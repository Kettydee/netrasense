"""
NetraSense Lightweight Arduino Sensor Bridge
============================================
Streams live ultrasonic distance between Arduino Uno and the NetraSense web
dashboard over port 5000. The deployed firmware owns buzzer behavior locally.

Requirements:
    pip install flask flask-cors pyserial
"""

import time
import json
import logging
from flask import Flask, jsonify, request
from flask_cors import CORS
from serial_sensor import ArduinoSerialReader, classify_threat_level
from obstacle_warning import ObstacleWarningEvaluator, ObstacleState

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("SensorBridge")

app = Flask(__name__)
CORS(app, resources={r"/*": {"origins": "*"}})

# Configurable obstacle warning evaluator
obstacle_evaluator = ObstacleWarningEvaluator(
    warning_threshold_cm=300.0,
    stale_timeout_s=3.0,
    hysteresis_cm=5.0,
    debounce_count=1,
    delta_alert_threshold_cm=15.0,
)

# Global sensor state — no reading is assumed until real hardware reports one.
# (Intentionally untyped: sensor_bridge has no future-annotations import and
# must import cleanly on Python 3.9.)
latest_reading = None
last_reading_time = 0.0
reading_count = 0
last_invalid_telemetry = None

def on_sensor_reading(record):
    global latest_reading, last_reading_time, reading_count, last_invalid_telemetry
    latest_reading = record
    last_reading_time = time.time()
    reading_count += 1
    last_invalid_telemetry = None

    dist = record["distance_cm"]
    ts = record.get("timestamp")
    obstacle_evaluator.process_reading(dist, reading_timestamp=ts)


def on_invalid_sensor_telemetry(event):
    """Expose a failed measurement without refreshing valid telemetry."""
    global last_invalid_telemetry
    last_invalid_telemetry = event
    obstacle_evaluator.process_reading(None, reading_timestamp=event.get("timestamp"))

reader = ArduinoSerialReader(
    on_reading=on_sensor_reading,
    on_invalid=on_invalid_sensor_telemetry,
    port="auto",
    baudrate=9600,
    device_id="NETRA-001"
)


def _telemetry_fresh():
    """Return ``(fresh, age_seconds)`` from the latest valid reading timestamp.

    Freshness comes from the obstacle evaluator's own bookkeeping (which is
    updated only by validated readings) so telemetry freshness and the reported
    obstacle state can never disagree.
    """
    age = obstacle_evaluator.evaluate().age_seconds
    if age is None:
        return False, None
    # Equality is fresh across bridge, evaluator, and vision server.
    return age <= obstacle_evaluator.stale_timeout_s, age


def _sensor_status() -> dict:
    """Build sensor status from runtime evidence only.

    Distinguishes serial disconnection (no port handle) from missing telemetry
    (port open but no fresh readings) so a healthy state is never claimed when
    the sensor status is unknown or the data is stale.
    """
    fresh, age = _telemetry_fresh()
    port = reader.connected_port
    if port is None:
        connected = False
        last_error = reader.last_error or "Serial port not connected"
    elif not fresh:
        connected = False
        if age is None:
            last_error = "Serial port open but no sensor data received yet"
        else:
            last_error = (
                f"No sensor data for {age:.1f}s "
                f"(timeout {obstacle_evaluator.stale_timeout_s:.1f}s)"
            )
    else:
        connected = True
        last_error = None
    return {
        "connected": connected,
        "port": port,
        "last_error": last_error,
        "fresh": fresh,
        "age": age,
    }

@app.route("/", methods=["GET"])
def index():
    status = _sensor_status()
    fresh = status["fresh"]
    return jsonify({
        "service": "NetraSense Arduino Sensor Bridge",
        "status": "online" if status["connected"] else "scanning",
        "port": status["port"],
        "latest_distance_cm": latest_reading.get("distance_cm") if fresh and latest_reading else None
    })

@app.route("/api/latest", methods=["GET"])
def api_latest():
    """Authoritative API endpoint consumed by the NetraSense website dashboard."""
    now = time.time()
    obs_eval = obstacle_evaluator.evaluate()
    obs_dict = obs_eval.to_dict()

    status = _sensor_status()
    fresh = status["fresh"]
    has_reading = latest_reading is not None
    # Aligned with the vision server: a live port handle plus fresh data are
    # both required before telemetry is presented as active hardware data.
    telemetry_active = fresh and has_reading and status["connected"] and last_invalid_telemetry is None

    if telemetry_active and latest_reading is not None:
        dist = latest_reading["distance_cm"]
        raw_threat = latest_reading.get("threat_level") or classify_threat_level(dist)
        sensor_data = latest_reading
        ui_threat = (
            "Collision" if raw_threat == "CRITICAL"
            else "Alarming" if raw_threat == "ALARM"
            else "Warning" if raw_threat == "WARNING"
            else "Normal"
        )
    else:
        # No fresh telemetry: never report a fabricated or stale threat level.
        dist = None
        raw_threat = None
        sensor_data = None
        ui_threat = "NO DATA"

    arduino = {
        "connected": status["connected"],
        "port": status["port"],
        "last_error": status["last_error"],
        "status": "CONNECTED" if status["connected"] else "DISCONNECTED",
        "last_update": last_reading_time,
        "total_readings": reading_count,
    }
    ultrasonic = {
        "active": telemetry_active,
        "distance_cm": dist,
        "threat_level": raw_threat,
        "device_id": sensor_data.get("device_id") if sensor_data else None,
        "timestamp": sensor_data.get("timestamp") if sensor_data else None,
        "status": "ACTIVE" if telemetry_active else "NOT ACTIVE",
        "obstacle_state": obs_dict["state"],
        "is_warning": obs_dict["is_warning"],
        "is_clear": obs_dict["is_clear"],
        "is_error": obs_dict["is_error"],
        "is_unavailable": obs_dict["is_unavailable"],
        "age_seconds": obs_dict["age_seconds"],
    }

    return jsonify({
        "timestamp": now,
        "fps": 0,
        "threat_level": ui_threat,
        "sensor_data": sensor_data,
        "sensor_status": {
            "connected": status["connected"],
            "port": status["port"],
            "last_error": status["last_error"]
        },
        "obstacle_warning": obs_dict,
        "invalid_telemetry": last_invalid_telemetry,
        "hardware_status": {
            "system": {
                "status": "ONLINE" if status["connected"] else "NO HARDWARE",
                "sensor_heartbeat_timeout_s": obstacle_evaluator.stale_timeout_s,
            },
            "arduino": arduino,
            "ultrasonic": ultrasonic,
            "obstacle_warning": obs_dict,
            # This bridge has no camera or AI engine; report their absence
            # explicitly so consumers of the shared HardwareStatus shape see
            # truthful values instead of missing keys.
            "camera": {
                "connected": False,
                "fps": 0,
                "source": None,
                "last_frame_timestamp": None,
                "last_error": None,
                "status": "DISCONNECTED",
            },
            "ai": {
                "loaded": False,
                "processing": False,
                "model": None,
                "status": "NOT READY",
            },
        }
    })

@app.route("/api/config", methods=["GET", "POST"])
def api_config():
    """Get or update obstacle warning configuration."""
    if request.method == "POST":
        data = request.get_json(silent=True) or {}
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
        "obstacle_warning": obstacle_evaluator.get_config()
    })

@app.route("/api/buzzer", methods=["POST"])
def api_buzzer():
    """Report that host buzzer overrides are unsupported by deployed firmware.

    The response keeps the legacy ``success`` and ``pattern`` fields so
    callers do not mistake a serial write for an acknowledged hardware action.
    """
    data = request.get_json(silent=True) or {}
    pattern = data.get("pattern", "OFF").upper()
    return jsonify({
        "success": False,
        "pattern": pattern,
        "supported": False,
        "error": "Firmware does not implement host-controlled buzzer commands",
    }), 501

if __name__ == "__main__":
    logger.info("Starting NetraSense Arduino Serial Reader...")
    reader.start()
    try:
        logger.info("Sensor bridge web server listening on http://localhost:5000")
        app.run(host="0.0.0.0", port=5000, debug=False)
    finally:
        reader.stop()
