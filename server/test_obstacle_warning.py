
"""Automated unit tests for ObstacleWarningEvaluator.

Verifies:
1. Valid distance below threshold (OBSTACLE_WARNING).
2. Valid distance exactly at threshold (OBSTACLE_WARNING).
3. Valid distance above threshold (CLEAR).
4. Invalid distance values (SENSOR_ERROR: strings, None, booleans, negative, out-of-range, NaN/Inf).
5. Missing sensor readings (SENSOR_UNAVAILABLE from start).
6. Stale readings (SENSOR_UNAVAILABLE after configured timeout).
7. Recovery after sensor error (SENSOR_ERROR -> valid reading -> OBSTACLE_WARNING or CLEAR).
8. Repeated readings that should not create duplicate alert events.
9. Significant distance change while still in warning triggers new alert event.
10. Debounce and hysteresis behavior.
"""

from __future__ import annotations

import unittest
from obstacle_warning import ObstacleWarningEvaluator, ObstacleState


class ObstacleWarningEvaluatorTests(unittest.TestCase):

    def setUp(self):
        self.evaluator = ObstacleWarningEvaluator(
            warning_threshold_cm=300.0,
            stale_timeout_s=3.0,
            hysteresis_cm=5.0,
            debounce_count=1,
            delta_alert_threshold_cm=15.0,
            min_distance_cm=2.0,
            max_distance_cm=400.0,
        )

    def test_missing_sensor_readings(self):
        """Initial state before any reading arrives must be SENSOR_UNAVAILABLE."""
        eval_res = self.evaluator.evaluate(current_time=100.0)
        self.assertEqual(eval_res.state, ObstacleState.SENSOR_UNAVAILABLE)
        self.assertTrue(eval_res.is_unavailable)
        self.assertFalse(eval_res.is_clear)
        self.assertFalse(eval_res.is_warning)
        self.assertIsNone(eval_res.distance_cm)
        self.assertEqual(eval_res.threat_level, "NONE")

    def test_valid_distance_below_threshold(self):
        """Valid distance < threshold triggers OBSTACLE_WARNING and raises an alert event."""
        res = self.evaluator.process_reading(120.0, reading_timestamp="2026-10-14T22:00:00Z", current_time=100.0)
        self.assertEqual(res.state, ObstacleState.OBSTACLE_WARNING)
        self.assertTrue(res.is_warning)
        self.assertFalse(res.is_clear)
        self.assertTrue(res.alert_triggered)
        self.assertEqual(res.distance_cm, 120.0)
        self.assertEqual(res.threat_level, "WARNING")

    def test_valid_distance_exactly_at_threshold(self):
        """Valid distance == threshold triggers OBSTACLE_WARNING."""
        res = self.evaluator.process_reading(300.0, current_time=100.0)
        self.assertEqual(res.state, ObstacleState.OBSTACLE_WARNING)
        self.assertTrue(res.is_warning)
        self.assertFalse(res.is_clear)
        self.assertTrue(res.alert_triggered)
        self.assertEqual(res.distance_cm, 300.0)
        self.assertEqual(res.threat_level, "WARNING")

    def test_valid_distance_above_threshold(self):
        """Valid distance > threshold results in CLEAR and does not trigger obstacle alert."""
        res = self.evaluator.process_reading(350.0, current_time=100.0)
        self.assertEqual(res.state, ObstacleState.CLEAR)
        self.assertTrue(res.is_clear)
        self.assertFalse(res.is_warning)
        self.assertFalse(res.alert_triggered)
        self.assertEqual(res.distance_cm, 350.0)
        self.assertEqual(res.threat_level, "NORMAL")

    def test_invalid_distance_values(self):
        """Negative numbers, booleans, out-of-range, and malformed inputs result in SENSOR_ERROR."""
        invalid_cases = [
            -5.0,       # Below min physical distance (2 cm)
            0.0,        # Below min physical distance
            1.5,        # Below min physical distance
            450.0,      # Above max physical distance (400 cm)
            "corrupted",# Non-numeric string
            True,       # Boolean
            False,      # Boolean
            None,       # None
            float("nan"), # NaN
            float("inf"), # Infinity
        ]
        for val in invalid_cases:
            with self.subTest(val=val):
                res = self.evaluator.process_reading(val, current_time=100.0)
                self.assertEqual(res.state, ObstacleState.SENSOR_ERROR)
                self.assertTrue(res.is_error)
                self.assertFalse(res.is_clear)
                self.assertFalse(res.is_warning)
                self.assertFalse(res.is_unavailable)
                self.assertIsNone(res.distance_cm)
                self.assertIsNotNone(res.error_message)

    def test_stale_readings_cannot_preserve_clear_indefinitely(self):
        """Fresh CLEAR reading becomes SENSOR_UNAVAILABLE once stale_timeout_s expires."""
        self.evaluator.process_reading(350.0, current_time=100.0)
        
        # 1.5s later: still fresh
        mid_eval = self.evaluator.evaluate(current_time=101.5)
        self.assertEqual(mid_eval.state, ObstacleState.CLEAR)
        self.assertFalse(mid_eval.is_unavailable)

        # 3.1s later: stale!
        stale_eval = self.evaluator.evaluate(current_time=103.1)
        self.assertEqual(stale_eval.state, ObstacleState.SENSOR_UNAVAILABLE)
        self.assertTrue(stale_eval.is_unavailable)
        self.assertFalse(stale_eval.is_clear)
        self.assertIsNone(stale_eval.distance_cm)
        self.assertIn("stale", stale_eval.error_message)

    def test_stale_readings_cannot_preserve_warning_indefinitely(self):
        """Fresh WARNING reading becomes SENSOR_UNAVAILABLE once stale_timeout_s expires."""
        self.evaluator.process_reading(80.0, current_time=100.0)
        
        stale_eval = self.evaluator.evaluate(current_time=103.5)
        self.assertEqual(stale_eval.state, ObstacleState.SENSOR_UNAVAILABLE)
        self.assertTrue(stale_eval.is_unavailable)
        self.assertFalse(stale_eval.is_warning)

    def test_recovery_after_sensor_error(self):
        """Sensor recovering from error transitions cleanly to correct state and alerts if warning."""
        # Step 1: Good reading
        self.evaluator.process_reading(350.0, current_time=100.0)
        self.assertEqual(self.evaluator.evaluate(100.0).state, ObstacleState.CLEAR)

        # Step 2: Error occurs
        err_res = self.evaluator.process_reading("bad_packet", current_time=100.5)
        self.assertEqual(err_res.state, ObstacleState.SENSOR_ERROR)

        # Step 3: Recovery with obstacle reading -> transitions to OBSTACLE_WARNING with alert_triggered
        rec_res = self.evaluator.process_reading(75.0, current_time=101.0)
        self.assertEqual(rec_res.state, ObstacleState.OBSTACLE_WARNING)
        self.assertTrue(rec_res.alert_triggered)
        self.assertEqual(rec_res.distance_cm, 75.0)
        self.assertEqual(rec_res.threat_level, "ALARM")

    def test_repeated_readings_do_not_create_duplicate_alerts(self):
        """Repeated measurements of the same obstacle should not generate alert events on every cycle."""
        # First reading: Obstacle encountered -> Alert triggered
        res1 = self.evaluator.process_reading(120.0, current_time=100.0)
        self.assertEqual(res1.state, ObstacleState.OBSTACLE_WARNING)
        self.assertTrue(res1.alert_triggered)

        # Second cycle: 121 cm (delta < 15 cm threshold) -> OBSTACLE_WARNING maintained, but NO duplicate alert event
        res2 = self.evaluator.process_reading(121.0, current_time=100.1)
        self.assertEqual(res2.state, ObstacleState.OBSTACLE_WARNING)
        self.assertFalse(res2.alert_triggered)

        # Third cycle: 119.5 cm -> Still no duplicate alert
        res3 = self.evaluator.process_reading(119.5, current_time=100.2)
        self.assertEqual(res3.state, ObstacleState.OBSTACLE_WARNING)
        self.assertFalse(res3.alert_triggered)

    def test_significant_distance_change_triggers_new_alert_event(self):
        """When distance changes by >= delta_alert_threshold_cm while remaining in warning, alert triggers."""
        # Initial warning at 150 cm
        res1 = self.evaluator.process_reading(150.0, current_time=100.0)
        self.assertTrue(res1.alert_triggered)

        # Small shift to 140 cm (10 cm delta < 15) -> no alert
        res2 = self.evaluator.process_reading(140.0, current_time=100.1)
        self.assertFalse(res2.alert_triggered)

        # Significant movement: obstacle got closer to 80 cm (70 cm delta >= 15) -> Alert triggers!
        res3 = self.evaluator.process_reading(80.0, current_time=100.2)
        self.assertTrue(res3.alert_triggered)
        self.assertEqual(res3.threat_level, "ALARM")

    def test_hysteresis_logic(self):
        """Hysteresis prevents rapid bouncing across the warning threshold boundary."""
        # Start at 295 cm (Warning)
        r1 = self.evaluator.process_reading(295.0, current_time=100.0)
        self.assertEqual(r1.state, ObstacleState.OBSTACLE_WARNING)

        # Distance increases to 302 cm. Since warning_threshold_cm is 300 and hysteresis is 5,
        # it must exceed 305 cm before clearing back to CLEAR!
        r2 = self.evaluator.process_reading(302.0, current_time=100.1)
        self.assertEqual(r2.state, ObstacleState.OBSTACLE_WARNING)

        # Distance increases to 306 cm (> 305 cm) -> Now transitions to CLEAR
        r3 = self.evaluator.process_reading(306.0, current_time=100.2)
        self.assertEqual(r3.state, ObstacleState.CLEAR)

    def test_configurable_threshold_and_timeout(self):
        """Evaluator thresholds and timeouts are runtime-configurable."""
        self.evaluator.update_config(warning_threshold_cm=150.0, stale_timeout_s=1.0)
        self.assertEqual(self.evaluator.warning_threshold_cm, 150.0)
        self.assertEqual(self.evaluator.stale_timeout_s, 1.0)

        # At 200 cm: with old threshold (300 cm) it was warning; with new 150 cm it is CLEAR!
        res = self.evaluator.process_reading(200.0, current_time=100.0)
        self.assertEqual(res.state, ObstacleState.CLEAR)

        # After 1.2s (> 1.0s timeout): goes stale
        stale = self.evaluator.evaluate(current_time=101.2)
        self.assertEqual(stale.state, ObstacleState.SENSOR_UNAVAILABLE)

    # ── Regression tests for confirmed defects ─────────────────────────────

    def test_invalid_reading_does_not_refresh_valid_reading_timestamp(self):
        """An invalid measurement must not extend the freshness of the last good reading."""
        self.evaluator.process_reading(350.0, current_time=100.0)

        err = self.evaluator.process_reading(float("nan"), current_time=101.0)
        self.assertEqual(err.state, ObstacleState.SENSOR_ERROR)
        self.assertFalse(err.is_clear)

        # 2.9s after the last VALID reading (1.9s after the error): freshness
        # is still measured from the valid reading, and the error state is
        # reported — never a resurrected CLEAR.
        mid = self.evaluator.evaluate(current_time=102.9)
        self.assertFalse(mid.is_clear)
        self.assertEqual(mid.state, ObstacleState.SENSOR_ERROR)

        # 3.2s after the last VALID reading: stale → SENSOR_UNAVAILABLE.
        stale = self.evaluator.evaluate(current_time=103.2)
        self.assertEqual(stale.state, ObstacleState.SENSOR_UNAVAILABLE)
        self.assertTrue(stale.is_unavailable)
        self.assertFalse(stale.is_clear)

    def test_repeated_evaluations_do_not_resurrect_stale_data(self):
        """Evaluating repeatedly must never make an old reading fresh again."""
        self.evaluator.process_reading(350.0, current_time=100.0)
        for current_time in (104.0, 105.0, 120.0):
            with self.subTest(current_time=current_time):
                res = self.evaluator.evaluate(current_time=current_time)
                self.assertEqual(res.state, ObstacleState.SENSOR_UNAVAILABLE)
                self.assertFalse(res.is_clear)
                self.assertFalse(res.is_warning)
                self.assertIsNone(res.distance_cm)

    def test_invalid_reading_after_clear_never_reports_clear(self):
        """Invalid data following a CLEAR reading must not keep reporting CLEAR."""
        self.evaluator.process_reading(350.0, current_time=100.0)
        res = self.evaluator.process_reading("bad_packet", current_time=100.5)
        self.assertEqual(res.state, ObstacleState.SENSOR_ERROR)
        self.assertFalse(res.is_clear)
        self.assertIsNone(res.distance_cm)

    def test_threat_level_boundaries_match_shared_system_zones(self):
        """Evaluator threat zones must match serial_sensor and the dashboard zones.

        Canonical boundaries (see test_threat_detection): 301 NORMAL, 300 WARNING,
        100 WARNING, 99 ALARM, 50 ALARM, 49 CRITICAL.
        """
        expected = {
            301.0: "NORMAL",
            300.0: "WARNING",
            100.0: "WARNING",
            99.0: "ALARM",
            50.0: "ALARM",
            49.0: "CRITICAL",
        }
        for distance_cm, threat in expected.items():
            with self.subTest(distance_cm=distance_cm):
                res = self.evaluator.process_reading(distance_cm, current_time=100.0)
                self.assertEqual(res.threat_level, threat)

    def test_configured_threshold_is_respected_by_threat_classification(self):
        """Threat classification follows the configured warning threshold."""
        self.evaluator.update_config(warning_threshold_cm=150.0)
        self.assertEqual(
            self.evaluator.process_reading(200.0, current_time=100.0).threat_level,
            "NORMAL",
        )
        self.assertEqual(
            self.evaluator.process_reading(150.0, current_time=100.1).threat_level,
            "WARNING",
        )

    def test_timeout_boundary_is_fresh_at_equality(self):
        self.evaluator.process_reading(350.0, current_time=100.0)
        self.assertTrue(self.evaluator.evaluate(current_time=103.0).is_clear)
        self.assertTrue(self.evaluator.evaluate(current_time=102.999).is_clear)
        self.assertTrue(self.evaluator.evaluate(current_time=103.001).is_unavailable)


if __name__ == "__main__":
    unittest.main()
