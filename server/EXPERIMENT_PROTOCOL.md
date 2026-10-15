# NetraSense recorded-scenario replay protocol

## Scope

`fusion_experiment.py` is an offline software replay. It does not operate hardware,
run YOLO, or measure physical latency. Unit-test fixtures and `recording_type:
simulated`/`fault_injection` records are not experimental evidence.

## Research questions and methods

Replay identical recordings through camera-only, ultrasonic-only, the retained
legacy weighted baseline, and reliability-aware fusion. The legacy model is an
offline historical baseline only. The reliability-aware policy selects the most
severe valid observation; this may reduce missed warnings but can increase false
warnings, so no improvement is assumed.

## JSONL data contract (schema 1.0)

One JSON object per line. Required: `scenario_id` (unique non-empty string) and
`timestamp` (ISO-8601 with timezone). `ground_truth_warning` is `true`, `false`,
or `null`; null means unknown and is excluded from classification denominators.

Optional fields use these units: `*_distance_cm` in centimetres, `*_age_s` in
seconds, and `processing_latency_ms` in milliseconds. `timestamp_source` is one
of `device`, `host_wall_clock`, `host_monotonic`, `video`, `manual`, `unknown`.
`recording_type` is `physical`, `simulated`, `fault_injection`, or `unknown`.
`fault_event` is `NONE`, `DISCONNECTED`, `RECONNECTED`, `RECOVERED`,
`INVALID_READING`, `STALE`, or `unknown`.

```json
{"scenario_id":"physical-0001","timestamp":"2026-10-15T08:30:00.120Z","timestamp_source":"device","recording_type":"physical","scenario_category":"nearby-person","ground_truth_obstacle_present":true,"ground_truth_warning":true,"ground_truth_distance_cm":85.0,"camera_available":true,"camera_age_s":0.02,"camera_detections":[{"label":"person","confidence":0.81,"distance_cm":null}],"ultrasonic_valid":true,"ultrasonic_distance_cm":84.7,"ultrasonic_age_s":0.01,"fault_event":"NONE"}
```

Ground truth must come from an independent labeling procedure (measured setup,
video annotation, or protocol observer), never model predictions. Keep event
time separate from processing time; replay overhead is not sensor-to-warning
latency. Any referenced media file should be retained beside the source JSONL
and verified by the study operator before use.

## Metrics

A positive is an independently labeled required warning. The report includes
TP/FP/FN/TN, warning precision `TP/(TP+FP)`, recall `TP/(TP+FN)`, missed-warning
rate `FN/(TP+FN)`, and false-warning rate `FP/(FP+TN)`. Zero denominators are
reported as null. Invalid-ultrasonic rate is the fraction of replayed records
marked invalid; recovery success is valid ultrasonic data on defined recovery
events. Confidence intervals and significance tests are intentionally omitted
until a sufficiently sized, prospectively defined physical dataset exists.

## Reproducibility

Run from `server/`:

```sh
python3 fusion_experiment.py recordings.jsonl replay_report.json
python3 -m unittest test_fusion_experiment
```

The report preserves input order, exclusions and reasons, recording types,
configuration identifier, and SHA-256 hashes of source/accepted input. Do not
tune thresholds on the same records used for final evaluation.

## Physical validation still required

Use synchronized camera/Arduino clocks or an explicitly documented alignment
procedure, measured obstacle distances, independent warning labels, and logged
hardware recovery events. Evaluate lighting, motion blur, camera movement,
disconnection/reconnection, invalid echoes, and buzzer timing. No current
software result establishes navigation safety or real-world effectiveness.
