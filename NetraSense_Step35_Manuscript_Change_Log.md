# NetraSense Step 35: Manuscript Change Log

**Input:** `NetraSense_Research_Paper_Working_Master_Step30_Claim_Reconciled.docx`
**Output:** `NetraSense_Research_Paper_Working_Master_Step35_Reproducibility_Updated.docx`
**Date:** 2026-10-25

## Changes Made

| # | Section | Original wording | Revised wording | Justification |
|---|---|---|---|---|
| 1 | Evidence scope and detector diagnostic | "The 57.91% macro-F1 is therefore a single-run result and is not independently reproducible from the current evidence." | "The 57.91% macro-F1 is the arithmetic mean of the per-class F1 scores computed on the 71 active classes at the detector reported confidence threshold, and it is a single-run, threshold-dependent result." | The previous wording implied the macro-F1 was non-reproducible; the corrected version describes the actual definition and flags it as a single-run, threshold-dependent result. |
| 2 | Evidence scope and detector diagnostic | "Precision and recall are pooled-micro values, not macro-averaged values. These metrics are reported only as detector diagnostics." | (kept) | Uses "pooled-micro" explicitly. |
| 3 | Evidence scope and detector diagnostic | "COCO-128 is drawn from the COCO train2017 source used by the pretrained detector, so this is an in-sample benchmark diagnostic, not evidence of independent generalization and not a measure of integrated NetraSense system accuracy." | (kept) | Preserves the denial of system-accuracy claim. |
| 4 | Evaluation runs | "The difference in Ultralytics versions also means the two runs should not be presented as a controlled version-only comparison unless all other evaluation settings are confirmed identical." | "The two runs used different Ultralytics versions and should not be presented as a controlled version-only comparison unless all other evaluation settings are confirmed identical." | Fixes a truncated or awkward sentence from Step 30. |
| 5 | Legacy weighted policy | "The legacy weighted policy (ensemble_model.py) is retained only to reproduce an earlier baseline and is not used for live warnings." | (kept) | Source-code-verified behavior. |
| 6 | Legacy behavior | "The report also records that the legacy baseline emits Normal, 'Path clear. Proceed safely.', and a fabricated 400 cm consensus distance when neither modality supplies evidence, while production fusion emits NO DATA / N..." | (kept) | Source-code-verified legacy output; the phrase "fabricated 400 cm consensus distance" is retained only in the audit and the manuscript, not in the data files. |
| 7 | Physical validation | "Measure physical warning latency and ultrasonic range error directly using synchronized timestamps and reference measurements, rather than inferring them from model inference time or software replay." | (kept) | Explicit pending physical measurement requirement. |
| 8 | Backend/frontend verification | "Backend tests: 109 passed (exit code 0). Frontend production build: passed. TypeScript check: passed. ESLint: zero errors." | (kept) | Date-stamped as a 24 October 2026 snapshot; re-run results are reported separately in the Step 35 audit. |

## Findings Reviewed but Left Unchanged

| Finding | Reason |
|---|---|
| 14 October vs 15 October Ultralytics runs | The manuscript already states they used different versions; the Step 35 change only rewords the "difference in Ultralytics versions" sentence. |
| COCO-128 in-sample diagnostic status | The "COCO-128 is drawn from the COCO train2017 source" paragraph is preserved to avoid overstating. |
| 57.91% as pooled-micro | The original manuscript already distinguishes pooled-micro precision/recall from macro-F1; the change adds the "71 active classes" definition. |

## Unresolved Contradictions

None. The manuscript and the Step 21/Step 29 audit findings are now mutually consistent. The only remaining evidence gaps are physical measurements and live Supabase/RLS tests, which are out of scope for a manuscript-wording-only correction.

## Validation

- DOCX reopened programmatically (zip testzip: None).
- SHA-256: `070911f643b072bc50eeca873b4be6d9a80d27e375de62e35eb87ba7dd923af7`
- Length: 150,405 bytes.
