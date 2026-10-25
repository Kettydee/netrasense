# NetraSense: A Freshness-Aware IoT Framework for Vision-Based Obstacle Detection and Ultrasonic Warning

**Harsh Bothra S, Khirabdi Tanaya Dash, Atharva Ajagekar**  
School of Computer Science and Engineering, Vellore Institute of Technology, Vellore, Tamil Nadu, India

---

## Abstract

NetraSense is an experimental Internet-of-Things prototype that combines a camera-based object-detection pipeline with an HC-SR04 ultrasonic ranging channel and an Arduino-local buzzer. This paper documents the implemented system and an evaluation-ready methodology, rather than claiming field performance that has not yet been measured. The central design decision is freshness-aware, decision-level fusion: a valid, fresh ultrasonic measurement and a visual detection may each support a warning, but they are not averaged or declared to describe the same object without an object-association method. The production policy selects the most severe valid observation, represents one available modality as `SENSOR DEGRADED`, and represents absent valid observations as `NO VALID DATA`. Visual detections contribute object-detection and threat evidence; the optional monocular-depth capability is inactive in the evaluated baseline. Invalid or stale ultrasonic readings are excluded from current decisions; loss of ultrasonic telemetry does not discard usable visual evidence. The implementation also provides a recording schema, a read-only validator, and a deterministic offline replay harness for camera-only, ultrasonic-only, legacy weighted, and reliability-aware policies. Source inspection and automated software tests verify these software behaviors. However, no genuine physical recording, held-out annotated NetraSense dataset, physical latency measurement, or hardware trial is presently available. Consequently, this draft reports no detection, warning, recovery, or safety-performance result. It specifies the controlled protocol, denominators, artifacts, and validity constraints required before such claims can be made.

**Keywords:** obstacle warning; sensor fusion; data freshness; Internet of Things; ultrasonic sensing; object detection; reproducible evaluation

---

## 1. Introduction

Obstacle-warning systems may combine complementary sensing modalities: image detectors can supply semantic labels and image locations, while short-range ultrasonic ranging can directly measure a return along its acoustic beam. The combination is attractive, but it creates a reliability problem. A visual detection has no inherent metric correspondence to an ultrasonic echo, a port that is open is not necessarily a healthy sensor, and an old reading must not be displayed or acted on as if it were current. More generally, data fusion is not automatically beneficial merely because several signals are present; association, data quality, missing modalities, and the meaning of the output must be explicit [1].

NetraSense is a prototype built around these constraints. Its camera server performs YOLO-based detection and may use a monocular depth component; an Arduino reads an HC-SR04 sensor and drives a local piezo buzzer. Python components ingest serial telemetry, apply freshness and warning logic, expose HTTP endpoints, and provide a dashboard. The deployed policy is deliberately conservative at the *decision* level: it permits any valid warning observation to escalate the result, but it avoids manufacturing a single "fused distance" when more than one modality is present.

The contribution of this paper is therefore an implementation-grounded and experimentally falsifiable framework, not a claim that NetraSense improves obstacle detection or is safe for navigation. Specifically, it documents: (i) a failure-aware sensor and data path; (ii) a deterministic policy for representing sensor availability and warning states; and (iii) provenance-aware recording, validation, and replay tooling for a future comparison of warning policies. Physical effectiveness, usability, and safety remain research questions.

---

## 2. Related Work

Single-stage YOLO detectors frame object detection as direct prediction of bounding boxes and class probabilities from an image [2]. NetraSense uses a YOLO11n checkpoint in the inspected evaluation artifacts; this paper cites the original YOLO formulation for the detector family rather than attributing the original paper's results to the local checkpoint. A detector score is useful for ranking detections, but it is not automatically a calibrated probability for a particular deployment environment. The NetraSense policy therefore does not use detector confidence as a calibrated probability or as a vote that can make an unobserved path clear.

Multisensor fusion has long been studied as the combination of information from multiple sources for decision support, with target/measurement association identified as a substantive problem rather than an incidental implementation detail [1]. This motivates NetraSense's choice not to average the HC-SR04 beam range with a visual or monocular-depth estimate. Such an average would imply that the modalities observe the same obstacle, an assertion the present hardware and geometry do not establish.

Ultrasonic electronic travel aids and obstacle-warning prototypes have been reported in the literature. For example, Bousbia-Salah, Bettayeb, and Larbi describe a navigation aid incorporating multiple ultrasonic sensors and feedback modalities [3]. More recent work has designed and evaluated two electronic obstacle-detection aids for visually impaired users, a wearable smart belt and a handheld smart stick, in participant comparisons against a conventional white cane [4]. Those published studies are evidence about their own devices and protocols, not evidence that NetraSense is effective. NetraSense currently has neither a participant study nor a physical trial.

Freshness is also an important systems property. Age-of-information research treats the timeliness of updates as central to decisions about time-varying processes [5]. NetraSense uses a practical local freshness gate rather than claiming an Age-of-Information optimization result: elapsed time is calculated with a monotonic clock, and a reading older than the configured timeout is excluded from the live ultrasonic contribution. Because the Arduino firmware transmits no source-side acquisition timestamp, this freshness assessment is computed from host receipt time; it is therefore a practical freshness proxy rather than a direct measurement of true Age of Information.

The reviewed literature is a selective, topic-focused sample rather than a completed systematic review. Vision-based detection, ultrasonic ranging, multimodal sensor fusion, embedded warning devices, and timeliness-aware processing are established research areas; the combination of vision and ultrasound for obstacle detection is not claimed here to be new. The features emphasized in this paper - explicit input validation, missing/invalid/stale-data handling, receipt-time freshness assessment, conservative decision-level fusion outputs, and explicit sensing-state reporting - are implementation-level design choices rather than proven first-of-kind inventions. Their purpose in this work is to make the prototype's behavior explicit, testable, and reproducible; whether they improve any outcome relative to existing systems is an empirical question that this paper leaves open.

---

## 3. Problem Statement and Research Objectives

The problem addressed is how to make the behavior of a low-cost vision-and-ultrasonic obstacle-warning prototype explicit and testable when observations may be missing, invalid, stale, or mutually non-associable. The project does **not** solve verified obstacle avoidance or navigation safety. The sensing combination itself is established in prior work; the gap addressed here concerns explicit, testable behavior for missing, invalid, and stale observations, disciplined system-status reporting, and a reproducible evaluation path, rather than an unexplored sensing technology.

The research objectives are:

1. Implement a transparent warning policy that distinguishes valid evidence from invalid, stale, disconnected, and unavailable sensing.
2. Preserve visual warnings when ultrasonic sensing fails, and preserve ultrasonic warnings when the camera produces no detection.
3. Prevent a single beam measurement from being misrepresented as the distance to a camera-detected object.
4. Create a reproducible path from independently labelled physical events to validation and deterministic policy replay.
5. Measure, in future controlled trials, camera-only, ultrasonic-only, legacy weighted, and reliability-aware warning policies using identical timestamped records.

---

## 4. System Architecture

### 4.1 Implemented data paths

The inspected implementation has two relevant paths.

```text
Camera -> YOLO detection / optional depth processing -> VisionPipeline
       -> EnsembleClassifier -> vision API and dashboard

HC-SR04 -> Arduino measurement -> JSON serial telemetry -> SerialSensorReader
       -> Sensor bridge / vision-server state -> freshness gate
       -> ObstacleWarningEvaluator and EnsembleClassifier -> API/dashboard
       -> Arduino-local buzzer state machine
```

The vision server reads the latest camera detections and only passes ultrasonic data to the ensemble while the serial update is fresh. `/api/fuse` follows the same intended ensemble policy; when the caller does not submit an explicit ultrasonic value, it applies the same freshness gate to stored telemetry. The sensor bridge exposes serial and warning status separately. Its `/api/buzzer` endpoint returns an explicit unsupported response because the inspected firmware does not parse host buzzer commands; a successful serial write would not prove actuator control.

The dashboard consumes typed fusion fields, including `sensing_state`, and labels the displayed score as **signal agreement**. That label is intentional: the field is a deterministic coverage/agreement indicator, not a probability that an obstacle exists.

### 4.2 Hardware and local actuation

The inspected Arduino firmware (`arduino/ultrasonic_sensor.ino`) configures HC-SR04 trigger and echo on D9 and D10, respectively, and a piezo buzzer on D11. It starts serial communication at 9600 baud, samples nominally every 75 ms, and uses a 24,000 microsecond echo timeout. A valid reading is transmitted as JSON with `distance_cm` and `valid:true`. A missing echo or out-of-range result is transmitted as `valid:false` with a status such as `NO_ECHO` or `OUT_OF_RANGE`; it is not encoded as a 400 cm clear-distance sentinel.

The firmware itself maps valid ranges to pulsed buzzer patterns: greater than or equal to 300 cm is silent, 200--299 cm is slow, 100--199 cm is moderate, and below 100 cm is rapid. These are implemented thresholds and actuator rules, not validated safety distances. The firmware retains the prior buzzer pattern after an invalid range rather than interpreting the failure as clear. Physical buzzer timing and behavior have not been measured.

---

## 5. Hardware and Software Implementation

The Python serial reader normalizes accepted telemetry, rejects explicit invalid/failure records and physically invalid ranges, and records host receipt time for display and processing. The host receipt timestamp is not an Arduino acquisition timestamp. The reader is designed to reconnect and to avoid duplicate reader threads; source inspection and unit tests cover parsing, stale-data handling, and reconnection paths, but they do not substitute for a cable-disconnection trial.

`ObstacleWarningEvaluator` uses a monotonic clock for elapsed-time freshness. Its configured software distance zones are 300 cm (warning), 100 cm (alarm), and 50 cm (critical); it additionally implements hysteresis and debounce configuration. When valid telemetry becomes stale, the evaluator represents it as unavailable rather than allowing repeated evaluation to refresh it. The evaluator's states include clear, obstacle warning, sensor error, and sensor unavailable. The ensemble separately expresses `FUSED`, `SENSOR DEGRADED`, and `NO VALID DATA`, which concern the availability of fusion inputs rather than a claim of physical safety or a hardware-fault diagnosis: `SENSOR DEGRADED` and `FUSED` count contributing modalities, and a degraded label can arise simply because one modality has no fresh valid observation.

The active fusion implementation is `server/ensemble.py`. `server/ensemble_model.py` remains only as an explicitly retained legacy weighted implementation for offline historical-baseline replay. Production `/api/fuse` and the live vision path use `EnsembleClassifier`, not the legacy model. This separation permits comparative experiments without silently presenting the old weighted model as deployed behavior.

---

## 6. Freshness-Aware Sensor Fusion Methodology

### 6.1 Inputs and validity

At each evaluation, the policy can receive: (a) an ultrasonic range (d_u), (b) zero or more visual detections, and (c) optionally a depth-derived range. An ultrasonic signal is admitted only when its distance is a finite, non-Boolean, in-range value (2.0 cm to 400.0 cm, strictly less than 400.0 to exclude the legacy no-echo sentinel) and the live telemetry is fresh. An invalid, absent, or stale ultrasonic value produces no ultrasonic signal. In particular, an invalid reading is not converted to a normal/clear state.

A visual detection without a metric range can still provide evidence that an object is present. The policy chooses the strongest supplied visual detection for its visual signal, but the associated detector score is used as an ordering/coverage input only. It is not calibrated, and it does not establish an obstacle probability. Without a valid visual distance or explicit threat, a usable detection supports `WARNING`, never `CLEAR`.

### 6.2 Decision rule

Let (S) be the set of valid, currently admissible modality signals. Each signal has a severity (q(s) in {0,1,2,3}), corresponding to `NORMAL`, `WARNING`, `ALARM`, and `CRITICAL`. The deployed decision is

q_out = max over s in S of q(s).

If (S = ∅), the output threat is `NO DATA` and the sensing state is `NO VALID DATA`; these are two distinct fields of the same result, a threat-level fallback and an input-availability state, not interchangeable. If one modality contributes, the state is `SENSOR DEGRADED`; if at least two distinct modalities contribute, it is `FUSED`. These state labels do not claim that two signals agree about the same physical object.

When a sole signal has a numeric range, that value may be surfaced as `fused_distance_cm`. When more than one modality is active, the fused-distance field is null even if one source has a number. Per-modality distances remain available. This prevents an HC-SR04 beam range from being displayed as the range of a detected object.

The rule deliberately favors missed-warning sensitivity over warning specificity whenever an admissible signal conflicts with a less severe one. Its trade-off is explicit: choosing the most severe valid observation can increase false warnings. Whether that trade-off is preferable, and whether it improves any metric relative to a baseline, must be measured using independently labelled records. It must not be inferred from automated unit tests.

### 6.3 Failure handling

| Observation condition | Policy output principle |
|---|---|
| No valid visual or ultrasonic observation | `NO DATA` / `NO VALID DATA`, not clear |
| Fresh valid ultrasonic obstacle and no camera detection | Ultrasonic warning can still trigger |
| Usable visual detection and failed ultrasound | Visual warning remains; sensing is degraded |
| Stale or invalid ultrasound | Excluded from current decision; cannot refresh itself |
| Multiple visual detections and one ultrasonic range | No range averaging or object association |
| Conflicting valid severities | Most severe valid severity; disagreement is reflected only by the non-probabilistic agreement indicator |

---

## 7. Experimental Protocol and Evaluation Metrics

### 7.1 Recording, validation, and replay workflow

The project supplies a three-stage workflow. First, `record_scenario_metadata.py` appends operator-supplied JSONL metadata. It does not read a serial port, camera, model, actuator, or live warning state; independent labels and event timestamps must therefore be supplied by the operator. Second, `validate_recordings.py` reads JSONL without modifying it, validates schema and unique scenario identifiers, records exclusions, and produces a hash-backed summary. Third, `fusion_experiment.py` deterministically replays accepted records through four methods: camera-only, ultrasonic-only, the retained legacy weighted baseline, and reliability-aware fusion.

Each record requires a unique scenario identifier and an ISO-8601 timestamp with timezone. Optional fields retain recording type (`physical`, `simulated`, `fault_injection`, or `unknown`), timestamp source, independent ground-truth obstacle/warning labels, camera availability/detections/age, ultrasonic validity/distance/age, fault event, and optional processing latency. The replay manifest records source and accepted-payload SHA-256 hashes, exclusions, categories, recording types, and policy identifier. Simulated and fault-injection records test software handling; they are not physical evidence.

`PHYSICAL_TEST_PROTOCOL.md` specifies controlled stationary-obstacle trials, independent distance measurement, preflight checks, lighting and motion conditions, invalid-echo and disconnection cases, recovery cases, and observed buzzer behavior. It explicitly prohibits treating the prototype as a validated mobility aid or conducting blind navigation. The protocol requires documentation of clock alignment because the firmware lacks an acquisition timestamp and the Python serial timestamp is host receipt/processing time.

### 7.2 Outcome definitions and denominators

For a policy output and an independently assigned warning label, a true positive (TP) is a required-warning event that produces a warning; a false negative (FN) is a required-warning event that does not; a false positive (FP) is a no-warning event that produces one; and a true negative (TN) is a no-warning event that does not. Records with unknown ground truth are retained for provenance but excluded from these classification denominators.

Precision = TP / (TP + FP), Recall = TP / (TP + FN), Missed-warning rate = FN / (TP + FN), False-warning rate = FP / (FP + TN).

An undefined denominator is reported as null, not zero. The invalid-ultrasonic rate is invalid-ultrasonic records divided by replayed accepted records. Recovery success is valid ultrasonic data on predefined recovery/reconnection events divided by such events. Physical warning latency requires a common, documented event-time and decision/actuation-time basis; replay timestamps and program execution time alone are not sensor-to-warning latency.

Detection metrics (precision, recall, F1, mAP50, and mAP50--95) require authentic image annotations, matching rules, split identity, checkpoint hash, inference configuration, and a held-out evaluation set. They cannot be calculated from model predictions used as labels.

---

## 8. Results and Discussion — Placeholder Pending Data Collection

**No physical or held-out NetraSense result is reported in this draft.** Automated software tests and source inspection verify code paths; they do not measure real sensing, warning effectiveness, latency, usability, or safety.

The repository contains a COCO-128 diagnostic evaluation for `yolo11n.pt` with provenance artifacts. Its audited split path is `coco128/images/train2017`; therefore it is not an independent, held-out NetraSense benchmark and cannot establish generalization to NetraSense environments. The repository's software evaluation report also states that no annotated NetraSense samples are present. These artifacts may be retained as diagnostic/provenance records but are not used here as paper performance results.

The legacy `evaluation_report.json`/benchmark summary includes synthetic figures labelled 98.80% accuracy and AUC 0.9995. Those figures must not be presented as detector, fusion, or system performance. They are excluded from this paper.

After prospective data collection, this section must include at least:

- **Table 1:** physical recording cohort, environments, object classes, distance strata, repetitions, exclusions, and ground-truth method.
- **Table 2:** TP, FP, FN, TN and denominator-aware warning metrics for the four policies, reported separately by scenario and overall.
- **Table 3:** invalid-reading, disconnection, reconnection, stale-data, and recovery outcomes.
- **Table 4:** model-only, software-pipeline, and physical sensor-to-warning timing results, each with clock/method definition, sample count, mean, median, and 95th percentile where justified.
- **Figure 1:** deployed data flow and local versus host actuator control.
- **Figure 2:** pre-specified policy-state timeline for fresh, stale, invalid, disconnected, and recovered telemetry.
- **Figure 3:** per-scenario warning outcomes (with uncertainty intervals only when the sampling plan supports them).

Any comparative claim must identify the record set, policy configuration, threshold values, exclusions, and uncertainty method. The same data must not be used both to tune thresholds and to make a final comparative claim without a separate evaluation partition.

---

## 9. Limitations and Threats to Validity

The principal limitation is absence of physical evidence. The project has no genuine physical recordings, no physical experiment, no annotated held-out NetraSense dataset, no measured buzzer response, and no independently measured end-to-end latency. Consequently, no navigation-safety, obstacle-detection-accuracy, recovery-time, or fusion-improvement assertion is justified.

The HC-SR04 is a beam-range sensor; target reflectivity, angle, placement, electrical compatibility, and environmental conditions require controlled measurement. The camera detector may miss objects under lighting variation, movement, blur, occlusion, class mismatch, or camera placement changes. Monocular depth has scale ambiguity. Neither the current architecture nor its tests demonstrate an object-level association between image detections and ultrasonic echoes.

The firmware supplies no acquisition timestamp, so host-side serial receipt time cannot by itself determine physical sensing latency. The conservative maximum-severity rule may increase warnings in disagreement conditions. The configured thresholds are engineering parameters, not universal safety thresholds. Finally, the available COCO-128 diagnostic data overlap the detector's training-distribution context and are neither representative of egocentric operation nor a substitute for a held-out study dataset.

---

## 10. Conclusion and Future Work

NetraSense provides an implemented, freshness-aware framework for combining visual and ultrasonic warning evidence without asserting unjustified object-distance correspondence. Its meaningful current contribution is reproducible software behavior and a protocol-ready path to measurement: invalid/stale readings are not current evidence, unavailable sensing is not represented as clear, visual and ultrasonic observations can each support a warning, and offline replay retains data provenance and exclusions.

The next work is empirical: collect independently labelled controlled recordings; validate clock alignment and hardware failure/recovery behavior; measure policy-specific warning outcomes; create a held-out NetraSense image dataset; evaluate the exact deployed model variant(s), including YOLO11m if deployed; and conduct any participant study only under an approved, safety-conscious protocol. Calibration, object association, and time-to-collision are future research topics, not capabilities claimed here.

---

## References

1. B. Khaleghi, A. Khamis, F. O. Karray, and S. N. Razavi, "Multisensor data fusion: A review of the state-of-the-art," *Information Fusion*, vol. 14, no. 1, pp. 28--44, 2013. doi: [10.1016/j.inffus.2011.08.001](https://doi.org/10.1016/j.inffus.2011.08.001).
2. J. Redmon, S. Divvala, R. Girshick, and A. Farhadi, "You Only Look Once: Unified, Real-Time Object Detection," in *Proceedings of the IEEE Conference on Computer Vision and Pattern Recognition*, 2016. doi: [10.1109/CVPR.2016.91](https://doi.org/10.1109/CVPR.2016.91).
3. M. Bousbia-Salah, M. Bettayeb, and A. Larbi, "A Navigation Aid for Blind People," *Journal of Intelligent & Robotic Systems*, vol. 64, pp. 387--400, 2011. doi: [10.1007/s10846-011-9555-7](https://doi.org/10.1007/s10846-011-9555-7).
4. Z. A. Ali, "Design and evaluation of two obstacle detection devices for visually impaired people," *Journal of Engineering Research*, vol. 11, no. 3, pp. 100--105, 2023. doi: [10.1016/j.jer.2023.100132](https://doi.org/10.1016/j.jer.2023.100132).
5. J. Wang, X. Cao, B. Yin, and Y. Cheng, "Sleep--Wake Sensor Scheduling for Minimizing AoI-Penalty in Industrial Internet of Things," *IEEE Internet of Things Journal*, vol. 9, no. 9, pp. 6404--6417, 2022. doi: [10.1109/JIOT.2021.3112211](https://doi.org/10.1109/JIOT.2021.3112211).

---

## Implementation and Artifact Basis for This Draft

This manuscript was prepared from source and artifacts inspected in the NetraSense repository, including `server/ensemble.py`, `server/ensemble_model.py`, `server/vision_server.py`, `server/sensor_bridge.py`, `server/serial_sensor.py`, `server/obstacle_warning.py`, `arduino/ultrasonic_sensor.ino`, `src/lib/sensor.ts`, `src/routes/_authenticated/dashboard.tsx`, `server/EXPERIMENT_PROTOCOL.md`, `server/PHYSICAL_TEST_PROTOCOL.md`, `server/fusion_experiment.py`, `server/record_scenario_metadata.py`, `server/validate_recordings.py`, relevant unit tests, and the evaluation-result artifacts. It should be revised after data collection using the companion checklist.

---

## Appendix A: Paper Corrections Applied to Parts 3–6

The following corrections were applied to the paper as part of the Parts 3–6 audit:

1. **Depth estimation.** The paper now states that depth is an *optional capability* and is *not active* in the evaluated baseline. The paper does not claim depth-assisted performance in the baseline.
2. **Fusion states.** `NO DATA` is the fused threat-level fallback; `SENSOR DEGRADED` is the sensing state when one distinct source contributes; `FUSED` is the sensing state when two or more sources contribute; `NO VALID DATA` is the result structure's initial state value and is also the runtime sensing state whenever no valid observation is available (the `fused_threat_level` field then falls back to `NO DATA`); the two `NO` labels are separate fields with different meanings.
3. **fused_distance_cm.** A numeric fused distance is populated only when exactly one signal source provides a distance. It is never a fabricated or averaged value.
4. **Firmware vs. host input ranges.** The paper distinguishes the firmware's 2–380 cm accepted range from the host parser's 2–<400 cm policy (2–<400 for non-flagged records; 2–400 inclusive for explicitly flagged records).
5. **Freshness.** The paper states host receipt time is not acquisition time; the timestamp is a host-side proxy. The stale rule is strictly `age > 3.0 seconds`, with equality fresh.
6. **Heartbeat timeout.** The paper preserves the verified statement that age strictly greater than 3.0 seconds is stale, while equality remains fresh.
7. **Buzzer vs. threat thresholds.** The paper separates host threat classification from Arduino buzzer actuation bands and does not claim the firmware uses identical thresholds.
8. **Legacy synthetic figures.** The legacy figures 98.80% accuracy and AUC 0.9995 are excluded as unsupported.
9. **COCO-128 diagnostic.** The paper states the COCO-128 evaluation is an in-sample detector diagnostic, not independent generalization.
10. **Replay determinism.** Replay determinism is described as software-level repeatability, not physical evidence.
11. **Typo fixed.** "firmeware" corrected to "firmware".
12. **Depth paragraph deduplication.** C.4 contains one canonical depth paragraph, not duplicate or contradictory paragraphs.
13. **Novelty framing.** A Related Work scope statement and a Section 3 clarification state that the literature review is selective rather than a completed systematic review, that vision-ultrasound obstacle detection and fusion are established prior work, and that input validation, missing/invalid/stale-data handling, receipt-time freshness assessment, conservative fusion outputs, and sensing-state reporting are implementation-level design choices rather than proven first-of-kind inventions.
14. **Freshness semantics.** The Related Work freshness paragraph states explicitly that the firmware transmits no acquisition timestamp, so the host receipt-time assessment is a freshness proxy rather than a direct Age-of-Information measurement.
15. **Reference verification.** All five references were re-verified against publisher records; reference [4]'s DOI was corrected from the unresolvable 10.1006/jer.2023.0132 to 10.1016/j.jer.2023.100132, and its Related Work sentence updated to the published device descriptions (wearable smart belt and handheld smart stick compared with a white cane).
