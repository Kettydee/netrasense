"""API-level regression tests for the lightweight sensor bridge.

Verifies that ``/api/latest`` and ``/`` never report fabricated or stale
telemetry as live hardware data:

* before any reading arrives: NO DATA, no distance, no threat level;
* a fresh real reading is exposed with its mapped threat level;
* stale telemetry is withheld and explained via ``last_error``;
* serial disconnection is distinguishable from missing telemetry;
* the service index never invents a distance.

Run from the server directory:
    python3 -m unittest test_sensor_bridge
"""

from __future__ import annotations

import time
import unittest

try:
    import sensor_bridge  # noqa: F401  (requires flask + flask-cors)

    HAVE_BRIDGE = True
except ImportError:  # pragma: no cover - environment without flask-cors
    sensor_bridge = None
    HAVE_BRIDGE = False


@unittest.skipUnless(HAVE_BRIDGE, "flask/flask-cors not installed in this environment")
class SensorBridgeApiTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.app = sensor_bridge.app.test_client()

    def setUp(self):
        sensor_bridge.latest_reading = None
        sensor_bridge.last_reading_time = 0.0
        sensor_bridge.reading_count = 0
        sensor_bridge.last_invalid_telemetry = None
        sensor_bridge.obstacle_evaluator.reset()
        sensor_bridge.obstacle_evaluator.update_config(stale_timeout_s=3.0)
        sensor_bridge.reader.connected_port = None
        sensor_bridge.reader.connected_since = None
        sensor_bridge.reader.last_error = None

    def tearDown(self):
        sensor_bridge.reader.connected_port = None
        sensor_bridge.reader.last_error = None
        sensor_bridge.obstacle_evaluator.reset()
        sensor_bridge.obstacle_evaluator.update_config(stale_timeout_s=3.0)

    def _prime_reading(self, distance_cm=120.0):
        """Simulate a connected port plus a fresh validated reading."""
        sensor_bridge.reader.connected_port = "FAKE0"
        sensor_bridge.on_sensor_reading(
            {
                "distance_cm": distance_cm,
                "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                "device_id": "NETRA-001",
                "threat_level": "WARNING" if distance_cm <= 300 else "NORMAL",
                "processing_latency_ms": 0.5,
            }
        )

    def test_no_initial_reading_reports_no_data(self):
        """With no reading ever received, nothing may look healthy or measured."""
        data = self.app.get("/api/latest").get_json()

        self.assertEqual(data["threat_level"], "NO DATA")
        self.assertIsNone(data["sensor_data"])
        self.assertFalse(data["sensor_status"]["connected"])
        self.assertIsNotNone(data["sensor_status"]["last_error"])

        ultrasonic = data["hardware_status"]["ultrasonic"]
        self.assertFalse(ultrasonic["active"])
        self.assertEqual(ultrasonic["status"], "NOT ACTIVE")
        self.assertIsNone(ultrasonic["distance_cm"])
        self.assertIsNone(ultrasonic["threat_level"])
        self.assertFalse(ultrasonic["is_clear"])
        self.assertTrue(ultrasonic["is_unavailable"])

        self.assertEqual(data["obstacle_warning"]["state"], "SENSOR_UNAVAILABLE")
        self.assertFalse(data["obstacle_warning"]["is_clear"])
        self.assertEqual(data["hardware_status"]["system"]["status"], "NO HARDWARE")

    def test_index_never_invents_a_distance(self):
        data = self.app.get("/").get_json()
        self.assertIsNone(data["latest_distance_cm"])
        self.assertEqual(data["status"], "scanning")

    def test_fresh_reading_is_exposed_with_mapped_threat(self):
        self._prime_reading(distance_cm=120.0)
        data = self.app.get("/api/latest").get_json()

        self.assertEqual(data["threat_level"], "Warning")
        self.assertIsNotNone(data["sensor_data"])
        self.assertEqual(data["sensor_data"]["distance_cm"], 120.0)
        self.assertTrue(data["sensor_status"]["connected"])
        self.assertIsNone(data["sensor_status"]["last_error"])

        ultrasonic = data["hardware_status"]["ultrasonic"]
        self.assertTrue(ultrasonic["active"])
        self.assertEqual(ultrasonic["status"], "ACTIVE")
        self.assertEqual(ultrasonic["distance_cm"], 120.0)
        self.assertEqual(ultrasonic["threat_level"], "WARNING")
        self.assertTrue(ultrasonic["is_warning"])
        self.assertFalse(ultrasonic["is_clear"])
        self.assertEqual(data["hardware_status"]["arduino"]["status"], "CONNECTED")

        index = self.app.get("/").get_json()
        self.assertEqual(index["status"], "online")
        self.assertEqual(index["latest_distance_cm"], 120.0)

    def test_stale_telemetry_is_withheld_and_explained(self):
        self._prime_reading(distance_cm=350.0)  # CLEAR while fresh
        # Shrink the stale window rather than rewinding the monotonic clock:
        # the evaluator uses 0.0 as its "never read" sentinel, so large rewinds
        # are not portable across hosts whose monotonic clock is still small.
        sensor_bridge.obstacle_evaluator.update_config(stale_timeout_s=0.05)
        sensor_bridge.last_reading_time = time.time() - 60.0
        time.sleep(0.1)  # let the fresh CLEAR reading exceed the stale window

        data = self.app.get("/api/latest").get_json()

        self.assertEqual(data["threat_level"], "NO DATA")
        self.assertIsNone(data["sensor_data"])
        self.assertFalse(data["sensor_status"]["connected"])
        # The port handle survives: this is missing telemetry, not a dead link.
        self.assertEqual(data["sensor_status"]["port"], "FAKE0")
        self.assertIn("No sensor data", data["sensor_status"]["last_error"])

        ultrasonic = data["hardware_status"]["ultrasonic"]
        self.assertFalse(ultrasonic["active"])
        self.assertIsNone(ultrasonic["distance_cm"])
        self.assertIsNone(ultrasonic["threat_level"])
        self.assertFalse(ultrasonic["is_clear"])

        # A stale CLEAR must not survive as CLEAR.
        self.assertEqual(data["obstacle_warning"]["state"], "SENSOR_UNAVAILABLE")
        self.assertFalse(data["obstacle_warning"]["is_clear"])

    def test_serial_disconnection_is_distinguishable_from_missing_telemetry(self):
        self._prime_reading(distance_cm=120.0)
        sensor_bridge.reader.connected_port = None  # link gone
        sensor_bridge.reader.last_error = "Serial connection lost (device unplugged)"

        data = self.app.get("/api/latest").get_json()
        self.assertFalse(data["sensor_status"]["connected"])
        self.assertIsNone(data["sensor_status"]["port"])
        self.assertEqual(
            data["sensor_status"]["last_error"], "Serial connection lost (device unplugged)"
        )
        self.assertEqual(data["hardware_status"]["arduino"]["status"], "DISCONNECTED")
        # Telemetry is withheld once the port handle is gone, even if the last
        # reading was recent.
        self.assertIsNone(data["sensor_data"])
        self.assertFalse(data["hardware_status"]["ultrasonic"]["active"])

    def test_response_contains_shared_hardware_status_contract(self):
        """The shared HardwareStatus shape must be complete for consumers."""
        data = self.app.get("/api/latest").get_json()
        hardware = data["hardware_status"]
        for key in ("system", "arduino", "ultrasonic", "obstacle_warning", "camera", "ai"):
            self.assertIn(key, hardware)
        self.assertIn("status", hardware["arduino"])
        self.assertIn("last_update", hardware["arduino"])
        self.assertIn("total_readings", hardware["arduino"])
        self.assertIn("device_id", hardware["ultrasonic"])
        self.assertIn("timestamp", hardware["ultrasonic"])
        self.assertIn("status", hardware["ultrasonic"])
        self.assertIn("sensor_heartbeat_timeout_s", hardware["system"])

    def test_buzzer_endpoint_never_claims_unsupported_firmware_control(self):
        """A serial write cannot be presented as an acknowledged buzzer action."""
        response = self.app.post("/api/buzzer", json={"pattern": "ALARM"})
        data = response.get_json()
        self.assertEqual(response.status_code, 501)
        self.assertFalse(data["success"])
        self.assertFalse(data["supported"])
        self.assertEqual(data["pattern"], "ALARM")
        self.assertIn("does not implement", data["error"])

    def test_invalid_telemetry_hides_prior_valid_reading_without_refreshing_age(self):
        self._prime_reading(distance_cm=350.0)
        age_before = sensor_bridge.obstacle_evaluator.evaluate().age_seconds
        sensor_bridge.on_invalid_sensor_telemetry({
            "timestamp": "2026-10-15T00:00:01Z", "error": "Invalid ultrasonic telemetry",
        })
        data = self.app.get("/api/latest").get_json()
        self.assertIsNone(data["sensor_data"])
        self.assertEqual(data["threat_level"], "NO DATA")
        self.assertTrue(data["obstacle_warning"]["is_error"])
        self.assertIsNotNone(data["invalid_telemetry"])
        self.assertGreaterEqual(sensor_bridge.obstacle_evaluator.evaluate().age_seconds, age_before)

    def test_freshness_timeout_equality_is_active(self):
        self._prime_reading(distance_cm=120.0)
        original = sensor_bridge.obstacle_evaluator.evaluate
        try:
            sensor_bridge.obstacle_evaluator.evaluate = lambda: type("E", (), {"age_seconds": 3.0})()
            self.assertTrue(sensor_bridge._telemetry_fresh()[0])
        finally:
            sensor_bridge.obstacle_evaluator.evaluate = original


if __name__ == "__main__":
    unittest.main()
