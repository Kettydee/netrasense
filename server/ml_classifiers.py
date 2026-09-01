"""
NetraSense — ML Threat-Level Classifiers
==========================================
Implements the five classifiers from the research paper plus a Voting
Classifier ensemble:

1. Decision Tree
2. Support Vector Machine (SVM)
3. K-Nearest Neighbors (KNN)
4. Random Forest
5. Gaussian Naive Bayes
6. Voting Classifier (soft-voting ensemble of all five)

Features: ultrasonic distance, YOLO closest distance, depth distance,
          detection confidence, signal count, motion flag.

Usage::

    from ml_classifiers import NetraSenseMLPipeline

    pipeline = NetraSenseMLPipeline()
    pipeline.train(X_train, y_train)
    predictions = pipeline.predict(X_test)
    metrics = pipeline.evaluate(X_test, y_test)
    pipeline.save("models/threat_classifier.joblib")
    pipeline.load("models/threat_classifier.joblib")

Run standalone for full benchmark:
    python ml_classifiers.py
"""

from __future__ import annotations

import os
import pickle
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

try:
    from sklearn.tree import DecisionTreeClassifier
    from sklearn.svm import SVC
    from sklearn.neighbors import KNeighborsClassifier
    from sklearn.ensemble import RandomForestClassifier, VotingClassifier
    from sklearn.naive_bayes import GaussianNB
    from sklearn.model_selection import cross_val_score, StratifiedKFold
    from sklearn.preprocessing import StandardScaler
    from sklearn.pipeline import Pipeline as SKPipeline
    from sklearn.metrics import (
        accuracy_score,
        precision_score,
        recall_score,
        f1_score,
        confusion_matrix,
        classification_report,
    )
    HAS_SKLEARN = True
except ImportError:
    HAS_SKLEARN = False


# ── Feature Engineering ──────────────────────────────────────────────

FEATURE_NAMES = [
    "ultrasonic_cm",        # Direct distance from HC-SR04 (0–400)
    "yolo_closest_cm",      # Closest YOLO detection distance (0–400 or 0)
    "depth_cm",             # Depth estimation distance (0–400 or 0)
    "yolo_confidence",      # YOLO detection confidence (0–1)
    "signal_count",         # Number of active signals (0–3)
    "has_ultrasonic",       # Binary: ultrasonic signal available
    "has_yolo",             # Binary: YOLO detection available
    "has_depth",            # Binary: depth estimation available
]

THREAT_CLASSES = ["NORMAL", "WARNING", "ALARM", "CRITICAL"]

# ── Training Dataset ─────────────────────────────────────────────────
# Features: [ultrasonic_cm, yolo_closest_cm, depth_cm, yolo_confidence,
#            signal_count, has_ultrasonic, has_yolo, has_depth]

TRAINING_DATA: List[Tuple[List[float], str]] = [
    # ── NORMAL (300+ cm) ──────────────────────────────────────────
    ([350.0, 340.0, 360.0, 0.85, 3, 1, 1, 1], "NORMAL"),
    ([310.0, 300.0, 320.0, 0.88, 3, 1, 1, 1], "NORMAL"),
    ([380.0, 370.0, 385.0, 0.90, 3, 1, 1, 1], "NORMAL"),
    ([320.0, 310.0, 325.0, 0.82, 3, 1, 1, 1], "NORMAL"),
    ([360.0, 355.0, 365.0, 0.87, 3, 1, 1, 1], "NORMAL"),
    ([340.0, 330.0, 345.0, 0.91, 3, 1, 1, 1], "NORMAL"),
    ([305.0, 295.0, 310.0, 0.84, 3, 1, 1, 1], "NORMAL"),
    ([390.0, 385.0, 395.0, 0.93, 3, 1, 1, 1], "NORMAL"),
    ([335.0, 0.0, 340.0, 0.0, 2, 1, 0, 1], "NORMAL"),       # No YOLO
    ([0.0, 350.0, 360.0, 0.86, 2, 0, 1, 1], "NORMAL"),       # No ultrasonic
    ([350.0, 0.0, 0.0, 0.0, 1, 1, 0, 0], "NORMAL"),          # Ultrasonic only
    ([0.0, 340.0, 0.0, 0.88, 1, 0, 1, 0], "NORMAL"),         # YOLO only
    ([365.0, 358.0, 0.0, 0.82, 2, 1, 1, 0], "NORMAL"),       # No depth
    ([375.0, 0.0, 380.0, 0.0, 2, 1, 0, 1], "NORMAL"),        # No YOLO
    ([315.0, 308.0, 318.0, 0.89, 3, 1, 1, 1], "NORMAL"),
    ([328.0, 320.0, 332.0, 0.85, 3, 1, 1, 1], "NORMAL"),
    ([345.0, 338.0, 350.0, 0.87, 3, 1, 1, 1], "NORMAL"),
    ([358.0, 350.0, 362.0, 0.90, 3, 1, 1, 1], "NORMAL"),
    ([372.0, 365.0, 378.0, 0.86, 3, 1, 1, 1], "NORMAL"),
    ([395.0, 388.0, 398.0, 0.91, 3, 1, 1, 1], "NORMAL"),
    ([325.0, 0.0, 330.0, 0.0, 2, 1, 0, 1], "NORMAL"),
    ([0.0, 355.0, 0.0, 0.90, 1, 0, 1, 0], "NORMAL"),
    ([342.0, 335.0, 348.0, 0.84, 3, 1, 1, 1], "NORMAL"),
    ([368.0, 360.0, 372.0, 0.88, 3, 1, 1, 1], "NORMAL"),

    # ── WARNING (100–300 cm) ──────────────────────────────────────
    ([299.0, 280.0, 305.0, 0.85, 3, 1, 1, 1], "WARNING"),
    ([250.0, 240.0, 260.0, 0.88, 3, 1, 1, 1], "WARNING"),
    ([180.0, 170.0, 190.0, 0.82, 3, 1, 1, 1], "WARNING"),
    ([100.0, 95.0, 105.0, 0.90, 3, 1, 1, 1], "WARNING"),
    ([200.0, 195.0, 210.0, 0.87, 3, 1, 1, 1], "WARNING"),
    ([150.0, 140.0, 155.0, 0.84, 3, 1, 1, 1], "WARNING"),
    ([270.0, 265.0, 275.0, 0.89, 3, 1, 1, 1], "WARNING"),
    ([120.0, 115.0, 125.0, 0.86, 3, 1, 1, 1], "WARNING"),
    ([230.0, 0.0, 240.0, 0.0, 2, 1, 0, 1], "WARNING"),       # No YOLO
    ([0.0, 220.0, 230.0, 0.85, 2, 0, 1, 1], "WARNING"),      # No ultrasonic
    ([200.0, 0.0, 0.0, 0.0, 1, 1, 0, 0], "WARNING"),         # Ultrasonic only
    ([0.0, 180.0, 0.0, 0.82, 1, 0, 1, 0], "WARNING"),        # YOLO only
    ([160.0, 155.0, 0.0, 0.88, 2, 1, 1, 0], "WARNING"),      # No depth
    ([285.0, 0.0, 290.0, 0.0, 2, 1, 0, 1], "WARNING"),
    ([145.0, 138.0, 148.0, 0.86, 3, 1, 1, 1], "WARNING"),
    ([215.0, 208.0, 218.0, 0.84, 3, 1, 1, 1], "WARNING"),
    ([175.0, 168.0, 178.0, 0.87, 3, 1, 1, 1], "WARNING"),
    ([245.0, 238.0, 250.0, 0.89, 3, 1, 1, 1], "WARNING"),
    ([130.0, 125.0, 135.0, 0.85, 3, 1, 1, 1], "WARNING"),
    ([260.0, 252.0, 265.0, 0.88, 3, 1, 1, 1], "WARNING"),
    ([190.0, 0.0, 195.0, 0.0, 2, 1, 0, 1], "WARNING"),
    ([0.0, 200.0, 0.0, 0.87, 1, 0, 1, 0], "WARNING"),
    ([225.0, 218.0, 228.0, 0.86, 3, 1, 1, 1], "WARNING"),
    ([155.0, 148.0, 158.0, 0.84, 3, 1, 1, 1], "WARNING"),

    # ── ALARM (50–100 cm) ─────────────────────────────────────────
    ([99.0, 90.0, 102.0, 0.85, 3, 1, 1, 1], "ALARM"),
    ([75.0, 68.0, 78.0, 0.88, 3, 1, 1, 1], "ALARM"),
    ([50.0, 45.0, 52.0, 0.90, 3, 1, 1, 1], "ALARM"),
    ([85.0, 80.0, 88.0, 0.87, 3, 1, 1, 1], "ALARM"),
    ([65.0, 60.0, 67.0, 0.84, 3, 1, 1, 1], "ALARM"),
    ([92.0, 87.0, 95.0, 0.89, 3, 1, 1, 1], "ALARM"),
    ([60.0, 0.0, 65.0, 0.0, 2, 1, 0, 1], "ALARM"),           # No YOLO
    ([0.0, 70.0, 0.0, 0.86, 1, 0, 1, 0], "ALARM"),           # YOLO only
    ([80.0, 0.0, 0.0, 0.0, 1, 1, 0, 0], "ALARM"),            # Ultrasonic only
    ([70.0, 65.0, 0.0, 0.88, 2, 1, 1, 0], "ALARM"),          # No depth
    ([55.0, 0.0, 58.0, 0.0, 2, 1, 0, 1], "ALARM"),
    ([88.0, 82.0, 90.0, 0.85, 3, 1, 1, 1], "ALARM"),
    ([72.0, 67.0, 75.0, 0.87, 3, 1, 1, 1], "ALARM"),
    ([95.0, 88.0, 98.0, 0.89, 3, 1, 1, 1], "ALARM"),
    ([62.0, 58.0, 65.0, 0.86, 3, 1, 1, 1], "ALARM"),
    ([78.0, 72.0, 80.0, 0.84, 3, 1, 1, 1], "ALARM"),

    # ── CRITICAL (<50 cm) ─────────────────────────────────────────
    ([45.0, 40.0, 47.0, 0.85, 3, 1, 1, 1], "CRITICAL"),
    ([30.0, 25.0, 32.0, 0.88, 3, 1, 1, 1], "CRITICAL"),
    ([10.0, 8.0, 12.0, 0.90, 3, 1, 1, 1], "CRITICAL"),
    ([35.0, 32.0, 38.0, 0.87, 3, 1, 1, 1], "CRITICAL"),
    ([20.0, 18.0, 22.0, 0.84, 3, 1, 1, 1], "CRITICAL"),
    ([8.0, 6.0, 10.0, 0.89, 3, 1, 1, 1], "CRITICAL"),
    ([42.0, 0.0, 44.0, 0.0, 2, 1, 0, 1], "CRITICAL"),        # No YOLO
    ([0.0, 35.0, 0.0, 0.86, 1, 0, 1, 0], "CRITICAL"),        # YOLO only
    ([25.0, 0.0, 0.0, 0.0, 1, 1, 0, 0], "CRITICAL"),         # Ultrasonic only
    ([15.0, 12.0, 0.0, 0.88, 2, 1, 1, 0], "CRITICAL"),       # No depth
    ([38.0, 0.0, 40.0, 0.0, 2, 1, 0, 1], "CRITICAL"),
    ([48.0, 42.0, 50.0, 0.85, 3, 1, 1, 1], "CRITICAL"),
    ([22.0, 18.0, 24.0, 0.87, 3, 1, 1, 1], "CRITICAL"),
    ([40.0, 36.0, 42.0, 0.89, 3, 1, 1, 1], "CRITICAL"),
    ([12.0, 10.0, 14.0, 0.86, 3, 1, 1, 1], "CRITICAL"),
    ([32.0, 28.0, 35.0, 0.84, 3, 1, 1, 1], "CRITICAL"),
]


@dataclass
class ClassifierResult:
    """Result from evaluating a single classifier."""
    name: str
    accuracy: float
    precision: float
    recall: float
    f1: float
    cv_mean: float
    cv_std: float
    train_time_ms: float
    predict_time_ms: float
    confusion_matrix: List[List[int]]
    classification_report: str


if HAS_SKLEARN:

    def _build_classifiers() -> Dict[str, Any]:
        """Build all six classifiers with StandardScaler pipelines."""
        classifiers = {
            "Decision Tree": SKPipeline([
                ("scaler", StandardScaler()),
                ("clf", DecisionTreeClassifier(
                    random_state=42,
                    max_depth=10,
                    min_samples_split=5,
                )),
            ]),
            "SVM": SKPipeline([
                ("scaler", StandardScaler()),
                ("clf", SVC(
                    kernel="rbf",
                    C=10.0,
                    gamma="scale",
                    random_state=42,
                    probability=True,
                )),
            ]),
            "KNN": SKPipeline([
                ("scaler", StandardScaler()),
                ("clf", KNeighborsClassifier(
                    n_neighbors=5,
                    weights="distance",
                    metric="minkowski",
                )),
            ]),
            "Random Forest": SKPipeline([
                ("scaler", StandardScaler()),
                ("clf", RandomForestClassifier(
                    n_estimators=100,
                    max_depth=10,
                    min_samples_split=5,
                    random_state=42,
                )),
            ]),
            "Gaussian NB": SKPipeline([
                ("scaler", StandardScaler()),
                ("clf", GaussianNB()),
            ]),
        }

        # Voting Classifier (soft voting — uses predicted probabilities)
        estimators = [
            ("dt", classifiers["Decision Tree"]),
            ("svm", classifiers["SVM"]),
            ("knn", classifiers["KNN"]),
            ("rf", classifiers["Random Forest"]),
            ("gnb", classifiers["Gaussian NB"]),
        ]
        classifiers["Voting Classifier"] = VotingClassifier(
            estimators=estimators,
            voting="soft",
        )

        return classifiers


class NetraSenseMLPipeline:
    """End-to-end ML pipeline for threat-level classification.

    Handles feature engineering, training, evaluation, cross-validation,
    model persistence, and live prediction.
    """

    def __init__(self) -> None:
        if not HAS_SKLEARN:
            raise ImportError(
                "scikit-learn is required. Install with: pip install scikit-learn"
            )
        self._classifiers = _build_classifiers()
        self._trained: Dict[str, Any] = {}
        self._scaler = StandardScaler()
        self._best_name: Optional[str] = None
        self._best_model: Optional[Any] = None

    @staticmethod
    def prepare_features(
        ultrasonic_cm: Optional[float] = None,
        yolo_closest_cm: Optional[float] = None,
        depth_cm: Optional[float] = None,
        yolo_confidence: float = 0.0,
    ) -> List[float]:
        """Convert raw sensor signals into the feature vector."""
        has_u = 1.0 if (ultrasonic_cm is not None and ultrasonic_cm > 0) else 0.0
        has_y = 1.0 if (yolo_closest_cm is not None and yolo_closest_cm > 0) else 0.0
        has_d = 1.0 if (depth_cm is not None and depth_cm > 0) else 0.0
        signal_count = has_u + has_y + has_d

        return [
            ultrasonic_cm or 0.0,
            yolo_closest_cm or 0.0,
            depth_cm or 0.0,
            yolo_confidence,
            signal_count,
            has_u,
            has_y,
            has_d,
        ]

    def load_training_data(
        self,
        data: Optional[List[Tuple[List[float], str]]] = None,
    ) -> Tuple[List[List[float]], List[str]]:
        """Load and return training data as (X, y)."""
        dataset = data or TRAINING_DATA
        X = [features for features, _label in dataset]
        y = [label for _, label in dataset]
        return X, y

    def train(
        self,
        X: List[List[float]],
        y: List[str],
        classifier_name: Optional[str] = None,
    ) -> Dict[str, ClassifierResult]:
        """Train all classifiers (or a specific one) and return results.

        Parameters
        ----------
        X : feature matrix
        y : labels
        classifier_name : if set, only train this classifier

        Returns
        -------
        Dict mapping classifier name → ClassifierResult
        """
        results = {}
        names = [classifier_name] if classifier_name else list(self._classifiers.keys())

        for name in names:
            clf = self._classifiers[name]
            t0 = time.perf_counter()
            clf.fit(X, y)
            train_ms = (time.perf_counter() - t0) * 1000

            t0 = time.perf_counter()
            y_pred = clf.predict(X)
            predict_ms = (time.perf_counter() - t0) * 1000

            acc = accuracy_score(y, y_pred)
            prec = precision_score(y, y_pred, average="macro", zero_division=0)
            rec = recall_score(y, y_pred, average="macro", zero_division=0)
            f1 = f1_score(y, y_pred, average="macro", zero_division=0)
            cm = confusion_matrix(y, y_pred, labels=THREAT_CLASSES).tolist()
            report = classification_report(y, y_pred, labels=THREAT_CLASSES, zero_division=0)

            # Cross-validation (5-fold stratified)
            cv_mean, cv_std = 0.0, 0.0
            if len(set(y)) >= 2:
                try:
                    cv_scores = cross_val_score(
                        clf, X, y,
                        cv=StratifiedKFold(n_splits=min(5, min(len(y) // 2, 10)),
                                           shuffle=True, random_state=42),
                        scoring="accuracy",
                    )
                    cv_mean = float(cv_scores.mean())
                    cv_std = float(cv_scores.std())
                except Exception:
                    pass

            result = ClassifierResult(
                name=name,
                accuracy=round(acc, 4),
                precision=round(prec, 4),
                recall=round(rec, 4),
                f1=round(f1, 4),
                cv_mean=round(cv_mean, 4),
                cv_std=round(cv_std, 4),
                train_time_ms=round(train_ms, 3),
                predict_time_ms=round(predict_ms, 3),
                confusion_matrix=cm,
                classification_report=report,
            )
            results[name] = result
            self._trained[name] = clf

        # Track best model
        if results:
            best = max(results.values(), key=lambda r: r.cv_mean)
            self._best_name = best.name
            self._best_model = self._trained[best.name]

        return results

    def predict(self, X: List[List[float]], classifier_name: Optional[str] = None) -> List[str]:
        """Predict threat levels for new feature vectors."""
        name = classifier_name or self._best_name
        if name not in self._trained:
            raise ValueError(f"Classifier '{name}' not trained. Call train() first.")
        return list(self._trained[name].predict(X))

    def predict_single(
        self,
        ultrasonic_cm: Optional[float] = None,
        yolo_closest_cm: Optional[float] = None,
        depth_cm: Optional[float] = None,
        yolo_confidence: float = 0.0,
        classifier_name: Optional[str] = None,
    ) -> str:
        """Predict threat level for a single reading."""
        features = self.prepare_features(
            ultrasonic_cm, yolo_closest_cm, depth_cm, yolo_confidence
        )
        return self.predict([features], classifier_name)[0]

    def save(self, path: str | Path) -> None:
        """Save the best trained model to disk (pickle)."""
        if self._best_model is None:
            raise ValueError("No model trained yet. Call train() first.")
        path = Path(path)
        path.parent.mkdir(parents=True, exist_ok=True)
        with open(path, "wb") as f:
            pickle.dump({
                "model": self._best_model,
                "name": self._best_name,
                "feature_names": FEATURE_NAMES,
                "classes": THREAT_CLASSES,
            }, f)
        print(f"[ML] Saved best model ({self._best_name}) to {path}")

    def load(self, path: str | Path) -> None:
        """Load a previously saved model from disk."""
        with open(path, "rb") as f:
            data = pickle.load(f)
        self._best_model = data["model"]
        self._best_name = data["name"]
        self._trained[self._best_name] = self._best_model
        print(f"[ML] Loaded model ({self._best_name}) from {path}")

    @property
    def best_classifier_name(self) -> Optional[str]:
        return self._best_name


# ── Standalone benchmark ─────────────────────────────────────────────

def run_benchmark():
    """Full benchmark comparing all classifiers."""
    if not HAS_SKLEARN:
        print("scikit-learn is required. Install with: pip install scikit-learn")
        return

    print("=" * 70)
    print("  NetraSense ML Classifiers — Benchmark")
    print("=" * 70)

    pipeline = NetraSenseMLPipeline()
    X, y = pipeline.load_training_data()

    print(f"\n  Training samples: {len(X)}")
    print(f"  Features: {len(FEATURE_NAMES)}")
    print(f"  Classes: {THREAT_CLASSES}")
    print(f"  Class distribution: { {c: y.count(c) for c in THREAT_CLASSES} }")

    results = pipeline.train(X, y)

    # Print comparison table
    print(f"\n{'Classifier':<22} │ {'Accuracy':>8} │ {'Prec':>6} │ {'Recall':>6} │ {'F1':>6} │ {'CV Mean±Std':>12} │ {'Train':>8} │ {'Predict':>8}")
    print("─" * 105)
    for name in ["Decision Tree", "SVM", "KNN", "Random Forest", "Gaussian NB", "Voting Classifier"]:
        r = results[name]
        cv_str = f"{r.cv_mean:.3f}±{r.cv_std:.3f}" if r.cv_mean > 0 else "N/A"
        marker = " ★" if name == pipeline.best_classifier_name else ""
        print(f"  {name:<20} │ {r.accuracy*100:>7.2f}% │ {r.precision:.4f} │ {r.recall:.4f} │ {r.f1:.4f} │ {cv_str:>12} │ {r.train_time_ms:>7.2f}ms │ {r.predict_time_ms:>7.3f}ms{marker}")

    print("─" * 105)

    # Print confusion matrices for key classifiers
    for name in ["Voting Classifier", "Random Forest", "SVM"]:
        r = results[name]
        print(f"\n  {name} — Confusion Matrix:")
        print(f"  {'':>12} ", end="")
        for lbl in THREAT_CLASSES:
            print(f"{lbl:>10}", end="")
        print()
        for i, lbl in enumerate(THREAT_CLASSES):
            print(f"  {lbl:>10} │", end="")
            for j in range(len(THREAT_CLASSES)):
                print(f"{r.confusion_matrix[i][j]:>10}", end="")
            print()

    # Save best model
    model_dir = Path(__file__).parent / "models"
    pipeline.save(model_dir / "threat_classifier.joblib")

    print("\n" + "=" * 70)
    print("  Benchmark complete.")
    print("=" * 70)


if __name__ == "__main__":
    run_benchmark()
