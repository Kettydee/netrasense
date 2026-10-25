# NetraSense: Object-Detection Evaluation, Confidence Tuning, and Warning-System Status

## 1. Experimental objective

Measure the existing NetraSense YOLO11n object-detection baseline on a
genuine ground-truth benchmark, quantify the confidence-threshold
trade-off at several operating points, and document the complete
sensor-fusion warning path so that future improvements (fine-tuning,
threshold selection, physical sensor calibration) can be planned on
measured evidence rather than assumption.

## 2. Model and dataset status (PHASE 1 / 2)

### Model provenance

| Property | Value |
|---|---|
| Weights | `yolo11n.pt` (YOLO11n) |
| SHA-256 | `0ebbc80d4a7680d14987a577cd21342b65ecfd94632bd9a8da63ae6417644ee1` |
| Parameters | 2,616,248 |
| GFLOPs | 6.5 |
| File size | 5,613,764 bytes |
| Training | Pretrained only; no training or fine-tuning in this repo |
| Training scripts | None present |

### Dataset

| Property | Value |
|---|---|
| Dataset | COCO-128 |
| Images | 128 |
| Ground-truth targets | 929 |
| Classes | 80 COCO classes (71 active in eval) |
| Annotation format | YOLO txt / COCO JSON |
| Source | Creative Commons Attribution 4.0 (CC BY 4.0) |
| Path | `/opt/homebrew/datasets/coco128/` |

### Software environment

Python 3.9.6, PyTorch 2.8.0, Ultralytics 8.4.177, NumPy 1.26.4,
OpenCV 5.0.0.93, CPU (Apple M4).

## 3. Baseline evaluation results (PHASE 2)

Run with `server/evaluate_accuracy.py --model yolo11n.pt --data
/tmp/coco128.yaml --imgsz 640 --out evaluation_results/accuracy`.

| Metric | Value |
|---|---|
| Precision (macro) | 69.35% |
| Recall (macro) | 59.09% |
| F1-Score | 63.81% |
| mAP@50 | 68.01% |
| mAP@50-95 | 50.26% |

Per-class (the most important for this application):

| Class | Precision | Recall | F1 | mAP@50 |
|---|---|---|---|---|
| bicycle | 0.39 | **0.17** | 0.23 | 0.46 |
| car | 0.68 | **0.20** | 0.30 | 0.24 |
| person | 0.82 | 0.68 | 0.75 | 0.80 |
| bus | 0.77 | 0.71 | 0.74 | 0.72 |
| dog | 0.93 | 0.94 | 0.94 | 0.94 |
| motorcycle | 0.75 | 1.00 | 0.86 | 0.99 |
| chair | 0.63 | 1.00 | 0.77 | 0.99 |
| couch | 0.93 | 0.33 | 0.49 | 0.56 |
| stop sign | 1.00 | 0.42 | 0.59 | 0.66 |

Artifact files: `experiments/accuracy_baseline_summary.txt`,
`experiments/accuracy_baseline_report.json`,
`experiments/per_class_accuracy_baseline.csv`.

## 4. Confidence-threshold experiment (PHASE 4)

Run with `server/evaluate_confidence_sweep.py --model yolo11n.pt
--data /tmp/coco128.yaml --imgsz 640 --confs 0.10 0.25 0.45 0.60`.

| Threshold | Precision | Recall | F1 | mAP@50 | mAP@50-95 |
|---|---|---|---|---|---|
| 0.10 | 67.98% | 59.41% | 63.41% | 60.92% | 46.81% |
| 0.25 | 73.48% | 57.17% | 64.31% | 55.22% | 43.36% |
| 0.45 | 75.86% | 45.63% | 56.98% | 44.78% | 36.40% |
| 0.60 | 76.83% | 36.00% | 49.03% | 35.56% | 30.26% |

Per-class recall at the key obstacle classes:

| Threshold | person | car | bicycle | dog | chair | bus |
|---|---|---|---|---|---|---|
| 0.10 | 0.699 | 0.196 | 0.167 | 0.941 | 1.000 | 0.714 |
| 0.25 | 0.677 | 0.196 | 0.167 | 0.941 | 1.000 | 0.714 |
| 0.45 | 0.524 | 0.152 | 0.167 | 0.824 | 1.000 | 0.714 |
| 0.60 | 0.429 | 0.087 | 0.167 | 0.706 | 1.000 | 0.571 |

Observation: precision improves with a higher threshold, but recall
collapses across the most safety-critical classes, especially person,
car, and bicycle. **This experiment does not show that threshold tuning
improves mAP** — mAP@50 falls monotonically as precision rises. What it
does show is a precision/recall trade-off that must be decided by the
application, not by the metric.

## 5. Error analysis (PHASE 3)

Weakest classes: bicycle (17% recall) and car (20% recall). Both are
tiny-object categories. At 640x640 the model rarely assigns them
confidence above the operating threshold, and where they are detected
the boxes are coarse.

Strongest classes: dog (94%), motorcycle (100%), chair (100%). The
recall gap is a small-object localization/generalization issue, not a
threshold issue.

Artifact: `experiments/error_analysis/analysis.md`.

## 6. Fine-tuning (PHASE 5 / 6)

**NOT EXECUTED.** The repository contains no training script, no
annotated NetraSense capture corpus, and no YOLO-compatible data
configuration. The dataset collector and normalizer are present as
software tools but have never been run against physical hardware.

A fine-tuning A/B experiment is justified by the small-object weakness,
but it cannot be run honestly until:
- a labelled pedestrian-vehicle dataset exists, and
- a train/val/test split with no leakage is defined.

A full dataset-collection, annotation, and training configuration
template is captured in `experiments/training_plan.md`. No checkpoint
or training result exists yet. **The model remains the pure pretrained
YOLO11n.**

## 7. System-level warning evaluation (PHASE 7)

### What the code actually fuses

1. **Ultrasonic** via Arduino HC-SR04 (`server/serial_sensor.py`,
   `server/obstacle_warning.py`). The evaluator emits four states —
   OBSTACLE_WARNING, CLEAR, SENSOR_ERROR, SENSOR_UNAVAILABLE — with
   hysteresis, debounce, and a 3 s staleness timeout.
2. **Vision** via YOLO11n and optional Depth Anything V2
   (`server/vision.py`). Distance, when depth is loaded, comes from the
   monocular depth model, **not** the ultrasonic measurement.

### Fusion point

The fusion lives in `server/ensemble.py`. It is deliberately
agreement-based: the ultrasonic, YOLO, and depth signals are kept as
separate per-modality sub-reports, and no object distance is created by
averaging an ultrasonic beam with a monocular depth estimate. The
design explicitly avoids inventing object-level correspondence that the
sensor geometry does not provide.

### Behaviour verified in code (software analysis)

- Invalid ultrasonic readings are rejected before they reach the
  evaluator; `invalid_telemetry` is tracked separately.
- A missing sensor reading cannot produce a distance: the evaluator
  returns SENSOR_UNAVAILABLE when no fresh reading exists.
- Stale data (>3 s) demotes a state to SENSOR_UNAVAILABLE; it does not
  preserve a misleading CLEAR.
- The four-state warning machine distinguishes OBSTACLE_WARNING,
  CLEAR, SENSOR_ERROR, and SENSOR_UNAVAILABLE.

### What remains physical hardware validation

The software logic is sound, but the following require the physical
board and sensor:
- Ultrasonic accuracy (MAE, RMSE, bias) at known distances
- Serial read reliability and dropout rate
- False-warning / missed-warning rate at the 100 cm and 300 cm boundary
- End-to-end warning latency from raw line to dashboard badge
- Stale-distance and USB-disconnect safety

Artifact: `experiments/hardware_protocol.md`.

## 8. Latency and resource measurements

- Model: 2,616,248 parameters, 6.5 GFLOPs, 5.6 MB file.
- Inference device: CPU (Apple M4) for all COCO-128 evaluation.
- COCO-128 throughput was not separately captured as a live process in
  this session; the existing validation log records the framework
  versions but not a per-frame millisecond measurement. This is an
  explicit pending item.

## 9. Limitations

- COCO-128 is a 128-image diagnostic set; it will not reproduce the
  real world.
- COCO-128 is third-person static imagery; NetraSense is a forward-
  looking wearable camera subject to motion, vibration, and dynamic
  lighting.
- No NetraSense-specific training corpus exists, so fine-tuning was not
  executed.
- Hardware-dependent metrics (ultrasonic accuracy, serial reliability,
  fusion warning rate, end-to-end latency) are pending physical
  measurement.
- The "sensor fusion" in the ensemble is an agreement / degradation
  state, not a fused distance. Presenting it as a fused range would be
  inaccurate.

## 10. Experiments that remain pending

| Experiment | Status | Needs |
|---|---|---|
| Fine-tuning on a curated dataset | Dataset required | Capture corpus + annotation |
| 800x800 inference benchmark | Pending | Same eval script, `--imgsz 800` |
| 0.25 threshold production switch | Pending decision | Product policy |
| Ultrasonic accuracy | Pending hardware | Arduino + HC-SR04 |
| Serial reliability | Pending hardware | Real serial line |
| Warning precision/recall | Pending hardware | Physical obstacle at known distance |
| End-to-end warning latency | Pending hardware | Timestamped logs |

## 11. Recommended next improvement

1. Adopt a threshold after product review (the data supports a
   precision/recall trade-off; the current `conf=0.50` is the
   production default and should not be claimed as an optimality
   result).
2. Collect an annotated pedestrian-vehicle capture corpus and run the
   fine-tuning A/B experiment using the template in
   `experiments/training_plan.md`.
3. Perform the physical sensor protocol before adding safety claims to
   the paper.

## 12. Reproduction commands

```bash
# Baseline accuracy (exact settings)
python3 server/evaluate_accuracy.py --model /Users/harshbothra/Desktop/netrasense/yolo11n.pt \
    --data /tmp/coco128.yaml --imgsz 640 --out evaluation_results/accuracy

# Confidence-threshold sweep
python3 server/evaluate_confidence_sweep.py --model /Users/harshbothra/Desktop/netrasense/yolo11n.pt \
    --data /tmp/coco128.yaml --imgsz 640 --out evaluation_results/confidence_sweep

# Larger-image-size variant for future benchmark
python3 server/evaluate_accuracy.py --model /Users/harshbothra/Desktop/netrasense/yolo11n.pt \
    --data /tmp/coco128.yaml --imgsz 800 --out evaluation_results/accuracy
```

## 13. Actual numerical results summary

| Metric | Baseline |
|---|---|
| Precision | 69.35% |
| Recall | 59.09% |
| F1 | 63.81% |
| mAP@50 | 68.01% |
| mAP@50-95 | 50.26% |
| bicycle recall | 17% |
| car recall | 20% |
| person recall | 68% |

Threshold trade-off is a precision/recall choice, not an mAP win:
higher thresholds raise precision and lower mAP; lower thresholds raise
recall and lower precision. No experiment in this report claims a
superiority result, and no training has been performed.
