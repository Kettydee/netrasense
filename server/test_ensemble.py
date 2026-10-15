"""Hardware-free regression tests for reliability-aware fusion policy."""

from __future__ import annotations

import unittest

from ensemble import EnsembleClassifier


class ReliabilityAwareFusionTests(unittest.TestCase):
    def setUp(self) -> None:
        self.ensemble = EnsembleClassifier()

    def test_no_modalities_is_explicitly_no_valid_data(self) -> None:
        result = self.ensemble.classify()
        self.assertEqual(result.fused_threat_level, "NO DATA")
        self.assertEqual(result.sensing_state, "NO VALID DATA")
        self.assertIsNone(result.fused_distance_cm)

    def test_ultrasonic_warning_survives_missing_camera(self) -> None:
        result = self.ensemble.classify(ultrasonic_cm=80.0)
        self.assertEqual(result.fused_threat_level, "ALARM")
        self.assertEqual(result.sensing_state, "SENSOR DEGRADED")
        self.assertEqual(result.fused_distance_cm, 80.0)

    def test_visual_detection_survives_missing_ultrasonic(self) -> None:
        result = self.ensemble.classify(
            yolo_detections=[{"label": "person", "confidence": 0.7, "distance_cm": None}],
        )
        self.assertEqual(result.fused_threat_level, "WARNING")
        self.assertEqual(result.sensing_state, "SENSOR DEGRADED")
        self.assertIsNone(result.fused_distance_cm)

    def test_conflicting_valid_observations_choose_safer_severity(self) -> None:
        result = self.ensemble.classify(
            ultrasonic_cm=250.0,
            yolo_detections=[{"label": "car", "confidence": 0.8, "distance_cm": 60.0, "threat_level": "ALARM"}],
        )
        self.assertEqual(result.fused_threat_level, "ALARM")
        self.assertEqual(result.sensing_state, "FUSED")

    def test_unrelated_distances_are_not_averaged(self) -> None:
        result = self.ensemble.classify(
            ultrasonic_cm=80.0,
            yolo_detections=[{"label": "person", "confidence": 0.9, "distance_cm": 250.0, "threat_level": "WARNING"}],
        )
        self.assertIsNone(result.fused_distance_cm)
        self.assertEqual(result.ultrasonic_distance, 80.0)
        self.assertEqual(result.yolo_distance, 250.0)


if __name__ == "__main__":
    unittest.main()
