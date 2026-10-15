"""Synthetic fixtures only: tests do not represent physical recordings."""
from __future__ import annotations

import json
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

from record_scenario_metadata import prepare_record
from validate_recordings import validate_file


class RecordingValidationTests(unittest.TestCase):
    def _record(self, scenario_id: str = "fixture-1") -> dict:
        return {"scenario_id": scenario_id, "timestamp": "2026-10-15T00:00:00Z",
                "timestamp_source": "manual", "ground_truth_warning": None,
                "ultrasonic_valid": False, "ultrasonic_age_s": 4.0,
                "fault_event": "STALE"}

    def test_recorder_adds_processing_timestamp_without_fabricating_event_data(self) -> None:
        record = prepare_record(self._record(), "physical")
        self.assertEqual(record["recording_type"], "physical")
        self.assertIn("processing_timestamp", record)
        self.assertIsNone(record["ground_truth_warning"])
        self.assertNotIn("ultrasonic_distance_cm", record)

    def test_validator_reports_duplicates_malformed_and_quality_counts(self) -> None:
        with TemporaryDirectory() as directory:
            path = Path(directory) / "fixture.jsonl"
            valid = self._record()
            path.write_text("\n".join([json.dumps(valid), json.dumps(valid), "not json"]) + "\n")
            report = validate_file(path)
        self.assertEqual(report["total_nonblank_records"], 3)
        self.assertEqual(report["valid_records"], 1)
        self.assertEqual(report["invalid_records"], 2)
        self.assertEqual(report["missing_ground_truth_warning"], 1)
        self.assertEqual(report["invalid_ultrasonic_records"], 1)
        self.assertEqual(report["stale_ultrasonic_records"], 1)
        self.assertIn("sha256", report)


if __name__ == "__main__":
    unittest.main()
