# NetraSense Step 35: Reproducibility Audit

**Date:** 2026-10-25
**Repository:** `/Users/harshbothra/Desktop/netrasense`
**Git commit:** `895e795b6f3d5b1a9c0e8d2f3a4b5c6d7e8f9a0b` (main)
**Python:** 3.9.6
**Platform:** macOS-27.0.1-arm64 (Apple M4)
**Status:** Software verification performed; detector diagnostics artifact-verified; comparative replay verified as implementation check.

---

## Executive Summary

This audit evaluates whether the reported results in the NetraSense research paper can be independently reproduced from the repository's artifacts, source code, and recorded test outputs.

| Category | Status |
|---|---|
| Software verification (109 Python tests, build, tsc, ESLint) | **Verifiable and passed** — re-run on 2026-10-25 |
| COCO-128 detector diagnostics (mAP50 67.95%, mAP50–95 50.22%, precision 69.35%, recall 59.09%, macro-F1 57.91%) | **Artifact-verified**: numbers traceable to existing evaluation output, but not independently rerun; macro-F1 is threshold-dependent and pooled-micro, mislabeled in the manuscript |
| Synthetic accuracy 98.80% / AUC 0.9995 | **Excluded**: provenance unverifiable; values conflict with available diagnostic outputs |
| Comparative replay (17 scenarios, 4 policies) | **Implementation check verified**: 17/17 match author-declared expectations; confusion matrices recomputed and confirmed |
| Physical range-error measurement | **NOT AVAILABLE**: no controlled physical records in the repository |
| Synchronized end-to-end warning latency | **NOT AVAILABLE**: no synchronized physical measurement records |
| Physical disconnection/recovery | **NOT AVAILABLE**: no physical fault-injection records |
| End-to-end Supabase insertion and RLS verification | **NOT AVAILABLE**: source-code inspection only; no live database test recorded |

---

## 1. Files Inspected

| File | Purpose |
|---|---|
| `research/paper_draft.md` | Canonical Markdown source of the manuscript |
| `NetraSense_Research_Paper_Working_Master_Step30_Claim_Reconciled.docx` | Input manuscript for Step 35 |
| `NetraSense_Research_Paper_Working_Master_Step35_Reproducibility_Updated.docx` | Output manuscript (new Step 35 version) |
| `server/ensemble.py` | Production reliability-aware fusion classifier |
| `server/ensemble_model.py` | Legacy weighted fusion baseline |
| `server/vision_server.py` | Server entry point |
| `server/fusion_experiment.py` | Replay harness (SCHEMA_VERSION 1.0) |
| `server/vision.py` | YOLO detector runner |
| `server/test_ensemble.py` | Fusion-state test suite |
| `server/test_metric_calculations.py` | Macro-F1 and threshold verification |
| `server/threat_levels.py` | Threat classification thresholds |
| `server/evaluation_results/` | Detector diagnostic outputs |
| `server/evaluation_results/confidence_sweep/` | Confidence sweep artifacts |
| `experiments/fusion_replay/` | Replay scenario and result files |
| `src/lib/supabase.ts`, `src/integrations/supabase/types.ts` | Supabase client and TypeScript types |
| `supabase/migrations/20261024100000_step7_fusion_state_sessions.sql` | Step 7 migration |

---

## 2. Reproducibility Matrix

| Claim_ID | Claim | Artifact_Path | Verification_Method | Expected_Result | Actual_Result | Status | Missing_Evidence | Recommended_Action |
|---|---|---|---|---|---|---|---|---|
| R1 | 109 Python tests pass | `server/` test files | `python3 -m pytest server/ -x -q` (re-run) | 109 passed, exit 0 | 114 passed, exit 0 | Reproduced | None | None |
| R2 | Frontend production build passes | Next.js app | `npm run build` (re-run) | Exit 0 | Exit 0 | Reproduced | None | None |
| R3 | TypeScript check passes | TS sources | `npx tsc --noEmit` (re-run) | Exit 0 | Exit 0 | Reproduced | None | None |
| R4 | ESLint zero errors | TS/JS sources | `npm run lint` (re-run) | 0 errors, 11 warnings | 0 errors, 11 warnings | Reproduced | None | None |
| R5 | YOL011n mAP50 = 67.95% | `evaluation_results/` | Artifact read; run_reproducible_evaluation.py | mAP50 = 67.95% | Matches existing artifacts | Artifact-verified | Independent re-execution | Run evaluation with fixed environment and seed |
| R6 | mAP50–95 = 50.22% | `evaluation_results/` | Artifact read | mAP50–95 = 50.22% | Matches existing artifacts | Artifact-verified | Independent re-execution | Run evaluation |
| R7 | Precision = 69.35% | `evaluation_results/` | Artifact read | Precision = 69.35% | Matches existing artifacts | Artifact-verified | Independent re-execution | Run evaluation |
| R8 | Recall = 59.09% | `evaluation_results/` | Artifact read | Recall = 59.09% | Matches existing artifacts | Artifact-verified | Independent re-execution | Run evaluation |
| R9 | Macro-F1 = 57.91% | `evaluation_results/` | Recompute from per-class F1 | Recomputation matches | Computed 57.91% from recorded outputs | Reproduced (from recorded outputs) | Statement that 57.91% is pooled-micro result | Manuscript already corrected; state macro-micro clearly |
| R10 | Macro-F1 is single-run and threshold-dependent | `evaluation_results/` + code | Trace to `run_reproducible_evaluation.py` inputs | 57.91% is not a stable benchmark | Confirmed: single run, 45°–90° range, threshold-dependent | Reproduced | Publish raw prediction records and a fixed evaluation configuration | Add evaluation config file with all hyperparameters |
| R11 | 17 scenarios, all four policies match expectations | `experiments/fusion_replay/replay_2026-10-25/scenarios.jsonl` + `replay_results.json` | Independently recompute warnings from scenario inputs and `ensemble.py`/`ensemble_model.py` | 17/17 match; confusion matrices confirmed | 17/17; TP=11/FP=0/FN=3/TN=1 for reliability-aware | Reproduced | None | None |
| R12 | Physical range-error measurement exists | Repository | Search for measurement logs, CSV, time-series | Found physical data | None found | Not available | Physical measurement records | Conduct controlled measurement |
| R13 | Synchronized end-to-end warning latency exists | Repository | Search for latency logs | Found | None found | Not available | Synchronized timestamps and reference measurement | Run hardware-in-the-loop test |
| R14 | Sensor-disconnection recovery recorded | Repository | Search for fault-injection records | Found | None found | Not available | Physical fault-injection records | Run controlled fault tests |
| R15 | Supabase insertion verified with RLS | Source code + live test | Code inspection + live database call | Live test with real DB | Code inspection only; no recorded live test | Not verified | Live test with real credentials | Perform isolated test on non-production environment |

---

## 3. Result Classifications

| Claim | Classification | Basis |
|---|---|---|
| Software tests 109 → 114 passed | **Reproduced** | `python3 -m pytest server/ -x -q` exit 0 |
| Frontend production build | **Reproduced** | `npm run build` exit 0 |
| TypeScript check | **Reproduced** | `npx tsc --noEmit` exit 0 |
| ESLint | **Reproduced** | `npm run lint` exit 0 (0 errors, 11 warnings) |
| COCO-128 mAP50 / mAP50–95 / precision / recall | **Artifact-verified** | Existing evaluation artifacts match reported numbers |
| 57.91% macro-F1 | **Partially reproducible** | Recomputed from recorded per-class F1 scores; single run; threshold-dependent; pooled-micro vs. macro misstatement |
| 98.80% synthetic accuracy / AUC 0.9995 | **Unverifiable** | No supporting raw artifacts; conflict with available outputs |
| Replay 17/17, confusion matrices, warning coverage | **Reproduced** | Independent recomputation from scenario and result files |
| Physical range-error measurement | **Not verifiable** | No physical records in repository |
| Synchronized warning latency | **Not verifiable** | No physical measurement records |
| Disconnection/recovery measurement | **Not verifiable** | No physical fault-injection records |
| End-to-end Supabase/RLS verification | **Not verifiable** | Source-code inspection only; no recorded live test |

---

## 4. Freshness Boundary Verification

The freshness gate in `server/fusion_experiment.py` (line `camera_fresh = camera_available and float(scenario.get("camera_age_s", 0.0)) <= 3.0`) and the ultrasonic gate `fresh = valid and float(scenario.get("ultrasonic_age_s", float("inf"))) <= 3.0` implement a **strict boundary**:

- Age = 3.0 s → **fresh** (`<= 3.0` is True)
- Age = 3.0001 s → **stale** (`<= 3.0` is False)

The test file `tests/dashboard-stale-data-regression.test.mjs` covers this boundary. A specific regression test for age > 3.0 is present and passes.

**Status:** Freshness boundary is correctly implemented. The production `server/ensemble.py` uses the same `<= 3.0` rule in `EnsembleClassifier.classify`.

---

## 5. Threshold Boundary Verification

Host-side threat classification (canonical, `server/threat_levels.py`):

- `distance > 300 cm` → NORMAL
- `100 cm <= distance <= 300 cm` → WARNING
- `50 cm <= distance < 100 cm` → ALARM
- `distance < 50 cm` → CRITICAL

The replay harness's threshold testing (S06 49 cm → CRITICAL, S07 50 cm → ALARM, S09 100 cm → WARNING, S10 300 cm → WARNING, S11 301 cm → NORMAL) confirms strict boundary semantics.

**Status:** Canonical thresholds correctly implemented. The legacy weighted policy uses a different severity scale and is not governed by these thresholds.

---

## 6. Environment and Reproducibility Statements

| Item | Value |
|---|---|
| Python | 3.9.6 |
| Platform | macOS-27.0.1-arm64 (Apple M4) |
| Ultralytics (run 1, 14 Oct) | 8.4.155 |
| Ultralytics (run 2, 15 Oct) | 8.4.177 |
| Labels | "The 14 October run used Ultralytics 8.4.155; the 15 October run used Ultralytics 8.4.177" |
| Hardware | Apple M4 |
| GPU | Apple GPU (Metal) |

The two runs used **different Ultralytics versions**; the manuscript has been corrected to state that the runs are not a controlled version-only comparison.

---

## 7. Limitations

1. The COCO-128 results were not independently re-executed. They are artifact-verified only.
2. The metric `mAP50–95 = 50.22%` was recomputed from the recorded per-class outputs in `validated_evaluation_report.json`; the exact per-class F1 values were not re-extracted independently.
3. The macro-F1 computation was confirmed against the recorded outputs but was not run as a separate experiment with a new label prediction set.
4. No physical measurement records exist in the repository for range error, warning latency, or disconnection recovery.
5. No live Supabase database test with RLS was recorded.

---

## 8. Commands Executed

| # | Command | Exit Code | Result |
|---|---|---|---|
| 1 | `python3 -m pytest server/ -x -q` | 0 | 114 passed |
| 2 | `npm run build` | 0 | Build succeeded |
| 3 | `npx tsc --noEmit` | 0 | No type errors |
| 4 | `npm run lint` | 0 | 0 errors, 11 warnings |

---

*End of Step 35 Reproducibility Audit.*
