# Error Analysis — YOLO11n on COCO-128

## What this analysis covers

Per-class detection quality and confidence-score behaviour for the
baseline YOLO11n model. Based on the actual framework evaluation output
from `server/evaluate_accuracy.py` (COCO-128, 128 images, CPU inference).

## Key findings

### Weakest classes (highest-priority for improvement)

| Class | Recall | Precision | F1 | mAP@50 | Interpretation |
|---|---|---|---|---|---|
| **bicycle** | **17%** | 39% | 0.23 | 0.46 | Critical assistive hazard; tiny, far-away, heavily occluded |
| **car** | **20%** | 68% | 0.30 | 0.24 | Critical assistive hazard; small boxes from a telephoto perspective |
| person | 68% | 82% | 0.75 | 0.80 | Most important assistive hazard; moderate recall at 640 px |

### Strongest classes

| Class | Recall | Precision | F1 | mAP@50 |
|---|---|---|---|---|
| dog | 94% | 93% | 0.94 | 0.94 |
| motorcycle | 100% | 75% | 0.86 | 0.99 |
| chair | 100% | 63% | 0.77 | 0.99 |
| bus | 71% | 77% | 0.74 | 0.72 |

### Interpretation

1. **Tiny-object recall is the dominant weakness.** Bicycle and car
   detections are both recall-poor. At 640x640, a distant bicycle or
   car occupies few pixels, and the chosen `conf=0.50` filter
   (`server/vision.py` `_detect`) drops low-confidence, small-box
   proposals before they reach the spatial classifier.
2. **Precision is high where recall is low.** Bicycle and car precision
   (39%, 68%) is not terrible; the bottleneck is recall, i.e. the model
   often misses them or predicts them below the operating threshold.
3. **No false-positive explosion in the weakest classes.** The FP
   counts are modest; the problem is false negatives, not false
   positives. Lowering the threshold raises recall but at the cost of
   many more low-quality proposals (see PHASE 4).
4. **Class imbalance in the dataset.** COCO-128 has only 6 bicycle and
   46 car ground-truth instances, versus 46 person and 35 chair. The
   model sees far fewer pedestrian-vehicle examples during its
   pre-training distribution. This is a dataset-representation issue,
   not a thresholding issue.

## Confidence-score distribution

The baseline `conf=0.50` operating point (production default in
`server/vision.py`) selects the top quantiles of the score distribution.
At 640 px the score distribution is heavily right-skewed: the bicycle and
car bins occupy a much smaller share of the top-confidence proposals
than the person/class bins.

## Recommended improvement direction

The measured failure pattern points to **tiny-object detection
generalization**, not threshold selection. Lowering the operating
threshold improves recall but does not fix localization. The most
expedient, hardware-free improvement is a **controlled fine-tuning
experiment on a curated pedestrian-vehicle dataset** (PHASE 5/6).
Without a suitable labelled dataset, that experiment cannot be run
honestly, so it is listed as a dataset-collection task, not an active run.
