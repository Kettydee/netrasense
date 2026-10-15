"""Offline replay and validation for externally recorded fusion scenarios.

This module never opens hardware, runs camera inference, or writes production
state. JSONL fixtures are software tests, not experiments. Real recordings
must declare ``recording_type: physical`` and retain their source timestamps.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import platform
import sys
from collections import Counter
from datetime import datetime
from pathlib import Path
from typing import Any, Iterable

from ensemble import EnsembleClassifier
from ensemble_model import MultiModalEnsembleModel

SCHEMA_VERSION = "1.0"
RECORDING_TYPES = {"physical", "simulated", "fault_injection", "unknown"}
TIMESTAMP_SOURCES = {"device", "host_wall_clock", "host_monotonic", "video", "manual", "unknown"}
FAULT_EVENTS = {"NONE", "DISCONNECTED", "RECONNECTED", "RECOVERED", "INVALID_READING", "STALE", "unknown"}
WARNING_LEVELS = {"WARNING", "ALARM", "CRITICAL", "Warning", "Alarming", "Collision"}
METHODS = ("camera_only", "ultrasonic_only", "legacy_weighted", "reliability_aware")


def _warning(level: str | None) -> bool:
    return level in WARNING_LEVELS


def _valid_timestamp(value: Any) -> bool:
    if not isinstance(value, str):
        return False
    try:
        datetime.fromisoformat(value.replace("Z", "+00:00"))
        return True
    except ValueError:
        return False


def validate_scenario(scenario: Any) -> list[str]:
    """Return actionable schema errors; absence of labels remains valid/unknown."""
    if not isinstance(scenario, dict):
        return ["record must be a JSON object"]
    errors: list[str] = []
    if not isinstance(scenario.get("scenario_id"), str) or not scenario["scenario_id"].strip():
        errors.append("scenario_id must be a non-empty string")
    if not _valid_timestamp(scenario.get("timestamp")):
        errors.append("timestamp must be ISO-8601 with timezone, e.g. 2026-10-15T00:00:00Z")
    if scenario.get("timestamp_source", "unknown") not in TIMESTAMP_SOURCES:
        errors.append(f"timestamp_source must be one of {sorted(TIMESTAMP_SOURCES)}")
    if scenario.get("recording_type", "unknown") not in RECORDING_TYPES:
        errors.append(f"recording_type must be one of {sorted(RECORDING_TYPES)}")
    label = scenario.get("ground_truth_warning")
    if label is not None and not isinstance(label, bool):
        errors.append("ground_truth_warning must be true, false, or null (unknown)")
    presence = scenario.get("ground_truth_obstacle_present")
    if presence is not None and not isinstance(presence, bool):
        errors.append("ground_truth_obstacle_present must be true, false, or null (unknown)")
    ground_truth_distance = scenario.get("ground_truth_distance_cm")
    if ground_truth_distance is not None and (not isinstance(ground_truth_distance, (int, float)) or ground_truth_distance < 0):
        errors.append("ground_truth_distance_cm must be centimetres >= 0 or null")
    if scenario.get("camera_available") is not None and not isinstance(scenario["camera_available"], bool):
        errors.append("camera_available must be true, false, or null")
    if scenario.get("ultrasonic_valid") is not None and not isinstance(scenario["ultrasonic_valid"], bool):
        errors.append("ultrasonic_valid must be true, false, or null")
    age = scenario.get("ultrasonic_age_s")
    if age is not None and (isinstance(age, bool) or not isinstance(age, (int, float)) or not math.isfinite(age) or age < 0):
        errors.append("ultrasonic_age_s must be a finite number of seconds >= 0")
    distance = scenario.get("ultrasonic_distance_cm")
    if distance is not None and (isinstance(distance, bool) or not isinstance(distance, (int, float)) or not math.isfinite(distance) or distance < 0):
        errors.append("ultrasonic_distance_cm must be a finite centimetre value >= 0 or null")
    detections = scenario.get("camera_detections", [])
    if not isinstance(detections, list):
        errors.append("camera_detections must be an array")
    elif any(not isinstance(item, dict) for item in detections):
        errors.append("each camera detection must be an object")
    if scenario.get("camera_age_s") is not None and (not isinstance(scenario["camera_age_s"], (int, float)) or scenario["camera_age_s"] < 0):
        errors.append("camera_age_s must be seconds >= 0 or null")
    if scenario.get("fault_event", "NONE") not in FAULT_EVENTS:
        errors.append(f"fault_event must be one of {sorted(FAULT_EVENTS)}")
    return errors


def _method_metrics(records: list[dict[str, Any]], method: str) -> dict[str, int | float | None]:
    labeled = [r for r in records if isinstance(r.get("ground_truth_warning"), bool)]
    tp = sum(r["ground_truth_warning"] and r[method]["warning"] for r in labeled)
    fp = sum(not r["ground_truth_warning"] and r[method]["warning"] for r in labeled)
    fn = sum(r["ground_truth_warning"] and not r[method]["warning"] for r in labeled)
    tn = sum(not r["ground_truth_warning"] and not r[method]["warning"] for r in labeled)
    precision = tp / (tp + fp) if tp + fp else None
    recall = tp / (tp + fn) if tp + fn else None
    return {"labeled_trials": len(labeled), "unknown_ground_truth": len(records) - len(labeled),
            "confusion_matrix": {"tp": tp, "fp": fp, "fn": fn, "tn": tn},
            "warning_precision": precision, "warning_recall": recall,
            "missed_warning_rate": fn / (tp + fn) if tp + fn else None,
            "false_warning_rate": fp / (fp + tn) if fp + tn else None}


def _manifest(source_path: Path | None, accepted: list[dict[str, Any]], excluded: list[dict[str, Any]]) -> dict[str, Any]:
    payload = json.dumps(accepted, sort_keys=True, separators=(",", ":")).encode()
    return {"schema_version": SCHEMA_VERSION, "source_path": str(source_path) if source_path else None,
            "source_sha256": hashlib.sha256(source_path.read_bytes()).hexdigest() if source_path else None,
            "accepted_records": len(accepted), "excluded_records": len(excluded),
            "accepted_payload_sha256": hashlib.sha256(payload).hexdigest(),
            "recording_types": dict(Counter(r["recording_type"] for r in accepted)),
            "categories": dict(Counter(r.get("scenario_category", "unspecified") for r in accepted)),
            "ground_truth": dict(Counter("unknown" if r.get("ground_truth_warning") is None else str(r["ground_truth_warning"]).lower() for r in accepted)),
            "software": {"python": sys.version.split()[0], "platform": platform.platform(), "policy": "reliability-aware-v1"}}


def evaluate_scenarios(scenarios: Iterable[dict[str, Any]], source_path: Path | None = None) -> dict[str, Any]:
    """Deterministically replay all valid records and explicitly retain exclusions."""
    accepted: list[dict[str, Any]] = []
    excluded: list[dict[str, Any]] = []
    seen: set[str] = set()
    for index, raw in enumerate(scenarios, start=1):
        errors = validate_scenario(raw)
        sid = raw.get("scenario_id") if isinstance(raw, dict) else None
        if isinstance(sid, str) and sid in seen:
            errors.append(f"duplicate scenario_id: {sid}")
        if errors:
            excluded.append({"input_index": index, "scenario_id": sid, "reasons": errors})
            continue
        seen.add(sid)
        scenario = dict(raw)
        scenario.setdefault("timestamp_source", "unknown")
        scenario.setdefault("recording_type", "unknown")
        scenario.setdefault("fault_event", "NONE")
        accepted.append(scenario)

    records: list[dict[str, Any]] = []
    for scenario in accepted:
        camera_available = scenario.get("camera_available", True) is True
        camera_fresh = camera_available and float(scenario.get("camera_age_s", 0.0)) <= 3.0
        detections = scenario.get("camera_detections", []) if camera_fresh else []
        valid = scenario.get("ultrasonic_valid") is True
        fresh = valid and float(scenario.get("ultrasonic_age_s", float("inf"))) <= 3.0
        distance = float(scenario["ultrasonic_distance_cm"]) if fresh and scenario.get("ultrasonic_distance_cm") is not None else None
        reliability = EnsembleClassifier().classify(ultrasonic_cm=distance, yolo_detections=detections)
        legacy = MultiModalEnsembleModel().fuse(ultrasonic_distance_cm=distance, yolo_detections=detections)
        camera_level = "WARNING" if detections else "NO DATA"
        ultra_level = EnsembleClassifier._distance_to_threat(distance) if distance is not None else "NO DATA"
        records.append({"scenario_id": scenario["scenario_id"], "timestamp": scenario["timestamp"],
            "timestamp_source": scenario["timestamp_source"], "recording_type": scenario["recording_type"],
            "scenario_category": scenario.get("scenario_category", "unspecified"), "ground_truth_warning": scenario.get("ground_truth_warning"),
            "ground_truth_obstacle_present": scenario.get("ground_truth_obstacle_present"), "ground_truth_distance_cm": scenario.get("ground_truth_distance_cm"),
            "camera_available": camera_available, "camera_fresh": camera_fresh, "camera_detections": detections,
            "ultrasonic_valid": valid, "ultrasonic_distance_cm": distance, "ultrasonic_age_s": scenario.get("ultrasonic_age_s"), "fault_event": scenario["fault_event"],
            "camera_only": {"severity": camera_level, "warning": _warning(camera_level)},
            "ultrasonic_only": {"severity": ultra_level, "warning": _warning(ultra_level)},
            "legacy_weighted": {"severity": legacy.threat_level, "warning": _warning(legacy.threat_level)},
            "reliability_aware": {"severity": reliability.fused_threat_level, "warning": _warning(reliability.fused_threat_level), "sensing_state": reliability.sensing_state, "warning_decision_timestamp": scenario["timestamp"]}})
    invalid_rate = sum(not r["ultrasonic_valid"] for r in records) / len(records) if records else None
    recoveries = [r for r in records if r["fault_event"] in {"RECOVERED", "RECONNECTED"}]
    recovery_success = sum(r["ultrasonic_valid"] for r in recoveries) / len(recoveries) if recoveries else None
    return {"evaluation_type": "offline replay; not physical measurement unless input records declare recording_type=physical", "input_order": "preserved", "manifest": _manifest(source_path, accepted, excluded), "records": records, "excluded_records": excluded,
            "metrics": {method: _method_metrics(records, method) for method in METHODS},
            "data_quality": {"invalid_ultrasonic_rate": invalid_rate, "recovery_events": len(recoveries), "recovery_success_rate": recovery_success, "latency": "not calculated: replay timestamps are not physical sensor-to-warning latency"}}


def main() -> None:
    parser = argparse.ArgumentParser(description="Replay externally recorded NetraSense fusion scenarios")
    parser.add_argument("input_jsonl", type=Path)
    parser.add_argument("output_json", type=Path)
    args = parser.parse_args()
    parsed: list[dict[str, Any]] = []
    syntax_errors: list[dict[str, Any]] = []
    for line_no, line in enumerate(args.input_jsonl.read_text(encoding="utf-8").splitlines(), start=1):
        if not line.strip(): continue
        try: parsed.append(json.loads(line))
        except json.JSONDecodeError as exc: syntax_errors.append({"input_index": line_no, "scenario_id": None, "reasons": [f"malformed JSONL: {exc.msg}"]})
    result = evaluate_scenarios(parsed, args.input_jsonl)
    result["excluded_records"] = syntax_errors + result["excluded_records"]
    args.output_json.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__": main()
