"""Append operator-supplied physical-test metadata to a JSONL recording file.

No serial port, camera, actuator, model, or live warning state is accessed.
The operator supplies event time and independent ground truth; this tool adds
only a UTC processing timestamp and validates the record before appending.
"""
from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from fusion_experiment import validate_scenario


def processing_timestamp() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def prepare_record(raw: dict[str, Any], recording_type: str) -> dict[str, Any]:
    """Validate an operator record without fabricating event observations."""
    record = dict(raw)
    record["recording_type"] = recording_type
    record["processing_timestamp"] = processing_timestamp()
    errors = validate_scenario(record)
    if errors:
        raise ValueError("; ".join(errors))
    return record


def main() -> None:
    parser = argparse.ArgumentParser(description="Append validated NetraSense physical-test metadata JSONL")
    parser.add_argument("output_jsonl", type=Path)
    parser.add_argument("--recording-type", choices=("physical", "fault_injection"), default="physical")
    args = parser.parse_args()
    for line_no, line in enumerate(sys.stdin, start=1):
        if not line.strip():
            continue
        try:
            raw = json.loads(line)
            if not isinstance(raw, dict):
                raise ValueError("input must be a JSON object")
            record = prepare_record(raw, args.recording_type)
        except (json.JSONDecodeError, ValueError) as exc:
            raise SystemExit(f"record {line_no} rejected: {exc}")
        with args.output_jsonl.open("a", encoding="utf-8") as output:
            output.write(json.dumps(record, sort_keys=True) + "\n")


if __name__ == "__main__":
    main()
