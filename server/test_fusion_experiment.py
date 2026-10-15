"""Tests for the replay-only fusion experiment harness."""

from __future__ import annotations

import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

from fusion_experiment import evaluate_scenarios, main


class FusionExperimentHarnessTests(unittest.TestCase):
    def test_replays_identical_observations_and_preserves_fault_metadata(self) -> None:
        result = evaluate_scenarios([{
            "scenario_id": "fault-recovery-001", "timestamp": "2026-10-15T00:00:00Z",
            "ground_truth_warning": True, "camera_detections": [],
            "ultrasonic_valid": True, "ultrasonic_distance_cm": 80,
            "ultrasonic_age_s": 0.1, "fault_event": "RECOVERED",
        }])
        record = result["records"][0]
        self.assertEqual(record["fault_event"], "RECOVERED")
        self.assertTrue(record["ultrasonic_only"]["warning"])
        self.assertTrue(record["reliability_aware"]["warning"])
        self.assertEqual(result["metrics"]["reliability_aware"]["missed_warning_rate"], 0.0)

    def test_stale_invalid_reading_is_not_a_clear_observation(self) -> None:
        result = evaluate_scenarios([{
            "scenario_id": "stale-001", "timestamp": "2026-10-15T00:00:01Z",
            "ground_truth_warning": True, "camera_detections": [],
            "ultrasonic_valid": False, "ultrasonic_distance_cm": 350,
            "ultrasonic_age_s": 10.0, "fault_event": "DISCONNECTED",
        }])
        record = result["records"][0]
        self.assertEqual(record["reliability_aware"]["severity"], "NO DATA")
        self.assertEqual(record["reliability_aware"]["sensing_state"], "NO VALID DATA")
        self.assertEqual(result["metrics"]["reliability_aware"]["missed_warning_rate"], 1.0)

    def test_unknown_ground_truth_is_excluded_from_warning_denominators(self) -> None:
        result = evaluate_scenarios([{
            "scenario_id": "unknown-label", "timestamp": "2026-10-15T00:00:01Z",
            "ground_truth_warning": None, "camera_detections": [], "ultrasonic_valid": True,
            "ultrasonic_distance_cm": 350, "ultrasonic_age_s": 0.1,
        }])
        metrics = result["metrics"]["reliability_aware"]
        self.assertEqual(metrics["labeled_trials"], 0)
        self.assertEqual(metrics["unknown_ground_truth"], 1)
        self.assertIsNone(metrics["false_warning_rate"])

    def test_invalid_and_duplicate_records_are_reported_not_silently_omitted(self) -> None:
        valid = {"scenario_id": "same", "timestamp": "2026-10-15T00:00:01Z", "ground_truth_warning": False}
        result = evaluate_scenarios([valid, dict(valid), {"scenario_id": "bad", "timestamp": "not-a-time"}])
        self.assertEqual(len(result["records"]), 1)
        self.assertEqual(len(result["excluded_records"]), 2)
        self.assertIn("duplicate scenario_id", result["excluded_records"][0]["reasons"][0])
        self.assertIn("ISO-8601", result["excluded_records"][1]["reasons"][0])

    def test_replay_is_deterministic_and_manifest_hashes_input(self) -> None:
        scenario = {"scenario_id": "deterministic", "timestamp": "2026-10-15T00:00:01Z", "ground_truth_warning": True,
                    "recording_type": "fault_injection", "camera_detections": [], "ultrasonic_valid": True,
                    "ultrasonic_distance_cm": 80, "ultrasonic_age_s": 0.1}
        one, two = evaluate_scenarios([scenario]), evaluate_scenarios([scenario])
        self.assertEqual(one["records"], two["records"])
        self.assertEqual(one["manifest"]["accepted_payload_sha256"], two["manifest"]["accepted_payload_sha256"])

    def test_jsonl_syntax_error_is_written_as_exclusion(self) -> None:
        with TemporaryDirectory() as directory:
            source, output = Path(directory) / "in.jsonl", Path(directory) / "out.json"
            source.write_text('{"scenario_id":"ok","timestamp":"2026-10-15T00:00:01Z"}\nnot json\n')
            import sys
            old_argv, sys.argv = sys.argv, ["fusion_experiment.py", str(source), str(output)]
            try: main()
            finally: sys.argv = old_argv
            result = __import__("json").loads(output.read_text())
            self.assertEqual(len(result["excluded_records"]), 1)
            self.assertIn("malformed JSONL", result["excluded_records"][0]["reasons"][0])


if __name__ == "__main__":
    unittest.main()
