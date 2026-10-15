"""Hardware-free lifecycle tests for ArduinoSerialReader (mocked serial port).

Covers the reliability contract of the background reader thread:

* valid lines are delivered as records; invalid lines are discarded;
* an exception thrown by the consumer callback does not kill the reader;
* a serial disconnection clears connection state and reports the error;
* the reader reconnects and recovers when readings resume;
* the retry loop is bounded (no busy loop);
* repeated start() calls never create duplicate reader threads;
* stop() cleans up connection state.

Run from the server directory:
    python3 -m unittest test_serial_reader
"""

from __future__ import annotations

import threading
import time
import unittest

import serial_sensor


class FakeSerialException(Exception):
    """Stand-in for serial.SerialException."""


class FakeConnection:
    def __init__(self, lines, drop_when_drained: bool = False):
        self._pending = list(lines)
        self._drop_when_drained = drop_when_drained
        self._lock = threading.Lock()
        self.is_open = True
        self.writes: list = []

    def readline(self) -> bytes:
        with self._lock:
            if self._pending:
                return self._pending.pop(0)
        if self._drop_when_drained:
            raise FakeSerialException("device disconnected")
        time.sleep(0.005)
        return b""

    def reset_input_buffer(self) -> None:
        pass

    def write(self, payload: bytes) -> int:
        self.writes.append(payload)
        return len(payload)

    def close(self) -> None:
        self.is_open = False

    def __enter__(self):
        return self

    def __exit__(self, *exc_info):
        self.close()
        return False


class FakeSerialModule:
    """Scripted stand-in for the parts of pyserial the reader uses.

    Each script entry is one connection attempt, in order:
      * ``(lines, drop_when_drained)`` — open a connection serving ``lines``;
      * an exception class/instance — fail to open with that error.
    An exhausted script keeps failing every attempt (like an absent device).
    """

    SerialException = FakeSerialException

    def __init__(self, script):
        self._script = list(script)
        self.attempts = 0

    def Serial(self, port, baudrate, timeout=None):  # noqa: N802 - mirrors pyserial
        self.attempts += 1
        if not self._script:
            raise FakeSerialException("no scripted connection available")
        item = self._script.pop(0)
        if isinstance(item, type) and issubclass(item, BaseException):
            raise item("scripted open failure")
        if isinstance(item, BaseException):
            raise item
        lines, drop = item
        return FakeConnection(lines, drop_when_drained=drop)


def _wait_until(predicate, timeout: float = 3.0) -> bool:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if predicate():
            return True
        time.sleep(0.01)
    return predicate()


class ArduinoSerialReaderTests(unittest.TestCase):
    def setUp(self):
        self._original_serial = serial_sensor.serial
        self._readings: list = []
        self._readings_lock = threading.Lock()
        self.reader = None
        self.fake = None

    def tearDown(self):
        if self.reader is not None:
            self.reader.stop(timeout=2.0)
        serial_sensor.serial = self._original_serial

    def _record(self, record):
        with self._readings_lock:
            self._readings.append(record)

    def _distances(self):
        with self._readings_lock:
            return [r["distance_cm"] for r in self._readings]

    def _make_reader(self, script, on_reading=None, on_invalid=None):
        self.fake = FakeSerialModule(script)
        serial_sensor.serial = self.fake
        self.reader = serial_sensor.ArduinoSerialReader(
            on_reading=on_reading or self._record,
            port="FAKE0",
            baudrate=9600,
            reconnect_delay=0.05,
            reset_delay=0.01,
            on_invalid=on_invalid,
        )
        return self.reader

    def test_delivers_valid_records_and_discards_invalid_lines(self):
        lines = [
            b'{"distance_cm": 73.0}\n',
            b"garbage line\n",
            b'{"distance_cm": 400.0}\n',        # legacy no-echo sentinel
            b'{"distance_cm": 150, "valid": false}\n',
            b'{"distance_cm": 80.0, "valid": true}\n',
        ]
        reader = self._make_reader([(lines, False)])
        reader.start()

        self.assertTrue(_wait_until(lambda: len(self._distances()) >= 2))
        time.sleep(0.05)  # window for any incorrectly delivered extras
        # Only the two genuine measurements became records; the malformed line,
        # the 400 cm sentinel and the explicitly failed measurement did not —
        # so none of them could refresh a freshness timestamp.
        self.assertEqual(self._distances(), [73, 80])
        self.assertEqual(reader.connected_port, "FAKE0")

    def test_invalid_lines_notify_consumer_without_becoming_readings(self):
        invalid_events = []
        reader = self._make_reader(
            [([b'{"distance_cm": 80, "valid": true}\n', b'{"distance_cm": null, "valid": false, "status": "NO_ECHO"}\n'], False)],
            on_invalid=invalid_events.append,
        )
        reader.start()
        self.assertTrue(_wait_until(lambda: len(self._distances()) == 1 and len(invalid_events) == 1))
        self.assertEqual(self._distances(), [80])
        self.assertEqual(invalid_events[0]["error"], "Invalid ultrasonic telemetry")

    def test_callback_exception_does_not_kill_reader_thread(self):
        calls: list = []

        def flaky_callback(record):
            calls.append(record["distance_cm"])
            if len(calls) == 1:
                raise ValueError("consumer bug")

        reader = self._make_reader(
            [([b'{"distance_cm": 73.0}\n', b'{"distance_cm": 90.0}\n'], False)],
            on_reading=flaky_callback,
        )

        with self.assertLogs(serial_sensor.LOGGER.name, level="ERROR") as logs:
            reader.start()
            self.assertTrue(_wait_until(lambda: len(calls) >= 2))

        self.assertEqual(calls, [73, 90])
        self.assertTrue(reader._thread.is_alive())
        self.assertEqual(reader.connected_port, "FAKE0")
        self.assertTrue(any("callback" in message for message in logs.output))

    def test_disconnect_marks_status_and_reconnects_with_recovery(self):
        reader = self._make_reader(
            [
                ([b'{"distance_cm": 73.0}\n'], True),  # drops after draining
                ([b'{"distance_cm": 90.0}\n'], True),  # second link delivers again
            ]
        )
        reader.start()

        # A reading arrived, the link dropped, and the reader recovered by
        # reconnecting and delivering the next reading.
        self.assertTrue(_wait_until(lambda: len(self._distances()) >= 2))
        self.assertEqual(self._distances(), [73, 90])

        # With every scripted connection gone, the reader must report the
        # disconnection instead of claiming a healthy link.
        self.assertTrue(
            _wait_until(
                lambda: reader.connected_port is None and reader.last_error is not None
            )
        )
        self.assertIn("Serial connection lost", reader.last_error)
        self.assertTrue(reader._thread.is_alive())

        reader.stop()
        self.assertIsNone(reader.connected_port)
        self.assertIsNone(reader._connection)

    def test_retry_loop_is_bounded_not_busy(self):
        reader = self._make_reader([])  # every open attempt fails
        reader.start()
        self.assertTrue(_wait_until(lambda: reader.last_error is not None))
        time.sleep(0.3)
        # reconnect_delay=0.05 s allows ~6 attempts in 0.3 s; a busy loop would
        # produce orders of magnitude more.
        self.assertLess(self.fake.attempts, 15)
        reader.stop()

    def test_repeated_start_does_not_create_duplicate_threads(self):
        reader = self._make_reader([([], False)])
        reader.start()
        reader.start()
        self.assertTrue(_wait_until(lambda: reader.connected_port == "FAKE0"))

        matching = [
            thread
            for thread in threading.enumerate()
            if thread.name == "arduino-serial-reader" and thread.is_alive()
        ]
        self.assertEqual(len(matching), 1)

        reader.stop()
        self.assertTrue(_wait_until(lambda: not reader._thread.is_alive()))


if __name__ == "__main__":
    unittest.main()
