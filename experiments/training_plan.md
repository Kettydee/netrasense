# Dataset Collection & Fine-Tuning Plan (PHASE 5 / PHASE 6)

## Current model status

The model under test is `yolo11n.pt` — a **pretrained YOLO11n** released
by the Ultralytics project. No training or fine-tuning has been performed
on it in this repository. There is no training script, no checkpoint,
and no annotated NetraSense-specific dataset on disk.

The model loads successfully (SHA-256
`0ebbc80d4a7680d14987a577cd21342b65ecfd94632bd9a8da63ae6417644ee1`,
2,616,248 parameters, 6.5 GFLOPs).

## Available data today

- **COCO-128** (128 images, 929 ground-truth instances, 80 COCO classes)
  at `/opt/homebrew/datasets/coco128/`. This is a public diagnostic
  dataset, not a NetraSense capture corpus.
- **NetraSense dataset collector** (`server/dataset_collector.py`) and
  **dataset normalizer** (`server/dataset_normalizer.py`) exist as
  software tools but have never been run against physical hardware.
- No ground-truth annotations, train/val/test splits, or YOLO
  configuration for the intended application are present.

## Fine-tuning justification

The measured weak point is tiny-object recall: **bicycle recall 17%**,
**car recall 20%**, **person recall 68%**. These are the highest-risk
categories for a pedestrian-navigation assist. COCO-128 contains only
6 bicycle and 46 car ground-truth instances, so the model was
under-exposed to pedestrian-vehicle examples during its
pre-training distribution.

The current evidence therefore **justifies an experiment**, not a
conclusion. To run that experiment legitimately, the following must
exist before any training is launched:

1. A labelled capture corpus of the target environment (indoor
   pedestrian corridors, driveways, car parks, curbs) that includes
   enough bicycle, car, and person instances at small pixel scale to
   support the recall gap.
2. Annotations in YOLO format or COCO JSON, hand-verified.
3. A train/val/test split with no leakage.
4. A data.yaml configuration.

## Recommended collection plan (do not run until captured)

| Step | Action | Output |
|---|---|---|
| 1 | Log on-device frames from the live camera (or a representative static mount) | JPEGs + metadata CSV |
| 2 | Annotate bounding boxes for the assistive obstacle taxonomy (person, bicycle, car, bus, motorcycle, stop sign, curb, stairs, pedestrian, obstacle) | YOLO txt / COCO JSON |
| 3 | Deduplicate near-identical frames with the same hash | train/val/test YAML + split_stats.json |
| 4 | Generate data.yaml with train/val/test paths and class names | data.yaml |
| 5 | Train YOLO11n on a single GPU with fixed seed, logging to runs/ | best.pt + train_stats.json |
| 6 | Evaluate on the held-out test split with the same protocol as the baseline | model_comparison.csv |

## Training configuration template (not used yet)

The following is a **template for a future run**, not a record of
completed training:

```yaml
# experiments/training_config.yaml (template — not executed)
model: yolo11n.pt
data: experiments/data.yaml
imgsz: 640
epochs: 50
batch: 16
patience: 10
optimizer: Adam
lr0: 0.001
lrf: 0.01
momentum: 0.937
weight_decay: 0.0005
warmup_epochs: 3
augment: true
degrees: 5.0
translate: 0.1
scale: 0.5
perspective: 0.0005
flipud: 0.0
fliplr: 0.5
crop: 0.0
focal_loss: true
# seed: 42
project: experiments/runs
name: fine_tune_yolo11n
exist_ok: true
```

Hyperparameters above are a standard Ultralytics YOLO default and are
**not claimed to be the settings used by this repository**, which
contains no training script and no set of hyperparameters.

## Fair-model comparison design (PHASE 6)

If/when a labelled dataset exists:

| Model | Train | Test | Notes |
|---|---|---|---|
| Original pretrained YOLO11n | none | held-out test split | baseline |
| Fine-tuned YOLO11n | curated NetraSense dataset | same held-out split | A/B only |

Both models are evaluated with identical protocol:
`model.val(data=data.yaml, imgsz=640, conf=0.50, iou=0.6, device="cpu")`.
The test split must not be touched during training or threshold
selection. Metrics compared: precision, recall, F1, mAP@50,
mAP@50-95, inference latency, model file size, and runtime memory.

## Status: NOT EXECUTED

No training has been run. No checkpoint exists. The model remains the
pure pretrained YOLO11n. Fine-tuning is a **pending experiment** that
requires the dataset-collection steps above before it can be executed
honestly.

## Hardware requirements

- Single NVIDIA GPU with >= 8GB VRAM (or a CPU fallback, though CPU
  training is impractically slow for this model)
- The original `yolo11n.pt` preserved unmodified as the comparison
  baseline
- A labelled capture corpus from the target deployment environments

## Power/memory requirements

- Record process memory with `psutil` during training
- Record peak training memory and model file size
- Save the augmented training log to `experiments/raw_logs/`

## Reproducible training command (when dataset is ready)

```bash
yolo train data=experiments/data.yaml model=yolo11n.pt imgsz=640 epochs=50 batch=16 \
    lr0=0.001 lrf=0.01 seed=42 project=experiments/runs name=fine_tune_yolo11n
```
