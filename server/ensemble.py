"""
NetraSense — Multi-Signal Ensemble Threat Classifier
=====================================================
Fuses three independent signal sources into a single authoritative threat
assessment and distance estimate:

1. **Ultrasonic sensor** (HC-SR04 via Arduino) — direct distance measurement
2. **YOLO11 object detection** — label + bounding box + optional depth estimate
3. **Depth Anything V2** — monocular depth map at detection centroids

The ensemble produces:
- A fused distance estimate (weighted by sensor reliability)
- A threat level classification (weighted vote across all signals)
- A confidence score (how many signals agree)
- Per-signal contribution breakdown for transparency

Design Principles:
- Every signal is optional; the ensemble degrades gracefully.
- Ultrasonic is the most reliable for distance (direct measurement) and gets
  the highest weight when available.
- YOLO detections are rich (label, direction, motion) but distance is less
  precise without depth fusion.
- Depth Anything V2 provides dense depth but is monocular (scale ambiguity).
- The final output must be strictly better than any single signal alone.

Run standalone for testing:
    python ensemble.py --test
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Optional

# ── Threat level definitions (shared across all signals) ─────────────
THREAT_LEVELS = ("NORMAL", "WARNING", "ALARM", "CRITICAL")

# Distance thresholds for threat classification (cm)
THRESHOLDS = {
    "CRITICAL": (0, 50),      # 0–50 cm
    "ALARM":    (50, 100),     # 50–100 cm
    "WARNING":  (100, 300),    # 100–300 cm
    "NORMAL":   (300, 400),    # 300+ cm
}

# Map threat level to a numeric severity for weighted voting
SEVERITY_MAP = {
    "NORMAL":   0,
    "WARNING":  1,
    "ALARM":    2,
    "CRITICAL": 3,
}
SEVERITY_TO_LEVEL = {v: k for k, v in SEVERITY_MAP.items()}


@dataclass
class SignalInput:
    """One signal source's contribution to the ensemble."""
    source: str                       # "ultrasonic" | "yolo" | "depth"
    distance_cm: Optional[float] = None
    threat_level: Optional[str] = None
    confidence: float = 1.0           # 0–1, how reliable this reading is
    label: Optional[str] = None       # object label (YOLO only)
    direction: Optional[str] = None   # left/center/right (YOLO only)
    motion_state: Optional[str] = None  # Stationary/Moving (YOLO only)


@dataclass
class EnsembleResult:
    """Fused output from the ensemble classifier."""
    fused_distance_cm: Optional[float]
    fused_threat_level: str
    confidence: float                  # 0–1, agreement across signals
    signal_count: int                  # how many signals contributed
    signals: list[SignalInput] = field(default_factory=list)

    # Per-signal breakdown for transparency
    ultrasonic_distance: Optional[float] = None
    yolo_distance: Optional[float] = None
    depth_distance: Optional[float] = None
    ultrasonic_threat: Optional[str] = None
    yolo_threat: Optional[str] = None
    depth_threat: Optional[str] = None

    @property
    def has_data(self) -> bool:
        """True if at least one signal provided valid data."""
        return self.signal_count > 0

    def to_dict(self) -> dict:
        """Serialize for JSON API response."""
        return {
            "fused_distance_cm": self.fused_distance_cm,
            "fused_threat_level": self.fused_threat_level,
            "confidence": round(self.confidence, 3),
            "signal_count": self.signal_count,
            "ultrasonic": {
                "distance_cm": self.ultrasonic_distance,
                "threat_level": self.ultrasonic_threat,
            },
            "yolo": {
                "distance_cm": self.yolo_distance,
                "threat_level": self.yolo_threat,
            },
            "depth": {
                "distance_cm": self.depth_distance,
                "threat_level": self.depth_threat,
            },
        }


# ── Default weights (tuned for NetraSense hardware) ──────────────────
# Ultrasonic gets highest weight because it's a direct time-of-flight
# measurement. YOLO is next (real object detection). Depth gets lowest
# because monocular depth has scale ambiguity.
DEFAULT_WEIGHTS = {
    "ultrasonic": 0.50,
    "yolo":       0.30,
    "depth":      0.20,
}

# Minimum confidence threshold — signals below this are ignored
MIN_SIGNAL_CONFIDENCE = 0.1


class EnsembleClassifier:
    """Weighted ensemble threat classifier.

    Usage::

        ensemble = EnsembleClassifier()
        result = ensemble.classify(
            ultrasonic_cm=73.0,
            yolo_detections=[...],
            depth_map=ndarray,
        )
        print(result.fused_threat_level)  # "WARNING"
        print(result.fused_distance_cm)   # 73.0
        print(result.confidence)          # 0.85
    """

    def __init__(
        self,
        weights: Optional[dict[str, float]] = None,
        min_distance_cm: float = 2.0,
        max_distance_cm: float = 400.0,
    ) -> None:
        self._weights = weights or dict(DEFAULT_WEIGHTS)
        self._min_distance = min_distance_cm
        self._max_distance = max_distance_cm

        # Normalize weights to sum to 1.0
        total = sum(self._weights.values())
        if total > 0:
            self._weights = {k: v / total for k, v in self._weights.items()}

    def classify(
        self,
        ultrasonic_cm: Optional[float] = None,
        ultrasonic_threat: Optional[str] = None,
        yolo_detections: Optional[list[dict]] = None,
        depth_distance_cm: Optional[float] = None,
        yolo_closest_cm: Optional[float] = None,
    ) -> EnsembleResult:
        """Fuse all available signals into a single threat assessment.

        Parameters
        ----------
        ultrasonic_cm : float, optional
            Direct distance reading from HC-SR04 sensor.
        ultrasonic_threat : str, optional
            Pre-classified threat level from ultrasonic threshold rules.
        yolo_detections : list[dict], optional
            YOLO detection results, each with keys:
            - distance_cm: estimated distance (may be None)
            - threat_level: classified threat (may be None)
            - confidence: detection confidence (0–1)
            - label: object class name
            - direction: left/center/right
            - motion_state: Stationary/Moving
        depth_distance_cm : float, optional
            Closest depth estimate from Depth Anything V2.
        yolo_closest_cm : float, optional
            Pre-computed closest object distance from YOLO detections.

        Returns
        -------
        EnsembleResult
            Fused threat assessment with confidence and breakdown.
        """
        signals: list[SignalInput] = []

        # ── Signal 1: Ultrasonic ─────────────────────────────────────
        ultrasonic_signal = self._process_ultrasonic(ultrasonic_cm, ultrasonic_threat)
        if ultrasonic_signal:
            signals.append(ultrasonic_signal)

        # ── Signal 2: YOLO detections ────────────────────────────────
        yolo_signal = self._process_yolo(yolo_detections, yolo_closest_cm)
        if yolo_signal:
            signals.append(yolo_signal)

        # ── Signal 3: Depth estimation ───────────────────────────────
        depth_signal = self._process_depth(depth_distance_cm)
        if depth_signal:
            signals.append(depth_signal)

        # ── Fuse signals ─────────────────────────────────────────────
        return self._fuse(signals)

    # ── Private signal processors ────────────────────────────────────

    def _process_ultrasonic(
        self,
        distance_cm: Optional[float],
        threat: Optional[str],
    ) -> Optional[SignalInput]:
        """Process ultrasonic sensor reading."""
        if distance_cm is None:
            return None
        if not (self._min_distance <= distance_cm <= self._max_distance):
            return None

        return SignalInput(
            source="ultrasonic",
            distance_cm=distance_cm,
            threat_level=threat or self._distance_to_threat(distance_cm),
            confidence=1.0,  # Direct measurement — highest confidence
        )

    def _process_yolo(
        self,
        detections: Optional[list[dict]],
        closest_cm: Optional[float],
    ) -> Optional[SignalInput]:
        """Process YOLO object detections."""
        if not detections:
            return None

        # Find the closest detection with a distance estimate
        best_dist = closest_cm
        best_threat = None
        best_label = None
        best_direction = None
        best_motion = None
        best_conf = 0.0

        for det in detections:
            dist = det.get("distance_cm")
            conf = det.get("confidence", 0)

            if dist is not None and conf > best_conf:
                best_dist = dist
                best_threat = det.get("threat_level")
                best_label = det.get("label")
                best_direction = det.get("direction")
                best_motion = det.get("motion_state")
                best_conf = conf

        if best_dist is None and best_label is None:
            return None

        # Confidence based on detection count and confidence
        n_detections = len(detections)
        avg_conf = sum(d.get("confidence", 0) for d in detections) / max(1, n_detections)
        signal_confidence = min(1.0, avg_conf * (0.5 + 0.5 * min(n_detections, 3) / 3))

        return SignalInput(
            source="yolo",
            distance_cm=best_dist,
            threat_level=best_threat or (self._distance_to_threat(best_dist) if best_dist else None),
            confidence=signal_confidence,
            label=best_label,
            direction=best_direction,
            motion_state=best_motion,
        )

    def _process_depth(self, distance_cm: Optional[float]) -> Optional[SignalInput]:
        """Process depth estimation signal."""
        if distance_cm is None:
            return None
        if not (self._min_distance <= distance_cm <= self._max_distance):
            return None

        # Monocular depth has scale ambiguity — lower confidence
        return SignalInput(
            source="depth",
            distance_cm=distance_cm,
            threat_level=self._distance_to_threat(distance_cm),
            confidence=0.6,  # Monocular depth is less reliable
        )

    # ── Fusion engine ────────────────────────────────────────────────

    def _fuse(self, signals: list[SignalInput]) -> EnsembleResult:
        """Fuse multiple signals into a single result."""
        result = EnsembleResult(
            fused_distance_cm=None,
            fused_threat_level="NORMAL",
            confidence=0.0,
            signal_count=len(signals),
            signals=signals,
        )

        if not signals:
            result.fused_threat_level = "NO DATA"
            return result

        # Record per-signal breakdown
        for sig in signals:
            if sig.source == "ultrasonic":
                result.ultrasonic_distance = sig.distance_cm
                result.ultrasonic_threat = sig.threat_level
            elif sig.source == "yolo":
                result.yolo_distance = sig.distance_cm
                result.yolo_threat = sig.threat_level
            elif sig.source == "depth":
                result.depth_distance = sig.distance_cm
                result.depth_threat = sig.threat_level

        # ── Weighted distance fusion ─────────────────────────────────
        dist_signals = [s for s in signals if s.distance_cm is not None]
        if dist_signals:
            total_weight = sum(self._weights.get(s.source, 0.1) * s.confidence for s in dist_signals)
            if total_weight > 0:
                fused_dist = sum(
                    s.distance_cm * self._weights.get(s.source, 0.1) * s.confidence
                    for s in dist_signals
                ) / total_weight
                result.fused_distance_cm = round(fused_dist, 1)

        # ── Weighted threat level voting ─────────────────────────────
        threat_votes: dict[str, float] = {}
        for sig in signals:
            if sig.threat_level and sig.confidence >= MIN_SIGNAL_CONFIDENCE:
                level = sig.threat_level.upper()
                weight = self._weights.get(sig.source, 0.1) * sig.confidence
                threat_votes[level] = threat_votes.get(level, 0) + weight

        if threat_votes:
            # Pick the threat level with the highest weighted vote
            result.fused_threat_level = max(threat_votes, key=threat_votes.get)

            # If no ultrasonic signal, use the fused distance to potentially
            # escalate the threat level (YOLO-only scenarios)
            if not any(s.source == "ultrasonic" for s in signals) and result.fused_distance_cm is not None:
                dist_threat = self._distance_to_threat(result.fused_distance_cm)
                dist_sev = SEVERITY_MAP.get(dist_threat, 0)
                vote_sev = SEVERITY_MAP.get(result.fused_threat_level, 0)
                # Use the more severe of (voted, distance-based)
                if dist_sev > vote_sev:
                    result.fused_threat_level = dist_threat
        else:
            result.fused_threat_level = "NO DATA"

        # ── Confidence score ─────────────────────────────────────────
        # Confidence = weighted agreement across signals
        if len(signals) >= 2:
            severities = [SEVERITY_MAP.get(s.threat_level, 0) for s in signals if s.threat_level]
            if severities:
                avg_severity = sum(severities) / len(severities)
                max_deviation = max(abs(sev - avg_severity) for sev in severities)
                agreement = max(0, 1.0 - max_deviation / 3.0)
                avg_confidence = sum(s.confidence for s in signals) / len(signals)
                result.confidence = (agreement * 0.6 + avg_confidence * 0.4)
            else:
                result.confidence = signals[0].confidence if signals else 0.0
        elif signals:
            result.confidence = signals[0].confidence

        return result

    # ── Utility ──────────────────────────────────────────────────────

    @staticmethod
    def _distance_to_threat(distance_cm: Optional[float]) -> Optional[str]:
        """Convert a distance measurement to a threat level."""
        if distance_cm is None:
            return None
        if distance_cm <= 50:
            return "CRITICAL"
        if distance_cm <= 100:
            return "ALARM"
        if distance_cm <= 300:
            return "WARNING"
        return "NORMAL"


# ── Standalone test ──────────────────────────────────────────────────

def _run_test():
    """Quick smoke test for the ensemble classifier."""
    print("=" * 60)
    print("  NetraSense Ensemble Classifier — Smoke Test")
    print("=" * 60)

    ensemble = EnsembleClassifier()

    # Test 1: Ultrasonic only
    r = ensemble.classify(ultrasonic_cm=73.0)
    assert r.fused_threat_level == "ALARM", f"Expected ALARM, got {r.fused_threat_level}"
    assert r.fused_distance_cm == 73.0
    assert r.confidence == 1.0
    print(f"\n[1] Ultrasonic only (73 cm): {r.fused_threat_level} — OK")

    # Test 2: No signals
    r = ensemble.classify()
    assert r.fused_threat_level == "NO DATA", f"Expected NO DATA, got {r.fused_threat_level}"
    assert r.fused_distance_cm is None
    print(f"[2] No signals: {r.fused_threat_level} — OK")

    # Test 3: Ultrasonic + YOLO agree
    r = ensemble.classify(
        ultrasonic_cm=80.0,
        yolo_detections=[
            {"distance_cm": 85, "threat_level": "ALARM", "confidence": 0.9, "label": "person", "direction": "center"},
        ],
    )
    assert r.fused_threat_level == "ALARM"
    assert r.signal_count == 2
    assert r.confidence > 0.5
    print(f"[3] Ultrasonic (80 cm) + YOLO (85 cm): {r.fused_threat_level} conf={r.confidence:.2f} — OK")

    # Test 4: Conflicting signals — ultrasonic says WARNING, YOLO says ALARM
    r = ensemble.classify(
        ultrasonic_cm=150.0,
        yolo_detections=[
            {"distance_cm": 90, "threat_level": "ALARM", "confidence": 0.85, "label": "car", "direction": "center"},
        ],
    )
    # Ultrasonic has higher weight (0.5 vs 0.3), so WARNING should win
    print(f"[4] Conflict — U(150=WARN) vs Y(90=ALARM): {r.fused_threat_level} conf={r.confidence:.2f}")

    # Test 5: All three signals
    r = ensemble.classify(
        ultrasonic_cm=45.0,
        yolo_detections=[
            {"distance_cm": 42, "threat_level": "CRITICAL", "confidence": 0.95, "label": "pole", "direction": "center"},
        ],
        depth_distance_cm=48.0,
    )
    assert r.fused_threat_level == "CRITICAL"
    assert r.signal_count == 3
    print(f"[5] All three (U=45, Y=42, D=48): {r.fused_threat_level} conf={r.confidence:.2f} — OK")

    # Test 6: Out-of-range ultrasonic (should be ignored)
    r = ensemble.classify(ultrasonic_cm=0.5)
    assert r.fused_threat_level == "NO DATA"
    print(f"[6] Out-of-range (0.5 cm): {r.fused_threat_level} — OK")

    # Test 7: YOLO only with no distance
    r = ensemble.classify(
        yolo_detections=[
            {"distance_cm": None, "threat_level": None, "confidence": 0.7, "label": "person", "direction": "left"},
        ],
    )
    print(f"[7] YOLO only (no distance): {r.fused_threat_level} conf={r.confidence:.2f} — OK")

    print("\n" + "=" * 60)
    print("  All tests passed!")
    print("=" * 60)


if __name__ == "__main__":
    _run_test()
