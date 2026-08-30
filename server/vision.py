"""
NetraSense / Blind's Eye — Vision Pipeline & Spatial Awareness
==============================================================
Runs YOLO11 object detection, spatial zone classification (Left, Center, Right),
threat level mapping, and monocular depth estimation.
"""

from __future__ import annotations

import time
import threading
from dataclasses import dataclass, field
from typing import Optional

import cv2
import numpy as np

# ─────────────────────────────────────────────────────────────────────────
# Context-Aware Filtering Categories
# ─────────────────────────────────────────────────────────────────────────
INDOOR_CLASSES = {
    "person", "cat", "dog", "chair", "couch", "potted plant", "bed", 
    "dining table", "toilet", "tv", "laptop", "mouse", "remote", "keyboard", 
    "cell phone", "microwave", "oven", "toaster", "sink", "refrigerator", 
    "book", "clock", "vase", "scissors", "teddy bear", "hair drier", 
    "toothbrush", "backpack", "umbrella", "handbag", "tie", "bottle", 
    "wine glass", "cup", "fork", "knife", "spoon", "bowl", "banana", 
    "apple", "sandwich", "orange", "broccoli", "carrot", "hot dog", "pizza", 
    "donut", "cake"
}

OUTDOOR_CLASSES = {
    "person", "bicycle", "car", "motorcycle", "airplane", "bus", "train", 
    "truck", "boat", "traffic light", "fire hydrant", "stop sign", 
    "parking meter", "bench", "bird", "cat", "dog", "horse", "sheep", "cow", 
    "elephant", "bear", "zebra", "giraffe", "backpack", "umbrella", "handbag"
}


@dataclass
class Detection:
    """A single detected object with spatial metadata and threat classification."""
    label: str
    confidence: float
    x1: int
    y1: int
    x2: int
    y2: int
    cx: int               # centroid x
    cy: int               # centroid y
    direction: str        # "left" | "center" | "right"
    depth_meters: Optional[float] = None
    distance_cm: Optional[int] = None
    threat_level: str = "Normal"  # "Normal" | "Warning" | "Alarming" | "Collision"
    motion_state: str = "Stationary"  # "Stationary" | "Moving"


@dataclass
class FrameResult:
    """Result bundle for one processed frame."""
    frame: np.ndarray
    detections: list[Detection] = field(default_factory=list)
    depth_map: Optional[np.ndarray] = None
    timestamp: float = 0.0


def get_direction(cx: int, frame_width: int) -> str:
    """Return left / center / right depending on horizontal position."""
    if cx < frame_width / 3:
        return "left"
    elif cx < 2 * frame_width / 3:
        return "center"
    else:
        return "right"


def classify_distance(distance_cm: int) -> str:
    """NetraSense threat level classification based on distance."""
    if distance_cm <= 40:
        return "Collision"
    elif distance_cm <= 100:
        return "Alarming"
    elif distance_cm <= 200:
        return "Warning"
    return "Normal"


class VisionPipeline:
    """
    Threaded vision pipeline that runs YOLO and Depth Anything V2 in parallel.
    """

    def __init__(
        self,
        yolo_model,
        depth_session=None,
        confidence: float = 0.5,
        frame_width: int = 640,
        depth_scale: float = 3.0,
        mode: str = "all",
    ) -> None:
        self._yolo = yolo_model
        self._depth = depth_session
        self._confidence = confidence
        self._frame_width = frame_width
        self._depth_scale = depth_scale
        self._prev_tracks: dict[str, tuple[int, int, float]] = {}
        
        self.set_mode(mode)

        self._depth_input_name: Optional[str] = None
        self._depth_input_shape: Optional[tuple] = None
        if self._depth is not None:
            try:
                inp = self._depth.get_inputs()[0]
                self._depth_input_name = inp.name
                shape = inp.shape[2:]
                if not isinstance(shape[0], int) or not isinstance(shape[1], int):
                    self._depth_input_shape = (518, 518)
                else:
                    self._depth_input_shape = tuple(shape)
            except Exception:
                self._depth_input_shape = (518, 518)

    def set_mode(self, mode: str):
        self._mode = mode.lower()
        if self._mode == "indoor":
            self._allowed_classes = INDOOR_CLASSES
        elif self._mode == "outdoor":
            self._allowed_classes = OUTDOOR_CLASSES
        else:
            self._allowed_classes = None

    def set_confidence(self, conf: float):
        self._confidence = max(0.1, min(0.95, conf))

    def process_frame(self, frame: np.ndarray) -> FrameResult:
        h, w = frame.shape[:2]
        if w != self._frame_width:
            scale = self._frame_width / float(w)
            frame = cv2.resize(frame, (self._frame_width, int(h * scale)))
            h, w = frame.shape[:2]

        depth_map: Optional[np.ndarray] = None
        depth_error: Optional[Exception] = None

        t_dep = None
        if self._depth is not None:
            def _run_depth():
                nonlocal depth_map, depth_error
                try:
                    depth_map = self._estimate_depth(frame)
                except Exception as e:
                    depth_error = e

            t_dep = threading.Thread(target=_run_depth, name="da-v2-depth")
            t_dep.start()

        det_result: list[Detection] = []
        try:
            det_result = self._detect(frame, w, h)
        except Exception as e:
            print(f"[VISION] Detection error: {e}")

        if t_dep is not None:
            t_dep.join()

        # Fuse detections with depth map if available
        if depth_map is not None and det_result:
            dh, dw = depth_map.shape[:2]
            scale_x = dw / w
            scale_y = dh / h
            for det in det_result:
                dx = int(det.cx * scale_x)
                dy = int(det.cy * scale_y)
                dx = min(max(dx, 0), dw - 1)
                dy = min(max(dy, 0), dh - 1)
                depth_m = round(float(depth_map[dy, dx]), 2)
                det.depth_meters = depth_m
                det.distance_cm = int(depth_m * 100)
                det.threat_level = classify_distance(det.distance_cm)

        return FrameResult(
            frame=frame,
            detections=det_result,
            depth_map=depth_map,
            timestamp=time.time(),
        )

    def draw_overlays(self, result: FrameResult) -> np.ndarray:
        frame = result.frame.copy()
        h, w = frame.shape[:2]

        # Threat level color mapping (BGR)
        threat_colors = {
            "Collision": (40, 40, 235),   # Red
            "Alarming":  (0, 140, 255),   # Orange
            "Warning":   (0, 215, 255),   # Amber/Yellow
            "Normal":    (210, 160, 50),  # Blue/Cyan
        }

        for det in result.detections:
            color = threat_colors.get(det.threat_level, (210, 160, 50))
            
            # Draw rounded box / rectangle
            cv2.rectangle(frame, (det.x1, det.y1), (det.x2, det.y2), color, 2)

            # Label text
            parts = [det.label.capitalize(), f"({det.direction})"]
            if det.depth_meters is not None:
                parts.append(f"{det.depth_meters:.1f}m")
            else:
                parts.append(f"{int(det.confidence * 100)}%")
            
            label_text = " ".join(parts)

            # Text background badge
            (tw, th), _ = cv2.getTextSize(label_text, cv2.FONT_HERSHEY_SIMPLEX, 0.55, 2)
            bg_y1 = max(0, det.y1 - th - 8)
            bg_y2 = max(th + 8, det.y1)
            cv2.rectangle(frame, (det.x1, bg_y1), (det.x1 + tw + 10, bg_y2), color, -1)

            cv2.putText(
                frame, label_text,
                (det.x1 + 5, bg_y2 - 5),
                cv2.FONT_HERSHEY_SIMPLEX, 0.55, (255, 255, 255), 2,
            )

        # Direction guide lines (subtle thirds)
        line_color = (80, 80, 80)
        cv2.line(frame, (w // 3, 0), (w // 3, h), line_color, 1)
        cv2.line(frame, (2 * w // 3, 0), (2 * w // 3, h), line_color, 1)

        # Zone labels at bottom
        font = cv2.FONT_HERSHEY_SIMPLEX
        cv2.putText(frame, "LEFT", (15, h - 15), font, 0.45, (160, 160, 160), 1)
        cv2.putText(frame, "CENTER", (w // 3 + 15, h - 15), font, 0.45, (160, 160, 160), 1)
        cv2.putText(frame, "RIGHT", (2 * w // 3 + 15, h - 15), font, 0.45, (160, 160, 160), 1)

        return frame

    def _detect(self, frame: np.ndarray, frame_w: int, frame_h: int) -> list[Detection]:
        if self._yolo is None:
            return []

        yolo_res = self._yolo(frame, conf=self._confidence, verbose=False)[0]
        detections: list[Detection] = []
        names = self._yolo.names

        for box in yolo_res.boxes:
            conf = float(box.conf[0])
            if conf < self._confidence:
                continue

            cls_id = int(box.cls[0])
            label = names[cls_id]
            
            if self._allowed_classes and label not in self._allowed_classes:
                continue

            xyxy = box.xyxy[0].cpu().numpy()
            x1, y1, x2, y2 = map(int, xyxy)
            cx = (x1 + x2) // 2
            cy = (y1 + y2) // 2
            direction = get_direction(cx, frame_w)

            # Heuristic distance estimation if depth model is not loaded:
            # Bounding box relative height inversely proportional to distance
            rel_h = max(1, y2 - y1) / float(frame_h)
            # Compute motion state via temporal centroid displacement
            now = time.time()
            track_id = f"{label}_{direction}"
            motion_state = "Stationary"
            if track_id in self._prev_tracks:
                prev_cx, prev_cy, prev_time = self._prev_tracks[track_id]
                dt = max(0.001, now - prev_time)
                dist_pixels = np.hypot(cx - prev_cx, cy - prev_cy)
                speed_px_sec = dist_pixels / dt
                if speed_px_sec > 45.0:  # Threshold for camera motion displacement
                    motion_state = "Moving"
            self._prev_tracks[track_id] = (cx, cy, now)

            # Without the depth model these are filled in by
            # process_frame() depth-fusion; default to None / Normal.
            detections.append(Detection(
                label=label,
                confidence=conf,
                x1=x1, y1=y1, x2=x2, y2=y2,
                cx=cx, cy=cy,
                direction=direction,
                depth_meters=None,
                distance_cm=None,
                threat_level="Normal",
                motion_state=motion_state,
            ))

        return detections

    def _estimate_depth(self, frame: np.ndarray) -> Optional[np.ndarray]:
        if self._depth is None or self._depth_input_name is None:
            return None

        target_h, target_w = self._depth_input_shape
        img = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        img = cv2.resize(img, (target_w, target_h))
        img = img.astype(np.float32) / 255.0

        mean = np.array([0.485, 0.456, 0.406], dtype=np.float32)
        std = np.array([0.229, 0.224, 0.225], dtype=np.float32)
        img = (img - mean) / std

        img = np.transpose(img, (2, 0, 1))
        img = np.expand_dims(img, axis=0)

        outputs = self._depth.run(None, {self._depth_input_name: img})
        depth_map = outputs[0].squeeze()

        depth_map = self._depth_scale / (depth_map + 1e-6)
        return depth_map


class AnnouncementTracker:
    """
    Temporal debouncing and announcement management for assistive vision.
    Prevents repetitive speech stutters.
    """

    def __init__(
        self,
        absence_reset: float = 1.5,
        speak_interval: float = 2.0,
        min_duration: float = 0.4,
    ) -> None:
        self._absence_reset = absence_reset
        self._speak_interval = speak_interval
        self._min_duration = min_duration
        
        self._first_seen: dict[str, float] = {}
        self._last_seen: dict[str, float] = {}
        self._announced: set[str] = set()
        
        self._pending: list[str] = []
        self._last_speak_time: float = time.time()

    def update(self, detections: list[Detection]) -> Optional[str]:
        now = time.time()
        current_keys: set[str] = set()

        for det in detections:
            track_key = f"{det.label}_{det.direction}"
            current_keys.add(track_key)

            if track_key not in self._last_seen or (now - self._last_seen[track_key]) > self._absence_reset:
                self._first_seen[track_key] = now
                self._announced.discard(track_key)

            self._last_seen[track_key] = now

            if track_key not in self._announced and (now - self._first_seen[track_key]) >= self._min_duration:
                if det.threat_level in ("Collision", "Alarming"):
                    speech = f"CRITICAL: {det.label} on the {det.direction} at {det.depth_meters or (det.distance_cm/100):.1f} meters"
                else:
                    speech = f"{det.label} on the {det.direction}"

                self._pending.append(speech)
                self._announced.add(track_key)

        expired = [k for k, v in self._last_seen.items() if (now - v) > self._absence_reset]
        for k in expired:
            self._last_seen.pop(k, None)
            self._first_seen.pop(k, None)
            self._announced.discard(k)

        if self._pending and (now - self._last_speak_time) >= self._speak_interval:
            # Sort critical messages first
            critical_items = [p for p in self._pending if p.startswith("CRITICAL:")]
            if critical_items:
                msg = critical_items[0]
            else:
                msg = ", ".join(self._pending[:2])
            self._pending.clear()
            self._last_speak_time = now
            return msg

        return None
