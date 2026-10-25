"""Functional tests for the Step 7 fusion-state integration endpoints.

These tests verify that the production vision server exposes the Step 7
endpoints:

* GET /api/fusion-state — returns the authoritative fused threat level,
  sensing state, fused distance, confidence, freshness, and age_seconds.
* GET /api/alert-logs — returns the alert log payload.

The tests use an application test client, not a live server.  They check the
contract behaviour, not the contents of a database.  When Supabase is not
configured the endpoints must still return the correct in-memory payload.
"""

from __future__ import annotations

import unittest

from vision_server import (
    app,
    state,
    state_lock,
    SENSOR_HEARTBEAT_TIMEOUT_S,
    _persist_fusion_state,
    _supabase_from_env,
)


class FusionStateApiTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.client = app.test_client()

    def setUp(self) -> None:
        # Isolated state per test so that no previous reading leaks into the
        # next test.
        with state_lock:
            state["sensor_data"] = None
            state["sensor_last_update"] = 0.0
            state["sensor_invalid_telemetry"] = None
            state["ensemble_result"] = None
            state["alert_log"] = []

    #
    # /api/fusion-state endpoint
    #

    def test_fusion_state_basic_contract(self) -> None:
        payload = self.client.get("/api/fusion-state").get_json()
        self.assertEqual(payload["fused_threat_level"], "NO DATA")
        self.assertEqual(payload["sensing_state"], "NO VALID DATA")
        self.assertIsNone(payload["fused_distance_cm"])
        self.assertEqual(payload["signal_count"], 0)
        self.assertFalse(payload["fresh"])

    def test_fusion_state_fresh_when_valid_telemetry_and_ensemble(self) -> None:
        import time

        with state_lock:
            state["sensor_data"] = {
                "distance_cm": 80.0,
                "threat_level": "ALARM",
                "status": "ACTIVE",
                "timestamp": "2026-10-24T12:00:00Z",
            }
            state["sensor_last_update"] = time.monotonic()
            state["sensor_invalid_telemetry"] = None

        ensemble_result = type(
            "R",
            (),
            {
                "fused_threat_level": "ALARM",
                "sensing_state": "SENSOR DEGRADED",
                "fused_distance_cm": 80.0,
                "confidence": 1.0,
                "signal_count": 1,
            },
        )()
        with state_lock:
            state["ensemble_result"] = ensemble_result

        payload = self.client.get("/api/fusion-state").get_json()
        self.assertEqual(payload["fused_threat_level"], "ALARM")
        self.assertEqual(payload["sensing_state"], "SENSOR DEGRADED")
        self.assertEqual(payload["fused_distance_cm"], 80.0)
        self.assertTrue(payload["fresh"])
        self.assertGreaterEqual(payload["age_seconds"], 0.0)
        self.assertLess(payload["age_seconds"], SENSOR_HEARTBEAT_TIMEOUT_S)

    def test_fusion_state_treats_stale_telemetry_as_not_fresh(self) -> None:
        import time

        with state_lock:
            state["sensor_data"] = {
                "distance_cm": 80.0,
                "threat_level": "ALARM",
                "status": "ACTIVE",
                "timestamp": "2026-10-24T12:00:00Z",
            }
            state["sensor_last_update"] = time.monotonic() - (SENSOR_HEARTBEAT_TIMEOUT_S + 1)
            state["sensor_invalid_telemetry"] = None

        payload = self.client.get("/api/fusion-state").get_json()
        self.assertFalse(payload["fresh"])

    def test_fusion_state_returns_default_when_no_ensemble(self) -> None:
        payload = self.client.get("/api/fusion-state").get_json()
        self.assertEqual(payload["fused_threat_level"], "NO DATA")
        self.assertEqual(payload["sensing_state"], "NO VALID DATA")
        self.assertIsNone(payload["fused_distance_cm"])
        self.assertEqual(payload["signal_count"], 0)

    def test_fusion_state_age_uses_monotonic(self) -> None:
        import time

        with state_lock:
            state["sensor_data"] = {"distance_cm": 80.0, "status": "ACTIVE"}
            state["sensor_last_update"] = time.monotonic()

        payload = self.client.get("/api/fusion-state").get_json()
        self.assertIsInstance(payload["age_seconds"], float)
        self.assertGreaterEqual(payload["age_seconds"], 0.0)


class AlertLogsApiTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.client = app.test_client()

    def setUp(self) -> None:
        with state_lock:
            state["alert_log"] = []

    def test_alert_logs_returns_empty_when_no_records(self) -> None:
        payload = self.client.get("/api/alert-logs").get_json()
        self.assertEqual(payload["count"], 0)
        self.assertEqual(payload["records"], [])

    def test_alert_logs_returns_records(self) -> None:
        with state_lock:
            state["alert_log"] = [
                {
                    "scenario_id": "test-001",
                    "timestamp": "2026-10-24T12:00:00Z",
                    "state": "OBSTACLE_WARNING",
                    "distance_cm": 45.0,
                    "threat_level": "CRITICAL",
                    "has_valid_signal": True,
                    "source": "vision_server",
                    "fault_event": "NONE",
                    "age_seconds": 0.5,
                }
            ]

        payload = self.client.get("/api/alert-logs").get_json()
        self.assertEqual(payload["count"], 1)
        self.assertEqual(payload["records"][0]["state"], "OBSTACLE_WARNING")
        self.assertEqual(payload["records"][0]["distance_cm"], 45.0)


class SupabasePersistenceTests(unittest.TestCase):
    def test_supabase_from_env_returns_none_when_missing(self) -> None:
        # The integration path must not raise when the environment is missing
        # required variables.  This verifies graceful fallback.
        with state_lock:
            result = _supabase_from_env()
        self.assertIsNone(result)

    def test_persist_fusion_state_returns_false_when_unconfigured(self) -> None:
        fusion = type(
            "F",
            (),
            {
                "fused_threat_level": "ALARM",
                "sensing_state": "SENSOR DEGRADED",
                "fused_distance_cm": 80.0,
                "confidence": 1.0,
                "fresh": True,
                "age_seconds": 0.5,
                "signal_count": 1,
            },
        )()
        # Override so the helper does not actually need env vars.
        payload = _persist_fusion_state(fusion, "step7-integration")
        self.assertFalse(payload.get("inserted"))
        self.assertIn("reason", payload)


if __name__ == "__main__":
    unittest.main()
