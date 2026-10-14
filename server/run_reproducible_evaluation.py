"""Unified Reproducible Evaluation Pipeline for NetraSense YOLO11n.

This script executes:
1. Official Ultralytics validation (conf=0.001, iou=0.60) saving exact metrics.results_dict and box metrics.
2. Custom discrete operating-threshold evaluation across thresholds [0.10, 0.25, 0.45, 0.60] (IoU match=0.50).
3. Complete provenance collection (weights SHA-256, environment, dataset paths).
4. Direct serialization of JSON, CSV, and TXT artifacts from the single in-memory evaluation results object.

Macro F1 Definition:
- Macro Precision = arithmetic mean of per-class precision across active classes.
- Macro Recall = arithmetic mean of per-class recall across active classes.
- Macro F1 = arithmetic mean of per-class F1 across active classes.
- Harmonic F1 of Macro P & R is reported separately under 'harmonic_f1_of_macro_p_r'.
"""

from __future__ import annotations

import csv
import hashlib
import json
import platform
import sys
from pathlib import Path
from typing import Any, Dict, List

import numpy as np
import torch
import ultralytics
from ultralytics import YOLO

try:
    from eval_matching import box_iou_xyxy, compute_metrics_from_counts, match_predictions_to_ground_truth
except ImportError:
    from server.eval_matching import box_iou_xyxy, compute_metrics_from_counts, match_predictions_to_ground_truth


def compute_sha256(filepath: Path | str) -> str:
    """Compute SHA-256 hash of a file."""
    h = hashlib.sha256()
    with open(filepath, "rb") as f:
        while chunk := f.read(8192):
            h.update(chunk)
    return h.hexdigest()


def run_full_pipeline(
    weights_path: str = "yolo11n.pt",
    data_yaml: str = "coco128.yaml",
    imgsz: int = 640,
    nms_iou: float = 0.60,
    matching_iou: float = 0.50,
    thresholds: list[float] = [0.10, 0.25, 0.45, 0.60],
    output_dir: str = "evaluation_results/confidence_sweep",
) -> Dict[str, Any]:
    print("=" * 80)
    print("  NETRASENSE REPRODUCIBLE EVALUATION PIPELINE")
    print("=" * 80)

    weights_file = Path(weights_path)
    if not weights_file.exists():
        # Check in current working directory or server/
        if (Path("server") / weights_path).exists():
            weights_file = Path("server") / weights_path
        else:
            raise FileNotFoundError(f"Model weights file not found: {weights_file}")

    weights_sha256 = compute_sha256(weights_file)
    print(f"Model Weights  : {weights_file.resolve()} (SHA-256: {weights_sha256})")
    print(f"Dataset YAML   : {data_yaml}")
    print(f"Image Size     : {imgsz}x{imgsz}")
    print(f"NMS IoU        : {nms_iou}")
    print(f"Matching IoU   : {matching_iou}")
    print(f"Thresholds     : {thresholds}")

    # Ensure output directory
    out_path = Path(output_dir)
    out_path.mkdir(parents=True, exist_ok=True)

    # 1. Official Ultralytics Validation (Standard PR-Curve Integration)
    print("\n[Step 1/3] Running official Ultralytics validator (conf=0.001)...")
    model = YOLO(str(weights_file))
    val_results = model.val(
        data=data_yaml,
        imgsz=imgsz,
        conf=0.001,
        iou=nms_iou,
        device="cpu",
        split="val",
        verbose=False,
        plots=False,
    )

    official_results_dict = {k: float(v) for k, v in val_results.results_dict.items()}
    names = model.names
    num_classes = len(names)

    # Extract per-class official PR curve metrics
    box_metrics = val_results.box
    ap_class_idx = list(box_metrics.ap_class_index)
    official_per_class: Dict[str, Dict[str, Any]] = {}
    for cid, name in names.items():
        if cid in ap_class_idx:
            idx = ap_class_idx.index(cid)
            p = float(box_metrics.p[idx])
            r = float(box_metrics.r[idx])
            f1 = float(box_metrics.f1[idx])
            ap50 = float(box_metrics.ap50[idx])
            ap = float(box_metrics.ap[idx])
            official_per_class[name] = {
                "class_id": cid,
                "precision": round(p, 4),
                "recall": round(r, 4),
                "f1_score": round(f1, 4),
                "mAP50": round(ap50, 4),
                "mAP50_95": round(ap, 4),
            }

    p_macro_val = official_results_dict.get("metrics/precision(B)", 0.0)
    r_macro_val = official_results_dict.get("metrics/recall(B)", 0.0)
    harmonic_f1_macro = (2 * p_macro_val * r_macro_val) / (p_macro_val + r_macro_val) if (p_macro_val + r_macro_val) > 0 else 0.0
    arithmetic_macro_f1 = float(np.mean(box_metrics.f1)) if len(box_metrics.f1) > 0 else 0.0

    official_provenance = {
        "framework": "Ultralytics YOLO",
        "ultralytics_version": ultralytics.__version__,
        "torch_version": torch.__version__,
        "python_version": sys.version,
        "platform": platform.platform(),
        "weights_path": str(weights_file.resolve()),
        "weights_sha256": weights_sha256,
        "dataset_yaml": data_yaml,
        "dataset_split": "val",
        "image_size": imgsz,
        "conf_cutoff": 0.001,
        "nms_iou": nms_iou,
        "device": "cpu",
        "raw_results_dict": official_results_dict,
        "macro_metrics": {
            "precision": round(p_macro_val, 4),
            "recall": round(r_macro_val, 4),
            "macro_f1_arithmetic": round(arithmetic_macro_f1, 4),
            "harmonic_f1_of_macro_p_r": round(harmonic_f1_macro, 4),
            "mAP50": round(official_results_dict.get("metrics/mAP50(B)", 0.0), 4),
            "mAP50_95": round(official_results_dict.get("metrics/mAP50-95(B)", 0.0), 4),
        },
        "target_obstacle_classes": {
            k: v for k, v in official_per_class.items() if k in ["person", "car", "bicycle", "dog", "chair", "bus"]
        },
    }

    # 2. Parse Ground-Truth Annotations
    print("\n[Step 2/3] Parsing ground-truth annotations and generating raw predictions...")
    from ultralytics.data.utils import check_det_dataset
    data_info = check_det_dataset(data_yaml)
    img_dir = Path(data_info["val"])
    label_dir = img_dir.parent.parent / "labels" / img_dir.name

    img_paths = sorted(list(img_dir.glob("*.jpg")))
    print(f"Found {len(img_paths)} validation images in {img_dir}")
    print(f"Reading labels from {label_dir}")

    ground_truth: Dict[str, List[Dict[str, Any]]] = {}
    gt_class_counts = {c: 0 for c in range(num_classes)}

    for img_p in img_paths:
        stem = img_p.stem
        lbl_p = label_dir / f"{stem}.txt"
        boxes = []
        if lbl_p.exists():
            with open(lbl_p, "r", encoding="utf-8") as f:
                for line in f:
                    parts = line.strip().split()
                    if len(parts) >= 5:
                        cid = int(parts[0])
                        xc, yc, w, h = map(float, parts[1:5])
                        x1 = xc - w / 2.0
                        y1 = yc - h / 2.0
                        x2 = xc + w / 2.0
                        y2 = yc + h / 2.0
                        boxes.append({"cls": cid, "box": np.array([x1, y1, x2, y2])})
                        gt_class_counts[cid] += 1
        ground_truth[stem] = boxes

    total_gt = sum(gt_class_counts.values())
    active_classes = [c for c, count in gt_class_counts.items() if count > 0]
    print(f"Parsed {total_gt} total ground-truth instances across {len(active_classes)} active classes.")

    # Generate predictions using conf=0.001 to retain full proposal pool
    raw_predictions = model.predict(
        source=[str(p) for p in img_paths],
        conf=0.001,
        iou=nms_iou,
        imgsz=imgsz,
        device="cpu",
        verbose=False,
    )

    all_preds_by_img: Dict[str, List[Dict[str, Any]]] = {}
    for res in raw_predictions:
        stem = Path(res.path).stem
        orig_h, orig_w = res.orig_shape
        boxes_xyxy = res.boxes.xyxy.cpu().numpy()
        confs = res.boxes.conf.cpu().numpy()
        clss = res.boxes.cls.cpu().numpy().astype(int)
        img_preds = []
        for b, c, cl in zip(boxes_xyxy, confs, clss):
            b_norm = np.array([b[0] / orig_w, b[1] / orig_h, b[2] / orig_w, b[3] / orig_h])
            img_preds.append({"cls": cl, "conf": float(c), "box": b_norm})
        all_preds_by_img[stem] = img_preds

    # 3. Custom Operating-Threshold Matching
    print("\n[Step 3/3] Executing exact greedy matching across confidence thresholds...")
    target_obstacle_names = ["person", "car", "bicycle", "dog", "chair", "bus"]
    target_obstacle_cids = {name: [k for k, v in names.items() if v == name][0] for name in target_obstacle_names}

    sweep_records = []
    prev_retained = float("inf")

    for tau in thresholds:
        class_stats = {c: {"tp": 0, "fp": 0, "fn": 0, "gt": gt_class_counts[c]} for c in range(num_classes)}
        retained_preds_count = 0

        for stem, img_gt in ground_truth.items():
            img_preds = [p for p in all_preds_by_img[stem] if p["conf"] >= tau]
            retained_preds_count += len(img_preds)

            for c in range(num_classes):
                gt_c = [g for g in img_gt if g["cls"] == c]
                pred_c = [p for p in img_preds if p["cls"] == c]

                # Call reusable production matching function
                tp, fp, fn, _, _ = match_predictions_to_ground_truth(
                    predictions=pred_c,
                    ground_truth=gt_c,
                    matching_iou=matching_iou,
                )
                class_stats[c]["tp"] += tp
                class_stats[c]["fp"] += fp
                class_stats[c]["fn"] += fn

        # Verify monotonicity of retained detections
        assert retained_preds_count <= prev_retained, (
            f"Monotonicity error: retained predictions increased from {prev_retained} to {retained_preds_count} at conf {tau}"
        )
        prev_retained = retained_preds_count

        # Compute unrounded per-class metrics
        for c in range(num_classes):
            cs = class_stats[c]
            assert cs["tp"] + cs["fn"] == cs["gt"], f"Integrity error: TP + FN != GT for class {names[c]}"
            tp, fp, fn = cs["tp"], cs["fp"], cs["fn"]
            cs["precision"], cs["recall"], cs["f1_score"] = compute_metrics_from_counts(tp, fp, fn)

        total_tp = sum(class_stats[c]["tp"] for c in range(num_classes))
        total_fp = sum(class_stats[c]["fp"] for c in range(num_classes))
        total_fn = sum(class_stats[c]["fn"] for c in range(num_classes))

        # Check total predictions == TP + FP
        assert retained_preds_count == total_tp + total_fp, (
            f"Integrity error: retained predictions ({retained_preds_count}) != TP ({total_tp}) + FP ({total_fp})"
        )
        assert total_tp + total_fn == total_gt, f"Integrity error: Total TP + FN != Total GT ({total_gt})"

        # Micro-averaged metrics (calculated from pooled totals before rounding)
        micro_p, micro_r, micro_f1 = compute_metrics_from_counts(total_tp, total_fp, total_fn)

        # Macro-averaged metrics (unweighted arithmetic means across active classes with GT > 0)
        macro_p = float(np.mean([class_stats[c]["precision"] for c in active_classes]))
        macro_r = float(np.mean([class_stats[c]["recall"] for c in active_classes]))
        macro_f1 = float(np.mean([class_stats[c]["f1_score"] for c in active_classes]))
        harmonic_macro_f1 = (2.0 * macro_p * macro_r) / (macro_p + macro_r) if (macro_p + macro_r) > 0 else 0.0

        target_summary = {}
        for t_name, cid in target_obstacle_cids.items():
            cs = class_stats[cid]
            target_summary[t_name] = {
                "class_id": cid,
                "ground_truth_count": cs["gt"],
                "true_positives": cs["tp"],
                "false_positives": cs["fp"],
                "false_negatives": cs["fn"],
                "precision": round(cs["precision"], 4),
                "recall": round(cs["recall"], 4),
                "f1_score": round(cs["f1_score"], 4),
            }

        sweep_records.append({
            "confidence_threshold": tau,
            "retained_predictions_count": retained_preds_count,
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
                "macro_f1": round(macro_f1, 4),
                "harmonic_f1_of_macro_p_r": round(harmonic_macro_f1, 4),
            },
            "target_obstacle_classes": target_summary,
            "all_classes": {
                names[c]: {
                    "tp": class_stats[c]["tp"],
                    "fp": class_stats[c]["fp"],
                    "fn": class_stats[c]["fn"],
                    "gt": class_stats[c]["gt"],
                    "precision": round(class_stats[c]["precision"], 4),
                    "recall": round(class_stats[c]["recall"], 4),
                    "f1_score": round(class_stats[c]["f1_score"], 4),
                }
                for c in active_classes
            },
        })

    # Build Complete Unified Report
    full_report = {
        "report_title": "NetraSense YOLO11n Independent Reproducibility Audit & Evaluation Report",
        "evaluation_provenance": official_provenance,
        "dataset_metadata": {
            "name": "COCO-128",
            "path": str(img_dir),
            "license": "Creative Commons Attribution 4.0 International (CC BY 4.0)",
            "images_count": len(img_paths),
            "total_ground_truth_targets": total_gt,
            "active_classes_count": len(active_classes),
            "benchmark_classification": "Diagnostic sanity check (not independent field validation)",
        },
        "matching_algorithm_specification": {
            "prediction_ordering": "Descending confidence order per image and class",
            "iou_matching_rule": f"Greedy one-to-one assignment to candidate with highest IoU >= {matching_iou}",
            "duplicate_handling": "Secondary candidate predictions matching already-assigned ground truth are labeled FP",
            "class_matching_rule": "Strict class equality (cross-class proposals zeroed)",
        },
        "baseline_ultralytics_evaluation": {
            "description": "Standard Ultralytics validation integrating the full continuous PR curve (conf=0.001)",
            "macro_metrics": official_provenance["macro_metrics"],
            "target_classes": official_provenance["target_obstacle_classes"],
        },
        "custom_fixed_threshold_sweep": sweep_records,
        "metric_definitions": {
            "precision": "TP / (TP + FP) [0.0 if TP + FP == 0]",
            "recall": "TP / (TP + FN) [0.0 if TP + FN == 0; note TP + FN == GT]",
            "per_class_f1": "2 * P * R / (P + R) [0.0 if P + R == 0]",
            "micro_f1": "Calculated directly from pooled counts: 2 * Micro_P * Micro_R / (Micro_P + Micro_R)",
            "macro_precision": "Arithmetic mean of per-class precision across active classes",
            "macro_recall": "Arithmetic mean of per-class recall across active classes",
            "macro_f1": "Arithmetic mean of per-class F1 across active classes",
            "harmonic_f1_of_macro_p_r": "Harmonic mean of Macro_Precision and Macro_Recall: 2 * Macro_P * Macro_R / (Macro_P + Macro_R)",
        },
        "methodological_comparison_note": (
            "Custom operating-threshold metrics measure discrete TP/FP/FN after post-NMS confidence filtering at fixed tau. "
            "In contrast, Ultralytics precision and recall are picked from the peak F1 of an interpolated continuous curve. "
            "Furthermore, thresholded mAP represents a right-truncated PR curve and is not directly comparable to baseline mAP."
        ),
        "unresolved_limitations": [
            "COCO-128 is a small 128-image diagnostic dataset with low target counts for bicycle (6) and bus (7).",
            "Offline still image testing does not capture first-person wearable camera motion, vibration, or blur.",
            "Results do not demonstrate physical sensor fusion, real-world obstacle avoidance reliability, or navigation safety.",
        ],
    }

    # Save JSON Report
    json_path = out_path / "validated_evaluation_report.json"
    with open(json_path, "w", encoding="utf-8") as f:
        json.dump(full_report, f, indent=2)
    print(f"\n[SAVED] JSON: {json_path}")

    # Save CSV Report
    csv_path = out_path / "validated_confidence_threshold_comparison.csv"
    target_classes = ["person", "car", "bicycle", "dog", "chair", "bus"]
    with open(csv_path, "w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        header = [
            "Confidence_Threshold",
            "Retained_Detections",
            "Micro_TP",
            "Micro_FP",
            "Micro_FN",
            "Micro_Precision",
            "Micro_Recall",
            "Micro_F1",
            "Macro_Precision",
            "Macro_Recall",
            "Macro_F1",
            "Harmonic_F1_of_Macro_P_R",
        ]
        for cls in target_classes:
            header.extend([
                f"{cls.capitalize()}_GT",
                f"{cls.capitalize()}_TP",
                f"{cls.capitalize()}_FP",
                f"{cls.capitalize()}_FN",
                f"{cls.capitalize()}_Precision",
                f"{cls.capitalize()}_Recall",
                f"{cls.capitalize()}_F1",
            ])
        writer.writerow(header)

        for r in sweep_records:
            t = r["confidence_threshold"]
            n_det = r["retained_predictions_count"]
            mi = r["micro_averaged_metrics"]
            ma = r["macro_averaged_metrics"]
            row = [
                t,
                n_det,
                mi["total_tp"],
                mi["total_fp"],
                mi["total_fn"],
                mi["precision"],
                mi["recall"],
                mi["f1_score"],
                ma["precision"],
                ma["recall"],
                ma["macro_f1"],
                ma["harmonic_f1_of_macro_p_r"],
            ]
            tgts = r["target_obstacle_classes"]
            for cls in target_classes:
                c_data = tgts[cls]
                row.extend([
                    c_data["ground_truth_count"],
                    c_data["true_positives"],
                    c_data["false_positives"],
                    c_data["false_negatives"],
                    c_data["precision"],
                    c_data["recall"],
                    c_data["f1_score"],
                ])
            writer.writerow(row)
    print(f"[SAVED] CSV: {csv_path}")

    # Save TXT Audit Report
    txt_path = out_path / "evaluation_protocol_audit.txt"
    txt_content = f"""====================================================================================================
NETRASENSE YOLO11n INDEPENDENT REPRODUCIBILITY AUDIT REPORT
====================================================================================================

1. PROVENANCE & ENVIRONMENT
----------------------------------------------------------------------------------------------------
Model Weights Path   : {official_provenance['weights_path']}
Model Weights SHA-256: {official_provenance['weights_sha256']}
Dataset YAML / Split : {data_yaml} / val ({img_dir})
Total Images         : {len(img_paths)}
Total Ground Truth   : {total_gt} targets across {len(active_classes)} active classes (out of {num_classes} total)
Benchmark Category   : Diagnostic verification benchmark (COCO-128, CC BY 4.0)
Ultralytics Version  : {official_provenance['ultralytics_version']}
PyTorch Version      : {official_provenance['torch_version']}
Python Version       : {official_provenance['python_version'].split()[0]}
Host Platform        : {official_provenance['platform']}

2. BASELINE OFFICIAL ULTRALYTICS VALIDATION (Standard Full PR-Curve Integration, conf=0.001)
----------------------------------------------------------------------------------------------------
Baseline mAP@50             : {official_provenance['macro_metrics']['mAP50']*100:.2f}%
Baseline mAP@50-95          : {official_provenance['macro_metrics']['mAP50_95']*100:.2f}%
Macro Precision             : {official_provenance['macro_metrics']['precision']*100:.2f}%
Macro Recall                : {official_provenance['macro_metrics']['recall']*100:.2f}%
Macro F1 (Arithmetic Mean)  : {official_provenance['macro_metrics']['macro_f1_arithmetic']*100:.2f}%
Harmonic F1 (of Macro P & R): {official_provenance['macro_metrics']['harmonic_f1_of_macro_p_r']*100:.2f}%

Raw results_dict:
{json.dumps(official_results_dict, indent=2)}

3. EXACT OPERATING-THRESHOLD SWEEP (Discrete Matching at IoU >= 0.50)
----------------------------------------------------------------------------------------------------
Matching Specification:
- Proposals filtered strictly at conf >= tau.
- Predictions sorted in descending confidence order per image and class.
- One-to-one greedy assignment to candidate with highest IoU >= {matching_iou}.
- Overlapping duplicate detections mapped to same target are marked FP.
- Classes matched strictly by exact ID (no cross-class assignments).

Overall Sweep Results:
Conf | Retained Detections | Micro-P | Micro-R | Micro-F1 | Macro-P | Macro-R | Macro-F1 | Harmonic F1 (Macro)
----------------------------------------------------------------------------------------------------------------
"""
    for r in sweep_records:
        mi = r["micro_averaged_metrics"]
        ma = r["macro_averaged_metrics"]
        txt_content += (
            f"{r['confidence_threshold']:<4.2f} | {r['retained_predictions_count']:<19d} | "
            f"{mi['precision']*100:<6.2f}% | {mi['recall']*100:<6.2f}% | {mi['f1_score']*100:<7.2f}% | "
            f"{ma['precision']*100:<6.2f}% | {ma['recall']*100:<6.2f}% | {ma['macro_f1']*100:<7.2f}% | "
            f"{ma['harmonic_f1_of_macro_p_r']*100:<6.2f}%\n"
        )

    txt_content += """----------------------------------------------------------------------------------------------------------------

TARGET OBSTACLE CLASSES (TP, FP, FN COUNTS & FORMULA VERIFICATION):
----------------------------------------------------------------------------------------------------
Class   | Conf | GT  | TP  | FP  | FN  | Precision | Recall  | F1-Score | Conservation (TP+FN==GT)
----------------------------------------------------------------------------------------------------
"""
    for cls in target_classes:
        for r in sweep_records:
            c_data = r["target_obstacle_classes"][cls]
            tau = r["confidence_threshold"]
            gt = c_data["ground_truth_count"]
            tp = c_data["true_positives"]
            fp = c_data["false_positives"]
            fn = c_data["false_negatives"]
            p = c_data["precision"]
            r_val = c_data["recall"]
            f1 = c_data["f1_score"]
            txt_content += (
                f"{cls:<7s} | {tau:<4.2f} | {gt:<3d} | {tp:<3d} | {fp:<3d} | {fn:<3d} | "
                f"{p*100:<8.2f}% | {r_val*100:<6.2f}% | {f1*100:<7.2f}% | {tp} + {fn} == {gt} (OK)\n"
            )
        txt_content += "----------------------------------------------------------------------------------------------------\n"

    txt_content += """
4. METHODOLOGICAL COMPARISON: CUSTOM EVALUATOR VS. ULTRALYTICS
----------------------------------------------------------------------------------------------------
1. Custom evaluator computes discrete operational metrics directly from raw predictions retained
   at a specific confidence threshold (conf >= tau) with greedy 1-to-1 matching at IoU >= 0.50.
2. Ultralytics validator evaluates a continuous PR curve across all possible confidence thresholds
   using cumulative 10-level IoU matching, reporting precision and recall at the peak F1 operating point.
3. Macro F1 is computed as the arithmetic mean of per-class F1 scores. The harmonic mean of macro
   precision and macro recall is reported separately under 'harmonic_f1_of_macro_p_r'.
4. Both methods are mathematically sound for their respective purposes, but evaluate different definitions
   of operational performance. Fixed-threshold metrics should not be conflated with PR-curve peak values.

5. SCIENTIFIC & APPLICATION LIMITATIONS
----------------------------------------------------------------------------------------------------
- Diagnostic Dataset: COCO-128 is a minimal diagnostic dataset (128 images). It does not represent
  the full diversity of real-world obstacles or rare navigational hazards.
- Static Imagery: COCO-128 contains third-person stationary photos, whereas NetraSense operates from
  a body-worn sensor experiencing camera motion, vibration, and dynamic lighting.
- Safety Disclaimer: No claims of navigation safety, real-world obstacle-avoidance reliability, or
  physical sensor fusion performance are made or implied based on these software benchmark results.
====================================================================================================
"""
    with open(txt_path, "w", encoding="utf-8") as f:
        f.write(txt_content)
    print(f"[SAVED] TXT: {txt_path}")

    return full_report


if __name__ == "__main__":
    run_full_pipeline()
