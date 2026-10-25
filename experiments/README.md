# NetraSense Evaluation Outputs

Reproducible evaluation of the NetraSense YOLO11n object-detection baseline.

## What exists already

The following artifacts were produced by executing the project's own
evaluation scripts against the real model and dataset:

| Artifact | Source |
|---|---|
| `experiments/accuracy_baseline_summary.txt` | `server/evaluate_accuracy.py` output |
| `experiments/accuracy_baseline_report.json` | `server/evaluate_accuracy.py` JSON report |
| `experiments/per_class_accuracy_baseline.csv` | per-class accuracy table |
| `experiments/threshold_sweep_summary.txt` | `server/evaluate_confidence_sweep.py` output |
| `experiments/threshold_comparison.csv` | threshold comparison CSV |
| `experiments/baseline_validated_evaluation_report.json` | validated evaluation report |

## Baseline metrics (actual framework output)

Model        : YOLO11n (`yolo11n.pt`, SHA-256 `0ebbc80d...`)
Dataset      : COCO-128 (128 images, 929 ground-truth instances, 80 classes)
Device       : CPU (Apple M4)
Image size   : 640x640

| Metric | Value |
|---|---|
| Precision | 69.35% |
| Recall | 59.09% |
| F1-Score | 63.81% |
| mAP@50 | 68.01% |
| mAP@50-95 | 50.26% |

## Per-class weaknesses (most important for this application)

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

## Confidence-threshold sweep (PHASE 4, actual framework output)

| Threshold | Precision | Recall | F1 | mAP@50 | mAP@50-95 |
|---|---|---|---|---|---|
| 0.10 | 67.98% | 59.41% | 63.41% | 60.92% | 46.81% |
| 0.25 | 73.48% | 57.17% | 64.31% | 55.22% | 43.36% |
| 0.45 | 75.86% | 45.63% | 56.98% | 44.78% | 36.40% |
| 0.60 | 76.83% | 36.00% | 49.03% | 35.56% | 30.26% |

## Notes on limitations

- COCO-128 is a 128-image diagnostic dataset. It does **not** represent the
  diversity of real-world obstacles, lighting, motion blur, or occlusions
  experienced by a body-worn assistive sensor.
- COCO-128 is third-person static imagery. NetraSense operates from a
  camera viewing the forward pathway, subject to camera motion, vibration,
  and dynamic lighting.
- These results are **software benchmarks only**. No claims of navigation
  safety, real-world obstacle-avoidance reliability, or physical sensor
  fusion performance are made or implied.

## Reproduction commands

```bash
# Baseline accuracy
python3 server/evaluate_accuracy.py --model /Users/harshbothra/Desktop/netrasense/yolo11n.pt \
    --data /tmp/coco128.yaml --imgsz 640 --out evaluation_results/accuracy

# Threshold sweep (same settings as the run above)
python3 server/evaluate_confidence_sweep.py --model /Users/harshbothra/Desktop/netrasense/yolo11n.pt \
    --data /tmp/coco128.yaml --imgsz 640 --out evaluation_results/confidence_sweep
```
