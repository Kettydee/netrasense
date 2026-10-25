# Improvement Recommendations (PHASE 8)

## Evidence basis

The baseline metrics come from real framework output on COCO-128:

| Metric | Value |
|---|---|
| Precision | 69.35% |
| Recall | 59.09% |
| F1 | 63.81% |
| mAP@50 | 68.01% |
| mAP@50-95 | 50.26% |

| Class | Recall |
|---|---|
| bicycle | 17% |
| car | 20% |
| person | 68% |
| bus | 71% |

## Improvement options ranked by expected benefit

### High value, low-risk, hardware-free

1. **Confidence-threshold selection for the assistive pipeline**
   The threshold is currently `conf=0.50` (production default). The
   sweep shows 0.25 gives the best person/car/bicycle recall at the
   cost of more FP. Choosing 0.25 would trade precision (71%) for a
   ~30% relative recall gain on the most important classes. This is a
   single config edit, verified by PHASE 4 output, and requires no
   training. Risk: more low-quality proposals on the video feed.
2. **Tiny-object preprocessing**
   At 640x640 the model under-sees small obstacles. Region/anchor
   scaling, test-time mosaic, or image pyramid inference at 800 px
   (with the same val protocol) would directly target the weakest
   classes. This is verifiable with the same eval script and the
   existing threshold sweep.
3. **Semantic filtering by spatial zone**
   The vision pipeline already classifies left/center/right, and the
   stereo task is pedestrian path vs. lateral hazard. Applying a
   context-aware filter (e.g. only `person`/`bicycle`/`car` in the
   center corridor) does not change detection quality but changes how
   detections are escalated to warnings.

### Medium value, hardware-required

4. **Arduino ultrasonic accuracy calibration**
   The accelerometer/timestamp path is untested. A yardstick against a
   known-reflectance board at fixed distances is the single highest-
   value physical experiment (PHASE 7 protocol).
5. **Fusion-state logging**
   The dashboard already collects ultrasonic age, `invalid_telemetry`,
   and sensor status. Instrumenting the dashboard to log a JSONL of
   `timestamp, ultrasonic_age_s, ultrasonic_valid, threat_level, distance_cm,
   vision_detections, fused_state` would make PHASE 7 warning metrics
   reproducible on real data.

## Improvements deliberately NOT recommended yet

- **Full training** — no NetraSense capture corpus exists; the
  measured failure is tiny-object recall, and COCO-128 cannot fix it.
- **Quantization/pruning** — not implemented; not justified without a
  deployment memory/latency target.
- **Structural sensor fusion** — the ensemble is agreement-based, not
  range-fused. A range-fused hybrid would require object-level
  correspondence that the sensor geometry does not provide.

## Priority order for the next milestone

1. Run the 0.25 threshold evaluation (software-only, PHASE 4)
2. Benchmark 800x800 inference (software-only, latency/memory)
3. Build the annotated capture dataset (hardware + annotation)
4. Run the fine-tuning A/B experiment (PHASE 6) once the dataset is
   collected
5. Perform the physical sensor protocol (PHASE 7)

## Reproducible measurement commands

```bash
# 0.25 threshold, same protocol as the baseline
python3 server/evaluate_confidence_sweep.py --model /Users/harshbothra/Desktop/netrasense/yolo11n.pt \
    --data /tmp/coco128.yaml --imgsz 640 --out evaluation_results/confidence_sweep \
    --confs 0.10 0.25 0.45 0.60

# Larger image size (requires adjusting --imgsz and the model input)
python3 server/evaluate_accuracy.py --model /Users/harshbothra/Desktop/netrasense/yolo11n.pt \
    --data /tmp/coco128.yaml --imgsz 800 --out evaluation_results/accuracy
```
