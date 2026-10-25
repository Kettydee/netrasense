# NetraSense — Step 3 Finalization Audit (Related Work, Research Gap, Novelty)

**Date:** 2026-10-25
**Master identification:** `NetraSense_Research_Paper_Parts3_4_5_6_Updated.docx` (root, newest timestamp) is the master DOCX; `research/paper_draft.md` is the canonical Markdown source whose body text it mirrors verbatim. `netrasense/NetraSense_Research_Paper_Corrected.docx` is not a valid zip (not readable as DOCX) and was left untouched. The older root `NetraSense_Research_Paper_Corrected.docx` was read for context but not edited. The master DOCX was **not** modified; corrections were integrated into a new deliverable derived from it.

## Files inspected

- `NetraSense_Research_Paper_Parts3_4_5_6_Updated.docx` (master; all sections including Related Work, Section 3 Problem Statement, References, Appendix A)
- `research/paper_draft.md` (canonical Markdown, edited)
- `NetraSense_Research_Paper_Corrected.docx`, `netrasense/NetraSense_Research_Paper_Corrected.docx` (context only)
- `NetraSense_Final_Integration_Audit.md` (newest prior audit, Oct 24, 23:30: 109 Python tests OK exit 0; build OK; `tsc --noEmit` OK; ESLint 0 errors / 11 warnings)
- `experiments/README.md`, `experiments/report.md` (COCO-128 diagnostic provenance: YOLO11n `yolo11n.pt`, COCO-128, CPU; in-sample limitation)
- `server/ensemble.py` lines 380–419 (runtime state assignment: `NO VALID DATA`/`SENSOR DEGRADED`/`FUSED`, single-source `fused_distance_cm`, non-probabilistic agreement score)

## Files edited

1. `research/paper_draft.md` — 9 edits: 7 text replacements, 1 inserted Related Work scope paragraph, 3 appended appendix items (previous 2 items preserved). Git diff: 62 insertions, 21 deletions.
2. `tools/apply_step3_edits.py` — new idempotent edit/generation script (kept for reproducibility; not part of the paper).
3. `NetraSense_Research_Paper_Step3_Final.docx` — generated deliverable from the untouched master.

## Reference verification (all 5, against publisher/authoritative records)

| # | Reference | Result |
|---|---|---|
| 1 | Khaleghi, Khamis, Karray, Razavi, "Multisensor data fusion: A review of the state-of-the-art," *Information Fusion*, 14(1):28–44, 2013, doi 10.1016/j.inffus.2011.08.001 | Verified (ScienceDirect/ACM DL). Source supports association-as-substantive-problem claim. |
| 2 | Redmon, Divvala, Girshick, Farhadi, "You Only Look Once," CVPR 2016, doi 10.1109/CVPR.2016.91 | Verified (IEEE Xplore #7780460, pp. 779–788). Supports YOLO framing claim. |
| 3 | Bousbia-Salah, Bettayeb, Larbi, "A Navigation Aid for Blind People," *J Intell Robot Syst*, 64:387–400, 2011, doi 10.1007/s10846-011-9555-7 | Verified (Springer). Supports multi-ultrasonic navigation-aid claim. |
| 4 | Z. A. Ali, "Design and evaluation of two obstacle detection devices for visually impaired people," *J Eng Res*, 11(3):100–105, 2023 | **DOI corrected** from unresolvable `10.1006/jer.2023.0132` to `10.1016/j.jer.2023.100132` (confirmed via DOI/Unpaywall/Semantic Scholar; author Zahraa A. Ali). In-text claim reworded to the published description: two electronic aids (wearable smart belt, handheld smart stick) in participant comparison against a white cane. Full text is machine-blocked at the publisher page (HTTP 403); device descriptions were confirmed from publisher-indexed records. |
| 5 | Wang, Cao, Yin, Cheng, "Sleep–Wake Sensor Scheduling for Minimizing AoI-Penalty in IIoT," *IEEE IoT Journal*, 9(9):6404–6417, 2022, doi 10.1109/JIOT.2021.3112211 | Verified (IEEE Xplore #9536564). Supports timeliness/AoI claim. |

In-text citations `[1]–[5]`: all used in body text and all present in the reference list (automated check PASS). No citations were invented or removed.

## Changes made (same content in Markdown and DOCX)

1. **Related Work — scope/novelty statement (new closing paragraph).** The literature review is selective, not a completed systematic review; vision-ultrasound obstacle detection, fusion, embedded warning devices, and timeliness processing are established; the emphasized features are implementation-level design choices, not proven first-of-kind inventions; comparative benefit is left open as an empirical question.
2. **Related Work — [4] claim corrected** to the verified device descriptions; retains the statement that published studies are evidence about their own devices, not NetraSense.
3. **Related Work — freshness paragraph** now states the firmware transmits no acquisition timestamp, so host receipt time is a freshness proxy, not a direct Age-of-Information measurement.
4. **Section 3 (Research Gap)** now states the sensing combination is established prior work and the gap is explicit, testable missing/invalid/stale behavior, status reporting, and reproducible evaluation — not an unexplored sensing technology.
5. **Section 5** now states `SENSOR DEGRADED`/`FUSED` count contributing modalities and are not hardware-fault diagnoses or physical-safety claims.
6. **Section 6.2** now states `NO DATA` (threat-level fallback field) and `NO VALID DATA` (input-availability state field) are distinct fields, not interchangeable.
7. **References:** [4] DOI corrected to `10.1016/j.jer.2023.100132`.
8. **Appendix A item 2 corrected:** `NO VALID DATA` is both the result-structure default and the runtime sensing state when no valid observation exists (verified in `server/ensemble.py` lines ~391–401); `fused_threat_level` then falls back to `NO DATA`.
9. **Appendix A items 13–15 appended** documenting the above corrections and the reference re-verification.

## Claims removed or qualified

- Removed: "compared ultrasonic-based assistive devices" (unverified sensor type for [4]).
- Qualified: novelty framing (design choices, not inventions); fusion states as modality-availability labels; receipt-time freshness as a proxy; research gap as a behavior/reproducibility gap rather than a new sensing combination.
- No accuracy, false-warning, superiority, or safety claims were introduced. COCO-128 metrics remain quarantined as in-sample detector diagnostics and are not cited as NetraSense system performance.

## Unresolved inconsistencies / limitations

- The **master DOCX contains malformed XML** (a raw `<` in the body text "2–<400 cm" at Appendix item 4; parse error at column ~27675). Standard strict parsers reject it; Word's recovery behavior is undefined. It was preserved unmodified per the no-overwrite rule; the generated `NetraSense_Research_Paper_Step3_Final.docx` escapes text nodes and is well-formed.
- The master DOCX is a naive Markdown conversion (literal `**`, backticks, and `---` separators inside body text). This generator limitation is inherited; full Word styling was not added because that would require rewriting the template.
- Reference [4]'s full text could not be fetched directly (publisher 403); device details verified from publisher-indexed records only.
- DOCX headings render via non-standard `<w:h1 style="h1h1">` elements inherited from the master.

## Deliverable verification (automation, exit 0)

Reopened `NetraSense_Research_Paper_Step3_Final.docx`: valid zip; `word/document.xml` parses as well-formed XML; all 14 section headings present in order; all 9 edits present (position/count checked); old claim strings, old DOI (outside the appendix correction note), placeholders ("TODO", "TBD", "PLACEHOLDER"), smart glasses/wearable wording, and "Depth Anything" absence checks all PASS; in-text citations `[1]`–`[5]` each appearing in text before the References section and matched to list entries. Nothing was committed or pushed.

## Remaining prior artifacts noted

- Newest verification evidence remains the Oct 24 audit log (109 tests OK, build/TSC OK, ESLint 0 errors + 11 non-blocking warnings); no newer full verification log exists in the repository at audit time.
