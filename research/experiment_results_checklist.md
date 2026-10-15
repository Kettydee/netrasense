# NetraSense Experiment Results Checklist

This checklist is a data-collection and reporting gate. Completing software tests does not complete any item marked **physical**. Do not replace unknown values with zero, an assumed clear state, or simulated results.

## 1. Before collecting any record

- [ ] Freeze and record the source revision, uncommitted-diff status, Python/package environment, OS, camera source, serial port, Arduino board, firmware file/hash, and model checkpoint/hash.
- [ ] Record actual active model variant(s). Do not use YOLO11n results to characterize YOLO11m.
- [ ] Pre-register the warning thresholds, freshness timeout, hysteresis/debounce configuration, and policy identifier. Do not tune them on final-evaluation records.
- [ ] Confirm the controlled-test safety procedure, observer, termination method, wiring inspection, and electrical compatibility.
- [ ] Verify the distinction between Arduino-local buzzer control and unsupported host `/api/buzzer` control.
- [ ] Define an independent ground-truth procedure for obstacle presence, range, required warning, and event time. Model predictions must not provide ground truth.
- [ ] Define the retained raw-data location, access controls, backup process, and consent/privacy procedure if people or video are recorded.

## 2. Physical recordings required

No physical JSONL recording is currently present or validated as evidence. Collect and retain raw, immutable JSONL plus any authorized media/time-alignment records for:

- [ ] Camera-only obstacle observations.
- [ ] Ultrasonic-only observations.
- [ ] Both modalities available.
- [ ] Visual detections with no defensible metric distance.
- [ ] Multiple visual detections with one ultrasonic beam measurement.
- [ ] Valid but conflicting modality severities.
- [ ] Invalid/no-echo and out-of-range ultrasonic readings, with every failure retained.
- [ ] Stale telemetry, documented through safe observation rather than fabricated timestamps.
- [ ] Arduino/serial disconnection, reconnection, and recovery.
- [ ] Camera failure/disconnection and recovery.
- [ ] Lighting variation, camera motion, and motion-blur conditions.
- [ ] Range strata and obstacle classes/materials/orientations specified before collection.
- [ ] Observed local buzzer patterns and physical response timing.

For every event, record a unique `scenario_id`, ISO-8601 timestamp with timezone, timestamp source, recording type, independent labels, camera availability/detections/age, ultrasonic validity/range/age, and fault event. Use `record_scenario_metadata.py` only for operator-provided metadata; it does not collect sensors itself.

## 3. Dataset and annotation evidence required

- [ ] A held-out annotated NetraSense image/video dataset or a clearly documented external held-out dataset.
- [ ] Dataset license/consent, collection conditions, split definition, sample counts, annotation guidelines, annotator/quality-control process, and dataset SHA-256 hash.
- [ ] Image--annotation pairing validation and class-ID-to-class-name mapping.
- [ ] Training, validation, tuning, and final-test partitions with no uncontrolled overlap.
- [ ] Exact checkpoint path/version/hash and inference parameters (image size, confidence threshold, NMS/IoU settings, device, software versions).
- [ ] Detection matching rule and definitions for precision, recall, F1, mAP50, and mAP50--95.

**Do not use the existing COCO-128 diagnostic evaluation as an independent NetraSense generalization result.** Its audited path is under `train2017`, it contains only 128 images, and it does not represent the intended egocentric deployment conditions. **Do not use legacy synthetic 98.80% accuracy or AUC 0.9995 as model performance.**

## 4. Fusion comparison requirements

- [ ] Replay the *same accepted, timestamped physical records* through camera-only, ultrasonic-only, legacy weighted baseline, and reliability-aware policies.
- [ ] Run `validate_recordings.py` first; retain its output and source SHA-256 hash.
- [ ] Run `fusion_experiment.py`; retain replay output, accepted-payload hash, exclusions, software environment, and policy identifier.
- [ ] Report the number of raw records, accepted records, exclusions by reason, records with unknown labels, and physical versus simulated/fault-injection composition.
- [ ] Report TP, FP, FN, TN for each policy and scenario category.
- [ ] Report precision `TP/(TP+FP)`, recall `TP/(TP+FN)`, missed-warning rate `FN/(TP+FN)`, and false-warning rate `FP/(FP+TN)` with their denominators.
- [ ] Report undefined metrics as null/undefined with the zero denominator stated; never coerce them to zero.
- [ ] Report invalid-ultrasonic rate as invalid-ultrasonic accepted records divided by all accepted replay records.
- [ ] Report recovery success as valid ultrasonic readings on pre-defined reconnection/recovered events divided by those events.
- [ ] Keep results stratified by modality availability and degraded/fused/no-valid-data state.
- [ ] State that the maximum-severity policy may trade false warnings for missed warnings; do not claim superiority absent measured comparison.

## 5. Timing and resource measurements required

- [ ] Define and measure **model-only inference latency** separately from software-pipeline latency.
- [ ] Define and measure **physical sensor-to-warning latency** only with synchronized or documented aligned event, host, and actuator clocks.
- [ ] Record sample count, measurement instrumentation, warm-up policy, outlier rule, mean, median, and 95th percentile where the sample plan permits.
- [ ] Measure throughput, CPU use, memory use, and behavior during reconnection/degraded operation.
- [ ] Measure actual firmware buzzer onset/pattern timing; serial-write success is not an actuator measurement.
- [ ] Do not call replay execution time physical latency.

## 6. Tables required in the final paper

| ID | Required table | Minimum evidence |
|---|---|---|
| T1 | Hardware/software configuration | board, firmware/hash, sensor, camera, model/checkpoint/hash, versions, policy configuration |
| T2 | Physical data cohort | scenarios, repetitions, distances, classes/materials, conditions, exclusions, independent-label method |
| T3 | Detection evaluation | held-out split identity/hash, class mapping, matching/inference settings, detection metrics and denominators |
| T4 | Fusion comparison | TP/FP/FN/TN and all warning metrics for all four policies, overall and by condition |
| T5 | Failure/recovery behavior | invalid, stale, disconnect, reconnect, recovery-event counts and outcomes |
| T6 | Timing/resources | model, pipeline, and physical latency separated; throughput, CPU, memory, instrumentation |

## 7. Figures required in the final paper

- [ ] F1: Data-flow architecture showing camera path, serial path, freshness gate, fusion decision, APIs/dashboard, and Arduino-local buzzer.
- [ ] F2: State/timeline diagram for fresh, invalid, stale, disconnected, reconnected, and recovered observations.
- [ ] F3: Pre-specified warning outcomes by scenario and policy, with uncertainty visualization only when justified.
- [ ] F4: Held-out detection evaluation visualization (e.g., PR curve) only after authentic annotations and split provenance are available.
- [ ] F5: Timing-distribution figure with measurement definitions and sample counts, only after physical timing is instrumented.

## 8. Claims that remain prohibited until evidence exists

- [ ] Do not claim navigation safety, collision avoidance, usability, or clinical/assistive effectiveness.
- [ ] Do not claim improved detection accuracy, fusion improvement, lower latency, robustness, or statistical significance.
- [ ] Do not call detector confidence a calibrated probability.
- [ ] Do not infer an object-level distance from an unrelated ultrasonic beam return.
- [ ] Do not describe unavailable, invalid, or stale sensing as `CLEAR`.
- [ ] Do not represent simulated fixtures or fault-injection tests as physical trials.

## 9. Current evidence status

| Evidence | Current status |
|---|---|
| Software policy behavior and schema validation | Automated unit tests/source inspection; not physical validation |
| Offline replay/validator workflow | Implemented and testable; awaiting real input recordings |
| Physical sensor, buzzer, reconnection, and latency measurements | Missing; requires controlled hardware experiment |
| Held-out annotated NetraSense detection data | Missing |
| COCO-128 diagnostic artifact | Present, but not independent NetraSense generalization evidence |
| Legacy synthetic accuracy/AUC artifact | Present but invalid for model-performance reporting |
