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

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("SensorBridge")

app = Flask(__name__)
CORS(app, resources={r"/*": {"origins": "*"}})

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
    # Sensor heartbeat: stale after 3.0 seconds
    fresh = (now - last_reading_time) < 3.0 if last_reading_time > 0 else False
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
        "hardware_status": {
            "arduino": {
                "connected": is_connected and fresh,
                "port": active_port,
                "last_error": reader.last_error
            },
            "ultrasonic": {
                "active": fresh,
                "distance_cm": dist if fresh else None,
                "threat_level": raw_threat
            }
        }
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
