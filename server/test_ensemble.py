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

    def test_invalid_ultrasonic_measurement_is_not_clear_evidence(self) -> None:
        result = self.ensemble.classify(ultrasonic_cm=401.0)
        self.assertEqual(result.fused_threat_level, "NO DATA")
        self.assertEqual(result.sensing_state, "NO VALID DATA")

    def test_supplied_ultrasonic_label_cannot_downplay_distance(self) -> None:
        result = self.ensemble.classify(ultrasonic_cm=40.0, ultrasonic_threat="NORMAL")
        self.assertEqual(result.fused_threat_level, "CRITICAL")

    def test_exact_distance_boundaries_match_canonical_policy(self) -> None:
        expected = {
            49.9: "CRITICAL", 50.0: "ALARM", 50.1: "ALARM",
            99.9: "ALARM", 100.0: "WARNING", 100.1: "WARNING",
            299.9: "WARNING", 300.0: "WARNING", 300.1: "NORMAL",
        }
        for distance_cm, threat in expected.items():
            with self.subTest(distance_cm=distance_cm):
                self.assertEqual(
                    self.ensemble.classify(ultrasonic_cm=distance_cm).fused_threat_level,
                    threat,
                )

    def test_multiple_visual_objects_do_not_share_one_ultrasonic_range(self) -> None:
        result = self.ensemble.classify(
            ultrasonic_cm=80.0,
            yolo_detections=[
                {"label": "person", "confidence": 0.95, "distance_cm": None},
                {"label": "chair", "confidence": 0.70, "distance_cm": 220.0, "threat_level": "WARNING"},
            ],
        )
        self.assertEqual(result.fused_threat_level, "ALARM")
        self.assertEqual(result.sensing_state, "FUSED")
        self.assertIsNone(result.fused_distance_cm)
        self.assertEqual(result.ultrasonic_distance, 80.0)
        self.assertIsNone(result.yolo_distance)

    def test_invalid_distance_values_are_never_classified(self) -> None:
        invalid_values = [float("nan"), float("inf"), float("-inf"), True, False, 0, -5]
        for value in invalid_values:
            with self.subTest(value=value):
                result = self.ensemble.classify(ultrasonic_cm=value)
                self.assertEqual(result.fused_threat_level, "NO DATA")
                self.assertEqual(result.sensing_state, "NO VALID DATA")
                self.assertIsNone(result.fused_distance_cm)

    def test_string_distance_is_not_accepted(self) -> None:
        # A string cannot be a valid metric distance; the ensemble must not
        # silently coerce it into a number and classify it.
        result = self.ensemble.classify(ultrasonic_cm="400")
        self.assertEqual(result.fused_threat_level, "NO DATA")
        self.assertEqual(result.sensing_state, "NO VALID DATA")
        self.assertIsNone(result.fused_distance_cm)

    def test_legacy_400_cm_no_echo_sentinel_is_not_normal(self) -> None:
        # The firmware encodes a failed ultrasonic measurement (no echo) as the
        # legacy 400.0 cm sentinel.  The ensemble must not turn this into a
        # NORMAL threat level; it is unavailable data, not a calibrated range.
        result = self.ensemble.classify(ultrasonic_cm=400.0)
        self.assertEqual(result.fused_threat_level, "NO DATA")
        self.assertEqual(result.sensing_state, "NO VALID DATA")
        self.assertIsNone(result.fused_distance_cm)


if __name__ == "__main__":
    unittest.main()
