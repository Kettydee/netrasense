# NetraSense Step 35: Updated Blockers Tracker

**Date:** 2026-10-25
**Input:** Step 28 blockers tracker (`NetraSense_Step28_Blockers_Tracker.md` if present)

| Blocker_ID | Description | Severity | Evidence Available | Resolvable Without Hardware/New Data? | Action Performed | Remaining Action | Status | Evidence Supporting Status |
|---|---|---|---|---|---|---|---|---|
| B1 | Physical ultrasonic range-error measurement | High | None in repository | No | Documented as missing; no records found | Conduct controlled hardware measurement | Blocked | No measurement artifacts exist |
| B2 | Synchronized end-to-end physical warning latency | High | None in repository | No | Documented as missing | Run hardware-in-the-loop test with synchronized timestamps | Blocked | No synchronized physical logs found |
| B3 | Sensor disconnection and recovery measurement | High | None in repository | No | Documented as missing | Run controlled fault-injection tests | Blocked | No physical fault records |
| B4 | End-to-end Supabase insertion and RLS verification | Medium | Source-code inspection only | Yes (requires isolated test infrastructure) | Source code inspected; no live test recorded | Perform isolated test on non-production environment | In Progress | `src/lib/supabase.ts` and `src/integrations/supabase/types.ts` reviewed; no synthetic test on live DB |
| B5 | COCO-128 macro-F1 misinterpretation in manuscript | Medium | Evaluation artifacts | Yes | Manuscript corrected (Step 35) | None | Resolved | `NetraSense_Research_Paper_Working_Master_Step35_Reproducibility_Updated.docx` |
| B6 | Legacy weighted baseline confusion in manuscript | Medium | Source code | Yes | Manuscript corrected (Step 35) | None | Resolved | `ensemble_model.py` distinction preserved |
| B7 | Physical prototype hardware status | Medium | Team report: operational | Yes | Physical status acknowledged | No | Resolved | Team report documented; no fabricated measurements |
| B8 | Freshness boundary regression test | Medium | Tests present in `tests/dashboard-stale-data-regression.test.mjs` | Yes | Verified the strict boundary (<= 3.0 s) | None | Resolved | Production `<= 3.0` rule confirmed; tests pass |

---

## Environment

| Item | Value |
|---|---|
| Python | 3.9.6 |
| Platform | macOS-27.0.1-arm64 (Apple M4) |
| Production source | `server/ensemble.py`, `server/ensemble_model.py`, `server/vision_server.py` |
| Physical hardware | Not available for this audit |
