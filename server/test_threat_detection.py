"""Hardware-free checks for NetraSense ultrasonic threat detection.

Run from the server directory:
    python test_threat_detection.py
"""

from __future__ import annotations

import statistics
import time
import unittest

from serial_sensor import normalize_sensor_data


SCENARIOS = (
    ("Object at 3 m", 300, "WARNING"),
    ("Object at 2 m", 200, "WARNING"),
    ("Object at 1 m", 100, "WARNING"),
    ("Object at 70 cm", 70, "ALARM"),
    ("Object at 40 cm", 40, "CRITICAL"),
)


class ThreatDetectionTests(unittest.TestCase):
    def test_requested_distances_have_expected_threat_levels(self) -> None:
        for label, distance_cm, expected_level in SCENARIOS:
            with self.subTest(label=label):
                record = normalize_sensor_data(str(distance_cm))
                self.assertIsNotNone(record)
                self.assertEqual(record["threat_level"], expected_level)

    def test_threshold_boundaries(self) -> None:
        expected = {301: "NORMAL", 300: "WARNING", 100: "WARNING", 99: "ALARM", 50: "ALARM", 49: "CRITICAL"}
        for distance_cm, expected_level in expected.items():
            with self.subTest(distance_cm=distance_cm):
                self.assertEqual(normalize_sensor_data(str(distance_cm))["threat_level"], expected_level)


def run_latency_report() -> None:
    """Print local parse/classify/record-build latency for the requested checks."""
    latencies_ms = []
    print("Threat detection validation (no Arduino or AI required)")
    for label, distance_cm, expected_level in SCENARIOS:
        started_at = time.perf_counter()
        record = normalize_sensor_data(str(distance_cm))
        latency_ms = (time.perf_counter() - started_at) * 1000
        latencies_ms.append(latency_ms)
        outcome = "PASS" if record and record["threat_level"] == expected_level else "FAIL"
        actual = record["threat_level"] if record else "invalid"
        print(f"{outcome:4} | {label:16} | {actual:8} | response latency: {latency_ms:.3f} ms")
    print(f"Average response latency: {statistics.mean(latencies_ms):.3f} ms")
    print(f"Maximum response latency: {max(latencies_ms):.3f} ms")


if __name__ == "__main__":
    run_latency_report()
    unittest.main(argv=["test_threat_detection.py"])
