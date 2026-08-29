"""
NetraSense Vision Server — Realtime YOLO & Distance Inference Bridge
====================================================================
Streams real-time YOLO11 + Depth Anything V2 computer vision overlays
over MJPEG and REST API to the NetraSense web application.
"""

from __future__ import annotations

import argparse
import os
import sys
import time
import threading
from typing import Optional

import cv2
from flask import Flask, Response, jsonify, request
from flask_cors import CORS

from engine import HardwareProbe, ModelLoader
from tts_module import TTSEngine
from vision import VisionPipeline, AnnouncementTracker, Detection
from camera import CameraStream

app = Flask(__name__)
CORS(app, resources={r"/*": {"origins": "*"}})

@app.after_request
def add_cors_headers(response):
    response.headers['Access-Control-Allow-Origin'] = '*'
    response.headers['Access-Control-Allow-Methods'] = 'GET, POST, OPTIONS'
    response.headers['Access-Control-Allow-Headers'] = 'Content-Type, Authorization'
    return response

# Global pipeline state
state = {
    "camera": None,
    "pipeline": None,
    "tracker": None,
    "tts": None,
    "latest_detections": [],
    "fps": 0.0,
    "mode": "all",
    "confidence": 0.45,
    "audio_enabled": True,
    "threat_level": "Normal",
    "closest_obstacle": None,
}
state_lock = threading.Lock()


def init_vision_engine(args):
    print("=" * 60)
    print("  NetraSense YOLO Vision & Assistive Engine")
    print("=" * 60)

    probe = HardwareProbe()
    profile = probe.profile
    hw = probe.detect()
    print(f"[INIT] Hardware Tier : {hw['tier']}")
    print(f"[INIT] Platform      : {hw['platform']}")
    print(f"[INIT] Device CPU    : {hw['cpu']}")
    if hw["gpu"]:
        print(f"[INIT] GPU           : {hw['gpu']} ({hw['vram_gb']} GB)")

    loader = ModelLoader(profile)
    yolo_model = loader.load_yolo()
    depth_session = loader.load_depth() if not args.no_depth else None

    # TTS
    tts = TTSEngine(
        model_path=args.tts_model,
        speech_rate_scale=args.speech_rate,
        enabled=not args.mute,
    )

    pipeline = VisionPipeline(
        yolo_model=yolo_model,
        depth_session=depth_session,
        confidence=args.confidence,
        frame_width=args.frame_width,
        mode=args.mode,
    )

    tracker = AnnouncementTracker(
        absence_reset=args.absence_reset,
        speak_interval=args.speak_interval,
        min_duration=args.min_duration,
    )

    cam_src = int(args.camera) if args.camera.isdigit() else args.camera
    camera = CameraStream(cam_src)
    time.sleep(1.0)

    if not camera.isOpened():
        print(f"[WARNING] Camera {cam_src} could not be opened. Check device index or permissions.")

    with state_lock:
        state["camera"] = camera
        state["pipeline"] = pipeline
        state["tracker"] = tracker
        state["tts"] = tts
        state["mode"] = args.mode
        state["confidence"] = args.confidence
        state["audio_enabled"] = not args.mute

    tts.speak("NetraSense Vision Server is ready.")
    print("[INIT] Vision server initialized successfully.")


def generate_frames():
    prev_time = time.time()
    while True:
        with state_lock:
            camera = state["camera"]
            pipeline = state["pipeline"]
            tracker = state["tracker"]
            tts = state["tts"]

        if camera is None:
            time.sleep(0.1)
            continue

        ret, frame = camera.read()
        if not ret or frame is None:
            # Send black placeholder frame if camera unavailable
            blank = (b'--frame\r\n'
                     b'Content-Type: image/jpeg\r\n\r\n' + b'\r\n')
            time.sleep(0.05)
            continue

        # Run YOLO + Depth inference
        result = pipeline.process_frame(frame)

        curr_time = time.time()
        fps = 1.0 / (curr_time - prev_time + 1e-6)
        prev_time = curr_time

        # Update spatial audio announcements
        msg = tracker.update(result.detections)
        if msg and tts:
            tts.speak(msg)

        # Draw overlays
        annotated = pipeline.draw_overlays(result)
        cv2.putText(
            annotated, f"FPS: {int(fps)} | NetraSense AI", 
            (10, 25), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 255, 255), 2
        )

        # Update latest state
        highest_threat = "Normal"
        closest_dist = 999
        closest_obj = None

        threat_order = {"Normal": 0, "Warning": 1, "Alarming": 2, "Collision": 3}
        det_dicts = []
        for d in result.detections:
            det_dicts.append({
                "label": d.label,
                "confidence": round(d.confidence, 2),
                "direction": d.direction,
                "depth_meters": d.depth_meters,
                "distance_cm": d.distance_cm,
                "threat_level": d.threat_level,
                "bbox": [d.x1, d.y1, d.x2, d.y2],
            })
            if threat_order.get(d.threat_level, 0) > threat_order.get(highest_threat, 0):
                highest_threat = d.threat_level
            if d.distance_cm and d.distance_cm < closest_dist:
                closest_dist = d.distance_cm
                closest_obj = d.label

        with state_lock:
            state["latest_detections"] = det_dicts
            state["fps"] = round(fps, 1)
            state["threat_level"] = highest_threat
            state["closest_obstacle"] = {
                "object": closest_obj or "Clear",
                "distance_cm": closest_dist if closest_obj else 400,
                "threat_level": highest_threat,
            }

        # Encode JPEG
        ret, buffer = cv2.imencode('.jpg', annotated, [cv2.IMWRITE_JPEG_QUALITY, 80])
        if not ret:
            continue
        frame_bytes = buffer.tobytes()

        yield (b'--frame\r\n'
               b'Content-Type: image/jpeg\r\n\r\n' + frame_bytes + b'\r\n')


@app.route('/')
def index():
    return jsonify({
        "service": "NetraSense YOLO Vision Bridge",
        "status": "online",
        "endpoints": {
            "video_feed": "/video_feed",
            "api_latest": "/api/latest",
            "api_config": "/api/config",
        },
    })


@app.route('/video_feed')
def video_feed():
    """Live MJPEG video stream with YOLO bounding boxes and distance annotations."""
    return Response(
        generate_frames(),
        mimetype='multipart/x-mixed-replace; boundary=frame'
    )


@app.route('/api/latest')
def api_latest():
    """Returns current detection telemetry and threat analysis."""
    with state_lock:
        return jsonify({
            "timestamp": time.time(),
            "fps": state["fps"],
            "mode": state["mode"],
            "threat_level": state["threat_level"],
            "closest_obstacle": state["closest_obstacle"],
            "detections": state["latest_detections"],
        })


@app.route('/api/config', methods=['GET', 'POST'])
def api_config():
    """Get or update vision engine configuration."""
    with state_lock:
        if request.method == 'POST':
            data = request.get_json(silent=True) or {}
            if "confidence" in data:
                conf = float(data["confidence"])
                state["confidence"] = conf
                state["pipeline"].set_confidence(conf)
            if "mode" in data:
                mode = str(data["mode"])
                state["mode"] = mode
                state["pipeline"].set_mode(mode)
            if "audio_enabled" in data:
                aud = bool(data["audio_enabled"])
                state["audio_enabled"] = aud
                if state["tts"]:
                    state["tts"].enabled = aud

        return jsonify({
            "confidence": state["confidence"],
            "mode": state["mode"],
            "audio_enabled": state["audio_enabled"],
        })


def main():
    parser = argparse.ArgumentParser(description="NetraSense YOLO Vision Server")
    parser.add_argument("--host", type=str, default="0.0.0.0", help="Host address (default: 0.0.0.0)")
    parser.add_argument("--port", type=int, default=5000, help="Port to listen on (default: 5000)")
    parser.add_argument("--camera", type=str, default="0", help="Camera index or stream URL")
    parser.add_argument("--confidence", type=float, default=0.45, help="Confidence threshold")
    parser.add_argument("--frame-width", type=int, default=640, help="Frame width for processing")
    parser.add_argument("--mode", type=str, choices=["all", "indoor", "outdoor"], default="all")
    parser.add_argument("--speech-rate", type=float, default=1.0, help="TTS speech rate")
    parser.add_argument("--tts-model", type=str, default=None, help="Piper TTS model path")
    parser.add_argument("--mute", action="store_true", help="Disable server-side audio TTS")
    parser.add_argument("--no-depth", action="store_true", help="Disable Depth Anything V2")
    parser.add_argument("--speak-interval", type=float, default=2.0, help="Interval between speech announcements")
    parser.add_argument("--absence-reset", type=float, default=1.5, help="Absence reset time")
    parser.add_argument("--min-duration", type=float, default=0.4, help="Min continuous detection time")

    args = parser.parse_args()
    init_vision_engine(args)

    print(f"\nNetraSense YOLO Stream running at http://localhost:{args.port}/video_feed")
    print(f"Telemetry API running at http://localhost:{args.port}/api/latest\n")
    app.run(host=args.host, port=args.port, debug=False, threaded=True)


if __name__ == '__main__':
    main()
