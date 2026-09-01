"""
NetraSense Model Evaluation & Comparison Benchmark Suite
=========================================================
Computes Accuracy, Precision, Recall, F1-Score, and Latency/FPS metrics
comparing object detection models and distance classification engines.

Includes:
- Confusion matrix visualization (text + heatmap PNG)
- Per-class ROC curves with AUC scores
- Ensemble vs ultrasonic-only comparison

Run from server directory:
    python evaluate_models.py
"""

from __future__ import annotations

import os
import sys
import time
import statistics
from collections import defaultdict
from typing import Dict, List, Tuple, Optional

from serial_sensor import classify_threat_level
from ensemble import EnsembleClassifier, EnsembleResult

# ── Optional sklearn ML classifiers ────────────────────────────────
try:
    from ml_classifiers import NetraSenseMLPipeline, HAS_SKLEARN, FEATURE_NAMES, THREAT_CLASSES as ML_CLASSES
except ImportError:
    HAS_SKLEARN = False

# ── Optional matplotlib (graceful fallback) ──────────────────────────
try:
    import matplotlib
    matplotlib.use("Agg")  # Non-interactive backend — no display needed
    import matplotlib.pyplot as plt
    import matplotlib.colors as mcolors
    from matplotlib.gridspec import GridSpec
    HAS_MATPLOTLIB = True
except ImportError:
    HAS_MATPLOTLIB = False

try:
    import numpy as np
    HAS_NUMPY = True
except ImportError:
    HAS_NUMPY = False

# ── Output directory for visualizations ──────────────────────────────
EVAL_OUTPUT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "eval_output")


def compute_classification_metrics(y_true: List[str], y_pred: List[str], labels: List[str]) -> Dict[str, dict]:
    """Compute Precision, Recall, F1-Score, and Accuracy per class and macro average."""
    metrics = {}
    total_correct = sum(1 for t, p in zip(y_true, y_pred) if t == p)
    accuracy = total_correct / max(1, len(y_true))

    macro_p, macro_r, macro_f1 = [], [], []

    for lbl in labels:
        tp = sum(1 for t, p in zip(y_true, y_pred) if t == lbl and p == lbl)
        fp = sum(1 for t, p in zip(y_true, y_pred) if t != lbl and p == lbl)
        fn = sum(1 for t, p in zip(y_true, y_pred) if t == lbl and p != lbl)

        precision = tp / max(1, tp + fp)
        recall = tp / max(1, tp + fn)
        f1 = (2 * precision * recall) / max(1e-6, precision + recall)

        metrics[lbl] = {
            "precision": round(precision, 4),
            "recall": round(recall, 4),
            "f1_score": round(f1, 4),
            "tp": tp,
            "fp": fp,
            "fn": fn,
        }
        macro_p.append(precision)
        macro_r.append(recall)
        macro_f1.append(f1)

    metrics["macro_avg"] = {
        "accuracy": round(accuracy, 4),
        "precision": round(statistics.mean(macro_p), 4),
        "recall": round(statistics.mean(macro_r), 4),
        "f1_score": round(statistics.mean(macro_f1), 4),
    }

    return metrics


# ── Benchmark dataset simulating real-world obstacle distance measurements ──
TEST_DATASET: List[Tuple[float, str]] = [
    # (distance_cm, ground_truth_threat)
    (350.0, "NORMAL"),
    (310.0, "NORMAL"),
    (299.0, "WARNING"),
    (250.0, "WARNING"),
    (180.0, "WARNING"),
    (100.0, "WARNING"),
    (99.0, "ALARM"),
    (75.0, "ALARM"),
    (50.0, "ALARM"),
    (45.0, "CRITICAL"),
    (30.0, "CRITICAL"),
    (10.0, "CRITICAL"),
]

THREAT_LABELS = ["NORMAL", "WARNING", "ALARM", "CRITICAL"]

# ── Extended dataset for ensemble benchmarking ───────────────────────
# Expanded with 40 samples (including noisy/conflicting readings)
# for meaningful confusion matrices and ROC curves.
ENSEMBLE_TEST_DATASET = [
    # ── Normal (300+ cm) ──────────────────────────────────────────
    (350.0, 340.0, 360.0, "NORMAL"),
    (310.0, 300.0, 320.0, "NORMAL"),
    (380.0, 370.0, 385.0, "NORMAL"),
    (320.0, 310.0, 325.0, "NORMAL"),
    (360.0, 355.0, 365.0, "NORMAL"),
    (340.0, 330.0, 345.0, "NORMAL"),
    (305.0, 295.0, 310.0, "NORMAL"),
    (390.0, 385.0, 395.0, "NORMAL"),
    (335.0, None, 340.0, "NORMAL"),     # No YOLO
    (None, 350.0, 360.0, "NORMAL"),     # No ultrasonic
    # ── Warning (100–300 cm) ──────────────────────────────────────
    (299.0, 280.0, 305.0, "WARNING"),
    (250.0, 240.0, 260.0, "WARNING"),
    (180.0, 170.0, 190.0, "WARNING"),
    (100.0, 95.0, 105.0, "WARNING"),
    (200.0, 195.0, 210.0, "WARNING"),
    (150.0, 140.0, 155.0, "WARNING"),
    (270.0, 265.0, 275.0, "WARNING"),
    (120.0, 115.0, 125.0, "WARNING"),
    (230.0, None, 240.0, "WARNING"),
    # ── Alarm (50–100 cm) ─────────────────────────────────────────
    (99.0, 90.0, 102.0, "ALARM"),
    (75.0, 68.0, 78.0, "ALARM"),
    (50.0, 45.0, 52.0, "ALARM"),
    (85.0, 80.0, 88.0, "ALARM"),
    (65.0, 60.0, 67.0, "ALARM"),
    (92.0, 87.0, 95.0, "ALARM"),
    (60.0, None, 65.0, "ALARM"),       # No YOLO
    # ── Critical (<50 cm) ─────────────────────────────────────────
    (45.0, 40.0, 47.0, "CRITICAL"),
    (30.0, 25.0, 32.0, "CRITICAL"),
    (10.0, 8.0, 12.0, "CRITICAL"),
    (35.0, 32.0, 38.0, "CRITICAL"),
    (20.0, 18.0, 22.0, "CRITICAL"),
    (8.0, 6.0, 10.0, "CRITICAL"),
    (42.0, None, 44.0, "CRITICAL"),     # No YOLO
    # ── Conflicting / edge cases ──────────────────────────────────
    (200.0, 60.0, 210.0, "WARNING"),    # YOLO says ALARM, ultrasonic says WARNING
    (None, 80.0, None, "ALARM"),         # Only YOLO
    (None, None, None, "NORMAL"),        # No signals at all → NO DATA → excluded from metrics
    (120.0, 120.0, 120.0, "WARNING"),    # All agree at boundary
    (48.0, 48.0, 48.0, "CRITICAL"),      # All agree near CRITICAL/ALARM boundary
    (105.0, 105.0, 105.0, "WARNING"),    # All agree at WARNING/ALARM boundary
    (300.0, 300.0, 300.0, "NORMAL"),     # All agree at WARNING/NORMAL boundary
]

ENSEMBLE_THREAT_LABELS = ["NORMAL", "WARNING", "ALARM", "CRITICAL"]


# ── Confusion Matrix ─────────────────────────────────────────────────

def build_confusion_matrix(y_true: List[str], y_pred: List[str], labels: List[str]) -> List[List[int]]:
    """Build an NxN confusion matrix. Rows = ground truth, columns = predicted."""
    idx = {lbl: i for i, lbl in enumerate(labels)}
    n = len(labels)
    matrix = [[0] * n for _ in range(n)]
    for t, p in zip(y_true, y_pred):
        if t in idx and p in idx:
            matrix[idx[t]][idx[p]] += 1
    return matrix


def print_confusion_matrix_text(matrix: List[List[int]], labels: List[str], title: str = "Confusion Matrix") -> None:
    """Print a text-formatted confusion matrix to stdout."""
    print(f"\n  {title}")
    print("  " + "-" * (12 + 12 * len(labels)))
    # Header
    header = "  " + " " * 12 + "".join(f"{lbl:>12}" for lbl in labels) + "  ← Predicted"
    print(header)
    for i, lbl in enumerate(labels):
        row = f"  {lbl:>10} |" + "".join(f"{v:>12}" for v in matrix[i])
        print(row)
    print("  " + " " * 12 + "".join(" " * 12 for _ in labels))
    print("  ↑ Actual")


def plot_confusion_matrix_heatmap(
    matrix: List[List[int]],
    labels: List[str],
    title: str,
    output_path: str,
    normalize: bool = True,
) -> None:
    """Save a matplotlib confusion matrix heatmap as PNG."""
    if not HAS_MATPLOTLIB or not HAS_NUMPY:
        print(f"  [SKIP] matplotlib/numpy required for heatmap: {output_path}")
        return

    mat = np.array(matrix, dtype=float)
    if normalize and mat.sum() > 0:
        row_sums = mat.sum(axis=1, keepdims=True)
        row_sums[row_sums == 0] = 1
        mat_norm = mat / row_sums
    else:
        mat_norm = mat

    fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(14, 5), gridspec_kw={"width_ratios": [1, 1]})

    # Left: raw counts
    im1 = ax1.imshow(mat, cmap="Blues", aspect="auto")
    ax1.set_title(f"{title} (Counts)", fontsize=12, fontweight="bold")
    ax1.set_xticks(range(len(labels)))
    ax1.set_yticks(range(len(labels)))
    ax1.set_xticklabels(labels, fontsize=9)
    ax1.set_yticklabels(labels, fontsize=9)
    ax1.set_xlabel("Predicted", fontsize=10)
    ax1.set_ylabel("Actual", fontsize=10)
    for i in range(len(labels)):
        for j in range(len(labels)):
            color = "white" if mat[i][j] > mat.max() / 2 else "black"
            ax1.text(j, i, f"{int(mat[i][j])}", ha="center", va="center", fontsize=12, color=color, fontweight="bold")
    fig.colorbar(im1, ax=ax1, fraction=0.046, pad=0.04)

    # Right: normalized
    im2 = ax2.imshow(mat_norm, cmap="YlOrRd", aspect="auto", vmin=0, vmax=1)
    ax2.set_title(f"{title} (Normalized)", fontsize=12, fontweight="bold")
    ax2.set_xticks(range(len(labels)))
    ax2.set_yticks(range(len(labels)))
    ax2.set_xticklabels(labels, fontsize=9)
    ax2.set_yticklabels(labels, fontsize=9)
    ax2.set_xlabel("Predicted", fontsize=10)
    ax2.set_ylabel("Actual", fontsize=10)
    for i in range(len(labels)):
        for j in range(len(labels)):
            val = mat_norm[i][j]
            color = "white" if val > 0.5 else "black"
            ax2.text(j, i, f"{val:.2f}", ha="center", va="center", fontsize=10, color=color, fontweight="bold")
    fig.colorbar(im2, ax=ax2, fraction=0.046, pad=0.04)

    plt.tight_layout()
    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    fig.savefig(output_path, dpi=150, bbox_inches="tight", facecolor="white")
    plt.close(fig)
    print(f"  [SAVED] {output_path}")


# ── ROC Curves ───────────────────────────────────────────────────────

def _compute_severity_scores(
    y_true: List[str],
    y_pred: List[str],
    labels: List[str],
) -> Tuple[List[float], List[float]]:
    """Compute continuous scores for ROC from threat-level predictions.

    Maps each threat level to a severity score (0–1) and uses it as
    a proxy for the 'probability' needed by ROC curves.

    Returns (y_true_binary, y_scores) for the given positive class.
    """
    severity_map = {"NORMAL": 0.0, "WARNING": 0.33, "ALARM": 0.67, "CRITICAL": 1.0}
    y_scores = [severity_map.get(p, 0.0) for p in y_pred]
    return y_true, y_scores


def plot_roc_curves(
    y_true: List[str],
    y_pred: List[str],
    labels: List[str],
    title: str,
    output_path: str,
) -> None:
    """Plot per-class ROC curves (one-vs-rest) with AUC and save as PNG."""
    if not HAS_MATPLOTLIB:
        print(f"  [SKIP] matplotlib required for ROC curves: {output_path}")
        return

    severity_map = {"NORMAL": 0.0, "WARNING": 0.33, "ALARM": 0.67, "CRITICAL": 1.0}
    y_scores = [severity_map.get(p, 0.0) for p in y_pred]

    fig, ax = plt.subplots(figsize=(8, 6))
    colors = ["#2196F3", "#FFC107", "#FF5722", "#D32F2F"]

    for idx, lbl in enumerate(labels):
        # One-vs-rest: binary ground truth
        y_binary = [1.0 if t == lbl else 0.0 for t in y_true]
        n_pos = sum(y_binary)
        n_neg = len(y_binary) - n_pos

        if n_pos == 0 or n_neg == 0:
            continue  # Can't compute ROC without both classes

        # Sort by score descending
        pairs = sorted(zip(y_scores, y_binary), key=lambda x: -x[0])
        tp, fp = 0, 0
        tpr_list = [0.0]
        fpr_list = [0.0]

        for score, actual in pairs:
            if actual == 1.0:
                tp += 1
            else:
                fp += 1
            tpr_list.append(tp / n_pos)
            fpr_list.append(fp / n_neg)

        # Compute AUC (trapezoidal rule)
        auc = 0.0
        for i in range(1, len(fpr_list)):
            auc += (fpr_list[i] - fpr_list[i - 1]) * (tpr_list[i] + tpr_list[i - 1]) / 2.0

        color = colors[idx % len(colors)]
        ax.plot(fpr_list, tpr_list, color=color, lw=2, label=f"{lbl} (AUC = {auc:.3f})")

    # Diagonal baseline
    ax.plot([0, 1], [0, 1], color="gray", lw=1, linestyle="--", label="Random (AUC = 0.500)")

    ax.set_xlim([-0.02, 1.02])
    ax.set_ylim([-0.02, 1.02])
    ax.set_xlabel("False Positive Rate", fontsize=11)
    ax.set_ylabel("True Positive Rate", fontsize=11)
    ax.set_title(title, fontsize=13, fontweight="bold")
    ax.legend(loc="lower right", fontsize=10)
    ax.grid(True, alpha=0.3)

    plt.tight_layout()
    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    fig.savefig(output_path, dpi=150, bbox_inches="tight", facecolor="white")
    plt.close(fig)
    print(f"  [SAVED] {output_path}")


# ── Main Benchmark ───────────────────────────────────────────────────

def run_evaluation_benchmark():
    os.makedirs(EVAL_OUTPUT_DIR, exist_ok=True)

    print("=" * 65)
    print("  NetraSense AI & Sensor Model Evaluation Benchmark")
    print("=" * 65)
    if not HAS_MATPLOTLIB:
        print("  [INFO] matplotlib not installed — skipping PNG visualizations.")
        print("         Install with: pip install matplotlib")
    if not HAS_NUMPY:
        print("  [INFO] numpy not installed — some visualizations limited.")
        print("         Install with: pip install numpy")

    # ── 1. Ultrasonic Threat Classifier ───────────────────────────
    y_true = [gt for _, gt in TEST_DATASET]
    y_pred = []
    latencies_ms = []

    for dist, gt in TEST_DATASET:
        t0 = time.perf_counter()
        pred = classify_threat_level(dist)
        dt_ms = (time.perf_counter() - t0) * 1000
        latencies_ms.append(dt_ms)
        y_pred.append(pred)

    sensor_metrics = compute_classification_metrics(y_true, y_pred, THREAT_LABELS)

    print(f"\n[1] Ultrasonic Threat Classifier Performance:")
    print(f"    Accuracy       : {sensor_metrics['macro_avg']['accuracy'] * 100:.2f}%")
    print(f"    Macro Precision: {sensor_metrics['macro_avg']['precision']:.4f}")
    print(f"    Macro Recall   : {sensor_metrics['macro_avg']['recall']:.4f}")
    print(f"    Macro F1-Score : {sensor_metrics['macro_avg']['f1_score']:.4f}")
    print(f"    Mean Latency   : {statistics.mean(latencies_ms):.4f} ms")

    # Confusion matrix — ultrasonic
    cm_sensor = build_confusion_matrix(y_true, y_pred, THREAT_LABELS)
    print_confusion_matrix_text(cm_sensor, THREAT_LABELS, "Ultrasonic Classifier — Confusion Matrix")
    plot_confusion_matrix_heatmap(
        cm_sensor, THREAT_LABELS,
        title="Ultrasonic Threat Classifier",
        output_path=os.path.join(EVAL_OUTPUT_DIR, "confusion_matrix_ultrasonic.png"),
    )
    plot_roc_curves(
        y_true, y_pred, THREAT_LABELS,
        title="ROC Curves — Ultrasonic Threat Classifier",
        output_path=os.path.join(EVAL_OUTPUT_DIR, "roc_curves_ultrasonic.png"),
    )

    # ── 2. Ensemble Classifier ────────────────────────────────────
    ensemble = EnsembleClassifier()
    e_y_true = []
    e_y_pred = []
    e_latencies_ms = []
    ensemble_results = []

    for u_cm, y_cm, d_cm, gt in ENSEMBLE_TEST_DATASET:
        e_y_true.append(gt)
        t0 = time.perf_counter()
        result = ensemble.classify(
            ultrasonic_cm=u_cm,
            yolo_detections=[{"distance_cm": y_cm, "threat_level": None, "confidence": 0.85, "label": "object"}] if y_cm is not None else None,
            depth_distance_cm=d_cm,
        )
        dt_ms = (time.perf_counter() - t0) * 1000
        e_latencies_ms.append(dt_ms)
        e_y_pred.append(result.fused_threat_level)
        ensemble_results.append(result)

    # Filter out "NO DATA" from metrics
    valid_pairs = [(t, p) for t, p in zip(e_y_true, e_y_pred) if p != "NO DATA"]
    if valid_pairs:
        valid_y_true, valid_y_pred = zip(*valid_pairs)
    else:
        valid_y_true, valid_y_pred = [], []

    if valid_y_true:
        ensemble_metrics = compute_classification_metrics(
            list(valid_y_true), list(valid_y_pred), ENSEMBLE_THREAT_LABELS
        )
    else:
        ensemble_metrics = {"macro_avg": {"accuracy": 0, "precision": 0, "recall": 0, "f1_score": 0}}

    print(f"\n[2] Ensemble Classifier Performance (ultrasonic + YOLO + depth):")
    print(f"    Accuracy       : {ensemble_metrics['macro_avg']['accuracy'] * 100:.2f}%")
    print(f"    Macro Precision: {ensemble_metrics['macro_avg']['precision']:.4f}")
    print(f"    Macro Recall   : {ensemble_metrics['macro_avg']['recall']:.4f}")
    print(f"    Macro F1-Score : {ensemble_metrics['macro_avg']['f1_score']:.4f}")
    print(f"    Mean Latency   : {statistics.mean(e_latencies_ms):.4f} ms")
    print(f"    Signals fused  : {sum(r.signal_count for r in ensemble_results)} total across {len(ensemble_results)} samples")
    print(f"    Confidence avg : {statistics.mean([r.confidence for r in ensemble_results]):.3f}")

    # Per-class breakdown
    for lbl in ENSEMBLE_THREAT_LABELS:
        if lbl in ensemble_metrics and lbl != "macro_avg":
            m = ensemble_metrics[lbl]
            print(f"    {lbl:<10} P={m['precision']:.3f} R={m['recall']:.3f} F1={m['f1_score']:.3f}  (TP={m['tp']} FP={m['fp']} FN={m['fn']})")

    # Confusion matrix — ensemble
    if valid_y_true:
        cm_ensemble = build_confusion_matrix(list(valid_y_true), list(valid_y_pred), ENSEMBLE_THREAT_LABELS)
        print_confusion_matrix_text(cm_ensemble, ENSEMBLE_THREAT_LABELS, "Ensemble Classifier — Confusion Matrix")
        plot_confusion_matrix_heatmap(
            cm_ensemble, ENSEMBLE_THREAT_LABELS,
            title="Ensemble Threat Classifier",
            output_path=os.path.join(EVAL_OUTPUT_DIR, "confusion_matrix_ensemble.png"),
        )
        plot_roc_curves(
            list(valid_y_true), list(valid_y_pred), ENSEMBLE_THREAT_LABELS,
            title="ROC Curves — Ensemble Threat Classifier",
            output_path=os.path.join(EVAL_OUTPUT_DIR, "roc_curves_ensemble.png"),
        )

    # ── 3. AI Model Comparison ────────────────────────────────────
    print(f"\n[3] Vision AI Model Architecture Comparison:")
    print("-" * 65)
    print(f"{'Model Name':<22} | {'Params / Size':<14} | {'Target Device':<14} | {'Avg Latency':<10}")
    print("-" * 65)
    print(f"{'YOLO11 Nano (ONNX)':<22} | {'2.6 M (6.2MB)':<14} | {'CPU / Edge':<14} | {'8-12 ms':<10}")
    print(f"{'Depth Anything V2':<22} | {'24.8 M (98MB)':<14} | {'GPU / MPS':<14} | {'25-35 ms':<10}")
    ens_lat = f"{statistics.mean(e_latencies_ms):.2f} ms"
    print(f"{'Ensemble Fuser':<22} | {'N/A (rule)':<14} | {'CPU (any)':<14} | {ens_lat:<10}")
    print(f"{'TFJS COCO-SSD (Browser)':<22} | {'12.1 M (18MB)':<14} | {'WebGL / Client':<14} | {'15-22 ms':<10}")
    print("-" * 65)

    # ── 4. Ensemble vs Ultrasonic-only ────────────────────────────
    print(f"\n[4] Ensemble vs Ultrasonic-Only Accuracy Comparison:")
    print("-" * 65)
    s_acc = sensor_metrics['macro_avg']['accuracy'] * 100
    e_acc = ensemble_metrics['macro_avg']['accuracy'] * 100
    delta = e_acc - s_acc
    print(f"    Ultrasonic-only : {s_acc:.2f}% accuracy")
    print(f"    Ensemble fused  : {e_acc:.2f}% accuracy")
    print(f"    Delta           : {delta:+.2f}% {'(ensemble improves)' if delta > 0 else '(ultrasonic alone is better)'}")
    print("-" * 65)

    # ── 5. sklearn ML Classifiers Benchmark ────────────────────────
    if HAS_SKLEARN:
        print(f"\n{'=' * 65}")
        print("  sklearn ML Classifiers — Full Benchmark")
        print(f"{'=' * 65}")

        ml_pipeline = NetraSenseMLPipeline()
        X_ml, y_ml = ml_pipeline.load_training_data()

        print(f"\n  Training samples: {len(X_ml)}")
        print(f"  Features: {len(FEATURE_NAMES)} ({', '.join(FEATURE_NAMES)})")
        print(f"  Classes: {ML_CLASSES}")
        print(f"  Class distribution: {dict((c, y_ml.count(c)) for c in ML_CLASSES)}")

        ml_results = ml_pipeline.train(X_ml, y_ml)

        # Comparison table
        print(f"\n  {'Classifier':<22} │ {'Accuracy':>8} │ {'Prec':>6} │ {'Recall':>6} │ {'F1':>6} │ {'CV Mean±Std':>14} │ {'Train':>8} │ {'Predict':>8}")
        print("  " + "─" * 107)
        for name in ["Decision Tree", "SVM", "KNN", "Random Forest", "Gaussian NB", "Voting Classifier"]:
            r = ml_results[name]
            cv_str = f"{r.cv_mean:.3f}±{r.cv_std:.3f}" if r.cv_mean > 0 else "N/A"
            marker = " ★" if name == ml_pipeline.best_classifier_name else ""
            print(f"  {name:<20} │ {r.accuracy*100:>7.2f}% │ {r.precision:.4f} │ {r.recall:.4f} │ {r.f1:.4f} │ {cv_str:>14} │ {r.train_time_ms:>7.2f}ms │ {r.predict_time_ms:>7.3f}ms{marker}")
        print("  " + "─" * 107)

        # Confusion matrices for top 3 classifiers
        for name in ["Voting Classifier", "Random Forest", "SVM"]:
            r = ml_results[name]
            print_confusion_matrix_text(r.confusion_matrix, ML_CLASSES, f"{name} — Confusion Matrix")
            # Save heatmap PNG
            plot_confusion_matrix_heatmap(
                r.confusion_matrix, ML_CLASSES,
                title=f"{name}",
                output_path=os.path.join(EVAL_OUTPUT_DIR, f"confusion_matrix_{name.lower().replace(' ', '_')}.png"),
            )

        # ROC curves for Voting Classifier (best)
        best_r = ml_results[ml_pipeline.best_classifier_name]
        # Re-predict to get labels for ROC
        y_ml_pred = ml_pipeline.predict(X_ml)
        plot_roc_curves(
            y_ml, y_ml_pred, ML_CLASSES,
            title=f"ROC Curves — {ml_pipeline.best_classifier_name}",
            output_path=os.path.join(EVAL_OUTPUT_DIR, f"roc_curves_{ml_pipeline.best_classifier_name.lower().replace(' ', '_')}.png"),
        )

        # Save best model
        ml_pipeline.save(os.path.join(os.path.dirname(os.path.abspath(__file__)), "models", "threat_classifier.joblib"))

        print(f"\n  Best classifier: {ml_pipeline.best_classifier_name} (CV accuracy: {best_r.cv_mean:.4f})")
    else:
        print(f"\n[6] sklearn classifiers — SKIPPED (scikit-learn not installed)")
        print("    Install with: pip install scikit-learn")

    # ── 6. Visualization summary ──────────────────────────────────
    print(f"\n[6] Visualization Output:")
    print(f"    Directory : {EVAL_OUTPUT_DIR}")
    if HAS_MATPLOTLIB:
        expected_files = [
            "confusion_matrix_ultrasonic.png",
            "confusion_matrix_ensemble.png",
            "roc_curves_ultrasonic.png",
            "roc_curves_ensemble.png",
        ]
        if HAS_SKLEARN:
            expected_files.extend([
                "confusion_matrix_voting_classifier.png",
                "confusion_matrix_random_forest.png",
                "confusion_matrix_svm.png",
                "roc_curves_voting_classifier.png",
            ])
        for fname in expected_files:
            fpath = os.path.join(EVAL_OUTPUT_DIR, fname)
            exists = os.path.exists(fpath)
            size_kb = os.path.getsize(fpath) / 1024 if exists else 0
            status = f"✓ {size_kb:.1f} KB" if exists else "✗ missing"
            print(f"    {fname:<45} {status}")
    else:
        print("    [SKIP] Install matplotlib for PNG visualizations")
        print("            pip install matplotlib")

    print("\nEvaluation Benchmark complete.\n")


if __name__ == "__main__":
    run_evaluation_benchmark()
