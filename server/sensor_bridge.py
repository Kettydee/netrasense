"""
NetraSense Lightweight Arduino Sensor Bridge
============================================
Streams live ultrasonic distance and buzzer commands between Arduino Uno
and the NetraSense web dashboard over port 5000.

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

# Global sensor state
latest_reading = {
    "distance_cm": 150.0,
    "timestamp": None,
    "device_id": "NETRA-001",
}
is_connected = False
active_port = None
last_reading_time = 0.0

def on_sensor_reading(record):
    global latest_reading, is_connected, active_port, last_reading_time
    latest_reading = record
    is_connected = True
    last_reading_time = time.time()
    active_port = reader.connected_port

    dist = record.get("distance_cm", 150)
    ts = record.get("timestamp")
    obstacle_evaluator.process_reading(dist, reading_timestamp=ts)
    threat = classify_threat_level(dist)

    # Automatic buzzer feedback control to Arduino
    if threat == "CRITICAL":
        reader.send_command({"buzzer": "CRITICAL"})
    elif threat == "ALARM":
        reader.send_command({"buzzer": "ALARM"})
    elif threat == "WARNING":
        reader.send_command({"buzzer": "WARNING"})
    else:
        reader.send_command({"buzzer": "OFF"})

reader = ArduinoSerialReader(
    on_reading=on_sensor_reading,
    port="auto",
    baudrate=9600,
    device_id="NETRA-001"
)

@app.route("/", methods=["GET"])
def index():
    return jsonify({
        "service": "NetraSense Arduino Sensor Bridge",
        "status": "online" if is_connected else "scanning",
        "port": active_port,
        "latest_distance_cm": latest_reading.get("distance_cm")
    })

@app.route("/api/latest", methods=["GET"])
def api_latest():
    """Authoritative API endpoint consumed by the NetraSense website dashboard."""
    now = time.time()
    obs_eval = obstacle_evaluator.evaluate()
    obs_dict = obs_eval.to_dict()

    fresh = (now - last_reading_time) < obstacle_evaluator.stale_timeout_s if last_reading_time > 0 else False
    dist = latest_reading.get("distance_cm", 150.0)
    raw_threat = classify_threat_level(dist)

    ui_threat = (
        "Collision" if raw_threat == "CRITICAL"
        else "Alarming" if raw_threat == "ALARM"
        else "Warning" if raw_threat == "WARNING"
        else "Normal"
    )

    return jsonify({
        "timestamp": now,
        "fps": 0,
        "threat_level": ui_threat,
        "sensor_data": latest_reading if fresh else None,
        "sensor_status": {
            "connected": is_connected and fresh,
            "port": active_port,
            "last_error": reader.last_error if not fresh else None
        },
        "obstacle_warning": obs_dict,
        "hardware_status": {
            "arduino": {
                "connected": is_connected and fresh,
                "port": active_port,
                "last_error": reader.last_error
            },
            "ultrasonic": {
                "active": fresh,
                "distance_cm": dist if fresh else None,
                "threat_level": raw_threat,
                "obstacle_state": obs_dict["state"],
                "is_warning": obs_dict["is_warning"],
                "is_clear": obs_dict["is_clear"],
                "is_error": obs_dict["is_error"],
                "is_unavailable": obs_dict["is_unavailable"],
                "age_seconds": obs_dict["age_seconds"],
            },
            "obstacle_warning": obs_dict,
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
    """Manual buzzer override endpoint."""
    data = request.get_json(silent=True) or {}
    pattern = data.get("pattern", "OFF").upper()
    success = reader.send_command({"buzzer": pattern})
    return jsonify({"success": success, "pattern": pattern})

if __name__ == "__main__":
    logger.info("Starting NetraSense Arduino Serial Reader...")
    reader.start()
    try:
        logger.info("Sensor bridge web server listening on http://localhost:5000")
        app.run(host="0.0.0.0", port=5000, debug=False)
    finally:
        reader.stop()
