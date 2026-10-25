# NetraSense Step 21 — Independent Verification of the Comparative Replay Results

**Audit date:** 2026-10-25 · **Branch:** `main` · **Commit verified live:** `0b22525b3abb13f03ebc35f0637fa95dab531ad5`
**Method:** read-only independent recomputation from raw artifacts; existing artifacts, sources, and manuscript untouched.

---

## 1. Executive Verdict

**INDEPENDENTLY VERIFIED, WITH DISCLOSED LIMITATIONS.** All headline metrics of the 25 October replay reproduce exactly from the raw files: 17 accepted scenarios (0 excluded), all four policy outputs present on every record, boolean-warning expectation matches 17/17 for all four policies, confusion matrices (TP/FP/FN/TN = 11/0/3/1 for reliability-aware; 10/0/4/1 legacy; 9/0/5/1 ultrasonic-only; 3/0/11/1 camera-only), warning precision 1.0 on every policy, and both artifact hashes reproduce bit-exactly. Two interpretation-level corrections stand out and are itemized in §7/§10: (a) the "expected outputs" are stored **in the same scenario file as the inputs**, so the 17/17 result is an implementation check against author-declared expectations, not independent ground-truth validation; (b) two scenarios (S02, S17) show a *severity-label* deviation from the predicted text ("Alarming" vs actual "Collision") that is invisible in the boolean metric.

## 2. Files Inspected and Repository State

- [scenarios.jsonl](experiments/fusion_replay/replay_2026-10-25/scenarios.jsonl) (17,344 bytes, mtime 12:28), [replay_results.json](experiments/fusion_replay/replay_2026-10-25/replay_results.json) (21,987 B), [replay_summary.json](experiments/fusion_replay/replay_2026-10-25/replay_summary.json) (14,959 B), [REPLAY_REPORT.md](experiments/fusion_replay/replay_2026-10-25/REPLAY_REPORT.md) (9,550 B).
- Harness semantics: [fusion_experiment.py](server/fusion_experiment.py) (`validate_scenario`, `_method_metrics`, `_manifest`, `evaluate_scenarios`); production fusion [ensemble.py](server/ensemble.py) `classify/_process_ultrasonic/_process_yolo/_fuse`; legacy [ensemble_model.py](server/ensemble_model.py) `fuse/_score_ultrasonic/_score_yolo`.
- Working tree preserved (uncommitted modifications unchanged); branch `main`.
- Harness tests rerun fresh: `python3 -m unittest test_fusion_experiment` in `server/` → exit 0, `OK` (6/6; the tail output shows the final `OK` line).

## 3. Schema and Record-Integrity Checks (independent)

| Check | Result |
|---|---|
| JSONL records | **17**, each parses as JSON |
| Unique scenario IDs | **True** (17 unique) |
| Schema conformance (rerun through the harness's own `validate_scenario`) | **0 violations**; 17/17 accepted |
| Both JSON outputs parse | **OK** |
| Scenario↔result association | **1:1 and complete** (every scenario id has exactly one record; no orphan records) |
| Policy blocks present | `camera_only`, `ultrasonic_only`, `legacy_weighted`, `reliability_aware` on **all 17** records; `sensing_state` present on every `reliability_aware` block |
| Recording types (recomputed) | `{simulated: 11, fault_injection: 6}` — matches the report |
| Physical recordings falsely represented | **None** — every record carries `input_provenance` containing "synthetic"; no `recording_type: physical` record exists |
| Manifest cross-check | `accepted_records: 17` == recomputed accepted count; manifest categories match recomputed category counts |

## 4. Independently Recalculated Metrics

Recomputed from `scenarios.jsonl` + per-record policy blocks; **not copied** from `replay_summary.json` (the recorded summary was then cross-checked and matched exactly — see §8).

Denominator derivation: 17 scenarios total; `ground_truth_warning` is boolean on **15** (S02, S03, S04, S06–S10, S11, S12, S13, S14, S15, S16, S17 → 14 true; S09 false); **2 unknown-label records (S01, S05) are excluded** from all warning denominators per the harness's labeled-set rule (mirrored by my independent count). The "14 warning-labelled scenarios" figure = all gt-true labeled scenarios. Standard binary classification and the harness's definition agree here; both are reported and identical for this data.

| Policy | Included | Unknown | TP | FP | FN | TN | Precision | Recall | False-warn rate | Missed-warn rate |
|---|---|---|---|---|---|---|---|---|---|---|
| camera_only | 15 | 2 | 3 | 0 | 11 | 1 | 1.0 | 0.2143 | 0.0 | 0.7857 |
| ultrasonic_only | 15 | 2 | 9 | 0 | 5 | 1 | 1.0 | 0.6429 | 0.0 | 0.3571 |
| legacy_weighted | 15 | 2 | 10 | 0 | 4 | 1 | 1.0 | 0.7143 | 0.0 | 0.2857 |
| reliability_aware | 15 | 2 | **11** | **0** | **3** | **1** | 1.0 | 0.7857 | 0.0 | 0.2143 |

Reported coverage 11/14, 10/14, 9/14, 3/14 **reproduces exactly**. The reliability-aware matrix TP=11/FP=0/FN=3/TN=1 **verified against individual records** (gt-true non-warned cases: S11, S12, S14 — invalid/stale ultrasonic with camera absent; correct policy behavior, correctly excluded from any "accuracy" phrasing because ground truth there is synthetic).

Expectation-match recomputation (boolean warning, per the harness's `warning` field): **camera_only 17/17, ultrasonic_only 17/17, legacy_weighted 17/17, reliability_aware 17/17 — zero mismatches**, for every scenario individually (full trail in [NetraSense_Step21_Scenario_Audit.csv](NetraSense_Step21_Scenario_Audit.csv)).

## 5. Confusion Matrices for All Four Policies

Above in §4 (identical in [NetraSense_Step21_Recomputed_Metrics.json](NetraSense_Step21_Recomputed_Metrics.json)). Note both representations coincide because the harness computes the same pooled values over the same 15 boolean-labelled records; unknown-label records never enter denominators (verified: `false_warning_rate`/`warning_precision` None cases only when denominators are 0 — not triggered here).

## 6. Scenario-by-Scenario Discrepancies

Boolean-warning level: **no discrepancies** (all 68 policy×scenario comparisons match the pre-stored expectations).

Severity-*label* expectations (the first token of each `expected` string) vs actual output, checked independently: three textual deviations, none a behavioural mismatch:

1. **S01 / reliability_aware** — expected token "NO DATA threat", actual severity "NO DATA". Wording artifact of the expectation text; after normalization this is a match.
2. **S02-camera-only-person / legacy_weighted** — expectation text predicted "Alarming"; raw output is **"Collision"**. Explanation from code: legacy `_score_yolo` yields det_score ≈ 0.94 (person risk 0.85×0.4 + full proximity 0.6), and `fuse()`'s safety override (`fused_score ≥ 0.82` → "Collision") fires before the band thresholds. Boolean warning true both ways. This is a prediction-text imprecision by the audit author during Step 19, recorded transparently under `discrepancy_notes`, not a harness or implementation error.
3. **S17-ultrasonic-disconnected-visual / legacy_weighted** — same "Alarming"-vs-"Collision" override as S02.

No scenario exhibits out-of-range, missing, or contradictory output fields; no unexpected records; no duplicate IDs.

## 7. Specific Technical Checks (A–E)

**A. No-evidence behaviour (S01, S11, S12, S14).** Raw `legacy_weighted` blocks: severity `"Normal"`, warning false on all four cases; raw `reliability_aware` blocks: severity `"NO DATA"`, `sensing_state: "NO VALID DATA"`, no numeric distance field in the record (production result serializes `fused_distance_cm` only through `to_dict`; the replay row carries no distance ⇒ null in the paper sense). **Qualification:** the *fabricated 400 cm consensus distance* and the *"Path clear. Proceed safely."* action string are **not fields of the replay outputs** — they are properties of [`ensemble_model.py fuse()`](server/ensemble_model.py#L163) (else-branch `consensus_dist = 400.0` with uniform 0.33/0.34 fallback weights), established by direct code inspection of the exact function invoked by the harness. Verified by implementation, not observable in `replay_results.json` rows; any paper wording must not imply the raw replay file contains that distance.

**B. Threshold boundaries.** Ultrasonic-only and reliability-aware severities from raw records: 49 cm → CRITICAL (S10), 50 cm → ALARM (S06), 100 cm → WARNING (S07), 300 cm → WARNING (S08), 301 cm → NORMAL (S09) — exactly the documented canonical bands (>300 NORMAL; 100–300 inclusive WARNING; 50–99 ALARM; <50 CRITICAL). Legacy uses different internal bands (collision 40 cm, alarming ≤100 cm, warning ≤200 cm): raw legacy severities are "Alarming" at 49/50/100 and, notably, **"Normal" at exactly 300 cm** (its score 0.15 at d≥200 with no visual evidence) — a genuine legacy-vs-canonical boundary divergence. The report already compares legacy via boolean warning only at that point; confirmed appropriate.

**C. Freshness.** Harness code applies a single, shared gate before any policy sees data: `fresh = ultrasonic_valid is True and age <= 3.0`; invalid (`ultrasonic_valid` false/null) and `age > 3.0` both become no-evidence; **exactly 3.0 s remains evidence-active** (S13 raw output: ultrasonic-only ALARM, reliability-aware ALARM/SENSOR DEGRADED) while 3.001 s is excluded (S14 → NO DATA everywhere except camera path). Confirmed in code: stale/invalid handling is **pre-applied by the shared gate, not independently re-implemented by each policy** — the four-way comparison is therefore a decision-policy comparison on equal, already-gated inputs. Documented difference: only `reliability_aware` additionally exposes `sensing_state`.

**D. Sensor fusion / no-averaging.** Raw records for S04 (multi-modality agreeing) and S05 (conflict): `reliability_aware` severities ALARM and WARNING with `sensing_state: "FUSED"`, and **no fused distance field is emitted on either multi-modality record** — consistent with production `_fuse()` (numeric `fused_distance_cm` only when exactly one signal *and* one distance source). By contrast, the legacy consensus average (~79 cm, S04) is computed inside the legacy model (code-verified). No-evidence (`NO VALID DATA`) is distinct from a measured clear path (S09 NORMAL with numeric distance 301) in both code and outputs. Visual detections in this scenario set carry no calibrated metric distance, and no policy output treats them as such (camera-only is boolean; production falls back to WARNING severity, never a distance).

**E. Recovery.** Recomputed directly: records with `fault_event ∈ {RECONNECTED, RECOVERED}` = **1** (S16); `ultrasonic_valid` on it = true → success 1/1, rate 1.0 — matches the report. **Qualification:** one designed recovery scenario establishes only that the harness's recovery accounting works; it does not establish physical recovery robustness or recovery latency.

## 8. Hash Verification

| Hash | Reported | Independently recomputed | Status |
|---|---|---|---|
| `source_sha256` (sha256 of `scenarios.jsonl` bytes) | `ef`-prefixed value in `replay_results.json.manifest` | sha256 of the file's raw bytes | **VERIFIED, exact match** |
| `accepted_payload_sha256` | present in manifest | Reimplemented the exact documented pipeline from `_manifest` source: parsed JSONL → schema-validate → dedupe → `setdefault` fix-ups (`timestamp_source"/`recording_type` → "unknown", `fault_event` → "NONE") → `json.dumps(accepted, sort_keys=True, separators=(",",":"))` → sha256 | **VERIFIED, exact match** (`ef47d3fc...` both sides) |

Key-ordering, whitespace, permission to include non-schema documentation keys (`expected`, `rationale`, … inside the hashed payload) were all confirmed by reading `_manifest` before recomputing; no unknown-algorithm blocker.

## 9. Manuscript Integration Audit (Step 20 draft — read-only)

Manuscript inspected: [research/paper_draft.md](research/paper_draft.md). **No numeric comparative-replay claims are currently integrated.** The draft reports the replay *workflow* (lines 127–141) and explicitly states that simulated and fault-injection records "are not physical evidence" (line 131) and that the draft "reports no detection, warning, recovery, or safety-performance result" (line 10).

| Potential claim | Verdict | Basis |
|---|---|---|
| Replay harness replays four policies deterministically with hash-backed manifest | VERIFIED | `fusion_experiment.py` + recomputed hashes |
| Stale/invalid handling precedes policy comparison (shared gate) | VERIFIED | `evaluate_scenarios` source |
| Simulated records are not physical evidence | VERIFIED (consistent) | all records synthetic |
| "Reports no detection/warning/recovery result" | VERIFIED (consistent) | no numeric replay results in draft |
| Any claimed 17/17 or 11/14 figure | NOT APPLICABLE / NOT PRESENT | absent from draft; if added later, must carry the §5(a) framing |
| Legacy no-evidence "Path clear"/400 cm characterizations | VERIFIED via code | §7.A — but wording must say "per the legacy implementation", since raw replay rows omit it |
| Any superiority or real-world-accuracy statement | UNSUPPORTED if added without physical/cohort data | §4 denominators are 15 designed scenarios |

**Does the Step 20 manuscript need corrections?** No corrections are required for consistency with the replay evidence, because the draft deliberately reports no such numbers. If the authors later integrate the replay results, they must include the two qualifications below.

## 10. Limitations and Recommended Qualifications

1. **Expectation provenance:** expected outputs are stored in the same file as the inputs; chronological pre-declaration cannot be proven from file metadata (all four artifacts share the 12:28–12:30 window). The 17/17 result must be phrased as *implementation verification against author-declared expectations*, never as independent ground-truth evaluation.
2. **Severity-label deviations (S02, S17):** legacy's Collision-override makes the "Alarming" expectation-text imprecise; consequence-free at boolean level, but any text quoting legacy severities should say Collision for close, high-risk visuals.
3. **Legacy 400 cm fabrication** is code-derived (replayed rows omit it); cite it as implementation property.
4. **Denominators are small and synthetic:** 15 labelled scenarios (14 true / 1 false). Underlying metrics are extremely sensitive; never convert recall 0.786 into a real-world rate.
5. Still outstanding and *not offered for manuscript reuse*: physical range-error, synchronized physical warning latency, hardware disconnection/recovery, end-to-end Supabase/RLS verification.

## 11. Commands Executed and Exit Codes

| Command | Exit |
|---|---|
| `git branch --show-current; git rev-parse HEAD; git status --short` | 0 |
| `python3 -m unittest test_fusion_experiment` (cwd `server`) | 0 (`OK`, 6/6; final line verified) |
| Independent schema/integrity/hash recomputation script (imports harness `validate_scenario`; re-implements payload hashing) | 0 — all checks printed above |
| Independent metric recomputation script (confusion counts, boundary/no-evidence/fusion/recovery checks) | 0 — all reported values matched |
| Severity-level expectation cross-check | 0 — 3 textual deviations found and documented |
| CSV regeneration + validation (26 columns × 18 rows header+17, workable) | 0 |

No experiment rerun overwrote any existing artifact (all recomputations used temporary in-memory state); uncommitted changes preserved.
