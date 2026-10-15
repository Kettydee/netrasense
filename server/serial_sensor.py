"""Reliable Arduino ultrasonic-sensor ingestion and normalization.

Arduino may send one distance per line (for example ``73`` or ``73 cm``), or
JSON such as ``{\"distance_cm\": 73}``.  Each accepted line is converted to a
portable sensor record before it is passed to the application.
"""

from __future__ import annotations

import argparse
import json
import logging
import math
import re
import threading
import time
from datetime import datetime, timezone
from typing import Callable, Optional

try:
    import serial
    from serial.tools import list_ports
except ImportError:  # Lets unrelated vision features start without pyserial.
    serial = None
    list_ports = None


LOGGER = logging.getLogger(__name__)
_DISTANCE_PATTERN = re.compile(
    r"^\s*(?:distance(?:_cm)?\s*[:=]\s*)?([-+]?\d+(?:\.\d+)?)\s*(?:cm)?\s*$",
    re.IGNORECASE,
)


def classify_threat_level(distance_cm: float) -> str:
    """Classify distance using NetraSense's non-AI ultrasonic safety thresholds.

    Boundaries are deterministic: 300 cm is WARNING, 100 cm is WARNING, and
    50 cm is ALARM. NORMAL therefore starts at 300.01 cm for decimal sensors.
    """
    if distance_cm > 300:
        return "NORMAL"
    if distance_cm >= 100:
        return "WARNING"
    if distance_cm >= 50:
        return "ALARM"
    return "CRITICAL"


def utc_timestamp() -> str:
    """Return an unambiguous ISO-8601 UTC timestamp."""
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


# Status strings that assert the measurement is good. Anything else on a
# payload that carries a ``status`` field marks the measurement as failed.
_VALID_STATUS_VALUES = frozenset({"ok", "valid", "success", "good", "active", "true"})


def _flagged_valid(payload: dict) -> bool:
    """Honor an explicit ``valid``/``status`` marker from the firmware.

    Payloads without any marker are legacy (validity unknown) and pass through
    so old firmware keeps working.
    """
    if "valid" in payload or "is_valid" in payload:
        valid = payload.get("valid", payload.get("is_valid"))
        if isinstance(valid, str):
            return valid.strip().lower() in _VALID_STATUS_VALUES
        return bool(valid)
    if "status" in payload:
        status = payload.get("status")
        if isinstance(status, str):
            return status.strip().lower() in _VALID_STATUS_VALUES
        return status is None
    return True


def _parse_reading(raw_line: bytes | str) -> tuple[Optional[float], bool]:
    """Parse one Arduino line into ``(distance_cm, flagged_valid)``.

    ``distance_cm`` is ``None`` when the line carries no usable number.
    ``flagged_valid`` is True only when the firmware explicitly marked the
    measurement as good (``valid: true`` or an OK ``status``).  Legacy payloads
    and bare numbers carry no marker and return False so the caller can apply
    the stricter legacy range check.  Explicit ``valid: false`` / failure
    ``status`` payloads return ``(None, False)`` so a failed measurement can
    never become a reading.
    """
    if isinstance(raw_line, bytes):
        text = raw_line.decode("utf-8", errors="replace").strip()
    else:
        text = str(raw_line).strip()
    if not text:
        return None, False

    flagged_valid = False
    try:
        value = json.loads(text)
    except json.JSONDecodeError:
        match = _DISTANCE_PATTERN.fullmatch(text)
        if not match:
            return None, False
        value = match.group(1)
    else:
        if isinstance(value, dict):
            if not _flagged_valid(value):
                return None, False
            flagged_valid = "valid" in value or "is_valid" in value or (
                "status" in value and value.get("status") is not None
            )
            value = value.get("distance_cm", value.get("distance"))

    # bool is a number subclass but never a meaningful measurement.
    if isinstance(value, bool) or not isinstance(value, (int, float, str)):
        return None, flagged_valid
    try:
        distance = float(value)
    except (TypeError, ValueError):
        return None, flagged_valid
    if not math.isfinite(distance):
        return None, flagged_valid
    return distance, flagged_valid


def parse_distance_cm(raw_line: bytes | str) -> Optional[float]:
    """Extract a finite distance in centimetres from a single Arduino line.

    Returns ``None`` for malformed input and for measurements the firmware
    explicitly marked as failed (``valid: false`` / failure ``status``).
    """
    return _parse_reading(raw_line)[0]


def normalize_sensor_data(
    raw_line: bytes | str,
    device_id: str = "NETRA-001",
    min_distance_cm: float = 2.0,
    max_distance_cm: float = 400.0,
) -> Optional[dict[str, int | float | str]]:
    """Return the shared sensor-data record, or ``None`` for invalid input.

    Rejected input never produces a record, so an invalid measurement cannot
    refresh the last-valid-reading timestamp.  Legacy payloads without an
    explicit validity marker are rejected at exactly ``max_distance_cm``:
    older firmware reports a failed ultrasonic measurement (no echo) as the
    sentinel value ``400.0`` (the configured maximum), which must never be
    accepted as a real "path is clear" distance.
    """
    started_at = time.perf_counter()
    distance, flagged_valid = _parse_reading(raw_line)
    if distance is None:
        return None
    if flagged_valid:
        if not min_distance_cm <= distance <= max_distance_cm:
            return None
    elif not min_distance_cm <= distance < max_distance_cm:
        return None
    # Preserve whole-centimetre Arduino measurements as integers.
    normalized_distance: int | float = int(distance) if distance.is_integer() else round(distance, 2)
    return {
        "distance_cm": normalized_distance,
        "timestamp": utc_timestamp(),
        "device_id": device_id,
        "threat_level": classify_threat_level(distance),
        # Local time from receipt of the complete serial line to a ready record.
        "processing_latency_ms": round((time.perf_counter() - started_at) * 1000, 3),
    }


class ArduinoSerialReader:
    """Reconnectable background reader for a USB-connected Arduino.

    Set ``port`` to a device path (for example ``/dev/tty.usbmodem1101``), or
    ``None``/``auto`` to rediscover a likely Arduino-compatible USB device.

    Supports sending commands back to Arduino (e.g. buzzer control) via
    ``send_command()``.
    """

    def __init__(
        self,
        on_reading: Callable[[dict[str, int | float | str]], None],
        port: Optional[str] = None,
        baudrate: int = 9600,
        device_id: str = "NETRA-001",
        min_distance_cm: float = 2.0,
        max_distance_cm: float = 400.0,
        reconnect_delay: float = 2.0,
        reset_delay: float = 1.5,
    ) -> None:
        self.on_reading = on_reading
        self.port = port
        self.baudrate = baudrate
        self.device_id = device_id
        self.min_distance_cm = min_distance_cm
        self.max_distance_cm = max_distance_cm
        self.reconnect_delay = reconnect_delay
        # Arduino boards commonly reset when USB serial opens; wait before reading.
        self.reset_delay = reset_delay
        self.connected_port: Optional[str] = None
        self.connected_since: Optional[float] = None
        self.last_error: Optional[str] = None
        self._stop_event = threading.Event()
        self._thread: Optional[threading.Thread] = None
        self._connection: Optional[serial.Serial] = None
        self._connection_lock = threading.Lock()

    def start(self) -> None:
        if serial is None:
            raise RuntimeError("pyserial is required. Install dependencies with: pip install -r requirements.txt")
        if self._thread and self._thread.is_alive():
            return
        self._stop_event.clear()
        self._thread = threading.Thread(target=self._run, name="arduino-serial-reader", daemon=True)
        self._thread.start()

    def stop(self, timeout: float = 3.0) -> None:
        self._stop_event.set()
        if self._thread:
            self._thread.join(timeout=timeout)

    def _resolve_port(self) -> Optional[str]:
        if self.port and self.port.lower() != "auto":
            return self.port
        if list_ports is None:
            return None
        preferred = ("arduino", "ch340", "cp210", "usb serial", "usbmodem", "usbserial")
        ports = list(list_ports.comports())
        for port_info in ports:
            description = f"{port_info.description} {port_info.manufacturer or ''}".lower()
            if any(name in description or name in port_info.device.lower() for name in preferred):
                return port_info.device
        return ports[0].device if len(ports) == 1 else None

    def _mark_disconnected(self) -> None:
        """Clear all connection state so status never claims a dead link."""
        self.connected_port = None
        self.connected_since = None
        with self._connection_lock:
            self._connection = None

    def _run(self) -> None:
        while not self._stop_event.is_set():
            port = self._resolve_port()
            if not port:
                self._mark_disconnected()
                self._wait_to_retry("No Arduino serial port found")
                continue
            try:
                with serial.Serial(port, self.baudrate, timeout=1) as connection:
                    with self._connection_lock:
                        self._connection = connection
                    self.connected_port = port
                    self.connected_since = time.monotonic()
                    self.last_error = None
                    LOGGER.info("Connected to Arduino on %s at %s baud", port, self.baudrate)
                    # Arduino boards commonly reset when USB serial opens.
                    if self.reset_delay > 0:
                        time.sleep(self.reset_delay)
                    connection.reset_input_buffer()
                    while not self._stop_event.is_set():
                        raw_line = connection.readline()
                        if not raw_line:
                            continue
                        record = normalize_sensor_data(
                            raw_line, self.device_id, self.min_distance_cm, self.max_distance_cm,
                        )
                        if record is None:
                            LOGGER.warning("Discarded invalid ultrasonic reading: %r", raw_line[:100])
                            continue
                        try:
                            self.on_reading(record)
                        except Exception:
                            # A consumer bug must not kill the reader thread
                            # (that would silently freeze telemetry forever).
                            LOGGER.exception(
                                "Reading callback raised; serial reader continues",
                            )
            except (serial.SerialException, OSError) as exc:
                self._mark_disconnected()
                self._wait_to_retry(f"Serial connection lost ({exc})")
            except Exception as exc:
                # Unexpected failures (callback bugs, malformed input, OS
                # errors) must be logged, surfaced, and retried — never allowed
                # to terminate the reader thread silently.
                LOGGER.exception("Unexpected error in serial reader loop")
                self._mark_disconnected()
                self._wait_to_retry(f"Unexpected serial reader failure ({exc!r})")
            finally:
                self._mark_disconnected()

    def _wait_to_retry(self, message: str) -> None:
        self.last_error = message
        LOGGER.warning("%s; retrying in %ss", message, self.reconnect_delay)
        self._stop_event.wait(self.reconnect_delay)

    def send_command(self, command: dict) -> bool:
        """Send a JSON command to the Arduino (e.g. buzzer control).

        Parameters
        ----------
        command : dict
            Command to send, e.g. {"buzzer": "ALARM"}.

        Returns
        -------
        bool
            True if the command was sent successfully.
        """
        with self._connection_lock:
            conn = self._connection
        if conn is None or not conn.is_open:
            return False
        try:
            msg = json.dumps(command) + "\n"
            conn.write(msg.encode("utf-8"))
            return True
        except (serial.SerialException, OSError):
            return False


def main() -> None:
    parser = argparse.ArgumentParser(description="Print normalized Arduino ultrasonic sensor data as JSON")
    parser.add_argument("--port", default="auto", help="Serial path, or auto (default)")
    parser.add_argument("--baudrate", type=int, default=9600)
    parser.add_argument("--device-id", default="NETRA-001")
    parser.add_argument("--min-distance-cm", type=float, default=2.0)
    parser.add_argument("--max-distance-cm", type=float, default=400.0)
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    reader = ArduinoSerialReader(
        lambda record: print(json.dumps(record), flush=True),
        args.port, args.baudrate, args.device_id, args.min_distance_cm, args.max_distance_cm,
    )
    try:
        reader.start()
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        pass
    finally:
        reader.stop()


if __name__ == "__main__":
    main()
