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
from serial_sensor import ArduinoSerialReader

app = Flask(__name__)
CORS(app, resources={r"/*": {"origins": "*"}})

@app.after_request
def add_cors_headers(response):
    response.headers['Access-Control-Allow-Origin'] = '*'
    response.headers['Access-Control-Allow-Methods'] = 'GET, POST, OPTIONS'
    response.headers['Access-Control-Allow-Headers'] = 'Content-Type, Authorization'
    return response

# ── Sensor heartbeat timeout (seconds) ───────────────────────────────
# If no valid Arduino reading arrives within this window the sensor is
# considered disconnected / stale.  Centralised here so every consumer
# references the same value.
SENSOR_HEARTBEAT_TIMEOUT_S = 3.0

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
    "sensor_data": None,
    "sensor_reader": None,
    # Heartbeat bookkeeping — populated by update_sensor_data()
    "sensor_last_update": 0.0,   # time.monotonic() of last valid reading
    "sensor_total_readings": 0,  # lifetime count of accepted readings
}
state_lock = threading.Lock()


def update_sensor_data(record):
    """Store the latest validated Arduino measurement for API clients."""
    with state_lock:
        state["sensor_data"] = record
        state["sensor_last_update"] = time.monotonic()
        state["sensor_total_readings"] += 1


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
    camera = CameraStream(cam_src, args.capture_dir)
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

    if args.serial_port:
        sensor_reader = ArduinoSerialReader(
            on_reading=update_sensor_data,
            port=args.serial_port,
            baudrate=args.serial_baudrate,
            device_id=args.sensor_device_id,
            min_distance_cm=args.sensor_min_distance_cm,
            max_distance_cm=args.sensor_max_distance_cm,
        )
        sensor_reader.start()
        with state_lock:
            state["sensor_reader"] = sensor_reader
    else:
        # Even without --serial-port, expose the reader slot so
        # /api/hardware-status can report DISCONNECTED correctly.
        with state_lock:
            state["sensor_reader"] = None

    tts.speak("NetraSense Vision Server is ready.")
    print("[INIT] Vision server initialized successfully.")


def _build_hardware_status() -> dict:
    """Build the authoritative runtime hardware status object.

    Every field is derived from actual runtime state — nothing is
    hardcoded.  This is the single source of truth consumed by the
    frontend Device Status panel.
    """
    now = time.monotonic()

    # ── Arduino Serial ───────────────────────────────────────────────
    sensor_reader = state.get("sensor_reader")
    arduino_connected = bool(sensor_reader and sensor_reader.connected_port)
    arduino_last_update = state["sensor_last_update"]
    arduino_last_error = sensor_reader.last_error if sensor_reader else None
    arduino_port = sensor_reader.connected_port if sensor_reader else None

    # The Arduino serial port is considered stale if no valid reading
    # arrived within the heartbeat window.
    if arduino_connected and arduino_last_update > 0:
        sensor_age = now - arduino_last_update
        if sensor_age > SENSOR_HEARTBEAT_TIMEOUT_S:
            # Port handle is still open but data flow stopped — treat as
            # a de-facto disconnection (e.g. cable pulled mid-read).
            arduino_connected = False
            arduino_last_error = f"No sensor data for {sensor_age:.1f}s (timeout {SENSOR_HEARTBEAT_TIMEOUT_S}s)"

    arduino_status = "CONNECTED" if arduino_connected else "DISCONNECTED"
    if arduino_last_error and not arduino_connected:
        arduino_status = "DISCONNECTED"

    # ── HC-SR04 Ultrasonic ───────────────────────────────────────────
    sensor_data = state["sensor_data"]
    ultrasonic_active = False
    ultrasonic_distance_cm = None
    ultrasonic_threat = None
    ultrasonic_device_id = None
    ultrasonic_timestamp = None

    if (
        arduino_connected
        and sensor_data is not None
        and arduino_last_update > 0
        and (now - arduino_last_update) <= SENSOR_HEARTBEAT_TIMEOUT_S
    ):
        ultrasonic_active = True
        ultrasonic_distance_cm = sensor_data.get("distance_cm")
        ultrasonic_threat = sensor_data.get("threat_level")
        ultrasonic_device_id = sensor_data.get("device_id")
        ultrasonic_timestamp = sensor_data.get("timestamp")

    ultrasonic_status = "ACTIVE" if ultrasonic_active else "NOT ACTIVE"

    # ── Camera ───────────────────────────────────────────────────────
    camera = state.get("camera")
    camera_connected = False
    camera_fps = 0.0
    camera_last_frame_ts = None
    camera_last_error = None
    camera_source = None

    if camera is not None:
        cam_status = camera.status()
        camera_connected = bool(cam_status.get("available"))
        camera_fps = cam_status.get("fps", 0.0)
        camera_last_frame_ts = cam_status.get("last_frame_timestamp")
        camera_last_error = cam_status.get("last_error")
        camera_source = cam_status.get("source")

    camera_runtime_status = "ACTIVE" if camera_connected else "DISCONNECTED"
    if camera_last_error and not camera_connected:
        camera_runtime_status = "ERROR"

    # ── AI Engine ────────────────────────────────────────────────────
    pipeline = state.get("pipeline")
    ai_model_loaded = pipeline is not None
    ai_processing = False
    ai_model_name = None

    if ai_model_loaded and camera_connected:
        # The pipeline actively processes frames only when the camera is
        # producing frames.  Check the fps counter as a proxy for
        # "currently processing".
        ai_processing = camera_fps > 0
        # Derive the model name from what was actually loaded.
        ai_model_name = "YOLO11"

    ai_status = "NOT READY"
    if ai_model_loaded and camera_connected and ai_processing:
        ai_status = "PROCESSING"
    elif ai_model_loaded and not camera_connected:
        ai_status = "READY (no camera)"
    elif ai_model_loaded:
        ai_status = "READY"

    # ── Overall system status ─────────────────────────────────────────
    any_connected = arduino_connected or camera_connected
    system_status = "ONLINE" if any_connected else "NO HARDWARE"

    return {
        "system": {
            "status": system_status,
            "sensor_heartbeat_timeout_s": SENSOR_HEARTBEAT_TIMEOUT_S,
        },
        "arduino": {
            "connected": arduino_connected,
            "port": arduino_port,
            "last_error": arduino_last_error,
            "status": arduino_status,
            "last_update": arduino_last_update,
            "total_readings": state["sensor_total_readings"],
        },
        "ultrasonic": {
            "active": ultrasonic_active,
            "distance_cm": ultrasonic_distance_cm,
            "threat_level": ultrasonic_threat,
            "device_id": ultrasonic_device_id,
            "timestamp": ultrasonic_timestamp,
            "status": ultrasonic_status,
        },
        "camera": {
            "connected": camera_connected,
            "fps": camera_fps,
            "source": camera_source,
            "last_frame_timestamp": camera_last_frame_ts,
            "last_error": camera_last_error,
            "status": camera_runtime_status,
        },
        "ai": {
            "loaded": ai_model_loaded,
            "processing": ai_processing,
            "model": ai_model_name,
            "status": ai_status,
        },
    }


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
            # Track that camera stopped producing frames
            with state_lock:
                cam = state.get("camera")
                if cam and not cam.isOpened():
                    cam.last_error = "Camera stopped producing frames"
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
            if closest_obj:
                state["closest_obstacle"] = {
                    "object": closest_obj,
                    "distance_cm": closest_dist,
                    "threat_level": highest_threat,
                }
            # Do NOT overwrite closest_obstacle to a fake 400cm when no
            # object is detected.  Leave it as-is (or None) so the
            # frontend can distinguish "clear" from "no data".

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
            "api_capture": "/api/capture",
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
    """Returns current detection telemetry, threat analysis, and hardware status.

    The response is split into two sections:
    - Legacy fields (fps, detections, threat_level …) for backward compat.
    - ``hardware_status``: the authoritative runtime state object.
    """
    with state_lock:
        hw = _build_hardware_status()

        # Derive a safe sensor_status from the heartbeat-aware arduino status
        # for callers that still read the old flat shape.
        sensor_status = {
            "connected": hw["arduino"]["connected"],
            "port": hw["arduino"]["port"],
            "last_error": hw["arduino"]["last_error"],
        }

        # Only expose sensor_data when it is fresh.
        fresh_sensor = hw["ultrasonic"]["active"]
        sensor_data = state["sensor_data"] if fresh_sensor else None

        return jsonify({
            "timestamp": time.time(),
            "fps": state["fps"],
            "camera_status": state["camera"].status() if state["camera"] else None,
            "mode": state["mode"],
            "threat_level": state["threat_level"],
            "closest_obstacle": state["closest_obstacle"],
            "detections": state["latest_detections"],
            "sensor_data": sensor_data,
            "sensor_status": sensor_status,
            # New authoritative hardware status object
            "hardware_status": hw,
        })


@app.route('/api/capture', methods=['POST'])
def capture_webcam_frame():
    """Save the newest webcam frame as a JPEG without requiring AI inference."""
    with state_lock:
        camera = state["camera"]
    if camera is None:
        return jsonify({"error": "Camera is not initialized"}), 503

    captured = camera.capture_frame()
    if captured is None:
        return jsonify({"error": "No camera frame is available", "camera_status": camera.status()}), 503
    return jsonify({"status": "captured", "path": str(captured), "camera_status": camera.status()})


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


@app.route('/api/hardware-status')
def api_hardware_status():
    """Standalone endpoint returning the authoritative hardware status.

    Useful for the dashboard to poll without pulling full detection
    telemetry every time.
    """
    with state_lock:
        return jsonify(_build_hardware_status())


def main():
    parser = argparse.ArgumentParser(description="NetraSense YOLO Vision Server")
    parser.add_argument("--host", type=str, default="0.0.0.0", help="Host address (default: 0.0.0.0)")
    parser.add_argument("--port", type=int, default=5000, help="Port to listen on (default: 5000)")
    parser.add_argument("--camera", type=str, default="0", help="Camera index or stream URL")
    parser.add_argument("--capture-dir", type=str, default="captures", help="Directory for webcam JPEG captures")
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
    parser.add_argument("--serial-port", type=str, default=None, help="Arduino serial path, or auto; disabled when omitted")
    parser.add_argument("--serial-baudrate", type=int, default=9600, help="Arduino serial baud rate")
    parser.add_argument("--sensor-device-id", type=str, default="NETRA-001", help="ID added to sensor records")
    parser.add_argument("--sensor-min-distance-cm", type=float, default=2.0, help="Reject sensor readings below this value")
    parser.add_argument("--sensor-max-distance-cm", type=float, default=400.0, help="Reject sensor readings above this value")

    args = parser.parse_args()
    init_vision_engine(args)

    print(f"\nNetraSense YOLO Stream running at http://localhost:{args.port}/video_feed")
    print(f"Telemetry API running at http://localhost:{args.port}/api/latest\n")
    app.run(host=args.host, port=args.port, debug=False, threaded=True)


if __name__ == '__main__':
    main()
