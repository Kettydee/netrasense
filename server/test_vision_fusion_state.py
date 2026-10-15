"""Regression tests for vision-server fusion updates without camera frames."""
from __future__ import annotations

import copy
import unittest

import vision_server
from ensemble import EnsembleClassifier


class _Reader:
    connected_port = "FAKE0"
    connected_since = 1.0
    last_error = None


class VisionFusionStateTests(unittest.TestCase):
    def setUp(self):
        self.original_state = copy.deepcopy(vision_server.state)
        vision_server.obstacle_evaluator.reset()
        vision_server.state.update({
            "ensemble": EnsembleClassifier(), "sensor_reader": _Reader(),
            "sensor_data": None, "sensor_last_update": 0.0,
            "sensor_invalid_telemetry": None, "latest_detections": [],
            "ensemble_result": None, "sensor_total_readings": 0,
            "latest_warning_eval": None, "camera": None,
        })

    def tearDown(self):
        vision_server.state.clear()
        vision_server.state.update(self.original_state)
        vision_server.obstacle_evaluator.reset()

    def test_camera_absence_still_refreshes_ultrasonic_fusion(self):
        vision_server.update_sensor_data({
            "distance_cm": 80.0, "timestamp": "2026-10-15T00:00:00Z", "threat_level": "ALARM",
        })
        result = vision_server.state["ensemble_result"]
        self.assertEqual(result["fused_threat_level"], "ALARM")
        self.assertEqual(result["sensing_state"], "SENSOR DEGRADED")

    def test_invalid_telemetry_excludes_prior_range_and_valid_recovery_restores_it(self):
        vision_server.update_sensor_data({
            "distance_cm": 80.0, "timestamp": "2026-10-15T00:00:00Z", "threat_level": "ALARM",
        })
        last_valid = vision_server.state["sensor_last_update"]
        vision_server.update_invalid_sensor_telemetry({"timestamp": "2026-10-15T00:00:01Z", "error": "NO_ECHO"})
        self.assertEqual(vision_server.state["sensor_last_update"], last_valid)
        self.assertEqual(vision_server.state["ensemble_result"]["sensing_state"], "NO VALID DATA")
        self.assertEqual(vision_server.obstacle_evaluator.evaluate().state.value, "SENSOR_ERROR")
        vision_server.update_sensor_data({
            "distance_cm": 80.0, "timestamp": "2026-10-15T00:00:02Z", "threat_level": "ALARM",
        })
        self.assertIsNone(vision_server.state["sensor_invalid_telemetry"])
        self.assertEqual(vision_server.state["ensemble_result"]["fused_threat_level"], "ALARM")

    def test_camera_recovery_replaces_no_vision_input_without_fabricated_range(self):
        vision_server.update_sensor_data({
            "distance_cm": 80.0, "timestamp": "2026-10-15T00:00:00Z", "threat_level": "ALARM",
        })
        with vision_server.state_lock:
            result = vision_server._refresh_ensemble_locked(detections=[
                {"label": "person", "confidence": 0.8, "distance_cm": None},
            ])
        self.assertEqual(result.sensing_state, "FUSED")
        self.assertIsNone(result.fused_distance_cm)
