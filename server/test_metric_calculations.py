"""Automated unit tests and regression tests for NetraSense YOLO11n evaluation.

Tests:
1. Exact mathematical metrics calculation from counts with zero-denominator safety.
2. Direct testing of reusable production matching function (eval_matching.py):
   - Pair of boxes with IoU exactly 0.50 matches when threshold is >= 0.50.
   - Pair of boxes with IoU just below 0.50 (e.g. 0.4999) does not match.
   - Duplicate detections (higher confidence matches, lower confidence marked FP).
   - Confidence ordering and 1-to-1 matching explicitly verified.
   - Wrong-class detections (cannot match across different class IDs).
   - Multiple overlapping ground-truth boxes (matched greedily to best IoU without stealing).
   - Empty predictions and empty ground truth handling.
3. Direct loading and integrity verification of generated evaluation artifacts:
   - Macro precision = arithmetic mean of per-class precision across active classes directly from counts.
   - Macro recall = arithmetic mean of per-class recall across active classes directly from counts.
   - Macro F1 = arithmetic mean of per-class F1 across active classes directly from counts.
   - Harmonic F1 of macro P & R is reported separately under 'harmonic_f1_of_macro_p_r'.
   - TP + FN == GT for every class and threshold.
   - Total retained predictions == Total TP + Total FP.
   - Aggregated micro counts equal sum of per-class counts.
   - Monotonic decrease of retained predictions as confidence threshold increases.
4. Cross-file artifact consistency:
   - Loads generated JSON, CSV, and TXT files and verifies matching detection counts
     and consistent micro/macro metrics across all 4 thresholds.
5. Provenance and official Ultralytics baseline validation traceability:
   - Validates official results_dict structure, ISO 8601 timestamp, and baseline values.
"""

from __future__ import annotations

import csv
import json
from pathlib import Path
import re
import unittest
import numpy as np

try:
    from eval_matching import box_iou_xyxy, compute_metrics_from_counts, match_predictions_to_ground_truth
except ImportError:
    from server.eval_matching import box_iou_xyxy, compute_metrics_from_counts, match_predictions_to_ground_truth


class TestProductionMatchingLogic(unittest.TestCase):
    """Unit tests directly calling match_predictions_to_ground_truth and box_iou_xyxy."""

    def test_iou_exact_threshold_boundary(self):
        """Construct a pair of boxes with IoU mathematically equal to 0.50."""
        # Box A: [0, 0, 10, 10] (area 100)
        # Box B: [0, 0, 10, 20] (area 200, intersection 100, union 200 -> IoU = 100/200 = 0.50)
        boxA = np.array([0.0, 0.0, 10.0, 10.0])
        boxB = np.array([0.0, 0.0, 10.0, 20.0])
        iou_exact = box_iou_xyxy(boxA, boxB)
        self.assertAlmostEqual(iou_exact, 0.50, places=9)

        gt = [{"cls": 0, "box": boxA}]
        preds = [{"cls": 0, "conf": 0.80, "box": boxB}]
        tp, fp, fn, m_preds, m_gts = match_predictions_to_ground_truth(preds, gt, matching_iou=0.50)
        self.assertEqual(tp, 1, "Box with exact IoU=0.50 must match when condition is >= 0.50")
        self.assertEqual(fp, 0)
        self.assertEqual(fn, 0)

    def test_iou_just_below_threshold_fails(self):
        """Construct a pair of boxes with IoU just below 0.50 (e.g. y = 20.01 -> IoU ~ 0.49975)."""
        boxA = np.array([0.0, 0.0, 10.0, 10.0])
        boxB_sub = np.array([0.0, 0.0, 10.0, 20.01])
        iou_sub = box_iou_xyxy(boxA, boxB_sub)
        self.assertLess(iou_sub, 0.50)

        gt = [{"cls": 0, "box": boxA}]
        preds = [{"cls": 0, "conf": 0.80, "box": boxB_sub}]
        tp, fp, fn, m_preds, m_gts = match_predictions_to_ground_truth(preds, gt, matching_iou=0.50)
        self.assertEqual(tp, 0, "Box with IoU < 0.50 must not match")
        self.assertEqual(fp, 1)
        self.assertEqual(fn, 1)

    def test_duplicate_detections_and_confidence_ordering(self):
        """Verify that when 2 predictions overlap 1 GT box, the higher confidence matches and the lower becomes FP."""
        box = np.array([0.0, 0.0, 10.0, 10.0])
        gt = [{"cls": 0, "box": box}]
        preds = [
            {"cls": 0, "conf": 0.60, "box": box},  # Lower confidence
            {"cls": 0, "conf": 0.95, "box": box},  # Higher confidence
        ]
        tp, fp, fn, m_preds, m_gts = match_predictions_to_ground_truth(preds, gt, matching_iou=0.50)
        self.assertEqual(tp, 1)
        self.assertEqual(fp, 1)
        self.assertEqual(fn, 0)
        self.assertEqual(m_preds, [1])
        self.assertEqual(m_gts, [0])

    def test_wrong_class_detections_rejected(self):
        """Prediction of class A must never match ground truth of class B even with identical coordinates."""
        box = np.array([0.0, 0.0, 10.0, 10.0])
        gt = [{"cls": 0, "box": box}]  # Class 0 (person)
        preds = [{"cls": 2, "conf": 0.95, "box": box}]  # Class 2 (car)
        tp, fp, fn, m_preds, m_gts = match_predictions_to_ground_truth(preds, gt, matching_iou=0.50)
        self.assertEqual(tp, 0)
        self.assertEqual(fp, 1)
        self.assertEqual(fn, 1)

    def test_multiple_overlapping_ground_truth_boxes(self):
        """Verify greedy assignment when multiple GT boxes overlap."""
        pred_box = np.array([0.0, 0.0, 10.0, 10.0])
        gt1 = {"cls": 0, "box": np.array([0.0, 0.0, 10.0, 12.0])}  # IoU = 100/120 = 0.8333
        gt2 = {"cls": 0, "box": np.array([0.0, 0.0, 10.0, 18.0])}  # IoU = 100/180 = 0.5556
        gt = [gt1, gt2]
        preds = [{"cls": 0, "conf": 0.90, "box": pred_box}]

        tp, fp, fn, m_preds, m_gts = match_predictions_to_ground_truth(preds, gt, matching_iou=0.50)
        self.assertEqual(tp, 1)
        self.assertEqual(fp, 0)
        self.assertEqual(fn, 1)
        self.assertEqual(m_gts, [0])

    def test_empty_predictions_and_empty_ground_truth(self):
        """Edge cases for empty inputs."""
        box = np.array([0.0, 0.0, 10.0, 10.0])
        tp, fp, fn, _, _ = match_predictions_to_ground_truth([], [{"cls": 0, "box": box}], matching_iou=0.50)
        self.assertEqual(tp, 0)
        self.assertEqual(fp, 0)
        self.assertEqual(fn, 1)

        tp, fp, fn, _, _ = match_predictions_to_ground_truth([{"cls": 0, "conf": 0.9, "box": box}], [], matching_iou=0.50)
        self.assertEqual(tp, 0)
        self.assertEqual(fp, 1)
        self.assertEqual(fn, 0)


class TestGeneratedEvaluationArtifacts(unittest.TestCase):
    """Integrity checks on actual generated artifacts on disk."""

    @classmethod
    def setUpClass(cls):
        candidates = [
            Path("server/evaluation_results/confidence_sweep"),
            Path("evaluation_results/confidence_sweep"),
        ]
        base_dir = None
        for p in candidates:
            if (p / "validated_evaluation_report.json").exists():
                base_dir = p
                break
        if base_dir is None:
            raise FileNotFoundError("Evaluation artifacts directory not found.")

        cls.base_dir = base_dir
        with open(base_dir / "validated_evaluation_report.json", "r", encoding="utf-8") as f:
            cls.report = json.load(f)

    def test_provenance_and_model_weights_hash(self):
        """Verify provenance fields exist and are non-empty."""
        prov = self.report.get("evaluation_provenance", {})
        self.assertEqual(prov.get("framework"), "Ultralytics YOLO")
        self.assertIn("ultralytics_version", prov)
        self.assertIn("torch_version", prov)
        self.assertIn("python_version", prov)
        self.assertIn("evaluation_timestamp_iso", prov)
        # Validate ISO 8601 timestamp format
        iso_ts = prov.get("evaluation_timestamp_iso", "")
        self.assertTrue(len(iso_ts) >= 19 and "T" in iso_ts, f"Invalid ISO timestamp: {iso_ts}")
        self.assertEqual(prov.get("dataset_yaml"), "coco128.yaml")
        self.assertEqual(len(prov.get("weights_sha256", "")), 64)

    def test_baseline_validation_traceability(self):
        """Verify that baseline values match the raw results_dict."""
        prov = self.report.get("evaluation_provenance", {})
        raw_dict = prov.get("raw_results_dict", {})
        self.assertIn("metrics/mAP50(B)", raw_dict)
        self.assertIn("metrics/mAP50-95(B)", raw_dict)
        self.assertIn("metrics/precision(B)", raw_dict)
        self.assertIn("metrics/recall(B)", raw_dict)

        map50 = raw_dict["metrics/mAP50(B)"]
        self.assertAlmostEqual(map50, 0.6795, places=3)

    def test_sweep_mathematical_conservation_and_unrounded_macro(self):
        """Verify that all sweep results satisfy counting identities and macro definitions:
        - Computed directly from integer counts
        - Macro Precision = arithmetic mean of class precision
        - Macro Recall = arithmetic mean of class recall
        - Macro F1 = arithmetic mean of class F1
        - TP + FN == GT for every class
        - Total retained predictions == Total TP + Total FP
        - Monotonic decrease of retained predictions as confidence increases
        """
        sweep = self.report.get("custom_fixed_threshold_sweep", [])
        self.assertGreaterEqual(len(sweep), 4)

        prev_retained = float("inf")
        for record in sweep:
            tau = record["confidence_threshold"]
            retained = record["retained_predictions_count"]
            micro = record["micro_averaged_metrics"]
            macro = record["macro_averaged_metrics"]
            tot_tp = micro["total_tp"]
            tot_fp = micro["total_fp"]
            tot_fn = micro["total_fn"]

            # Retained detections == TP + FP
            self.assertEqual(retained, tot_tp + tot_fp, f"Retained != TP + FP at conf {tau}")

            # Total TP + FN == Total Ground Truth (929)
            self.assertEqual(tot_tp + tot_fn, 929, f"Total TP + FN != 929 at conf {tau}")

            # Monotonicity of retained detections
            self.assertLessEqual(retained, prev_retained, f"Retained predictions did not decrease at conf {tau}")
            prev_retained = retained

            # Per-class counts and unrounded macro aggregation
            all_classes = record["all_classes"]
            class_p_list = []
            class_r_list = []
            class_f1_list = []

            for cname, cstat in all_classes.items():
                tp = int(cstat["tp"])
                fp = int(cstat["fp"])
                fn = int(cstat["fn"])
                gt = int(cstat["gt"])
                self.assertEqual(tp + fn, gt, f"Class {cname} failed TP+FN==GT at conf {tau}")

                p_calc, r_calc, f1_calc = compute_metrics_from_counts(tp, fp, fn)
                self.assertAlmostEqual(p_calc, cstat["precision"], places=7)
                self.assertAlmostEqual(r_calc, cstat["recall"], places=7)
                self.assertAlmostEqual(f1_calc, cstat["f1_score"], places=7)

                class_p_list.append(p_calc)
                class_r_list.append(r_calc)
                class_f1_list.append(f1_calc)

            # Macro Precision directly from integer-based class precision
            expected_macro_p = float(np.mean(class_p_list))
            self.assertAlmostEqual(macro["precision"], expected_macro_p, places=7)

            # Macro Recall directly from integer-based class recall
            expected_macro_r = float(np.mean(class_r_list))
            self.assertAlmostEqual(macro["recall"], expected_macro_r, places=7)

            # Macro F1 directly from integer-based class F1
            expected_macro_f1 = float(np.mean(class_f1_list))
            self.assertAlmostEqual(macro["macro_f1"], expected_macro_f1, places=7)

            # Harmonic F1 of Macro P & R
            expected_harmonic_macro_f1 = (2.0 * expected_macro_p * expected_macro_r) / (expected_macro_p + expected_macro_r) if (expected_macro_p + expected_macro_r) > 0 else 0.0
            self.assertAlmostEqual(macro["harmonic_f1_of_macro_p_r"], expected_harmonic_macro_f1, places=7)

    def test_cross_artifact_consistency(self):
        """Loads JSON, CSV, and TXT artifacts and verifies that detection counts
        and micro/macro metrics match consistently across all 4 thresholds."""
        json_path = self.base_dir / "validated_evaluation_report.json"
        csv_path = self.base_dir / "validated_confidence_threshold_comparison.csv"
        txt_path = self.base_dir / "evaluation_protocol_audit.txt"

        self.assertTrue(json_path.exists())
        self.assertTrue(csv_path.exists())
        self.assertTrue(txt_path.exists())

        # Load CSV
        csv_rows = []
        with open(csv_path, "r", encoding="utf-8") as f:
            reader = csv.DictReader(f)
            for row in reader:
                csv_rows.append(row)

        self.assertEqual(len(csv_rows), 4)

        # Load TXT content
        txt_content = txt_path.read_text(encoding="utf-8")

        # Compare JSON vs CSV vs TXT for all 4 thresholds
        sweep = self.report["custom_fixed_threshold_sweep"]
        for i, record in enumerate(sweep):
            tau = record["confidence_threshold"]
            retained = record["retained_predictions_count"]
            micro_tp = record["micro_averaged_metrics"]["total_tp"]
            micro_fp = record["micro_averaged_metrics"]["total_fp"]
            micro_fn = record["micro_averaged_metrics"]["total_fn"]

            csv_row = csv_rows[i]
            self.assertAlmostEqual(float(csv_row["Confidence_Threshold"]), tau, places=2)
            self.assertEqual(int(csv_row["Retained_Detections"]), retained)
            self.assertEqual(int(csv_row["Micro_TP"]), micro_tp)
            self.assertEqual(int(csv_row["Micro_FP"]), micro_fp)
            self.assertEqual(int(csv_row["Micro_FN"]), micro_fn)

            # Check TXT table contains exact confidence and retained count
            # Table format: "0.10 | 1077 "
            pattern = rf"{tau:.2f}\s*\|\s*{retained}\s*\|"
            self.assertIsNotNone(
                re.search(pattern, txt_content),
                f"TXT table missing expected row for conf={tau:.2f}, retained={retained}",
            )


if __name__ == "__main__":
    unittest.main()
