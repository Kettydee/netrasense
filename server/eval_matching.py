"""Reusable production matching and metric calculation module for NetraSense object detection."""

from __future__ import annotations
from typing import Any, Dict, List, Sequence, Tuple
import numpy as np


def box_iou_xyxy(box1: Sequence[float] | np.ndarray, box2: Sequence[float] | np.ndarray) -> float:
    """Compute pairwise Intersection-over-Union (IoU) between two [x1, y1, x2, y2] bounding boxes."""
    xA = max(box1[0], box2[0])
    yA = max(box1[1], box2[1])
    xB = min(box1[2], box2[2])
    yB = min(box1[3], box2[3])

    inter = max(0.0, xB - xA) * max(0.0, yB - yA)
    area1 = max(0.0, box1[2] - box1[0]) * max(0.0, box1[3] - box1[1])
    area2 = max(0.0, box2[2] - box2[0]) * max(0.0, box2[3] - box2[1])
    union = area1 + area2 - inter
    return float(inter / union) if union > 0 else 0.0


def compute_metrics_from_counts(tp: int, fp: int, fn: int) -> Tuple[float, float, float]:
    """Calculate Precision, Recall, and F1 with explicit zero denominator handling."""
    precision = float(tp / (tp + fp)) if (tp + fp) > 0 else 0.0
    recall = float(tp / (tp + fn)) if (tp + fn) > 0 else 0.0
    f1 = float(2.0 * precision * recall / (precision + recall)) if (precision + recall) > 0 else 0.0
    return precision, recall, f1


def match_predictions_to_ground_truth(
    predictions: List[Dict[str, Any]],
    ground_truth: List[Dict[str, Any]],
    matching_iou: float = 0.50,
) -> Tuple[int, int, int, List[int], List[int]]:
    """Perform greedy one-to-one matching between predictions and ground-truth boxes.

    Rules:
    1. Input predictions are sorted descending by confidence.
    2. A prediction matches an unmatched ground-truth box if and only if:
       - They have the identical class (g['cls'] == p['cls']).
       - Their IoU >= matching_iou.
    3. If multiple unmatched ground-truth boxes qualify, the one with the maximum IoU is assigned.
    4. Once matched, a ground-truth box cannot be matched again. Subsequent overlapping
       predictions of that class become False Positives (duplicate detection handling).
    5. Predictions with no matching ground-truth box are False Positives.
    6. Ground-truth boxes left unmatched are False Negatives.

    Returns:
        (tp_count, fp_count, fn_count, matched_pred_indices, matched_gt_indices)
    """
    if len(predictions) == 0:
        return 0, 0, len(ground_truth), [], []
    if len(ground_truth) == 0:
        return 0, len(predictions), 0, [], []

    # Sort prediction indices by confidence descending
    sorted_pred_indices = sorted(range(len(predictions)), key=lambda i: -float(predictions[i].get("conf", 0.0)))

    matched_gt: set[int] = set()
    matched_preds: List[int] = []

    for p_idx in sorted_pred_indices:
        p = predictions[p_idx]
        p_cls = p["cls"]
        p_box = p["box"]

        best_iou = 0.0
        best_g_idx = -1

        for g_idx, g in enumerate(ground_truth):
            if g_idx in matched_gt or g["cls"] != p_cls:
                continue
            iou = box_iou_xyxy(p_box, g["box"])
            if iou > best_iou:
                best_iou = iou
                best_g_idx = g_idx

        if best_iou >= matching_iou and best_g_idx >= 0:
            matched_gt.add(best_g_idx)
            matched_preds.append(p_idx)

    tp = len(matched_preds)
    fp = len(predictions) - tp
    fn = len(ground_truth) - len(matched_gt)

    return tp, fp, fn, matched_preds, sorted(list(matched_gt))
