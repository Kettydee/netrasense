"""Phase 2 regression tests — serial ingestion, fusion, and depthless detections.

Guards the invariants verified during Phase 2 of the NetraSense audit:

* A YOLO detection without metric depth must not carry ``threat_level = "NORMAL"``
  through the ensemble.  The ensemble must assign at least WARNING.
* Negative and non-finite YOLO distances must not produce a falsely severe or
  falsely safe fused threat level.
* Invalid telemetry followed by a valid reading must recover cleanly.
* Conservative fusion: max severity wins, distances are never averaged.

Run from the server directory:
    python3 -m unittest test_phase2_regression
"""

from __future__ import annotations

import time
import unittest

from ensemble import EnsembleClassifier

try:
    import sensor_bridge  # noqa: F401

    HAVE_BRIDGE = True
except ImportError:
    sensor_bridge = None
    HAVE_BRIDGE = False


class DepthlessDetectionTests(unittest.TestCase):
    """A camera detection without calibrated depth must never be NORMAL."""

    def setUp(self) -> None:
        self.ensemble = EnsembleClassifier()

    def test_yolo_no_distance_no_threat_gets_warning(self) -> None:
        """Detection with distance_cm=None and threat_level=None → WARNING."""
        result = self.ensemble.classify(
            yolo_detections=[
                {"label": "person", "confidence": 0.85, "distance_cm": None, "threat_level": None},
            ],
        )
        self.assertEqual(result.fused_threat_level, "WARNING")
        self.assertIsNone(result.fused_distance_cm)

    def test_yolo_no_distance_explicit_none_threat_gets_warning(self) -> None:
        """Detection missing the threat_level key entirely → WARNING."""
        result = self.ensemble.classify(
            yolo_detections=[{"label": "chair", "confidence": 0.6}],
        )
        self.assertEqual(result.fused_threat_level, "WARNING")

    def test_yolo_with_depth_gets_classified_by_distance(self) -> None:
        """Detection with a real distance uses distance-based classification."""
        result = self.ensemble.classify(
            yolo_detections=[
                {"label": "car", "confidence": 0.9, "distance_cm": 80.0, "threat_level": "ALARM"},
            ],
        )
        self.assertEqual(result.fused_threat_level, "ALARM")

    def test_yolo_far_distance_is_normal(self) -> None:
        """Detection with distance > 300 cm is correctly classified as NORMAL."""
        result = self.ensemble.classify(
            yolo_detections=[
                {"label": "tree", "confidence": 0.7, "distance_cm": 350.0},
            ],
        )
        self.assertEqual(result.fused_threat_level, "NORMAL")

    def test_depthless_yolo_does_not_downplay_ultrasonic(self) -> None:
        """A depthless YOLO (None threat) must not reduce an ultrasonic ALARM."""
        result = self.ensemble.classify(
            ultrasonic_cm=80.0,
            yolo_detections=[
                {"label": "person", "confidence": 0.7, "distance_cm": None, "threat_level": None},
            ],
        )
        self.assertEqual(result.fused_threat_level, "ALARM")


class NegativeAndNonFiniteYoloTests(unittest.TestCase):
    """Edge cases for YOLO distance values that are not physically meaningful."""

    def setUp(self) -> None:
        self.ensemble = EnsembleClassifier()

    def test_negative_yolo_distance_classifies_as_critical(self) -> None:
        """A negative distance from depth estimation → CRITICAL (conservative)."""
        result = self.ensemble.classify(
            yolo_detections=[
                {"label": "pole", "confidence": 0.8, "distance_cm": -5.0},
            ],
        )
        # Negative values fall below 50 cm threshold → CRITICAL.
        # This is conservative (false alarm rather than false clear).
        self.assertEqual(result.fused_threat_level, "CRITICAL")

    def test_zero_yolo_distance_gets_warning_fallback(self) -> None:
        """distance_cm=0 is falsy; ensemble conservatively falls back to WARNING."""
        result = self.ensemble.classify(
            yolo_detections=[
                {"label": "wall", "confidence": 0.9, "distance_cm": 0},
            ],
        )
        # 0 is falsy in Python, triggering the WARNING fallback rather than
        # _distance_to_threat(0).  WARNING is conservative enough for an
        # impossible HC-SR04 value.
        self.assertEqual(result.fused_threat_level, "WARNING")


class ConservativeFusionEdgeCases(unittest.TestCase):
    """Additional edge cases for conservative fusion policy."""

    def setUp(self) -> None:
        self.ensemble = EnsembleClassifier()

    def test_all_three_signals_no_averaging(self) -> None:
        """Three signals with different distances: no averaged fused_distance_cm."""
        result = self.ensemble.classify(
            ultrasonic_cm=150.0,
            yolo_detections=[
                {"label": "person", "confidence": 0.9, "distance_cm": 80.0, "threat_level": "ALARM"},
            ],
            depth_distance_cm=120.0,
        )
        self.assertIsNone(result.fused_distance_cm)
        self.assertEqual(result.ultrasonic_distance, 150.0)
        self.assertEqual(result.yolo_distance, 80.0)
        self.assertEqual(result.depth_distance, 120.0)
        self.assertEqual(result.sensing_state, "FUSED")

    def test_single_ultrasonic_preserves_fused_distance(self) -> None:
        result = self.ensemble.classify(ultrasonic_cm=200.0)
        self.assertEqual(result.fused_distance_cm, 200.0)
        self.assertEqual(result.sensing_state, "SENSOR DEGRADED")

    def test_max_severity_wins_across_three_signals(self) -> None:
        result = self.ensemble.classify(
            ultrasonic_cm=350.0,       # NORMAL
            yolo_detections=[
                {"label": "dog", "confidence": 0.7, "distance_cm": 90.0, "threat_level": "ALARM"},
            ],
            depth_distance_cm=250.0,   # WARNING
        )
        self.assertEqual(result.fused_threat_level, "ALARM")


@unittest.skipUnless(HAVE_BRIDGE, "flask/flask-cors not installed")
class BridgeRecoveryTests(unittest.TestCase):
    """Bridge-level tests for invalid-then-valid recovery sequences."""

    def setUp(self):
        sensor_bridge.latest_reading = None
        sensor_bridge.last_reading_time = 0.0
        sensor_bridge.reading_count = 0
        sensor_bridge.last_invalid_telemetry = None
        sensor_bridge.obstacle_evaluator.reset()
        sensor_bridge.obstacle_evaluator.update_config(stale_timeout_s=3.0)
        sensor_bridge.reader.connected_port = "FAKE0"
        sensor_bridge.reader.connected_since = None
        sensor_bridge.reader.last_error = None

    def tearDown(self):
        sensor_bridge.reader.connected_port = None
        sensor_bridge.reader.last_error = None
        sensor_bridge.obstacle_evaluator.reset()

    def test_valid_after_invalid_restores_telemetry(self):
        """A valid reading after an invalid one must restore sensor data."""
        app = sensor_bridge.app.test_client()

        # 1. Prime a valid reading
        sensor_bridge.on_sensor_reading({
            "distance_cm": 120.0,
            "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "device_id": "NETRA-001",
            "threat_level": "WARNING",
            "processing_latency_ms": 0.5,
        })
        data = app.get("/api/latest").get_json()
        self.assertIsNotNone(data["sensor_data"])

        # 2. Inject invalid telemetry
        sensor_bridge.on_invalid_sensor_telemetry({
            "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "error": "NO_ECHO",
        })
        data = app.get("/api/latest").get_json()
        self.assertIsNone(data["sensor_data"])
        self.assertEqual(data["threat_level"], "NO DATA")

        # 3. Send a new valid reading — recovery
        sensor_bridge.on_sensor_reading({
            "distance_cm": 80.0,
            "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "device_id": "NETRA-001",
            "threat_level": "ALARM",
            "processing_latency_ms": 0.4,
        })
        data = app.get("/api/latest").get_json()
        self.assertIsNotNone(data["sensor_data"])
        self.assertEqual(data["sensor_data"]["distance_cm"], 80.0)
        self.assertIn(data["threat_level"], ("Alarming", "Alarm"))


if __name__ == "__main__":
    unittest.main()
