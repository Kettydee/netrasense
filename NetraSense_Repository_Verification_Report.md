# NetraSense — Definitive Repository Verification Report

**Date:** 2026-10-25 · **Branch:** `main` · **Status:** PARTIALLY VERIFIED

Scope: read-only audit. No source, test, dataset, or manuscript files were modified.

---

## 1. Final Verdict

**PARTIALLY VERIFIED.** Software correctness claims are freshly and independently verified. Detector diagnostics are externally consistent with stored artifacts but version-dependent and only diagnostic. Controlled physical performance, comparative fusion evaluation, and independent generalization evidence are **not present in the repository** and remain undocumented.

---

## 2. Fresh Verification Commands and Outcomes (executed 2026-10-25)

| Command | Outcome |
|---|---|
| `python3 -m unittest discover -s server -p 'test*.py'` | **exit 0 — "Ran 109 tests ... OK"** (0 failures/errors) |
| `npm run build` | **exit 0** (Nitro/Vite production build completed) |
| `npx tsc --noEmit` | **exit 0** (no type errors) |
| `npx eslint .` | **exit 0 — 11 problems (0 errors, 11 warnings)** |
| `python3 -m unittest test_step7_fusion_state test_vision_fusion_state -v` (cwd `server`) | **exit 0 — Ran 13 tests … OK** (Step-7 fusion-state/alert-log and vision-fusion-state regression suites) |

Environment: Python 3.9.6 · Node v24.13.0 · npm 11.6.2 · macOS (Apple M4).

An invocation of `python3 -m unittest server.test_step7_fusion_state -v` from the project root failed with `ModuleNotFoundError: No module named 'vision_server'` (exit 1) — the suites must run from the `server/` directory. This is an invocation-context note, not a product defect; the same module imports cleanly when run from `server/`.

ESLint is **not clean**: 11 warnings remain, no errors.

Corrected source/version context for this working tree, matching the fresh run: tests count 109 (modern state). Earlier reports of "92 tests" are **historical**, from a different audit environment; do not merge the counts.

---

## 3. Evidence Table

| # | Claim | Source artifact / file | Status | Limitation |
|---|---|---|---|---|
| 1 | 109 backend tests pass; build/tsc pass; ESLint 0 err / 11 warn | Fresh command runs (Section 2) | **VERIFIED (fresh)** | Lint warnings remain |
| 2 | Canonical thresholds: >300 cm NORMAL, 100–300 cm WARNING, 50 cm ALARM, <50 cm CRITICAL | [threat_levels.py](server/threat_levels.py), [ensemble.py](server/ensemble.py) (`THRESHOLDS`) | **VERIFIED (source)** | Thresholds are engineering parameters, not validated safety limits |
| 3 | Stale rule strictly `age > 3.0 s`; equality is fresh | [obstacle_warning.py](server/obstacle_warning.py) (`DEFAULT_STALE_TIMEOUT_S = 3.0`, freshness check) | **VERIFIED (source)** | — |
| 4 | Machine rejects non-finite, Boolean, <2 cm, ≥400 cm distances | [ensemble.py](server/ensemble.py) `_is_valid_distance_cm`; regression coverage in [test_phase2_regression.py](server/test_phase2_regression.py) | **VERIFIED (source + tests)** | — |
| 5 | `fused_distance_cm` numeric only when exactly one signal and one distance source; no averaging ever | [ensemble.py:360–375](server/ensemble.py#L360-L375) | **VERIFIED (source + tests)** (`test_all_three_signals_no_averaging`, `test_single_ultrasonic_preserves_fused_distance`) | — |
| 6 | Distinct fields: `fused_threat_level = "NO DATA"` (zero signals) vs `sensing_state = "NO VALID DATA" / "SENSOR DEGRADED" / "FUSED"` | [ensemble.py:390–400](server/ensemble.py#L390-L400) | **VERIFIED (source + tests)** | States count modalities, not hardware-fault diagnoses |
| 7 | Visual-only detection without metric distance can support at most WARNING, never a CLEAR path | [ensemble.py:280–313](server/ensemble.py#L280-L313) | **VERIFIED (source + tests)** (`test_yolo_no_distance_no_threat_gets_warning`) | — |
| 8 | HC-SR04 firmware: Trig D9, Echo D10, Buzzer D11, 9600 baud, 75 ms sampling, 24,000 µs echo timeout, valid 2–380 cm | [ultrasonic_sensor.ino:33–39,75–78,144](arduino/ultrasonic_sensor.ino#L33-L39) | **VERIFIED (source)** | Physical pin/wiring behavior not freshly hardware-verified |
| 9 | Firmware telemetry carries **no acquisition timestamp** (`{"distance_cm":…,"valid":true}`) — host receipt time is a freshness proxy | [ultrasonic_sensor.ino:152–176](arduino/ultrasonic_sensor.ino#L152-L176) | **VERIFIED (source)** | True Age-of-Information cannot be measured from this telemetry |
| 10 | Invalid firmware measurements emit `{"distance_cm":null,"valid":false,"status":"NO_ECHO"/"OUT_OF_RANGE"}`; previous buzzer pattern retained | [ultrasonic_sensor.ino:178–189](arduino/ultrasonic_sensor.ino#L178-L189) | **VERIFIED (source)** | — |
| 11 | Arduino buzzer is **firmware-local** (pattern bands >300 silent / ≥200 slow / ≥100 moderate / <100 rapid), independent of host threat levels | [ultrasonic_sensor.ino:163–177,83–140](arduino/ultrasonic_sensor.ino#L163-L177) | **VERIFIED (source)** | Firmware bands (200/100 cm) ≠ host thresholds (300/100/50 cm) — intentional, documented inconsistency |
| 12 | Host parser range 2.0–400.0 cm (flagged-valid contract; legacy 400.0 sentinel rejected by fusion) | [serial_sensor.py:134–147](server/serial_sensor.py#L134-L147), [ensemble.py](server/ensemble.py) | **VERIFIED (source + tests)** | Firmware (380) and host (400) ranges differ by design |
| 13 | Step-7 `/api/fusion-state` and `/api/alert-logs` endpoints exist on the production path; Supabase persistence is graceful-degradation (no-op without credentials) | [vision_server.py:817–875](server/vision_server.py#L817-L875), [supabase.ts](src/lib/supabase.ts), migration [20261024100000_step7_fusion_state_sessions.sql](supabase/migrations/20261024100000_step7_fusion_state_sessions.sql) | **VERIFIED (source + unit tests)** | No live Supabase connection was exercised; RLS/insert behavior unverified end-to-end |
| 14 | YOLO11n model (`yolo11n.pt`) selected for edge/CPU tiers; confidence default 0.5 (clamped 0.1–0.95) | [engine.py:127–129](server/engine.py#L127-L129), [vision.py:101,138–139](server/vision.py#L101) | **VERIFIED (source)** | `engine.py` tiering also allows `yolo11m.pt` on TIER_1 server hardware; production model depends on host tier |
| 15 | Optional Depth Anything V2 is **inactive in the evaluated baseline** (no ONNX session provided) | [vision.py:107–117,152–158](server/vision.py#L107-L117) | **VERIFIED (source)** | Paper correctly treats depth as unevaluated |
| 16 | COCO-128 metrics: mAP50 67.95 %, mAP50–95 50.22 %, precision 69.35 %, recall 59.09 %, macro F1 57.91 % | [validated_evaluation_report.json](server/evaluation_results/confidence_sweep/validated_evaluation_report.json) | **Provenance ESTABLISHED; see §5** | Diagnostic only; version-dependent; not integrated system accuracy |
| 17 | Legacy 98.80 % accuracy / AUC 0.9995 excluded from paper | [benchmark_summary.txt](server/evaluation_results/benchmark_summary.txt); exclusion asserted in [paper_draft.md](research/paper_draft.md) | **CONFIRMED EXCLUDED** | Legacy figures retain **no dataset/provenance artifacts**; unverifiable |
| 18 | Comparative results for camera-only / ultrasonic-only / legacy weighted / production fusion exist | No `.jsonl` scenario files, no comparative result artifacts found; replay harness [fusion_experiment.py](server/fusion_experiment.py) exists | **NOT PRESENT** | Harness verified by unit tests; no recorded scenarios available |
| 19 | Held-out, independently labelled NetraSense dataset exists | None found in `server/evaluation_results/`, `experiments/` | **NOT PRESENT** | COCO-128 only, and split path is `coco128/images/train2017` (in-sample context) |
| 20 | Controlled physical range-error / latency / recovery measurement records exist | No measurement logs found; [NetraSense_Experiment_Protocol.md](NetraSense_Experiment_Protocol.md) states "Prepared for execution … tests have not been run" | **NOT PRESENT** | See §6 hardware framing |
| 21 | Physical prototype assembled and operational | Project-team statement (task briefing) | **REPORTED, not independently verifiable from repository** | Repository contains no controlled records; absent records ≠ absent prototype |

---

## 4. Verified Architecture Summary

- **Vision path:** webcam → `VisionPipeline` ([vision.py](server/vision.py)) → YOLO11 (tier-selected weights: `yolo11n.pt` for edge/CPU tiers per [engine.py](server/engine.py); tier-1 server hardware maps to `yolo11m.pt`) → detections with label/confidence/zone; monocular depth is optional and inactive without an ONNX session.
- **Ultrasonic path:** HC-SR04 on Trig D9/Echo D10 samples at 75 ms (24,000 µs echo timeout), valid range 2–380 cm → JSON telemetry at 9600 baud → [serial_sensor.py](server/serial_sensor.py) normalized parse (host range 2.0–400.0 cm, flagged-valid contract) → host receipt timestamp (not acquisition time) → freshness via [obstacle_warning.py](server/obstacle_warning.py) (stale strictly > 3.0 s).
- **Fusion:** [ensemble.py](server/ensemble.py) combines signals without numerical averaging; output is maximum-severity across valid signals; one-modality → `SENSOR DEGRADED`, ≥2 modalities → `FUSED`, none → `NO VALID DATA`; `fused_distance_cm` populated only for a sole distance source.
- **Warnings:** host-side threat levels per `threat_levels.py` (300/100/50 cm boundaries); Arduino buzzer runs **firmware-local patterns** with different bands (200/100 cm) — intentionally separate.
- **API:** `/api/latest`, `/api/fuse`, `/api/config`, `/api/capture`, plus Step-7 `/api/fusion-state` and `/api/alert-logs` ([vision_server.py](server/vision_server.py)).
- **Persistence:** `fusion_state_sessions` migration with RLS; [supabase.ts](src/lib/supabase.ts) publishes only when server-side credentials exist; alert history falls back to in-memory.
- **Dashboard:** [dashboard.tsx](src/routes/_authenticated/dashboard.tsx) renders fused state; stale/invalid/unavailable states are represented explicitly (regression-tested via [test_step7_fusion_state.py](server/test_step7_fusion_state.py), [test_vision_fusion_state.py](server/test_vision_fusion_state.py)).

---

## 5. Metric-Provenance Findings

Two **separate, reproducible audit runs** exist for the same weights (`yolo11n.pt`, SHA-256 `0ebbc80d…`) on COCO-128 (`coco128.yaml`, split path `…/coco128/images/train2017`, 128 images, 929 GT instances):

| Run | Date | Ultralytics / PyTorch / Python | mAP50 | mAP50–95 | Precision | Recall | F1 variant |
|---|---|---|---|---|---|---|---|
| A (original audit) | 2026-10-14 | 8.4.155 / 2.14.0 / 3.14.3 | 67.95 % | 50.22 % | 69.35 % | 59.09 % | macro-arith **57.91 %** |
| B (corrected rerun) | 2026-10-15 | 8.4.177 / 2.8.0 / 3.9.6 | **68.01 %** | **50.26 %** | 69.35 % | 59.09 % | harmonic 63.81 %; macro-arith varies by threshold |

Findings:

1. The frequently quoted mAP50 67.95 % / mAP50–95 50.22 % are **Run A values** under Ultralytics 8.4.155. The later rerun under 8.4.177 gives 68.01 % / 50.26 %. Both are internally consistent with their own reports ([validated_evaluation_report.json](server/evaluation_results/confidence_sweep/validated_evaluation_report.json), [corrected_evaluation_protocol_audit.txt](server/evaluation_results/confidence_sweep/corrected_evaluation_protocol_audit.txt) explicitly reconciles the pairs). Any paper citing one number set must state the Ultralytics version.
2. Precision 69.35 % and recall 59.09 % are **pooled (micro)** values retained across both runs. The older audit labeled them "Macro"; the corrected audit labels them "Pooled Micro" — the corrected terminology is authoritative.
3. Macro F1 57.91 % is the **arithmetic mean of per-class F1** recorded only in Run A (`macro_f1_arithmetic: 0.57911…`). Run B does not reproduce that exact value (its persisted macro-F1 values range from ≈44.7 % to ≈59.4 % depending on confidence threshold). Treat 57.91 % as single-run, version-specific and **not independently reproducible today**.
4. The COCO-128 "val" split maps to the `train2017` images — the same distribution context as the `yolo11n.pt` COCO pretraining set. These metrics are therefore an **in-sample detector diagnostic**, and per artifact statements, **not** integrated NetraSense obstacle-detection accuracy. The manuscript correctly does not quote them as system performance.
5. The legacy benchmark_summary figures (98.80 % accuracy, AUC 0.9995, mAP@50 89.20 %) have **no** accompanying dataset, split, confusion-matrix inputs, or provenance in the repository. Correctly excluded from the paper; unverifiable.

---

## 6. Hardware Status (wording conflict resolved)

- Per the project team, the **physical prototype has been assembled and operated**. Reports describing hardware as "unavailable" refer to the **audit environment**, not the project: no physical device was attached to the audit machine, so hardware-in-the-loop checks could not be freshly executed here.
- The repository contains protocols ([NetraSense_Experiment_Protocol.md](NetraSense_Experiment_Protocol.md), [server/PHYSICAL_TEST_PROTOCOL.md](server/PHYSICAL_TEST_PROTOCOL.md), [experiments/hardware_protocol.md](experiments/hardware_protocol.md)) but **no controlled measurement records** of range error, end-to-end warning latency, or sensor disconnection recovery.
- Correct statement for the paper: *the prototype has been assembled and demonstrated; controlled physical performance evaluation remains undocumented in the inspected evidence and is pending execution of the prepared protocol.*

---

## 7. Research-Paper Reconciliation (read-only)

Supported by source code (verbatim-consistent): threshold boundaries, freshness rule, no-averaging policy, NO DATA vs NO VALID DATA vs SENSOR DEGRADED vs FUSED semantics, absence of firmware acquisition timestamps, firmware-local buzzer, receipt-time proxy caveat, inactive depth estimation.

Supported only by automated software tests: malformed-input rejection, reconnection/stale transitions, fusion counts of modalities — repeatability tests, not physical behavior.

Detector-only diagnostics (not system accuracy): any COCO-128 metric.

Requiring physical measurements / independent data (currently absent): detection accuracy in NetraSense environments, range error vs. ground truth, warning latency, false-warning rate, recovery behavior, comparative fusion evaluation, participant usability/safety.

**Contradiction flags:** none found between the current [research/paper_draft.md](research/paper_draft.md) and the repository. The draft already excludes legacy synthetic figures, labels COCO-128 as in-sample diagnostic, reports no physical or comparative results, and explicitly frames the literature review as selective and novelty as provisional. One nuance for authors: if any external document quotes 67.95 %/50.22 %/57.91 %, it must cite Ultralytics 8.4.155 and label macro-F1 as single-run; the current canonical rerun under 8.4.177 yields 68.01 %/50.26 %.

---

## 8. Remaining Blockers for Submission

1. **Controlled physical evaluation** — execute the prepared protocol: range error at known distances, boundary tests (≈50/100/300 cm), stale/disconnection behavior, end-to-end warning latency, buzzer-observation records.
2. **Comparative fusion evaluation** — record labelled scenarios (JSONL), replay through [fusion_experiment.py](server/fusion_experiment.py), report per-policy metrics per the analysis plan.
3. **Independent dataset** — annotate a NetraSense held-out set; only then may any generalization claim be made.
4. **Supabase end-to-end verification** — provisioned connection, insert, RLS enforcement, and `/api/fusion-state` + `/api/alert-logs` against a live instance.
5. **Optional** — resolve the 11 lint warnings; decide which COCO metric version set (8.4.155 vs 8.4.177) any external summary uses.

## 9. Discrepancies with Earlier Reports

- Test count: historical "92 tests" (different environment) vs current **109** — both legitimate audit snapshots; never merge.
- mAP 67.95 % vs 68.01 % is a version difference, not an error; the corrected audit already documents both.
- "Macro Precision/Recall" (older) vs "Pooled Micro" (corrected) — the corrected terminology should be used going forward.
- Prior reports calling hardware "unavailable" must be read as audit-environment statements; the prototype itself is assembled and operational per the project team.
