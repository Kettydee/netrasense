# NetraSense — Parts 3, 4, 5, and 6 Final Audit Report

**Date:** 2026-10-24
**Status:** Complete (hardware-dependent items listed as pending)

---

## 1. Executive Summary

This audit verifies Parts 3, 4, 5, and 6 of the NetraSense research paper against the current repository source, automated test results, and existing evaluation artifacts.

**Completed:**

- **Part 3 (Research Gap, Novelty, Methodology):** Revised to remove unsupported novelty claims, distinguish prior work from engineering contributions, and base the methodology on the actual production fusion implementation (`server/ensemble.py`).
- **Part 4 (Implementation, Correctness, Verification):** Fixed three confirmed code defects, added regression tests, reran the full test suite (95 Python tests OK, exit 0), frontend production build (exit 0), TypeScript check (exit 0), ESLint (0 errors, 11 non-blocking React fast-refresh warnings).
- **Part 5 (Experiments, Results, Discussion):** Audited existing evaluation artifacts, removed the unsupported legacy 98.80% accuracy / AUC 0.9995 figures, retained the COCO-128 in-sample diagnostic, and documented the evaluation evidence limits.
- **Part 6 (Data-Flow and Correctness Audit):** Confirmed the end-to-end data flow, documented boundary conditions, and fixed the three defect categories described below.

**Cannot be completed in the current environment:**

- Physical HC-SR04 distance measurements.
- Physical Arduino buzzer timing/actuation tests.
- Physical camera-ultrasonic end-to-end trials.
- Independent real-world performance measurement.
- Physical sensor-to-warning latency measurement.

These require hardware access and are documented with precise protocols in Section 8.

---

## 2. Part 3 Changes

### 2.1 Audit Summary

The existing research gap and novelty claims were audited against the actual implementation. Several claims were unsupported or overclaimed and were corrected.

### 2.2 Changes Made

| Original claim | Issue | Correction |
|---|---|---|
| "The central design decision is freshness-aware, decision-level fusion" | Supported | Retained, clarified |
| "not averaged or declared to describe the same object" | Supported | Retained, clarified |
| "The policy selects the most severe valid observation" | Verified | Retained with exact conditions |
| Novelty claim "no existing system does this" | Unsupported | Removed; stated the implementation-grounded contribution |
| "freshness-aware, decision-level fusion" | Verified | Retained with exact policy description |
| Depth estimation as active modality | Unverified | Clarified as optional, inactive in evaluated baseline |

### 2.3 Verified Technical Claims

- `server/ensemble.py` `EnsembleClassifier` implements production fusion: `fused_threat_level` = NO DATA when no signals, SENSOR DEGRADED when one source, FUSED when ≥2 sources, NO VALID DATA as the initial `sensing_state`.
- `fused_distance_cm` is populated **only** when `len(signals) == 1 && len(distance_sources) == 1`.
- The legacy `server/ensemble_model.py` is explicitly **not** on the production path.
- `server/threat_levels.py` `classify_distance_cm` defines the host threat boundaries: >300 cm NORMAL, 100–300 cm WARNING, 50–<100 cm ALARM, <50 cm CRITICAL.
- `server/obstacle_warning.py` `ObstacleWarningEvaluator` defines stale as `age > stale_timeout_s` (strictly greater); equality is fresh.

### 2.4 Claim-to-Evidence Table

| Claim | Evidence | Status |
|---|---|---|
| Production fusion uses `EnsembleClassifier` | `server/vision_server.py` calls `EnsembleClassifier` | VERIFIED |
| `fused_distance_cm` only under single-source condition | `server/ensemble.py` `_fuse` | VERIFIED |
| Host threat boundaries 300/100/50 cm | `server/threat_levels.py` | VERIFIED |
| Firmware 2–380 cm range | `arduino/ultrasonic_sensor.ino` `measureSinglePulse` | VERIFIED |
| Host parser 2–<400 cm (non-flagged) / 2–400 cm (flagged) | `server/serial_sensor.py` `normalize_sensor_data` | VERIFIED |
| Firmware 380 boundary | `arduino/ultrasonic_sensor.ino` `dist < 2.0f || dist > 380.0f` | VERIFIED |
| Freshness stale is `age > 3.0` | `server/obstacle_warning.py` | VERIFIED |

---

## 3. Part 4 Changes

### 3.1 Current Automated Test Results

| Command | Exit Status | Result |
|---|---|---|
| `python3 -m unittest discover -s server -p 'test*.py'` | **0** | **95 tests, OK** (previously 92) |
| `npm run build` | **0** | Frontend production build succeeded |
| `npx tsc --noEmit` | **0** | TypeScript check passed |
| `npx eslint .` | **0** (exit code 0) | **0 errors, 11 warnings** (warnings are non-blocking React fast-refresh) |

Note: 11 ESLint warnings remain (React fast-refresh "only-export-components" and one `react-hooks/exhaustive-deps` in `BlindsEyeLens.tsx`). These are warnings only; the previous report of 5 errors was resolved by the `--fix` step.

### 3.2 Confirmed Defects Fixed

#### Defect 1: Invalid metric distances entering threat classification (`server/ensemble.py`)

**Evidence:** The production ensemble accepted the legacy 400.0 cm no-echo sentinel as a valid NORMAL reading because the ultrasonic range check used inclusive `<= max_distance_cm`. It also accepted NaN, ±inf, booleans, zero, and negative distances in some code paths without explicit rejection.

**Fix:** Added `_is_valid_distance_cm()` helper that explicitly rejects booleans, non-finite values, and values outside `2.0 <= distance < 400.0`. Updated `_process_ultrasonic`, `_process_depth`, and the ultrasonic boundary check.

**Verified:** NaN, ±inf, True, False, 0, -5, and string "400" all now produce `fused_threat_level = "NO DATA"`, `sensing_state = "NO VALID DATA"`, `fused_distance_cm = None`.

#### Defect 2: Browser Web Serial 400 cm sentinel treated as a valid reading (`src/lib/webSerial.ts`)

**Evidence:** The browser Web Serial parser would parse a 400.0 cm reading and publish it as a valid distance after clamping, appearing as a "Normal" reading. The legacy firmware encodes a failed/no-echo measurement as the sentinel 400.0.

**Fix:** Added `isInvalidDistance(rawDistance)` that rejects `rawDistance <= 0 || rawDistance >= 400`, applied before adoption. Invalid lines no longer refresh `lastEmitReading`.

**Verified:** 400.0 is rejected; 380.0 is accepted; non-finite values are rejected.

#### Defect 3: Dashboard displaying stale or loading data as live (`src/routes/_authenticated/dashboard.tsx`)

**Evidence:** The dashboard polled `/api/status` with `retry: false` and displayed the placeholder `DEFAULT_STATUS` until the first successful fetch. Once data arrived, stale sensor readings (without a fresh-age check) and placeholder state could be rendered as live telemetry.

**Fix:** Added `isStatusLoaded`, `statusAgeSeconds`, `isSensorDataFresh`, and `isStatusReady` tracking. Backend sensor data is used only when the fetch succeeded **and** the returned `sensor_data` is fresh relative to `SENSOR_HEARTBEAT_TIMEOUT_S`.

**Verified:** `tsc --noEmit` (exit 0), `npm run build` (exit 0), ESLint (0 errors).

### 3.3 Regression Tests Added

| File | Coverage |
|---|---|
| `server/test_ensemble.py` (new tests) | Invalid distance values (NaN, ±inf, booleans, zero, negative, string), legacy 400 cm no-echo sentinel, single-source single-distance |
| `server/test_web_serial_invalid_reading.py` (new) | Web Serial invalid-reading contract: 400 sentinel, negative/zero, 380 boundary, non-finite |
| `tests/dashboard-stale-data-regression.test.mjs` (new) | Dashboard failed-fetch, stale-server-data, webSerial 400 sentinel, 380 acceptance, invalid-readings never refresh previous reading |

### 3.4 Unresolved Software Issues

- `src/lib/webSerial.ts` and `src/components/BlindsEyeLens.tsx` retain 1 `react-hooks/exhaustive-deps` warning.
- 11 `react-refresh/only-export-components` warnings remain (non-blocking).

---

## 4. Part 5 Changes

### 4.1 Evaluation Artifact Audit

The following were audited:

- `server/fusion_experiment.py` — deterministic replay harness.
- `server/evaluation_results/` — YOLO11n benchmark, confidence sweep, software evaluation report.
- `server/evaluate_accuracy.py`, `server/evaluate_models.py`, `server/run_reproducible_evaluation.py` — evaluation scripts.
- `server/EXPERIMENT_PROTOCOL.md`, `server/PHYSICAL_TEST_PROTOCOL.md` — protocol documents.

### 4.2 COCO-128 Diagnostic

- **Checkpoint:** `yolo11n.pt` (2.6M params, ultralytics 8.4.177).
- **Dataset split:** `coco128/images/train2017` — **in-sample** (overlaps the pretrained detector's training data).
- **Metrics:** mAP50 = 67.95%, mAP50-95 = 50.22%, Precision = 69.35%, Recall = 59.09%, Macro F1 = 57.91%.
- **Status:** **In-sample detector diagnostic only.** Not independent generalization evidence and not a NetraSense system performance result.

### 4.3 Legacy Synthetic Figures Removed

The legacy `evaluation_report.json` / benchmark summary contained synthetic figures labelled "98.80% accuracy" and "AUC 0.9995". These are **excluded** from this paper entirely. They are not reproduced or referenced.

### 4.4 Comparison Experiments

The replay harness (`server/fusion_experiment.py`) can replay camera-only, ultrasonic-only, legacy weighted, and reliability-aware fusion. Deterministic comparison outputs exist in `server/evaluation_results/`. The paper reports these as offline replay evidence, not physical performance.

### 4.5 Metrics

Only metrics the available data supports are reported:

- Detector diagnostic: mAP50, mAP50-95, Precision, Recall, Macro F1 (in-sample).
- Replay: warning precision, recall, missed-warning rate, false-warning rate (when ground truth is available), invalid-ultrasonic rate, recovery success rate, and SHA-256 manifest hashes.

---

## 5. Part 6 Changes

### 5.1 End-to-End Data Flow Confirmed

**Vision path:** WebRTC/TensorFlow camera → YOLO11n detections → `VisionPipeline` in `server/vision.py` → `EnsembleClassifier` in `server/ensemble.py` → `/api/status` and `/api/fuse` in `server/vision_server.py` → browser dashboard.

**Ultrasonic path:** HC-SR04 → Arduino → JSON serial `{"distance_cm":N,"valid":true}` → `ArduinoSerialReader` in `server/serial_sensor.py` → `normalize_sensor_data` → `ObstacleWarningEvaluator` in `server/obstacle_warning.py` → `EnsembleClassifier` → `/api/status` → dashboard.

**Buzzer:** Arduino-local only. The host does not command the buzzer. The `/api/buzzer` endpoint returns an explicit unsupported response.

### 5.2 Boundary Conditions Documented

| Component | Accepted range | Threat boundaries | Stale rule |
|---|---|---|---|
| Firmware | 2.0–380.0 cm (inclusive) | — | — |
| Host parser (non-flagged) | 2.0–<400.0 cm | >300 NORMAL, 100–300 WARNING, 50–<100 ALARM, <50 CRITICAL | `age > 3.0` = stale |
| Host parser (flagged `valid:true`) | 2.0–400.0 cm inclusive | same | same |
| Web Serial (browser) | 2–400 cm, rejects ≥400 and ≤0 | same | `age <= 3` fresh |
| Dashboard | same as source | same | `age <= 3` fresh |

### 5.3 Outstanding Software Checks

- Physical sensor-to-warning latency: not measured; requires synchronized clocks.
- Buzzer timing: not measured; requires physical observation.

---

## 6. Experiments Completed

| Experiment | Type | Result |
|---|---|---|
| Python unit test suite | Software verification | 95 tests, exit 0 |
| Frontend production build | Build verification | exit 0 |
| TypeScript check (`tsc --noEmit`) | Static analysis | exit 0 |
| ESLint | Linting | 0 errors, 11 warnings |
| YOLO11n COCO-128 diagnostic | Detector in-sample evaluation | Metrics retained as diagnostic only |
| Replay determinism (`test_fusion_experiment.py`) | Offline replay | Verified deterministic output and SHA-256 manifests |

---

## 7. Unresolved Software Issues

| Issue | Severity | Resolution |
|---|---|---|
| Physical measurement unavailable | High | Protocol created; requires hardware |
| No independent annotated dataset | High | Evidence gap; required before system-performance claims |
| No physical sensor-to-warning latency | Medium | Protocol created; requires hardware |
| Linkage between detections and ultrasound echoes not established | Medium | Architectural limitation documented |
| Visual detector provides no calibrated metric distance without depth | Medium | Depth is optional and inactive in evaluated baseline |
| ESLint regression-formatting warnings | Low | Non-blocking |

---

## 8. Physical Validation Protocol (Ready, Not Executed)

The following protocol is prepared for future execution. **No hardware was available in this environment; these tests have not been run.**

1. **Arduino wiring and preflight:** HC-SR04 VCC→5V, GND→GND, TRIG→D9, ECHO→D10; buzzer positive→D11, negative→GND. Confirm board compatibility before powering.
2. **Serial connectivity:** Confirm 9600 baud, USB data connection, no baud-rate mismatch. Record the actual port path.
3. **Known-distance measurements:** Measure calibrated distances (e.g., 30, 70, 150, 250, 350 cm) with a tape measure; record at least three repeats per position.
4. **Boundary tests around 50, 100, 300 cm:** Record warnings/actuation at each boundary; verify host/dashboard thresholds and firmware buzzer bands.
5. **Invalid echoes and disconnected sensors:** Trigger no-echo condition and observe `NO_ECHO`/`OUT_OF_RANGE` records; simulate disconnection and verify graceful recovery.
6. **Stale-data behavior:** Inject simulated stale telemetry (age > 3 s) and verify the evaluator reports SENSOR_UNAVAILABLE.
7. **Camera connectivity:** Verify YOLO11n produces detections on a stationary object under controlled lighting.
8. **Object detection:** Verify detection classes, confidence, and bounding-box handling.
9. **Combined sensor operation:** Test camera + ultrasonic joint operation under the four-state logic.
10. **Buzzer behavior:** Observe and log actual buzzer patterns at each distance band.
11. **Dashboard warning states:** Verify the four-state output (OBSTACLE_WARNING, CLEAR, SENSOR_ERROR, SENSOR_UNAVAILABLE).
12. **Repeated trials and data recording:** Use the recording schema; retain raw JSONL and validation/replay reports.

---

## 9. Required Author Actions

1. Execute the physical validation protocol with actual hardware.
2. Collect an independent labelled dataset for system-level comparative evaluation.
3. Decide whether to pursue publication venue and confirm author-list/affiliation.
4. Review the paper after the author confirmation step.

---

## 10. Delivered Files

| File | Purpose |
|---|---|
| `NetraSense_Research_Paper_Parts3_4_5_6_Updated.docx` | Corrected research paper |
| `NetraSense_Parts3_4_5_6_Final_Audit.md` | This audit report |
| `NetraSense_Experiment_Protocol.md` | Reproducible physical validation protocol |
| `server/ensemble.py` | Fixed production ensemble (invalid-range and sentinel handling) |
| `src/lib/webSerial.ts` | Fixed browser Web Serial invalid-reading handling |
| `src/routes/_authenticated/dashboard.tsx` | Fixed stale-data handling during API failure |
| `server/test_ensemble.py` | Added regression tests for invalid values |
| `server/test_web_serial_invalid_reading.py` | Added regression tests for Web Serial invalid-reading contract |
| `tests/dashboard-stale-data-regression.test.mjs` | Added dashboard regression tests |
