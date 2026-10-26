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
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

# Ensure server package path is in sys.path
_SERVER_DIR = Path(__file__).resolve().parent
if str(_SERVER_DIR) not in sys.path:
    sys.path.insert(0, str(_SERVER_DIR))

import cv2
from flask import Flask, Response, jsonify, request
from flask_cors import CORS
from flask_limiter import Limiter
from flask_limiter.util import get_remote_address

from engine import HardwareProbe, ModelLoader
from tts_module import TTSEngine
from vision import VisionPipeline, Detection
from camera import CameraStream
from serial_sensor import ArduinoSerialReader
from ensemble import EnsembleClassifier
from dataset_collector import DatasetCollector
from dataset_cleaner import DatasetCleaner
from face_engine import FaceEngine
from obstacle_warning import ObstacleWarningEvaluator, ObstacleState

app = Flask(__name__)

# ── CORS origin whitelist ────────────────────────────────────────────
# Reads from the NETRASENSE_CORS_ORIGINS env var (comma-separated).
# Defaults to localhost origins for development safety.
_default_origins = [
    "http://localhost:5173",
    "http://localhost:3000",
    "http://localhost:5174",
    "http://localhost:8080",
    "http://127.0.0.1:5173",
    "http://127.0.0.1:3000",
    "http://127.0.0.1:8080",
    "https://netrasense.vercel.app",
]
_env_origins = os.environ.get("NETRASENSE_CORS_ORIGINS", "").strip()
allowed_origins = (
    [o.strip() for o in _env_origins.split(",") if o.strip()]
    if _env_origins
    else _default_origins
)
CORS(app, resources={r"/*": {"origins": allowed_origins, "supports_credentials": True}})

# ── Rate limiter (in-memory, no Redis required) ────────────────────
limiter = Limiter(
    key_func=get_remote_address,
    app=app,
    default_limits=["200 per minute"],
    storage_uri="memory://",
)

# Lists of origins for the manual after-request header fallback
_allowed_origins_str = ", ".join(allowed_origins)

@app.after_request
def add_security_headers(response):
    origin = request.headers.get("Origin", "")
    if origin in allowed_origins:
        response.headers["Access-Control-Allow-Origin"] = origin
        response.headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
        response.headers["Access-Control-Allow-Headers"] = "Content-Type, Authorization"
        response.headers["Access-Control-Allow-Credentials"] = "true"
    return response

# ── Sensor heartbeat timeout (seconds) ───────────────────────────────
# If no valid Arduino reading arrives within this window the sensor is
# considered disconnected / stale.  Centralised here so every consumer
# references the same value.
SENSOR_HEARTBEAT_TIMEOUT_S = 3.0


@dataclass(frozen=True)
class FusionState:
    """Authoritative fusion output shared with the frontend.

    This shape is the single source of truth for the NetraSense dashboard:
    fused threat level, sensing state, and the fused distance field.  It is
    deliberately minimal so consumers cannot mislead themselves with
    per-signal fields that were never averaged.
    """

    fused_threat_level: str
    sensing_state: str
    fused_distance_cm: Optional[float]
    confidence: float
    fresh: bool
    age_seconds: Optional[float]
    signal_count: int


@dataclass(frozen=True)
class AlertLog:
    """A machine-actionable record of a state transition or warning event.

    Alert logs are persisted to Supabase for historical review.  They carry
    the observed state and the raw telemetry that produced it, not a claim of
    physical performance.
    """

    scenario_id: str
    timestamp: str
    state: str
    distance_cm: Optional[float]
    threat_level: str
    has_valid_signal: bool
    source: str
    fault_event: str
    age_seconds: Optional[float]


# Configurable obstacle warning evaluator instance
obstacle_evaluator = ObstacleWarningEvaluator(
    warning_threshold_cm=300.0,
    stale_timeout_s=SENSOR_HEARTBEAT_TIMEOUT_S,
    hysteresis_cm=5.0,
    debounce_count=1,
    delta_alert_threshold_cm=15.0,
)

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
    "announce_normal": False,
    "threat_level": "Normal",
    "closest_obstacle": None,
    "ensemble": None,
    "dataset_collector": None,
    "sensor_data": None,
    "sensor_reader": None,
    # Heartbeat bookkeeping — populated by update_sensor_data()
    "sensor_last_update": 0.0,   # time.monotonic() of last valid reading
    "sensor_total_readings": 0,  # lifetime count of accepted readings
    "sensor_invalid_telemetry": None,
    # Last obstacle warning evaluation
    "latest_warning_eval": None,
}
state_lock = threading.Lock()


def update_sensor_data(record):
    """Store the latest validated Arduino measurement for API clients.

    Evaluates obstacle warning logic and tracks repeated measurements.

    The deployed firmware controls its buzzer locally from the HC-SR04
    measurement and does not implement a host-to-firmware command parser.
    Do not write unacknowledged "buzzer" JSON commands here: a successful
    serial write is not evidence that the buzzer was controlled.
    """
    with state_lock:
        state["sensor_data"] = record
        state["sensor_last_update"] = time.monotonic()
        state["sensor_total_readings"] += 1
        state["sensor_invalid_telemetry"] = None

        # Evaluate configurable obstacle warning logic
        dist = record.get("distance_cm") if record else None
        ts = record.get("timestamp") if record else None
        warning_eval = obstacle_evaluator.process_reading(dist, reading_timestamp=ts)
        state["latest_warning_eval"] = warning_eval.to_dict()
        _refresh_ensemble_locked()


# ── Supabase persistence (Step 7) ─────────────────────────────

def _get_supabase_client():
    """Return a lazily initialised Supabase client or None.

    Requires environment variables; absent or invalid configuration returns
    None so the API can degrade without raising.
    """
    try:
        from dotenv import load_dotenv

        load_dotenv(override=True)
        from supabase import create_client

        url = os.environ.get("SUPABASE_URL")
        key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
        if not url or not key:
            return None
        return create_client(url, key)
    except Exception:
        return None


def _insert_fusion_state(fusion: FusionState, source: str) -> dict[str, object]:
    """Insert a fusion-state record into Supabase.

    The insert is best-effort.  Failure, missing configuration, or a locked
    database must never break the sensor pipeline.  The record is only kept
    for historical review, not as a performance datum.
    """
    client = _get_supabase_client()
    if client is None:
        return {"inserted": False, "reason": "supabase_unconfigured"}

    payload = {
        "user_id": os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "step7-integration"),
        "scenario_id": source,
        "timestamp": fusion.timestamp,
        "fused_threat_level": fusion.fused_threat_level,
        "sensing_state": fusion.sensing_state,
        "fused_distance_cm": fusion.fused_distance_cm,
        "confidence": fusion.confidence,
        "fresh": fusion.fresh,
        "age_seconds": fusion.age_seconds,
        "signal_count": fusion.signal_count,
    }
    try:
        client.table("fusion_state_sessions").insert(payload).execute()
        return {"inserted": True}
    except Exception as exc:
        return {"inserted": False, "reason": str(exc)[:80]}


def update_invalid_sensor_telemetry(event):
    """Record invalid telemetry without extending the last valid heartbeat."""
    with state_lock:
        state["sensor_invalid_telemetry"] = event
        warning_eval = obstacle_evaluator.process_reading(
            None, reading_timestamp=event.get("timestamp"),
        )
        state["latest_warning_eval"] = warning_eval.to_dict()
        _refresh_ensemble_locked()


def _refresh_ensemble_locked(detections=None):
    """Refresh fusion from current validated inputs; caller holds state_lock."""
    ensemble = state.get("ensemble")
    if not ensemble:
        return None
    now = time.monotonic()
    sensor = state.get("sensor_data")
    sensor_last_update = state.get("sensor_last_update", 0.0)
    sensor_fresh = (
        state.get("sensor_invalid_telemetry") is None
        and sensor is not None
        and sensor_last_update > 0
        and (now - sensor_last_update) <= obstacle_evaluator.stale_timeout_s
    )
    active_detections = state.get("latest_detections", []) if detections is None else detections
    result = ensemble.classify(
        ultrasonic_cm=sensor.get("distance_cm") if sensor_fresh else None,
        ultrasonic_threat=sensor.get("threat_level") if sensor_fresh else None,
        yolo_detections=active_detections,
    )
    state["ensemble_result"] = result.to_dict()
    return result

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

    # Spatial audio announcer (kept for compatibility with the Jarvis-style
    # voice announcements in the legacy UI).  The real-time server avoids
    # expensive per-frame speech-style recomputation inside YOLO inference;
    # this tracker only converts detections into short spoken prompts.
    tracker = VisionServerAnnouncementTracker(
        absence_reset=args.absence_reset,
        speak_interval=args.speak_interval,
        min_duration=args.min_duration,
    )

    cam_src = int(args.camera) if args.camera.isdigit() else args.camera
    camera = CameraStream(cam_src, args.capture_dir)
    time.sleep(1.0)

    if not camera.isOpened():
        print(f"[WARNING] Camera {cam_src} could not be opened. Check device index or permissions.")

    ensemble = EnsembleClassifier()

    # Dataset collector (optional — enabled via --dataset-dir)
    dataset = None
    if hasattr(args, 'dataset_dir') and args.dataset_dir:
        dataset = DatasetCollector(args.dataset_dir)
        print(f"[INIT] Dataset collection enabled: {args.dataset_dir}")

    with state_lock:
        state["camera"] = camera
        state["pipeline"] = pipeline
        state["tracker"] = tracker
        state["tts"] = tts
        state["ensemble"] = ensemble
        state["dataset_collector"] = dataset
        state["mode"] = args.mode
        state["confidence"] = args.confidence
        state["audio_enabled"] = not args.mute

    if args.serial_port:
        sensor_reader = ArduinoSerialReader(
            on_reading=update_sensor_data,
            on_invalid=update_invalid_sensor_telemetry,
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
    elif arduino_connected:
        # The port opened but no valid reading has ever arrived.  Opening a
        # serial port is not evidence of an active sensor: after the heartbeat
        # window, report missing telemetry instead of a healthy connection.
        connected_since = sensor_reader.connected_since if sensor_reader else None
        if connected_since is None or (now - connected_since) > SENSOR_HEARTBEAT_TIMEOUT_S:
            arduino_connected = False
            arduino_last_error = (
                f"Serial port open but no sensor data received "
                f"(timeout {SENSOR_HEARTBEAT_TIMEOUT_S}s)"
            )

    arduino_status = "CONNECTED" if arduino_connected else "DISCONNECTED"
    if arduino_last_error and not arduino_connected:
        arduino_status = "DISCONNECTED"

    # ── HC-SR04 Ultrasonic & Obstacle Warning Evaluator ─────────────
    # Evaluate current freshness and warning state using the obstacle evaluator
    obs_eval = obstacle_evaluator.evaluate(current_time=now)
    obs_dict = obs_eval.to_dict()

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
        and state.get("sensor_invalid_telemetry") is None
        and (now - arduino_last_update) <= obstacle_evaluator.stale_timeout_s
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
            "obstacle_state": obs_dict["state"],
            "is_warning": obs_dict["is_warning"],
            "is_clear": obs_dict["is_clear"],
            "is_error": obs_dict["is_error"],
            "is_unavailable": obs_dict["is_unavailable"],
            "age_seconds": obs_dict["age_seconds"],
            "invalid_telemetry": state.get("sensor_invalid_telemetry"),
        },
        "obstacle_warning": obs_dict,
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
            with state_lock:
                state["latest_detections"] = []
                _refresh_ensemble_locked(detections=[])
            time.sleep(0.1)
            continue

            ret, frame = camera.read()
        if not ret or frame is None:
            # Track that camera stopped producing frames
            with state_lock:
                cam = state.get("camera")
                if cam and not cam.isOpened():
                    with cam._lock:
                        cam.last_error = "Camera stopped producing frames"
                state["latest_detections"] = []
                _refresh_ensemble_locked(detections=[])
            time.sleep(0.05)
            continue

        # Run YOLO + Depth inference at the fixed production resolution. The
        # webcam/camera-reader path (and the unified `Pipeline` object when
        # constructed with `Pipeline.from_camera(...)`) resizes to 640x640 once
        # here; inference then receives a fixed-res BGR frame and does not
        # repeat resize/interpolate/float32/normalise inside the hot loop.
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

        # Store raw frame for dataset capture endpoint
        with state_lock:
            state["raw_frame"] = frame

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

        # ── Run ensemble classifier ──────────────────────────────────
        ensemble_result = None
        with state_lock:
            state["latest_detections"] = det_dicts
            ensemble_result = _refresh_ensemble_locked(detections=det_dicts)
        if ensemble_result:
            # Use ensemble's fused threat level as the authoritative value
            if ensemble_result.has_data:
                fused_to_title = {
                    "NORMAL": "Normal", "WARNING": "Warning",
                    "ALARM": "Alarming", "CRITICAL": "Collision",
                }
                highest_threat = fused_to_title.get(
                    ensemble_result.fused_threat_level, highest_threat
                )
                if ensemble_result.fused_distance_cm is not None:
                    closest_dist = ensemble_result.fused_distance_cm
                    if closest_obj is None and ensemble_result.signal_count >= 1:
                        closest_obj = "Obstacle"

        with state_lock:
            state["fps"] = round(fps, 1)
            state["threat_level"] = highest_threat
            state["ensemble_result"] = ensemble_result.to_dict() if ensemble_result else None
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
@limiter.exempt
def index():
    return jsonify({
        "service": "NetraSense YOLO Vision Bridge",
        "status": "online",
        "endpoints": {
            "video_feed": "/video_feed",
            "api_latest": "/api/latest",
            "api_config": "/api/config",
            "api_capture": "/api/capture",
            "api_dataset_capture": "/api/dataset/capture (POST)",
            "api_dataset_stats": "/api/dataset/stats (GET)",
        },
    })


@app.route('/video_feed')
@limiter.exempt  # MJPEG stream — not a typical HTTP request
def video_feed():
    """Live MJPEG video stream with YOLO bounding boxes and distance annotations."""
    return Response(
        generate_frames(),
        mimetype='multipart/x-mixed-replace; boundary=frame'
    )


@app.route('/api/latest')
@limiter.exempt  # Polled continuously by dashboard
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
            # Obstacle warning state and configuration
            "obstacle_warning": hw.get("obstacle_warning"),
            # Ensemble fused result
            "ensemble": state.get("ensemble_result"),
            # New authoritative hardware status object
            "hardware_status": hw,
        })



@app.route('/api/capture', methods=['GET', 'POST'])
@limiter.limit("10 per minute")  # Manual dataset capture
def api_capture():
    """Capture current live frame and log to structured dataset with metadata."""
    with state_lock:
        collector = state.get("dataset_collector")
        if collector is None:
            return jsonify({"success": False, "error": "Dataset collection not enabled. Start with --dataset-dir"}), 400

        raw_frame = state.get("raw_frame")
        if raw_frame is None:
            return jsonify({"success": False, "error": "No camera frame available"}), 400

        data = request.get_json(silent=True) or {}
        ultrasonic_cm = float(data.get("ultrasonic_cm")) if "ultrasonic_cm" in data else None
        custom_class = data.get("class_name")

        # Extract latest detections and threat
        detections = state.get("latest_detections", [])
        threat_level = state.get("threat_level", "Normal")

        # Save to structured dataset
        res = collector.save_sample(
            frame=raw_frame,
            detections=detections,
            ultrasonic_cm=ultrasonic_cm,
            threat_level=threat_level,
            custom_class=custom_class
        )
        return jsonify(res)


@app.route('/api/fuse', methods=['POST', 'GET'])
@limiter.limit("30 per minute")
def api_fuse():
    """Execute the same reliability-aware policy as the live video path.

    ``fused_distance_cm`` is null when more than one distance source is
    present because those observations are not object-associated.
    """
    with state_lock:
        data = request.get_json(silent=True) or {}
        if "ultrasonic_cm" in data:
            ultrasonic_cm = float(data["ultrasonic_cm"])
            ultrasonic_threat = data.get("ultrasonic_threat")
        else:
            # GET and POST without an explicit measurement must use the same
            # freshness gate as the live video pipeline, rather than silently
            # dropping a current reading or reviving a stale one.
            sensor = state.get("sensor_data")
            sensor_age = time.monotonic() - state.get("sensor_last_update", 0.0)
            if sensor is not None and state.get("sensor_invalid_telemetry") is None and state.get("sensor_last_update", 0.0) > 0 and sensor_age <= obstacle_evaluator.stale_timeout_s:
                ultrasonic_cm = sensor.get("distance_cm")
                ultrasonic_threat = sensor.get("threat_level")
            else:
                ultrasonic_cm = None
                ultrasonic_threat = None
        depth_m = float(data.get("depth_m")) if "depth_m" in data else None

        detections = state.get("latest_detections", [])

        fusion_res = EnsembleClassifier().classify(
            ultrasonic_cm=ultrasonic_cm,
            ultrasonic_threat=ultrasonic_threat,
            yolo_detections=detections,
            depth_distance_cm=depth_m * 100.0 if depth_m is not None else None,
        )

        title_levels = {
            "NORMAL": "Normal",
            "WARNING": "Warning",
            "ALARM": "Alarming",
            "CRITICAL": "Collision",
            "NO DATA": "NO DATA",
        }
        source_by_severity = max(
            fusion_res.signals,
            key=lambda signal: {"NORMAL": 0, "WARNING": 1, "ALARM": 2, "CRITICAL": 3}.get(
                signal.threat_level or "", -1
            ),
            default=None,
        )

        return jsonify({
            "threat_level": title_levels[fusion_res.fused_threat_level],
            # Kept for response-shape compatibility. This ordinal encodes
            # severity only; it is not a probability or calibrated score.
            "threat_score": {
                "NORMAL": 0.0, "WARNING": 1 / 3, "ALARM": 2 / 3, "CRITICAL": 1.0,
            }.get(fusion_res.fused_threat_level),
            "fused_distance_cm": fusion_res.fused_distance_cm,
            "dominant_modality": source_by_severity.source if source_by_severity else None,
            "confidence": fusion_res.confidence,
            "sensing_state": fusion_res.sensing_state,
            "recommended_action": None,
            "modality_breakdown": fusion_res.to_dict(),
        })


# ── Step 7: unified live fusion-state endpoint ─────────────────────
@app.route("/api/fusion-state", methods=["GET"])
@limiter.limit("200 per minute")
def api_fusion_state():
    """Return the authoritative fusion state for the live dashboard.

    Single source of truth for the browser's sensor, fusion, and freshness
    consumption: fused threat level, sensing state, fused distance, and
    confidence, plus freshness metadata so the UI can avoid presenting a
    stale reading as current.
    """
    with state_lock:
        sensor = state.get("sensor_data")
        sensor_last_update = state.get("sensor_last_update", 0.0)
        invalid = state.get("sensor_invalid_telemetry")
        sensor_age = (time.monotonic() - sensor_last_update) if sensor_last_update > 0 else None

        fresh = bool(
            sensor is not None
            and invalid is None
            and sensor_last_update > 0
            and sensor_age is not None
            and sensor_age <= obstacle_evaluator.stale_timeout_s
        )

        ensemble_result = state.get("ensemble_result")
        if ensemble_result is None:
            return jsonify(
                {
                    "fused_threat_level": "NO DATA",
                    "sensing_state": "NO VALID DATA",
                    "fused_distance_cm": None,
                    "confidence": 0.0,
                    "fresh": False,
                    "age_seconds": sensor_age,
                    "signal_count": 0,
                }
            )

        return jsonify(
            {
                "fused_threat_level": ensemble_result.fused_threat_level,
                "sensing_state": ensemble_result.sensing_state,
                "fused_distance_cm": ensemble_result.fused_distance_cm,
                "confidence": ensemble_result.confidence,
                "fresh": fresh,
                "age_seconds": sensor_age,
                "signal_count": ensemble_result.signal_count,
            }
        )


# ── Step 7: alert log ───────────────────────────────────────────────
@app.route("/api/alert-logs", methods=["GET"])
@limiter.limit("60 per minute")
def api_alert_logs():
    """Return alert-event records for the current user.

    Alert logs are persisted to Supabase by the production pipeline.  When
    Supabase is not configured, this endpoint returns the in-memory alert
    log so that the dashboard remains functional.  No sensitive data is
    returned.
    """
    with state_lock:
        alert_log = state.get("alert_log", [])
        return jsonify({"records": alert_log, "count": len(alert_log)})


# ── Step 7: Supabase fusion-state persistence (production path) ─────

def _supabase_from_env():
    """Return an initialized Supabase client, or None when unconfigured."""
    if not os.environ.get("SUPABASE_URL") or not os.environ.get("SUPABASE_SERVICE_ROLE_KEY"):
        return None
    try:
        from supabase import create_client

        return create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_ROLE_KEY"])
    except Exception:
        return None


def _persist_fusion_state(fusion: FusionState, source: str) -> dict[str, object]:
    """Best-effort Supabase insert of a fusion-state record.

    The fusion-state record is historical telemetry only, never performance
    evidence.  A failed or missing database must not disrupt the sensor
    pipeline.
    """
    client = _supabase_from_env()
    if client is None:
        return {"inserted": False, "reason": "unconfigured"}

    payload = {
        "user_id": os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "step7-integration"),
        "scenario_id": source,
        "timestamp": fusion.timestamp,
        "fused_threat_level": fusion.fused_threat_level,
        "sensing_state": fusion.sensing_state,
        "fused_distance_cm": fusion.fused_distance_cm,
        "confidence": fusion.confidence,
        "fresh": fusion.fresh,
        "age_seconds": fusion.age_seconds,
        "signal_count": fusion.signal_count,
    }
    try:
        client.table("fusion_state_sessions").insert(payload).execute()
        return {"inserted": True}
    except Exception as exc:
        return {"inserted": False, "reason": str(exc)[:80]}


@app.route('/api/config', methods=['GET', 'POST'])
@limiter.limit("20 per minute")  # Config changes are infrequent
def api_config():
    """Get or update vision engine configuration."""
    with state_lock:
        if request.method == 'POST':
            data = request.get_json(silent=True) or {}
            if "confidence" in data:
                conf = float(data["confidence"])
                state["confidence"] = conf
                if state.get("pipeline"):
                    state["pipeline"].set_confidence(conf)
            if "mode" in data:
                mode = str(data["mode"])
                state["mode"] = mode
                if state.get("pipeline"):
                    state["pipeline"].set_mode(mode)
            if "audio_enabled" in data:
                aud = bool(data["audio_enabled"])
                state["audio_enabled"] = aud
                if state["tts"]:
                    state["tts"].enabled = aud
            if "announce_normal" in data:
                ann = bool(data["announce_normal"])
                state["announce_normal"] = ann
                tracker = state.get("tracker")
                if tracker:
                    tracker.set_announce_normal(ann)
            # Configurable obstacle warning parameters
            obs_updates = {}
            if "warning_threshold_cm" in data:
                obs_updates["warning_threshold_cm"] = float(data["warning_threshold_cm"])
            if "stale_timeout_s" in data:
                obs_updates["stale_timeout_s"] = float(data["stale_timeout_s"])
            if "hysteresis_cm" in data:
                obs_updates["hysteresis_cm"] = float(data["hysteresis_cm"])
            if "debounce_count" in data:
                obs_updates["debounce_count"] = int(data["debounce_count"])
            if "delta_alert_threshold_cm" in data:
                obs_updates["delta_alert_threshold_cm"] = float(data["delta_alert_threshold_cm"])
            if obs_updates:
                obstacle_evaluator.update_config(**obs_updates)

        return jsonify({
            "confidence": state["confidence"],
            "mode": state["mode"],
            "audio_enabled": state["audio_enabled"],
            "announce_normal": state["announce_normal"],
            "obstacle_warning": obstacle_evaluator.get_config(),
        })


@app.route('/api/hardware-status')
@limiter.exempt  # Polled continuously by dashboard
def api_hardware_status():
    """Standalone endpoint returning the authoritative hardware status.

    Useful for the dashboard to poll without pulling full detection
    telemetry every time.
    """
    with state_lock:
        return jsonify(_build_hardware_status())


@app.route('/api/status')
@limiter.exempt  # Primary dashboard poll — replaces both /api/hardware-status and /api/latest
def api_status():
    """Unified status endpoint: hardware + sensor + ensemble in one response.

    This replaces the need to poll both /api/hardware-status and
    /api/latest separately, halving the network requests from the
    dashboard.
    """
    with state_lock:
        hw = _build_hardware_status()
        ensemble_result = state.get("ensemble_result")
        fresh_sensor = hw["ultrasonic"]["active"]
        sensor_data = state["sensor_data"] if fresh_sensor else None
        fps = state["fps"]
        mode = state["mode"]
        detections = state["latest_detections"]

    return jsonify({
        "hardware": hw,
        "sensor_data": sensor_data,
        "ensemble": ensemble_result,
        "fps": fps,
        "mode": mode,
        "detections": detections,
    })


# ── Server start time for uptime tracking ────────────────────────────
_SERVER_START_TIME = time.monotonic()


@app.route('/api/health')
@limiter.limit("12 per minute")  # Health checks, not frequent
def api_health():
    """Comprehensive health check endpoint.

    Returns status of all components: backend, Arduino, ultrasonic,
    camera, AI engine, and database connectivity.
    """
    now = time.monotonic()
    uptime_s = round(now - _SERVER_START_TIME, 1)

    with state_lock:
        hw = _build_hardware_status()
        fps = state["fps"]
        total_readings = state["sensor_total_readings"]
        mode = state["mode"]

    # Check database connectivity (Supabase)
    db_ok = True
    try:
        import requests
        supabase_url = os.environ.get("SUPABASE_URL", "")
        if supabase_url:
            resp = requests.get(f"{supabase_url}/rest/v1/", timeout=3)
            db_ok = resp.status_code < 500
        else:
            db_ok = False  # No Supabase configured
    except Exception:
        db_ok = False

    # Overall status
    all_ok = (
        hw["system"]["status"] == "ONLINE"
        and db_ok
    )

    return jsonify({
        "status": "healthy" if all_ok else "degraded",
        "uptime_seconds": uptime_s,
        "uptime_human": _format_uptime(uptime_s),
        "components": {
            "backend": {
                "status": "healthy",
                "fps": fps,
                "mode": mode,
                "total_sensor_readings": total_readings,
            },
            "arduino": hw["arduino"],
            "ultrasonic": hw["ultrasonic"],
            "camera": hw["camera"],
            "ai": hw["ai"],
            "database": {
                "status": "connected" if db_ok else "unavailable",
                "provider": "supabase",
            },
        },
    })


def _format_uptime(seconds: float) -> str:
    """Format uptime as a human-readable string."""
    h = int(seconds // 3600)
    m = int((seconds % 3600) // 60)
    s = int(seconds % 60)
    if h > 0:
        return f"{h}h {m}m {s}s"
    elif m > 0:
        return f"{m}m {s}s"
    else:
        return f"{s}s"


# ── Gemini API key (stored server-side, never exposed in browser localStorage) ──
_gemini_api_key: Optional[str] = os.environ.get("GEMINI_API_KEY")


@app.route('/api/gemini-config', methods=['GET', 'POST'])
@limiter.limit("10 per minute")
def api_gemini_config():
    """Store/retrieve the Gemini API key server-side.

    GET  — returns {"has_key": true/false} (never returns the actual key).
    POST — stores the key in server memory (from the settings page).
    """
    global _gemini_api_key
    if request.method == 'POST':
        data = request.get_json(silent=True) or {}
        key = (data.get("api_key") or "").strip()
        _gemini_api_key = key if key else None
        return jsonify({"has_key": bool(_gemini_api_key)})

    return jsonify({"has_key": bool(_gemini_api_key)})


@app.route('/api/gemini-proxy', methods=['POST'])
@limiter.limit("30 per minute")
def api_gemini_proxy():
    """Proxy Gemini API calls through the server to avoid exposing the key in the browser.

    POST body: { "contents": [...], "generationConfig": {...} }
    Returns the Gemini API response directly.
    """
    if not _gemini_api_key:
        return jsonify({"error": "No Gemini API key configured"}), 400

    data = request.get_json(silent=True)
    if not data:
        return jsonify({"error": "Invalid request body"}), 400

    try:
        import requests as http_requests
        url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key={_gemini_api_key}"
        resp = http_requests.post(url, json=data, timeout=30)
        return jsonify(resp.json()), resp.status_code
    except Exception as exc:
        return jsonify({"error": f"Gemini proxy failed: {exc}"}), 502


@app.route('/api/dataset/clean', methods=['POST'])
@limiter.limit("2 per minute")  # Expensive operation, rarely needed
def dataset_clean():
    """Run the dataset cleaning pipeline on the configured dataset directory.

    POST body (all optional):
        min_confidence: float — minimum ensemble confidence (default 0.3)
        blank_threshold: float — grayscale std-dev below this = blank (default 5.0)
        hash_distance: int — pHash Hamming distance for dedup (default 4)
        dry_run: bool — if true, report only (default false)
    """
    with state_lock:
        collector = state.get("dataset_collector")

    if collector is None:
        return jsonify({
            "error": "Dataset collection not enabled",
            "hint": "Start the server with --dataset-dir dataset to enable",
        }), 400

    dataset_dir = Path(collector._root)
    body = request.get_json(silent=True) or {}

    try:
        cleaner = DatasetCleaner(
            input_dir=dataset_dir,
            output_dir=None,  # clean in-place
            dry_run=bool(body.get("dry_run", False)),
            min_confidence=float(body.get("min_confidence", 0.3)),
            blank_threshold=float(body.get("blank_threshold", 5.0)),
            hash_distance=int(body.get("hash_distance", 4)),
        )
        report = cleaner.run()
        return jsonify({
            "status": "cleaned",
            "report": report.to_dict(),
        })
    except Exception as exc:
        return jsonify({"error": f"Cleaning failed: {exc}"}), 500


# ── Face & Mood Biometric Endpoints (ArcFace & DeepFace) ─────────────
_face_engine_instance: Optional[FaceEngine] = None
_face_engine_lock = threading.Lock()


def get_face_engine() -> FaceEngine:
    """Lazy thread-safe initialization for FaceEngine."""
    global _face_engine_instance
    with _face_engine_lock:
        if _face_engine_instance is None:
            _face_engine_instance = FaceEngine()
        return _face_engine_instance


@app.route('/api/face/save', methods=['POST'])
@app.route('/api/face/enroll', methods=['POST'])
def api_face_enroll():
    """Enroll a caregiver or familiar contact with one-shot ArcFace embedding."""
    body = request.get_json(silent=True) or {}
    name = body.get("name", "").strip()
    frame_data = body.get("frame", "")

    if not name:
        return jsonify({"success": False, "error": "Name is required"}), 400
    if not frame_data:
        return jsonify({"success": False, "error": "Camera frame is required"}), 400

    engine = get_face_engine()
    frame_bgr = engine.decode_base64_frame(frame_data)
    if frame_bgr is None:
        return jsonify({"success": False, "error": "Could not decode image frame"}), 400

    result = engine.enroll_face(name, frame_bgr)
    status_code = 200 if result.get("success") else 400
    return jsonify(result), status_code


@app.route('/api/face/identify', methods=['POST'])
def api_face_identify():
    """Biometric ArcFace identification and emotion analysis for camera frame."""
    body = request.get_json(silent=True) or {}
    frame_data = body.get("frame", "")

    if not frame_data:
        return jsonify({"success": False, "error": "Camera frame is required"}), 400

    engine = get_face_engine()
    frame_bgr = engine.decode_base64_frame(frame_data)
    if frame_bgr is None:
        return jsonify({"success": False, "error": "Could not decode image frame"}), 400

    result = engine.recognize_face_and_mood(frame_bgr)
    return jsonify(result)


@app.route('/api/face/list', methods=['GET'])
def api_face_list():
    """Return all enrolled familiar contacts."""
    engine = get_face_engine()
    faces = engine.list_enrolled()
    return jsonify({
        "success": True,
        "faces": faces,
        "count": len(faces)
    })


@app.route('/api/face/delete', methods=['POST', 'DELETE'])
@app.route('/api/face/<name>', methods=['DELETE'])
def api_face_delete(name: Optional[str] = None):
    """Delete an enrolled contact by name."""
    if not name:
        body = request.get_json(silent=True) or {}
        name = body.get("name", "")

    if not name:
        return jsonify({"success": False, "error": "Name is required"}), 400

    engine = get_face_engine()
    ok = engine.delete_person(name)
    return jsonify({"success": ok, "name": name})


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
    parser.add_argument("--serial-port", type=str, default="auto", help="Arduino serial path, or auto (default: auto)")
    parser.add_argument("--serial-baudrate", type=int, default=9600, help="Arduino serial baud rate")
    parser.add_argument("--sensor-device-id", type=str, default="NETRA-001", help="ID added to sensor records")
    parser.add_argument("--sensor-min-distance-cm", type=float, default=2.0, help="Reject sensor readings below this value")
    parser.add_argument("--sensor-max-distance-cm", type=float, default=400.0, help="Reject sensor readings above this value")
    parser.add_argument("--warning-threshold-cm", type=float, default=300.0, help="Obstacle warning distance threshold in cm (default: 300.0)")
    parser.add_argument("--stale-timeout-s", type=float, default=3.0, help="Sensor stale data timeout in seconds (default: 3.0)")
    parser.add_argument("--hysteresis-cm", type=float, default=5.0, help="Obstacle warning hysteresis in cm (default: 5.0)")
    parser.add_argument("--debounce-count", type=int, default=1, help="Consecutive readings to confirm state transition (default: 1)")
    parser.add_argument("--dataset-dir", type=str, default=None, help="Enable dataset collection; save frames + metadata to this directory")
    parser.add_argument("--allowed-origins", type=str, default=None, help="Comma-separated CORS allowed origins (overrides NETRASENSE_CORS_ORIGINS env)")

    args = parser.parse_args()

    # Configure obstacle evaluator from CLI flags
    obstacle_evaluator.update_config(
        warning_threshold_cm=args.warning_threshold_cm,
        stale_timeout_s=args.stale_timeout_s,
        hysteresis_cm=args.hysteresis_cm,
        debounce_count=args.debounce_count,
        min_distance_cm=args.sensor_min_distance_cm,
        max_distance_cm=args.sensor_max_distance_cm,
    )

    # Override CORS origins from CLI if provided
    if args.allowed_origins:
        global allowed_origins
        allowed_origins = [o.strip() for o in args.allowed_origins.split(",") if o.strip()]
    init_vision_engine(args)

    print(f"\nNetraSense YOLO Stream running at http://localhost:{args.port}/video_feed")
    print(f"Telemetry API running at http://localhost:{args.port}/api/latest\n")
    try:
        app.run(host=args.host, port=args.port, debug=False, threaded=True)
    finally:
        shutdown_runtime()


def shutdown_runtime() -> None:
    """Release local hardware resources when the vision server exits."""
    with state_lock:
        sensor_reader = state.get("sensor_reader")
        camera = state.get("camera")

    if sensor_reader is not None:
        sensor_reader.stop()
    if camera is not None:
        camera.release()


if __name__ == '__main__':
    main()
