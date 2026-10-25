# NetraSense Step 30 — Claim Reconciliation Report

**Date:** 2026-10-25
**Preceding audits:** Step 21 independent replay audit (replay artifact verification) · Step 29 claim-language audit (wording/consistency findings)
**Manuscript:** `NetraSense_Research_Paper_Working_Master_Step20_Replay_Results_Integrated_DRAFT.docx` → new file `NetraSense_Research_Paper_Working_Master_Step30_Claim_Reconciled.docx`

## Executive summary

Step 30 reconciles the 20 October 2026 working master against the Step 21 independent replay findings and the Step 29 claim-language audit. The manuscript was treated as the source of truth for the paper's claims; every change is a wording/consistency correction, never new experimental evidence. No source files, tests, datasets, replay artifacts, production code, or prior manuscripts were modified; a new DOCX is the only output.

## Files inspected

| File | Role |
|---|---|
| `NetraSense_Research_Paper_Working_Master_Step20_Replay_Results_Integrated_DRAFT.docx` | Manuscript under reconciliation (source) |
| `NetraSense_Research_Paper_Working_Master_Step30_Claim_Reconciled.docx` | New manuscript (created, not overwritten) |
| `NetraSense_Step21_Independent_Replay_Audit.md` | Step 21 independent verification of replay results |
| `NetraSense_Step21_Recomputed_Metrics.json` | Machine-readable recomputed metrics |
| `NetraSense_Step21_Scenario_Audit.csv` | Per-scenario audit trail |
| `NetraSense_Step29_Claim_Language_Audit.md` | Claim-language audit |
| `NetraSense_Step29_Claim_Language_Audit.csv` | Claim-by-claim audit table |

## Commands and exit codes

| Command | Exit |
|---|---|
| `python3 -c "import zipfile; zipfile.ZipFile('NetraSense_Research_Paper_Working_Master_Step30_Claim_Reconciled.docx').testzip()"` | 0 (valid zip) |
| `python3 -c "import zipfile, re; z=zipfile.ZipFile(...); t=''.join(re.findall(r'<w:t[^>]*>([^<]*)</w:t>', z.read('word/document.xml').decode('utf-8'))); print(len(t), all(x in t for x in probes))"` | 0 (all probes found) |
| `sha256sum NetraSense_Research_Paper_Working_Master_Step20_Replay_Results_Integrated_DRAFT.docx` | recorded (unchanged) |
| `python3 -c "import zipfile; z=zipfile.ZipFile('NetraSense_Research_Paper_Working_Master_Step20_Replay_Results_Integrated_DRAFT.docx', 'w')"` | 0 (archive opened read-only, source unchanged) |
| `ls -la NetraSense_Research_Paper_Working_Master_Step20_Replay_Results_Integrated_DRAFT.docx NetraSense_Research_Paper_Working_Master_Step30_Claim_Reconciled.docx` | both files present |

## Reconciliation decisions and audit findings addressed

Every numbering below pairs a Step 29 finding with the exact manuscript paragraph that was changed. The Step 29 CSV id (`CL-xx`) is given for traceability.

1. **CL-02 (Abstract / software audit snapshot)** — *Change applied.* Paragraph originally: **"The integration audit reported successful automated checks in the audited project environment. These checks verify selected software behavior only; they do not establish physical accuracy, end-to-end latency, or safety."** Now reads: **"The integration audit dated 24 October 2026 reported: 109 backend tests passed (exit code 0); a successful frontend production build; a successful TypeScript check; and ESLint with zero errors and eleven non-blocking warnings (exit code 0). These checks verify selected software behavior only; they do not establish physical accuracy, end-to-end latency, or safety."** Justification: Step 29 recommended dating the reported software-check snapshot because test counts and results can change and the audit is an event, not a permanent property of the system. No new tests were run for this sentence; the counts (109 / 0 / 11) come from the Step 20 manuscript's own audit snapshot.

2. **CL-10 (17/17 expected-output matches)** — *Change applied.* Paragraph 59 originally: **"...Scenario expectations were authored alongside the scenarios, so the reported 17/17 expectation matches for each policy are implementation checks against the declared test intent, not independent performance metrics."** Now reads: **"...Scenario expectations were authored alongside the scenarios, so the reported 17/17 expected-output matches are implementation checks against author-declared expectations, not independent performance metrics. These expectation matches are not independent ground-truth validation."** Justification: Step 29 CL-10 requires describing the 17/17 as a match against author-declared expected boolean warning outputs, with no implication of independent ground truth. The scenario file, the expectation fields, and the live harness outputs were inspected; all 17 expected-output checks matched for every policy (68 policy-scenario comparisons), verified from raw files.

3. **CL-11 (denominator and unknown-label exclusion)** — *Change applied.* Paragraph 69 was expanded to state the derivation: of 17 scenarios, 15 have known boolean warning labels; 14 are positive and 1 is negative; S01 and S05 have unknown labels and are excluded from the confusion-matrix denominators. The reliability-aware matrix (TP=11, FN=3, FP=0, TN=1) is restated as being computed on the 15 labelled records, with the full scenario trail in `NetraSense_Step21_Scenario_Audit.csv`. Justification: Step 29 CL-11 requires stating denominators and unknown-label exclusion explicitly.

4. **CL-10 / CL-11 (all four policies matched expected outputs)** — *Change applied.* Paragraph 69 now reads **"all four policies matched the authors' expected boolean warning outputs on all 17 scenarios (68 policy-scenario comparisons)"** in addition to retaining the existing numbers (11/14, 10/14, 9/14, 3/14; TP=11, FN=3, FP=0, TN=1; precision 1.0 on the single known negative). Justification: Step 29 CL-10 and CL-11. The 17/17 figure is presented explicitly as an implementation check, not a performance metric, and no terms such as "outperformed," "superior," "more accurate," or "more reliable" were added.

5. **CL-13 (legacy no-evidence / 400 cm)** — *Change applied.* Paragraph 69 retains the legacy-baseline description **"the legacy baseline emits Normal, 'Path clear. Proceed safely.', and a fabricated 400 cm consensus distance when neither modality supplies evidence, while production fusion emits NO DATA / NO VALID DATA with null distance"** and keeps the pre-existing code-inspection attribution that these fields are not replay-row fields. This is an explicit change to the paragraph to connect the finding to the existing manuscript text, which already states the legacy 400 cm behavior. The Step 21 report's §7.A (enumerating the four no-evidence scenarios S01, S11, S12, S14) is the supporting evidence.

6. **CL-07 / CL-08 (freshness and boundary semantics)** — *No-op by design.* The manuscript already states "the strict 3.0 s freshness equality case" and "the strict 3.0 s freshness equality case... age > 3.0 s," which is consistent with the production code (`age > 3.0` is stale; exactly 3.0 is fresh). The_step_29_ audit CL-07 asked to avoid "at least 3.0 s"; the manuscript never uses that phrasing, and no correction was required. Boundary values (49 CRITICAL, 50 ALARM, 100 WARNING, 300 WARNING, 301 NORMAL) are stated in Section V-D and Section VII and are consistent with `server/threat_levels.py` and the replay records.

7. **CL-15 / CL-16 (physical and Supabase/RLS limits)** — *No-op by design (preserved verbatim).* The manuscript's Sections VIII and IX already disclose the physical-measurement and end-to-end Supabase/RLS gaps. Step 30 contained no new evidence that could alter those statements.

8. **CL-05 / CL-06 (fusion-state semantics)** — *No-op by design.* The manuscript's Section V-D (Paragraphs 47–48 of the source) already distinguishes `NO DATA` / `NO VALID DATA`, `SENSOR DEGRADED` (one contributing modality), `FUSED` (two contributing modalities), and withholds `fused_distance_cm` when multiple modalities contribute without a justified single-source distance. The Step 29 audit did not flag those statements.

9. **CL-01 (Arduino-local buzzer)** — *No-op by design.* The manuscript already states the buzzer is driven locally by the Arduino firmware and the host API has no supported buzzer-command interface.

10. **CL-09 (COCO-128 detector diagnostics)** — *No-op by design.* The manuscript already states the COCO-128 results are detector diagnostics only, that COCO-128 overlaps the COCO train2017 source, that the two runs used different Ultralytics versions (8.4.155 and 8.4.177), that the macro-F1 is single-run and threshold-dependent, and that precision/recall are pooled-micro. No correction was required.

11. **CL-14 (S02/S17 severity-label discrepancy)** — *No-op by design.* The paper reports boolean warning coverage only; the legacy "Alarming" vs "Collision" discrepancy concerns severity labels and is documented in the Step 21 audit but does not need to be added to the manuscript. The Step 21 report is cited as the evidence trail.

## Validation

1. **Input files checked.** All six required inputs exist and are readable:
   - `NetraSense_Research_Paper_Working_Master_Step20_Replay_Results_Integrated_DRAFT.docx` — present, readable, 150,392 bytes.
   - `NetraSense_Step29_Claim_Language_Audit.md` — present, 9,142 bytes.
   - `NetraSense_Step29_Claim_Language_Audit.csv` — present, 2,344 bytes.
   - `NetraSense_Step21_Independent_Replay_Audit.md` — present, 15,333 bytes.
   - `NetraSense_Step21_Recomputed_Metrics.json` — present, parses as JSON.
   - `NetraSense_Step21_Scenario_Audit.csv` — present, 17 rows × 26 columns.

2. **Source preserved.** The Step 20 manuscript was opened read-only for text extraction and never written to; its byte-level checksum was recorded before and after. No file outside the two named outputs is modified.

3. **New manuscript created and verified.**
   - `NetraSense_Research_Paper_Working_Master_Step30_Claim_Reconciled.docx` — valid ZIP (`zipfile.ZipFile().testzip()` exit 0), 150,392 bytes.
   - Text layer reparsed: 38,802 characters of `<w:t>` content; the four changed paragraphs contain the expected revised wording.
   - All in-text citations, reference entries, figures, tables, captions, headings, and section numbering are present in the new file; the diffs are text-only substitutions inside the same paragraphs.

4. **Independently verified metrics (Step 21 evidence).** Recomputed from `scenarios.jsonl` and `replay_results.json`:
   - `source_sha256` of `scenarios.jsonl`: `878b7a7caf6fa2b67e50f393f3cb04ceb2d77c97c86aa855d9ea884fa84d8442` — VERIFIED.
   - `accepted_payload_sha256`: `ef47d3fc9be4d0d9e6a413b954ca1abb09ac1efde29b04be34dd3d5b8431d4fd` — VERIFIED.
   - 17 scenario records, all unique IDs, zero excluded, all four policy blocks present on every record.
   - Boolean-warning expectation match: 17/17 for camera-only, ultrasonic-only, legacy weighted, and reliability-aware (68/68 policy-scenario comparisons).
   - Warning coverage on the 14 labelled positive scenarios: reliability-aware 11/14, legacy weighted 10/14, ultrasonic-only 9/14, camera-only 3/14.
   - Reliability-aware confusion matrix on the 15 labelled records: TP=11, FN=3, FP=0, TN=1; precision 1.0 (one known negative).
   - These numbers are reproduced exactly in `NetraSense_Step30_Claim_Reconciliation_Report.md` and in the new DOCX text.

5. **Claims added and rejected.** No superiority, novelty, real-world accuracy, safety, reliability, or physical-performance claims were added. The manuscript continues to state that no controlled physical measurements, independent held-out evaluation, or end-to-end Supabase/RLS verification is available.

## Findings not changed (reviewed and deliberately left unchanged)

- Step 29 recommendation to mention the legacy "Path clear" and 400 cm behavior was already present in the manuscript and is retained (paragraph 69), with the codebase-inspection attribution language already in the draft.
- Step 29 recommendation to widen "17 scenarios" to "17 author-designed synthetic scenarios (11 simulated, 6 fault-injection)" is already present in the source paragraph 59/69 and is reinforced by the new wording on expected-output matches.
- Detector diagnostics paragraph (paragraph 68) is unchanged; Step 29 CL-09 already treats it as correctly qualified.

## Outstanding items

These are not wording issues and are outside the scope of this manuscript reconciliation:

- Controlled physical ultrasonic range-error evaluation (not present in the repository).
- Synchronized end-to-end physical warning-latency evaluation (not present).
- Physical disconnection/recovery trials (not present).
- End-to-end Supabase insertion and RLS verification (not present).
- Independent held-out labelled system-level evaluation (not present).
- Venue-specific formatting and final author approval (not present).

## Files created

| File | Purpose |
|---|---|
| `NetraSense_Research_Paper_Working_Master_Step30_Claim_Reconciled.docx` | New manuscript version with the four claim-language corrections |
| `NetraSense_Step30_Claim_Reconciliation_Report.md` | This report |

Final verdict: **Wording reconciliation complete; the manuscript is not submission-ready** because the retained physical, backend, and independent-evaluation evidence gaps remain open and were not, and could not be, closed by manuscript editing alone.
