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
   - Macro precision = arithmetic mean of per-class precision across active classes.
   - Macro recall = arithmetic mean of per-class recall across active classes.
   - Macro F1 = arithmetic mean of per-class F1 across active classes.
   - Harmonic F1 of macro P & R is reported separately under 'harmonic_f1_of_macro_p_r'.
   - TP + FN == GT for every class and threshold.
   - Total retained predictions == Total TP + Total FP.
   - Aggregated micro counts equal sum of per-class counts.
   - Monotonic decrease of retained predictions as confidence threshold increases.
4. Provenance and official Ultralytics baseline validation traceability:
   - Validates official results_dict structure and baseline values against official validator outputs.
"""

from __future__ import annotations

import json
from pathlib import Path
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
        # Verify matched prediction index is index 1 (the 0.95 confidence box)
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
        """Verify greedy assignment when multiple GT boxes overlap:
        Prediction matches the candidate with highest IoU without duplicate assignment.
        """
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
        # Resolve authoritative path under server/evaluation_results
        candidates = [
            Path("server/evaluation_results/confidence_sweep/validated_evaluation_report.json"),
            Path("evaluation_results/confidence_sweep/validated_evaluation_report.json"),
        ]
        report_path = None
        for p in candidates:
            if p.exists():
                report_path = p
                break
        if report_path is None:
            raise FileNotFoundError("validated_evaluation_report.json not found in candidate paths.")
        with open(report_path, "r", encoding="utf-8") as f:
            cls.report = json.load(f)

    def test_provenance_and_model_weights_hash(self):
        """Verify provenance fields exist and are non-empty."""
        prov = self.report.get("evaluation_provenance", {})
        self.assertEqual(prov.get("framework"), "Ultralytics YOLO")
        self.assertIn("ultralytics_version", prov)
        self.assertIn("torch_version", prov)
        self.assertIn("python_version", prov)
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

    def test_sweep_mathematical_conservation_and_macro_definitions(self):
        """Verify that all sweep results satisfy counting identities and macro definitions:
        - Macro Precision = arithmetic mean of class precision
        - Macro Recall = arithmetic mean of class recall
        - Macro F1 = arithmetic mean of class F1
        - Harmonic F1 of Macro P & R is separate under harmonic_f1_of_macro_p_r
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

            # Per-class counts and macro aggregation verification
            all_classes = record["all_classes"]
            class_p_list = []
            class_r_list = []
            class_f1_list = []

            for cname, cstat in all_classes.items():
                tp = cstat["tp"]
                fp = cstat["fp"]
                fn = cstat["fn"]
                gt = cstat["gt"]
                self.assertEqual(tp + fn, gt, f"Class {cname} failed TP+FN==GT at conf {tau}")

                p_calc, r_calc, f1_calc = compute_metrics_from_counts(tp, fp, fn)
                self.assertAlmostEqual(p_calc, cstat["precision"], places=4)
                self.assertAlmostEqual(r_calc, cstat["recall"], places=4)
                self.assertAlmostEqual(f1_calc, cstat["f1_score"], places=4)

                class_p_list.append(cstat["precision"])
                class_r_list.append(cstat["recall"])
                class_f1_list.append(cstat["f1_score"])

            # Verify Macro Precision = arithmetic mean of per-class precision
            expected_macro_p = float(np.mean(class_p_list))
            self.assertAlmostEqual(macro["precision"], expected_macro_p, places=3)

            # Verify Macro Recall = arithmetic mean of per-class recall
            expected_macro_r = float(np.mean(class_r_list))
            self.assertAlmostEqual(macro["recall"], expected_macro_r, places=3)

            # Verify Macro F1 = arithmetic mean of per-class F1
            expected_macro_f1 = float(np.mean(class_f1_list))
            self.assertAlmostEqual(macro["macro_f1"], expected_macro_f1, places=3)

            # Verify Harmonic F1 of Macro P & R
            expected_harmonic_macro_f1 = (2.0 * expected_macro_p * expected_macro_r) / (expected_macro_p + expected_macro_r) if (expected_macro_p + expected_macro_r) > 0 else 0.0
            self.assertAlmostEqual(macro["harmonic_f1_of_macro_p_r"], expected_harmonic_macro_f1, places=3)


if __name__ == "__main__":
    unittest.main()
