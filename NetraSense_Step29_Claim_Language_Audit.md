# NetraSense Step 29 — Claim-Language Audit
**Scope:** Abstract, Introduction, Related Work / Research Gap, Results, Limitations, Conclusion  
**Manuscript reviewed:** `NetraSense_Research_Paper_Working_Master_Step20_Replay_Results_Integrated_DRAFT.docx`  
**Review basis:** Actual manuscript text plus the Step 21 independent replay-verification summary supplied by the project team.  
**Disposition:** Audit only. The manuscript was not edited.

## Executive verdict
The manuscript is appropriately cautious overall. It does not claim real-world superiority, independent system accuracy, reduced false warnings, or validated safety. Its replay results are framed as implementation checks against author-designed scenarios, and the physical-validation and Supabase/RLS gaps are disclosed.

Three small but worthwhile wording/consistency fixes are recommended before submission:
1. In the Abstract, “109 passing backend tests” should be dated or described as the reported integration-audit snapshot, because test counts can change and are not a permanent property of the system.
2. In Results and Conclusion, use the exact Step 21 terminology “17 author-designed synthetic scenarios (11 simulated, 6 fault-injection)” and “expected-output matches,” avoiding shorthand that could imply independent ground truth.
3. When mentioning legacy “Path clear” and fabricated 400 cm consensus, explicitly attribute these to the legacy implementation’s `fuse()` behavior, not to fields observed in replay-result rows. The current Results text already makes this distinction reasonably clearly.

No evidence supports claiming that NetraSense is novel, safer, more accurate, more robust, or superior to the baselines. Do not add such claims.

## Claim-by-claim findings

### A. Abstract
- **Supported:** Integration of YOLO11n webcam detection, Arduino HC-SR04 ranging, host-side validity/receipt-time freshness handling, dashboard, and Arduino-local buzzer.
- **Supported with qualification:** “109 passing backend tests,” successful production build, TypeScript check, and ESLint with zero errors/eleven warnings. These are reported software checks, not system-performance results; identify them as an audit snapshot dated 24 October 2026.
- **Good limitation:** The abstract explicitly says these are not physical performance measurements and that the system is not a validated safety system.
- **Recommended wording:** “The integration audit reported on 24 October 2026 recorded 109 passing backend tests, a successful frontend production build and TypeScript check, and zero ESLint errors with eleven warnings.”

### B. Introduction and research gap
- **Supported:** The distinction between missing/invalid evidence and stale evidence; the firmware does not include source-side acquisition timestamps; host receipt time is only a freshness proxy.
- **Good qualification:** The literature section says it is not an exhaustive systematic review and does not establish that no prior system has the same combination.
- **Risk to avoid:** Do not turn the scoped implementation focus into a universal literature-gap or first-of-kind claim. Current language is appropriately qualified.
- **Recommendation:** Keep “selected literature motivates…” framing and avoid “no existing system,” “first system,” or “novel fusion algorithm.”

### C. Implementation and architecture claims
- **Supported by the stated implementation audit:** Max-threat selection among contributing signals; explicit sensing-state reporting; no numeric fused distance when multiple modalities contribute and no single-source distance is justified; `NO DATA` when no signal contributes.
- **Important wording detail:** `SENSOR DEGRADED` and `FUSED` describe modality availability/contribution, not a definitive hardware-fault diagnosis. The Conclusion correctly states this.
- **Important boundary detail:** Canonical host thresholds are `>300 NORMAL`, `100–300 WARNING`, `50–99 ALARM`, `<50 CRITICAL`; exactly 50 is ALARM, and exactly 100/300 are WARNING. Legacy behavior differs at 300 cm. Any table or prose should preserve these exact boundaries.
- **Freshness detail:** The stale condition is strictly `age > 3.0 s`; exactly 3.0 s is fresh. The manuscript should not describe this as `>= 3.0 s`.

### D. Detector diagnostics
- **Supported only as detector diagnostics:** 14 October run: mAP50 67.95%, mAP50–95 50.22%, pooled-micro precision 69.35%, pooled-micro recall 59.09%, macro-F1 57.91%. 15 October rerun: mAP50 68.01%, mAP50–95 50.26%.
- **Critical qualifications already present:** COCO-128 overlaps the COCO train2017 source used for pretraining; these are in-sample diagnostics, not independent generalization and not integrated NetraSense accuracy. The two runs used different Ultralytics versions and are not a controlled version-only comparison unless other settings are confirmed identical. Macro-F1 is single-run and threshold-dependent.
- **Recommendation:** Keep all qualifications adjacent to the numbers. Do not summarize these results as “NetraSense achieved X% accuracy.”

### E. Step 21 replay metrics
- **Independently recomputed according to the supplied Step 21 report:** 17 scenarios, 11 simulated and 6 fault-injection; all synthetic, none physical. All 17 expected-output checks matched for each of four policies (68 policy-scenario comparisons total).
- **Ground-truth denominator:** 15 scenarios have known boolean warning labels: 14 positive and 1 negative. S01 and S05 have unknown labels and are excluded from confusion-matrix calculations.
- **Coverage counts on the 14 positive scenarios:** reliability-aware 11/14; legacy weighted 10/14; ultrasonic-only 9/14; camera-only 3/14.
- **Reliability-aware confusion matrix:** TP=11, FN=3, FP=0, TN=1; recall 11/14 ≈ 0.786; precision 1.0 on this tiny labelled set. Precision 1.0 for all policies arises because none warned on the single known negative scenario.
- **Interpretation limit:** The expected outputs and scenarios were authored together. The 17/17 figure is an implementation check against author-declared expectations, not independent ground-truth validation. The 15 labelled synthetic records cannot support real-world performance or superiority claims.
- **Legacy discrepancy:** S02 and S17 expectation text calls the legacy severity “Alarming,” while actual raw output is “Collision” due to a legacy safety override; boolean warning status still matches. If severity-level results are ever discussed, disclose this discrepancy. It is not necessary to add it to the paper if the paper reports only boolean warning counts.
- **Legacy no-evidence behavior:** The “Normal” / “Path clear. Proceed safely.” / fabricated 400 cm consensus behavior is verified by inspection of `ensemble_model.py fuse()`; those fields are not replay-row fields. The current manuscript attributes them to the legacy implementation, which is the correct framing.
- **Recommendation:** Keep the replay paragraph’s limitations. Avoid the words “outperformed,” “superior,” “more accurate,” or “more reliable” based on this replay.

### F. Limitations and conclusion
- **Good disclosure:** No independent labelled NetraSense dataset; no controlled physical range-error measurements, synchronized warning latency, or physical disconnection/recovery measurements; live Supabase insertion and RLS unverified end to end; no object-level association between visual detections and ultrasonic returns.
- **Good conclusion:** Describes implementation-level properties rather than validated safety or superiority.
- **Recommendation:** Preserve these disclosures in any shortened abstract, poster, presentation, or submission version. Do not remove them merely to make the paper sound stronger.

## Recommended minimal edits (not applied)
1. Abstract software audit sentence: replace “An integration audit reports…” with the dated formulation given above.
2. Results replay sentence: replace any shorthand “17 scenarios” with “17 author-designed synthetic scenarios (11 simulated and 6 fault-injection); all four policies matched the authors’ expected boolean warning outputs on all 17 scenarios.”
3. If discussing the legacy 400 cm behavior, retain explicit attribution to `ensemble_model.py`’s `fuse()` implementation and state that this behavior was verified by code inspection rather than read from replay-row fields.

## Submission-blocking evidence gaps
These are not wording issues and cannot be solved by manuscript editing:
- Controlled physical ultrasonic range-error evaluation.
- Synchronized end-to-end physical warning-latency evaluation.
- Physical disconnection/recovery testing.
- End-to-end Supabase insertion and row-level security (RLS) verification.
- Independent held-out labelled system-level evaluation, if performance/generalization claims are desired.
- Venue-specific formatting and final author approval.

## Final status
**Claim language:** Generally evidence-aligned; minor tightening recommended.  
**Performance superiority / real-world safety:** Unsupported and correctly not claimed.  
**Submission readiness:** Not established. The remaining physical and backend evidence gaps are substantive.
