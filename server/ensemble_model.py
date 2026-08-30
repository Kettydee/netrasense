"""
NetraSense Multi-Modal Sensor Fusion & Ensemble Model
Fuses Ultrasonic Sensor Distance + YOLO Vision Object Detection + Monocular Depth Estimation.
Provides weighted probabilistic threat assessment, safety overrides, and explainable sensor contributions.
"""

from __future__ import annotations

from dataclasses import dataclass, field
import math
from typing import Any, Dict, List, Optional, Tuple


# Class-specific risk weighting factors
CLASS_RISK_WEIGHTS: Dict[str, float] = {
    # High Risk Obstacles (Moving or large collision hazards)
    "car": 1.0,
    "truck": 1.0,
    "bus": 1.0,
    "motorcycle": 0.95,
    "bicycle": 0.90,
    "person": 0.85,
    "stairs": 1.0,
    "fire hydrant": 0.80,
    "stop sign": 0.75,
    "train": 1.0,
    
    # Medium Risk Obstacles (Stationary room furniture)
    "chair": 0.60,
    "couch": 0.65,
    "dining table": 0.70,
    "bed": 0.60,
    "door": 0.65,
    "refrigerator": 0.70,
    "tv": 0.50,
    "bench": 0.60,
    
    # Low Risk (Small handheld objects)
    "bottle": 0.30,
    "cup": 0.25,
    "laptop": 0.40,
    "cell phone": 0.20,
    "book": 0.20,
    "backpack": 0.45,
    "suitcase": 0.55,
}

DEFAULT_RISK_WEIGHT = 0.50


@dataclass
class FusedThreatResult:
    threat_level: str               # "Normal" | "Warning" | "Alarming" | "Collision"
    threat_score: float             # 0.0 to 1.0
    fused_distance_cm: float        # Consensus distance
    dominant_modality: str          # "ultrasonic" | "yolo_vision" | "depth_estimation"
    confidence: float               # 0.0 to 1.0
    recommended_action: str         # Spoken directive
    modality_breakdown: Dict[str, Any] = field(default_factory=dict)


class MultiModalEnsembleModel:
    """
    Weighted Bayesian & Heuristic Multi-Modal Sensor Fusion Engine.
    """

    def __init__(
        self,
        weight_ultrasonic: float = 0.40,
        weight_yolo: float = 0.35,
        weight_depth: float = 0.25,
        collision_thresh_cm: float = 40.0,
        alarming_thresh_cm: float = 100.0,
        warning_thresh_cm: float = 200.0
    ) -> None:
        self.w_ultra = weight_ultrasonic
        self.w_yolo = weight_yolo
        self.w_depth = weight_depth
        
        self.collision_thresh = collision_thresh_cm
        self.alarming_thresh = alarming_thresh_cm
        self.warning_thresh = warning_thresh_cm

    def _score_ultrasonic(self, distance_cm: Optional[float]) -> Tuple[float, float]:
        """Compute threat score [0, 1] and confidence for ultrasonic distance."""
        if distance_cm is None or distance_cm <= 0 or distance_cm > 400:
            return 0.0, 0.0  # Zero confidence if disconnected

        # Inverse distance response
        if distance_cm <= self.collision_thresh:
            score = 1.0
        elif distance_cm <= self.alarming_thresh:
            score = 0.70 + 0.30 * (1.0 - (distance_cm - self.collision_thresh) / (self.alarming_thresh - self.collision_thresh))
        elif distance_cm <= self.warning_thresh:
            score = 0.30 + 0.40 * (1.0 - (distance_cm - self.alarming_thresh) / (self.warning_thresh - self.alarming_thresh))
        else:
            score = 0.30 * max(0.0, 1.0 - (distance_cm - self.warning_thresh) / 200.0)

        # Ultrasonic is highly confident in physical close range (under 2m)
        confidence = 0.95 if distance_cm < 200 else 0.75
        return round(score, 4), round(confidence, 2)

    def _score_yolo(
        self,
        detections: Optional[List[Dict[str, Any]]]
    ) -> Tuple[float, float, str, float]:
        """
        Compute threat score [0, 1], confidence, primary label, and estimated distance from YOLO detections.
        """
        if not detections:
            return 0.0, 0.5, "clear", 400.0

        max_score = 0.0
        top_label = "object"
        top_conf = 0.0
        est_dist = 400.0

        for det in detections:
            label = det.get("label", det.get("class", "object")).lower()
            conf = float(det.get("confidence", 0.8))
            box = det.get("box", [0, 0, 0, 0])
            
            # Relative screen area heuristic (larger bbox = closer)
            bw = abs(box[2] - box[0])
            bh = abs(box[3] - box[1])
            rel_area = (bw * bh) / (640.0 * 480.0) if bw > 0 and bh > 0 else 0.05

            risk_multiplier = CLASS_RISK_WEIGHTS.get(label, DEFAULT_RISK_WEIGHT)
            
            # Threat score combining class risk + proximity area
            proximity_factor = min(1.0, math.sqrt(rel_area) * 2.2)
            det_score = risk_multiplier * 0.40 + proximity_factor * 0.60

            if det_score > max_score:
                max_score = det_score
                top_label = label
                top_conf = conf
                # Approximate distance from relative area
                est_dist = max(20.0, min(400.0, (1.0 / (math.sqrt(rel_area) + 0.05)) * 40.0))

        return round(max_score, 4), round(top_conf, 2), top_label, round(est_dist, 1)

    def _score_depth(self, depth_meters: Optional[float]) -> Tuple[float, float, float]:
        """Compute threat score [0, 1], confidence, and distance from Monocular Depth estimation."""
        if depth_meters is None or depth_meters <= 0:
            return 0.0, 0.0, 400.0

        depth_cm = depth_meters * 100.0
        if depth_cm <= self.collision_thresh:
            score = 1.0
        elif depth_cm <= self.alarming_thresh:
            score = 0.75 + 0.25 * (1.0 - (depth_cm - self.collision_thresh) / (self.alarming_thresh - self.collision_thresh))
        elif depth_cm <= self.warning_thresh:
            score = 0.35 + 0.40 * (1.0 - (depth_cm - self.alarming_thresh) / (self.warning_thresh - self.alarming_thresh))
        else:
            score = 0.20 * max(0.0, 1.0 - (depth_cm - self.warning_thresh) / 300.0)

        confidence = 0.85 if depth_cm < 300 else 0.65
        return round(score, 4), round(confidence, 2), round(depth_cm, 1)

    def fuse(
        self,
        ultrasonic_distance_cm: Optional[float] = None,
        yolo_detections: Optional[List[Dict[str, Any]]] = None,
        depth_meters: Optional[float] = None
    ) -> FusedThreatResult:
        """
        Execute multi-signal ensemble fusion and return consolidated threat assessment.
        """
        # 1. Evaluate individual signals
        s_ultra, c_ultra = self._score_ultrasonic(ultrasonic_distance_cm)
        s_yolo, c_yolo, top_label, yolo_dist_cm = self._score_yolo(yolo_detections)
        s_depth, c_depth, depth_dist_cm = self._score_depth(depth_meters)

        # 2. Dynamic Weight Normalization based on active sensor availability
        weights = {
            "ultrasonic": self.w_ultra * c_ultra,
            "yolo_vision": self.w_yolo * c_yolo,
            "depth_estimation": self.w_depth * c_depth
        }
        total_w = sum(weights.values())

        if total_w > 0:
            norm_w = {k: v / total_w for k, v in weights.items()}
        else:
            norm_w = {"ultrasonic": 0.33, "yolo_vision": 0.33, "depth_estimation": 0.34}

        # 3. Weighted fused threat score
        fused_score = (
            norm_w["ultrasonic"] * s_ultra +
            norm_w["yolo_vision"] * s_yolo +
            norm_w["depth_estimation"] * s_depth
        )

        # 4. Consensus distance calculation
        active_distances = []
        if c_ultra > 0:
            active_distances.append((ultrasonic_distance_cm, norm_w["ultrasonic"]))
        if c_yolo > 0 and top_label != "clear":
            active_distances.append((yolo_dist_cm, norm_w["yolo_vision"]))
        if c_depth > 0:
            active_distances.append((depth_dist_cm, norm_w["depth_estimation"]))

        if active_distances:
            sum_dist_w = sum(w for _, w in active_distances)
            consensus_dist = sum(d * w for d, w in active_distances) / sum_dist_w
        else:
            consensus_dist = 400.0

        # 5. Safety Override: If ANY sensor detects imminent collision (< 40cm), force Collision level
        is_imminent_collision = (
            (ultrasonic_distance_cm is not None and 0 < ultrasonic_distance_cm <= self.collision_thresh) or
            (depth_meters is not None and 0 < depth_meters <= 0.40) or
            (fused_score >= 0.82)
        )

        if is_imminent_collision:
            threat_level = "Collision"
            recommended_action = f"EMERGENCY: Stop immediately! {top_label.capitalize()} at close range."
            fused_score = max(fused_score, 0.90)
        elif fused_score >= 0.55 or consensus_dist <= self.alarming_thresh:
            threat_level = "Alarming"
            recommended_action = f"Hazard ahead: {top_label.capitalize()} nearby. Slow down."
        elif fused_score >= 0.28 or consensus_dist <= self.warning_thresh:
            threat_level = "Warning"
            recommended_action = f"Caution: {top_label.capitalize()} detected ahead."
        else:
            threat_level = "Normal"
            recommended_action = "Path clear. Proceed safely."

        # Find dominant modality
        dominant = max(norm_w, key=norm_w.get)
        valid_confs = [c for c in [c_ultra, c_yolo, c_depth] if c > 0]
        mean_conf = round(sum(valid_confs) / len(valid_confs) if valid_confs else 0.70, 2)

        return FusedThreatResult(
            threat_level=threat_level,
            threat_score=round(float(fused_score), 3),
            fused_distance_cm=round(float(consensus_dist), 1),
            dominant_modality=dominant,
            confidence=mean_conf,
            recommended_action=recommended_action,
            modality_breakdown={
                "ultrasonic": {
                    "raw_distance_cm": ultrasonic_distance_cm,
                    "threat_score": s_ultra,
                    "normalized_weight": round(norm_w["ultrasonic"], 3)
                },
                "yolo_vision": {
                    "primary_object": top_label,
                    "estimated_distance_cm": yolo_dist_cm,
                    "threat_score": s_yolo,
                    "normalized_weight": round(norm_w["yolo_vision"], 3)
                },
                "depth_estimation": {
                    "depth_meters": depth_meters,
                    "threat_score": s_depth,
                    "normalized_weight": round(norm_w["depth_estimation"], 3)
                }
            }
        )


if __name__ == "__main__":
    ensemble = MultiModalEnsembleModel()
    
    # Test Scenario A: Person approaching at 85cm with ultrasonic and YOLO agreement
    print("[TEST 1] Testing Obstacle Encounter:")
    result = ensemble.fuse(
        ultrasonic_distance_cm=85.0,
        yolo_detections=[{"label": "person", "confidence": 0.92, "box": [150, 80, 420, 460]}],
        depth_meters=0.90
    )
    print(f"  Threat Level      : {result.threat_level}")
    print(f"  Threat Score      : {result.threat_score}")
    print(f"  Consensus Distance: {result.fused_distance_cm} cm")
    print(f"  Dominant Modality : {result.dominant_modality}")
    print(f"  Spoken Action     : {result.recommended_action}")
    print(f"  Breakdown         : {result.modality_breakdown}\n")

    # Test Scenario B: Imminent physical collision at 25cm
    print("[TEST 2] Testing Imminent Collision:")
    result2 = ensemble.fuse(
        ultrasonic_distance_cm=25.0,
        yolo_detections=[{"label": "chair", "confidence": 0.88, "box": [100, 50, 550, 470]}],
        depth_meters=0.28
    )
    print(f"  Threat Level      : {result2.threat_level}")
    print(f"  Threat Score      : {result2.threat_score}")
    print(f"  Action            : {result2.recommended_action}")
