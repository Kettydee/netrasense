"""Optional second-detector adapter for NetraSense.

Does not modify the existing YOLO server or its routes. Integrate via
fuse_detections(existing_detections, additional_detections) after running both
models on the SAME camera frame.
"""
from __future__ import annotations
from typing import Any

COCO_LABELS = {0: "person", 1: "bicycle", 2: "car", 3: "motorcycle", 5: "bus", 7: "truck"}

def normalize_label(label: str) -> str:
    return label.strip().lower().replace("_", " ")

def _iou(a: list[float], b: list[float]) -> float:
    ax1, ay1, ax2, ay2 = a
    bx1, by1, bx2, by2 = b
    intersection = max(0.0, min(ax2, bx2) - max(ax1, bx1)) * max(0.0, min(ay2, by2) - max(ay1, by1))
    area_a = max(0.0, ax2 - ax1) * max(0.0, ay2 - ay1)
    area_b = max(0.0, bx2 - bx1) * max(0.0, by2 - by1)
    return intersection / max(area_a + area_b - intersection, 1e-9)

def fuse_detections(
    existing: list[dict[str, Any]],
    additional: list[dict[str, Any]],
    iou_threshold: float = 0.55,
) -> list[dict[str, Any]]:
    """Class-aware non-max suppression; preserve existing fields and measured distances.

    Inputs must have 'label', 'confidence', 'bbox' (xyxy pixel coordinates).
    This is NOT evidence of better accuracy: benchmark on your actual scenes.
    """
    if not 0 < iou_threshold < 1:
        raise ValueError("iou_threshold must be between 0 and 1")
    merged = []
    for source, detections in (("existing", existing), ("ultralytics", additional)):
        for item in detections:
            box = item.get("bbox")
            if not isinstance(box, (list, tuple)) or len(box) != 4:
                continue
            try:
                coords = [float(v) for v in box]
                confidence = float(item.get("confidence", 0))
            except (TypeError, ValueError):
                continue
            if not 0 <= confidence <= 1 or not all(v == v and abs(v) < float("inf") for v in coords):
                continue
            if coords[2] <= coords[0] or coords[3] <= coords[1]:
                continue
            merged.append({**item, "bbox": coords, "confidence": confidence, "source": source})
    merged.sort(key=lambda d: d["confidence"], reverse=True)
    kept: list[dict[str, Any]] = []
    for candidate in merged:
        if any(normalize_label(candidate["label"]) == normalize_label(prev["label"])
               and _iou(candidate["bbox"], prev["bbox"]) >= iou_threshold for prev in kept):
            continue
        kept.append(candidate)
    return kept

class OptionalUltralyticsDetector:
    """Loads only when enabled. Requires: pip install ultralytics."""
    def __init__(self, weights: str = "yolo26s.pt", confidence: float = 0.35):
        from ultralytics import YOLO
        self.model = YOLO(weights)
        self.confidence = confidence

    def detect(self, frame: Any) -> list[dict[str, Any]]:
        output = self.model.predict(source=frame, conf=self.confidence, verbose=False)[0]
        height, width = frame.shape[:2]
        detections = []
        for box in output.boxes:
            x1, y1, x2, y2 = (float(x) for x in box.xyxy[0].tolist())
            class_id = int(box.cls[0])
            label = str(output.names[class_id])
            cx = (x1 + x2) / 2
            direction = "left" if cx < width / 3 else "right" if cx > 2 * width / 3 else "center"
            detections.append({
                "label": label,
                "confidence": float(box.conf[0]),
                "bbox": [x1, y1, x2, y2],
                "direction": direction,
                "distance_cm": None,  # NEVER fabricate distance from a 2D box
                "threat_level": "Normal",  # visual class alone cannot establish collision risk
            })
        return detections
