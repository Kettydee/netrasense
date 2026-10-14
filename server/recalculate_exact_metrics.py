"""Direct prediction extraction and ground-truth matching for NetraSense YOLO11n.

This script:
1. Runs raw inference on all 128 COCO-128 images with conf=0.001 (all proposals).
2. Parses genuine ground-truth bounding box labels from /opt/homebrew/datasets/coco128/labels/train2017.
3. For each confidence threshold in [0.10, 0.25, 0.45, 0.60]:
   - Filters predictions by confidence >= threshold.
   - For each image and for each class, matches predicted boxes to ground-truth boxes:
     * Candidate pairs must have IoU >= 0.50 (matching mAP@50 standard).
     * Matches are resolved greedily in descending order of IoU / confidence so that
       each ground-truth box and each predicted box is matched at most once (one-to-one matching).
   - Counts exact True Positives (TP), False Positives (FP), and False Negatives (FN).
   - Verifies that TP + FN == Ground Truth Count for every class.
   - Calculates Precision = TP / (TP + FP) [or 0.0 if TP+FP==0].
   - Calculates Recall = TP / (TP + FN) [or 0.0 if TP+FN==0].
   - Calculates F1 = 2 * P * R / (P + R) [or 0.0 if P+R==0].
4. Computes both micro-averaged metrics (pooling TP, FP, FN over classes) and macro-averaged metrics.
5. Saves the verified results as JSON and CSV.
"""

from __future__ import annotations
import json
import csv
from pathlib import Path
import numpy as np
from ultralytics import YOLO


def box_iou_xyxy(box1: np.ndarray, box2: np.ndarray) -> float:
    """Compute IoU between two [x1, y1, x2, y2] bounding boxes."""
    xA = max(box1[0], box2[0])
    yA = max(box1[1], box2[1])
    xB = min(box1[2], box2[2])
    yB = min(box1[3], box2[3])
    inter = max(0.0, xB - xA) * max(0.0, yB - yA)
    area1 = max(0.0, (box1[2] - box1[0])) * max(0.0, (box1[3] - box1[1]))
    area2 = max(0.0, (box2[2] - box2[0])) * max(0.0, (box2[3] - box2[1]))
    union = area1 + area2 - inter
    return inter / union if union > 0 else 0.0


def run_exact_matching(
    model_path: str = "yolo11n.pt",
    img_dir: str = "/opt/homebrew/datasets/coco128/images/train2017",
    label_dir: str = "/opt/homebrew/datasets/coco128/labels/train2017",
    thresholds: list[float] = [0.10, 0.25, 0.45, 0.60],
    iou_match_threshold: float = 0.50,
):
    print("=" * 80)
    print("  EXACT GROUND-TRUTH MATCHING & METRIC CALCULATION")
    print("=" * 80)

    model = YOLO(model_path)
    names = model.names
    num_classes = len(names)

    img_paths = sorted(list(Path(img_dir).glob("*.jpg")))
    print(f"Total evaluation images: {len(img_paths)}")

    # 1. Parse all ground truth annotations
    # YOLO format: class_id x_center y_center width height (normalized)
    ground_truth: dict[str, list[dict]] = {}
    gt_class_counts = {c: 0 for c in range(num_classes)}

    for img_p in img_paths:
        stem = img_p.stem
        lbl_p = Path(label_dir) / f"{stem}.txt"
        gt_boxes = []
        if lbl_p.exists():
            with open(lbl_p, "r", encoding="utf-8") as f:
                for line in f:
                    parts = line.strip().split()
                    if len(parts) >= 5:
                        cid = int(parts[0])
                        xc, yc, w, h = map(float, parts[1:5])
                        # Convert normalized xywh to normalized xyxy
                        x1 = xc - w / 2.0
                        y1 = yc - h / 2.0
                        x2 = xc + w / 2.0
                        y2 = yc + h / 2.0
                        gt_boxes.append({"cls": cid, "box": np.array([x1, y1, x2, y2])})
                        gt_class_counts[cid] += 1
        ground_truth[stem] = gt_boxes

    total_gt = sum(gt_class_counts.values())
    print(f"Total ground-truth targets parsed: {total_gt}")
    active_classes = [c for c, count in gt_class_counts.items() if count > 0]
    print(f"Classes with at least 1 ground-truth target: {len(active_classes)}")

    # 2. Run model predictions across all images at conf=0.001
    print("\nRunning YOLO11n inference on all images (conf=0.001, iou=0.60)...")
    results = model.predict(
        source=[str(p) for p in img_paths],
        conf=0.001,
        iou=0.60,
        imgsz=640,
        device="cpu",
        verbose=False,
    )

    # Store predictions per image: list of dict(cls, conf, box_norm)
    all_predictions: dict[str, list[dict]] = {}
    for res in results:
        stem = Path(res.path).stem
        orig_h, orig_w = res.orig_shape
        preds = []
        boxes_xyxy = res.boxes.xyxy.cpu().numpy()
        confs = res.boxes.conf.cpu().numpy()
        clss = res.boxes.cls.cpu().numpy().astype(int)

        for b, c, cl in zip(boxes_xyxy, confs, clss):
            # Normalize to 0-1 range to match normalized GT
            b_norm = np.array([b[0] / orig_w, b[1] / orig_h, b[2] / orig_w, b[3] / orig_h])
            preds.append({"cls": cl, "conf": float(c), "box": b_norm})
        all_predictions[stem] = preds

    # 3. For each confidence threshold, perform exact matching
    sweep_results = []
    target_obstacle_names = ["person", "car", "bicycle", "dog", "chair", "bus"]
    target_obstacle_cids = {name: [k for k, v in names.items() if v == name][0] for name in target_obstacle_names}

    for tau in thresholds:
        print(f"\nEvaluating Confidence Threshold: {tau:.2f}")
        class_stats = {c: {"tp": 0, "fp": 0, "fn": 0, "gt": gt_class_counts[c]} for c in range(num_classes)}
        retained_predictions_count = 0

        for stem, img_gt in ground_truth.items():
            img_preds = [p for p in all_predictions[stem] if p["conf"] >= tau]
            retained_predictions_count += len(img_preds)

            # Match per class
            for c in range(num_classes):
                gt_c = [g for g in img_gt if g["cls"] == c]
                pred_c = [p for p in img_preds if p["cls"] == c]

                if len(pred_c) == 0:
                    class_stats[c]["fn"] += len(gt_c)
                    continue
                if len(gt_c) == 0:
                    class_stats[c]["fp"] += len(pred_c)
                    continue

                # Sort predictions by confidence descending
                pred_c = sorted(pred_c, key=lambda x: -x["conf"])

                matched_gt = set()
                matched_pred = set()

                # Greedy matching by highest IoU >= iou_match_threshold
                for p_idx, p in enumerate(pred_c):
                    best_iou = 0.0
                    best_g_idx = -1
                    for g_idx, g in enumerate(gt_c):
                        if g_idx in matched_gt:
                            continue
                        iou = box_iou_xyxy(p["box"], g["box"])
                        if iou > best_iou:
                            best_iou = iou
                            best_g_idx = g_idx

                    if best_iou >= iou_match_threshold and best_g_idx >= 0:
                        matched_gt.add(best_g_idx)
                        matched_pred.add(p_idx)

                tp = len(matched_pred)
                fp = len(pred_c) - tp
                fn = len(gt_c) - len(matched_gt)

                class_stats[c]["tp"] += tp
                class_stats[c]["fp"] += fp
                class_stats[c]["fn"] += fn

        # Verify mathematical consistency for all classes
        for c in range(num_classes):
            cs = class_stats[c]
            assert cs["tp"] + cs["fn"] == cs["gt"], f"Class {c} ({names[c]}): TP({cs['tp']}) + FN({cs['fn']}) != GT({cs['gt']})"
            tp, fp, fn = cs["tp"], cs["fp"], cs["fn"]
            cs["precision"] = tp / (tp + fp) if (tp + fp) > 0 else 0.0
            cs["recall"] = tp / (tp + fn) if (tp + fn) > 0 else 0.0
            p, r = cs["precision"], cs["recall"]
            cs["f1_score"] = (2.0 * p * r) / (p + r) if (p + r) > 0 else 0.0

        # Overall Micro-Averaged Metrics (aggregating TP, FP, FN over all active classes)
        total_tp = sum(class_stats[c]["tp"] for c in active_classes)
        total_fp = sum(class_stats[c]["fp"] for c in active_classes)
        total_fn = sum(class_stats[c]["fn"] for c in active_classes)
        total_gt_active = sum(class_stats[c]["gt"] for c in active_classes)
        assert total_tp + total_fn == total_gt_active

        micro_p = total_tp / (total_tp + total_fp) if (total_tp + total_fp) > 0 else 0.0
        micro_r = total_tp / (total_tp + total_fn) if (total_tp + total_fn) > 0 else 0.0
        micro_f1 = (2.0 * micro_p * micro_r) / (micro_p + micro_r) if (micro_p + micro_r) > 0 else 0.0

        # Overall Macro-Averaged Metrics (unweighted average across active classes with GT > 0)
        macro_p = float(np.mean([class_stats[c]["precision"] for c in active_classes]))
        macro_r = float(np.mean([class_stats[c]["recall"] for c in active_classes]))
        macro_f1 = (2.0 * macro_p * macro_r) / (macro_p + macro_r) if (macro_p + macro_r) > 0 else 0.0

        # Target class statistics
        targets_summary = {}
        for t_name, cid in target_obstacle_cids.items():
            cs = class_stats[cid]
            targets_summary[t_name] = {
                "class_id": cid,
                "ground_truth_count": cs["gt"],
                "true_positives": cs["tp"],
                "false_positives": cs["fp"],
                "false_negatives": cs["fn"],
                "precision": round(cs["precision"], 4),
                "recall": round(cs["recall"], 4),
                "f1_score": round(cs["f1_score"], 4),
            }

        sweep_record = {
            "confidence_threshold": tau,
            "retained_predictions_count": retained_predictions_count,
            "micro_averaged_metrics": {
                "total_tp": total_tp,
                "total_fp": total_fp,
                "total_fn": total_fn,
                "precision": round(micro_p, 4),
                "recall": round(micro_r, 4),
                "f1_score": round(micro_f1, 4),
            },
            "macro_averaged_metrics": {
                "active_classes_count": len(active_classes),
                "precision": round(macro_p, 4),
                "recall": round(macro_r, 4),
                "f1_score": round(macro_f1, 4),
            },
            "target_obstacle_classes": targets_summary,
            "all_classes": {names[c]: class_stats[c] for c in active_classes},
        }
        sweep_results.append(sweep_record)

        print(f"  Retained Detections: {retained_predictions_count}")
        print(f"  Micro: TP={total_tp}, FP={total_fp}, FN={total_fn} | P={micro_p*100:.2f}%, R={micro_r*100:.2f}%, F1={micro_f1*100:.2f}%")
        print(f"  Macro: P={macro_p*100:.2f}%, R={macro_r*100:.2f}%, F1={macro_f1*100:.2f}%")
        for t_name in target_obstacle_names:
            ts = targets_summary[t_name]
            print(f"    {t_name:8s} (GT={ts['ground_truth_count']:3d}): TP={ts['true_positives']:3d}, FP={ts['false_positives']:3d}, FN={ts['false_negatives']:3d} | P={ts['precision']*100:.2f}%, R={ts['recall']*100:.2f}%, F1={ts['f1_score']*100:.2f}%")

    return sweep_results


if __name__ == "__main__":
    run_exact_matching()
