# NetraSense Comparative Fusion Replay — Reproducibility Report

**Run:** 2026-10-25 · **Harness:** `server/fusion_experiment.py` (SCHEMA_VERSION 1.0)
**Git commit:** `0b22525b3abb13f03ebc35f0637fa95dab531ad5` (branch `main`; no tracked source, firmware, test, or manuscript files were modified)
**Python:** 3.9.6 · **Platform:** macOS (Apple M4, arm64) · The harness imports only `ensemble` and `ensemble_model` (pure Python; Ultralytics/PyTorch are not needed for replay).

## Commands and exit codes

| Command (cwd `server/`) | Exit | Output |
|---|---|---|
| `git rev-parse HEAD` | 0 | `0b22525b3abb13f03ebc35f0637fa95dab531ad5` |
| `python3 -m unittest test_fusion_experiment -v` | 0 | `Ran 6 tests ... OK` |
| `python3 fusion_experiment.py ../experiments/fusion_replay/replay_2026-10-25/scenarios.jsonl ../experiments/fusion_replay/replay_2026-10-25/replay_results.json` | 0 | wrote `replay_results.json` |
| Validation + summary heredoc script (`SUMMARY_EXIT`) | 0 | wrote `replay_summary.json` |

Replay acceptance: **17 records accepted, 0 excluded**; recording types `{simulated: 11, fault_injection: 6}`; `recovery_events: 1`, `recovery_success_rate: 1.0`; `data_quality.latency` explicitly "not calculated: replay timestamps are not physical sensor-to-warning latency".

## Artifact paths

1. [scenarios.jsonl](experiments/fusion_replay/replay_2026-10-25/scenarios.jsonl) — 17 labelled scenarios with per-record `expected`, `rationale`, `input_provenance` (all declared synthetic author-designed inputs; none recorded from hardware).
2. [replay_results.json](experiments/fusion_replay/replay_2026-10-25/replay_results.json) — raw per-scenario outputs for every policy (combined file; each record carries explicit `camera_only`, `ultrasonic_only`, `legacy_weighted`, `reliability_aware` fields), plus manifest with source SHA-256.
3. [replay_summary.json](experiments/fusion_replay/replay_2026-10-25/replay_summary.json) — machine-readable per-policy pass/fail vs pre-declared expectations and harness confusion metrics.
4. This report.

All three JSON files were re-opened and parsed successfully after generation.

## Harness audit (Phase 1 findings)

- **Accepted input schema (validated by `validate_scenario`):** `scenario_id` (non-empty string, unique), ISO-8601 `timestamp` with timezone, `timestamp_source` ∈ {device, host_wall_clock, host_monotonic, video, manual, unknown}, `recording_type` ∈ {physical, simulated, fault_injection, unknown}, `ground_truth_warning`/`ground_truth_obstacle_present` (bool|null), `ground_truth_distance_cm` (cm ≥ 0|null), `camera_available` (bool|null), `camera_age_s` (s ≥ 0|null), `camera_detections` (array of objects), `ultrasonic_valid` (bool|null), `ultrasonic_distance_cm` (finite, ≥ 0, not boolean|null), `ultrasonic_age_s` (finite, ≥ 0, not boolean|null), `fault_event` ∈ {NONE, DISCONNECTED, RECONNECTED, RECOVERED, INVALID_READING, STALE, unknown}. Non-schema keys are preserved pass-through (used here for `scenario_category`, `expected`, `rationale`, `input_provenance`).
- **Outputs per policy:** for every accepted record, four policy blocks: `camera_only` (WARNING iff a fresh camera yields detections, else NO DATA), `ultrasonic_only` (canonical threshold classification of the fresh/valid distance, else NO DATA), `legacy_weighted` (`MultiModalEnsembleModel.fuse` severity from its weighted score/threshold bands), `reliability_aware` (`EnsembleClassifier.classify` fused threat + `sensing_state`). Harness-level `metrics` compute warning precision/recall/false-warning/missed-warning per policy using only boolean-labelled records; unknown labels are excluded from denominators (confirmed by test `test_unknown_ground_truth_is_excluded_from_warning_denominators`).
- **Equivalent inputs:** yes — a single freshness gate (`age > 3.0 s` ⇒ no evidence; invalid ⇒ no evidence) is applied to both modalities before all four policies see the same gated `distance` and `detections` lists. This makes the four-way warning-level comparison fair at the decision-policy level. Trade-off: each policy's *own* freshness/unavailability handling is not exercised — only `reliability_aware` additionally reveals `sensing_state` (and only its severity is meaningful there). `depth_distance_cm` is not passed by the harness (depth is inactive in the evaluated baseline anyway).
- **Field provenance:** all scenario inputs are synthetic and author-designed (`recording_type` simulated or fault_injection, `timestamp_source: manual`); policy outputs are derived; ground-truth labels are design judgements, not measurements.
- **Legacy detection-dict contract:** legacy reads `label`/`class`, `confidence` (defaults 0.8), `box` (defaults [0,0,0,0] → 0.05 area fallback); production reads `distance_cm`, `confidence` (defaults 0), `threat_level`, `label`, `direction`, `motion_state`. Scenarios therefore supply all keys explicitly.
- **Limitations:** (1) single-record scenarios, no temporal sequences; (2) stale/invalid handling is pre-applied by the gate, so policies are compared only on equal-footing inputs; (3) legacy severity labels use different internal thresholds (collision 40 / alarming 100 / warning 200 cm) — only the boolean `warning` was compared fairly across policies; (4) replay outputs are software behaviour, not physical measurements.

## Replay execution (Phase 3)

All four policies evaluated on all 17 scenarios; no exclusions; `REPLAY_EXIT=0`. Manifest `source_sha256` recorded in `replay_results.json` binds the exact scenario input.

## Analysis (Phase 4)

Pre-declared expectation match (warning behaviour vs the `expected` block authored with each scenario, before execution): **camera_only 17/17, ultrasonic_only 17/17, legacy_weighted 17/17, reliability_aware 17/17.** Zero mismatches — the harness and all four policies reproduced the designed behaviour exactly.

Coverage of the 14 warning-labelled gt_true scenarios (of 17; S01 and S05 carry unknown labels):

| Policy | gt-true warned | gt-false warned | Key differentiators |
|---|---|---|---|
| camera_only | 3/14 | 0/1 | Blind to all ultrasonic-only evidence (11 missed) |
| ultrasonic_only | 9/14 | 0/1 | Blind to all visual-only evidence |
| legacy_weighted | 10/14 | 0/1 | Misses visual-only (no, it warns via area heuristic — misses come from S08 300 cm and the fault cases); **fabricates "Normal / Path clear" + 400.0 cm consensus distance on zero evidence (S01, S11, S12, S14)**; false-clear at exactly 300 cm (S08) |
| reliability_aware | **11/14** | 0/1 | Correctly warns on the 300 cm boundary; declines to claim clear when no evidence (NO DATA / NO VALID DATA, null distance); caught 1/1 recovery event |

(`gt-false` denominator is the single gh-false scenario S09 — 301 cm; no policy warned on it.)

Harness confusion metrics (also in `replay_summary.json`): reliability_aware recall 11/14 ≈ 0.786 vs legacy 10/14 ≈ 0.714, ultrasonic-only 9/14 ≈ 0.643, camera-only 3/14 ≈ 0.214; warning precision 1.0 for all four policies on this scenario set (the only gt-false case was never warned).

### Findings suitable for the research paper (with mandatory framing)

1. **Scenario-level behaviour (simulated):** the production reliability-aware policy warned in strictly more designed scenarios (11/14 warning-labelled) than legacy weighted (10/14), ultrasonic-only (9/14), or camera-only (3/14), with no false warning in the single gt-false case. This is replay evidence from the designed scenario set, **not** real-world accuracy.
2. **Evidence-integrity difference (observable in policy behaviour):** when neither modality provides evidence, the production policy outputs `NO DATA` / `NO VALID DATA` with a null fused distance; the legacy baseline outputs `Normal` with "Path clear. Proceed safely." and a fabricated 400.0 cm consensus distance (4 cases exercised: S01, S11, S12, S14). Distinguishing "no evidence" from "clear path" is a design property demonstrated in replay, not yet measured in the field.
3. **Boundary conformance:** production matched all canonical boundary expectations (49→CRITICAL, 50→ALARM, 100→WARNING, 300→WARNING, 301→NORMAL); legacy diverged at exactly 300 cm (Normal vs canonical WARNING).
4. **No-averaging:** with two modalities contributing (S04, S05), production never emitted a numeric `fused_distance_cm`; the legacy baseline produced an uncalibrated ~79 cm consensus average (S04), demonstrating the semantic difference.
5. **Freshness equality edge:** age exactly 3.0 s stayed actionable (S13); 3.001 s was excluded (S14) — consistent with the strict `age > 3.0 s` rule.

### What this experiment does NOT establish

No physical warning latency, no real-world detection accuracy, no field false-alarm rates, no user response, no superiority over external published systems. Labels were designed together with the scenarios by the audit, so these results verify *implementation against intent* — a necessary but not sufficient form of evidence.

## Remaining limitations and hardware-dependent work

- A genuine physical recording cohort with independent obstacle labels is required before any field claim; then the same harness can replay it with `recording_type: physical`.
- Watch latency and recovery times are measurable only with hardware (synchronized clocks).
- The scenario set is single-instant; temporal sequences (e.g., obstacle approaching across boundary bands) need real traces.
- Ensemble `depth_distance_cm` is unused by the harness; depth remains inactive in the evaluated baseline.
