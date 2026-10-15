"""Read-only validator and summary generator for NetraSense scenario JSONL."""
from __future__ import annotations

import argparse
import hashlib
import json
from collections import Counter
from pathlib import Path
from typing import Any

from fusion_experiment import validate_scenario


def validate_file(path: Path) -> dict[str, Any]:
    records: list[dict[str, Any]] = []
    exclusions: list[dict[str, Any]] = []
    seen: set[str] = set()
    for line_no, line in enumerate(path.read_text(encoding="utf-8").splitlines(), start=1):
        if not line.strip():
            continue
        try:
            record = json.loads(line)
        except json.JSONDecodeError as exc:
            exclusions.append({"line": line_no, "reasons": [f"malformed JSONL: {exc.msg}"]})
            continue
        errors = validate_scenario(record)
        scenario_id = record.get("scenario_id") if isinstance(record, dict) else None
        if isinstance(scenario_id, str) and scenario_id in seen:
            errors.append(f"duplicate scenario_id: {scenario_id}")
        if errors:
            exclusions.append({"line": line_no, "scenario_id": scenario_id, "reasons": errors})
        else:
            seen.add(scenario_id)
            records.append(record)
    return {
        "source": str(path), "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
        "total_nonblank_records": len(records) + len(exclusions), "valid_records": len(records),
        "invalid_records": len(exclusions), "exclusions": exclusions,
        "missing_ground_truth_warning": sum(r.get("ground_truth_warning") is None for r in records),
        "invalid_ultrasonic_records": sum(r.get("ultrasonic_valid") is False for r in records),
        "stale_ultrasonic_records": sum((r.get("ultrasonic_age_s") or 0) > 3.0 for r in records),
        "sensor_availability": dict(Counter(str(r.get("ultrasonic_valid")) for r in records)),
        "scenario_categories": dict(Counter(r.get("scenario_category", "unspecified") for r in records)),
        "recording_types": dict(Counter(r.get("recording_type", "unknown") for r in records)),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Validate recorded NetraSense JSONL without changing it")
    parser.add_argument("input_jsonl", type=Path)
    parser.add_argument("--output", type=Path, help="optional JSON summary path")
    args = parser.parse_args()
    summary = validate_file(args.input_jsonl)
    encoded = json.dumps(summary, indent=2) + "\n"
    if args.output:
        args.output.write_text(encoded, encoding="utf-8")
    else:
        print(encoded, end="")


if __name__ == "__main__":
    main()
