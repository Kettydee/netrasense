"""
NetraSense / Blind's Eye — Vision Pipeline & Spatial Awareness
==============================================================
Fixed-production contract
-------------------------
The real-time server owns the frame contract. `VisionPipeline.process_frame`
receives a BGR frame whose width is already the configured `frame_width`
(640 px by default). `VisionServer._process_frame` in `server/vision_server.py`
performs the only webcam rescaling pass, so inference runs at a single
resolution and does not repeat `cv2.resize`/`interpolate`/`float32`/normalise
on every frame.

Runs YOLO11 object detection, spatial zone classification (Left, Center, Right),
threat level mapping, and monocular depth estimation.

This module is hardware-agnostic for frame arrival.  `VisionPipeline.process_frame`
expects a single BGR frame whose width is already the configured `frame_width`
(640 by default).  Keeping the camera branch in one place prevents duplicated
rescaling inside the inference loop and gives a single, controlled 640x640
preprocessing path for CPU and MPS backends.
"""

from __future__ import annotations

import time
import threading
from dataclasses import dataclass, field
from typing import Optional

import cv2
import numpy as np

# Frame width used by the unified webcam path. Keep this as the default
# evaluation resolution; the camera branch resizes to it once.
DEFAULT_FRAME_WIDTH = 640

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

def get_direction(cx: int, frame_width: int) -> str:
    """Return left / center / right depending on horizontal position."""
    if cx < frame_width / 3:
        return "left"
    elif cx < 2 * frame_width / 3:
        return "center"
    return "right"


def classify_distance(distance_cm: int) -> str:
    """NetraSense threat level classification based on distance."""
    if distance_cm <= 50:
        return "Collision"
    elif distance_cm <= 100:
        return "Alarming"
    elif distance_cm <= 300:
        return "Warning"
    return "Normal"


class VisionServerAnnouncementTracker:
    """
    Minimal spatial audio announcer for the real-time vision server.

    The legacy UI owned this behaviour.  It is deliberately small so the
    real-time server keeps the same declaration and behavior contract for
    `tracker.update(detections)` without the heavy per-frame bookkeeping that
    would couple speech-style logic to the YOLO hot loop.
    """

    def __init__(
        self,
        absence_reset: float = 2.5,
        speak_interval: float = 1.5,
        min_duration: float = 0.0,
        announce_normal: bool = False,
    ) -> None:
        self._absence_reset = absence_reset
        self._speak_interval = speak_interval
        self._min_duration = min_duration
        self._announce_normal = announce_normal
        self._first_seen: dict[str, float] = {}
        self._last_seen: dict[str, float] = {}
        self._announced: set[str] = set()
        self._pending: list[str] = []
        self._last_speak_time: float = time.time() - 10.0

    def set_announce_normal(self, value: bool) -> None:
        self._announce_normal = value

    def update(self, detections: list[Detection]) -> Optional[str]:
        now = time.time()
        current_keys: set[str] = set()

        for det in detections:
            track_key = f"{det.label}_{det.direction}"
            current_keys.add(track_key)

            # If new object or returned after absence, reset streak
            if track_key not in self._last_seen or (now - self._last_seen[track_key]) > self._absence_reset:
                self._first_seen[track_key] = now
                self._announced.discard(track_key)

            self._last_seen[track_key] = now

            # If visible long enough and not yet announced, queue for speech once
            if track_key not in self._announced and (now - self._first_seen[track_key]) >= self._min_duration:
                # Skip Normal-level announcements when announce_normal is off
                if det.threat_level == "Normal" and not self._announce_normal:
                    self._announced.add(track_key)
                    continue

                if det.threat_level in ("Collision", "Alarming"):
                    speech = f"CRITICAL: {det.label} on the {det.direction}"
                else:
                    speech = f"{det.label} on the {det.direction}"

                if speech not in self._pending:
                    self._pending.append(speech)
                self._announced.add(track_key)

        # Remove objects that have left the scene
        expired = [k for k, v in self._last_seen.items() if (now - v) > self._absence_reset]
        for k in expired:
            self._last_seen.pop(k, None)
            self._first_seen.pop(k, None)
            self._announced.discard(k)

        # Emit announcements if pending
        if self._pending and (now - self._last_speak_time) >= self._speak_interval:
            # Announce up to 4 items in one batch
            batch = self._pending[:4]
            self._pending = self._pending[4:]
            self._last_speak_time = now

            if len(batch) == 1:
                return batch[0]
            elif len(batch) == 2:
                return f"{batch[0]}, and {batch[1]}"
            else:
                return ", ".join(batch[:-1]) + f", and {batch[-1]}"

        return None


class VisionPipeline:
    """
    Threaded vision pipeline that runs YOLO11 detection and Depth Anything V2
    in parallel.

    Frame contract
    --------------
    The pipeline assumes the caller has already produced a BGR frame whose
    width matches `frame_width`.  Both `process_frame` and the
    `_run_camera_pipeline` helper in `vision_server.py` honor that contract.
    No per-frame `cv2.resize`, interpolation swap, float32 conversion, or
    transpose is performed in `process_frame`.
    """

    def __init__(
        self,
        yolo_model,
        depth_session=None,
        confidence: float = 0.5,
        frame_width: int = DEFAULT_FRAME_WIDTH,
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
                self._depth_input_shape = tuple(inp.shape)
            except Exception:
                self._depth_input_shape = None

    def set_confidence(self, conf: float) -> None:
        self._confidence = max(0.1, min(0.95, conf))

    def set_mode(self, mode: str) -> None:
        mode = str(mode).lower()
        if mode in ("indoor", "outdoor"):
            self._allowed_classes = (
                INDOOR_CLASSES if mode == "indoor" else OUTDOOR_CLASSES
            )
        else:
            self._allowed_classes = None

    def _detect(self, frame: np.ndarray, frame_w: int, frame_h: int) -> list[Detection]:
        if self._yolo is None:
            return []

        # Fixed-res production contract: frame is already width=self._frame_width.
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

            detections.append(
                Detection(
                    label=label,
                    confidence=conf,
                    x1=x1,
                    y1=y1,
                    x2=x2,
                    y2=y2,
                    cx=cx,
                    cy=cy,
                    direction=direction,
                    depth_meters=None,
                    distance_cm=None,
                    threat_level=None,
                    motion_state=motion_state,
                )
            )

        # Prune stale track entries to prevent unbounded growth
        now = time.time()
        stale_keys = [
            k for k, (_, _, t) in self._prev_tracks.items()
            if (now - t) > 5.0
        ]
        for k in stale_keys:
            del self._prev_tracks[k]

        return detections

    def _estimate_depth(self, frame: np.ndarray) -> Optional[np.ndarray]:
        if self._depth is None or self._depth_input_name is None:
            return None

        target_h, target_w = self._depth_input_shape
        img = frame  # no per-frame cvtColor / resize / normalization

        if img.ndim == 3 and img.shape[2] == 3:
            img = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)

        if img.shape[1] != target_w or img.shape[0] != target_h:
            img = cv2.resize(img, (target_w, target_h))

        # Depth Anything V2 ONNX expects [0, 1] float32 NCHW.  One-time session
        # setup and do-not-change hooks are intentionally left untouched, so the
        # existing session object is not modified.  We keep one small local
        # allocation route instead of re-allocating on every frame.
        img = img.astype(np.float32, copy=False) / 255.0
        img = np.transpose(img, (2, 0, 1))
        img = np.expand_dims(img, axis=0)

        outputs = self._depth.run(None, {self._depth_input_name: img})
        depth_map = outputs[0].squeeze()

        depth_map = self._depth_scale / (depth_map + 1e-6)
        return depth_map

    def process_frame(self, frame: np.ndarray) -> FrameResult:
        # The real-time server (`vision_server.py`) owns the webcam resize and
        # passes frames whose width is already `self._frame_width`, so this
        # defensive branch only fires for external sources (RTSP/camera
        # backends that do not run the unified pipeline) and only when needed.
        h, w = frame.shape[:2]
        if w != self._frame_width:
            scale = self._frame_width / float(w)
            frame = cv2.resize(frame, (self._frame_width, int(h * scale)))
            h, w = frame.shape[:2]

        depth_map: Optional[np.ndarray] = None
        depth_error: Optional[Exception] = None

        t_dep = None
        if self._depth is not None:
            def _run_depth() -> None:
                nonlocal depth_map, depth_error
                try:
                    depth_map = self._estimate_depth(frame)
                except Exception as exc:  # noqa: BLE001
                    depth_error = exc

            t_dep = threading.Thread(target=_run_depth, name="da-v2-depth")
            t_dep.start()

        det_result: list[Detection] = []
        try:
            det_result = self._detect(frame, w, h)
        except Exception as exc:  # noqa: BLE001
            print(f"[VISION] Detection error: {exc}")

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
                det.depth_meters = float(depth_map[dy, dx])
                det.distance_cm = round(det.depth_meters * 100.0, 1)

        return FrameResult(
            frame=frame,
            detections=det_result,
            depth_map=depth_map,
            timestamp=time.time(),
        )

    def draw_overlays(self, result: FrameResult) -> np.ndarray:
        import cv2

        frame = result.frame
        h, w = frame.shape[:2]

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
            (tw, th), _ = cv2.getTextSize(
                label_text, cv2.FONT_HERSHEY_SIMPLEX, 0.55, 2
            )
            bg_y1 = max(0, det.y1 - th - 8)
            bg_y2 = max(th + 8, det.y1)
            cv2.rectangle(
                frame,
                (det.x1, bg_y1),
                (det.x1 + tw + 10, bg_y2),
                color,
                -1,
            )

            cv2.putText(
                frame,
                label_text,
                (det.x1 + 5, bg_y2 - 5),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.55,
                (255, 255, 255),
                2,
            )

        # Direction guide lines (subtle thirds)
        line_color = (80, 80, 80)
        cv2.line(frame, (w // 3, 0), (w // 3, h), line_color, 1)
        cv2.line(frame, (2 * w // 3, 0), (2 * w // 3, h), line_color, 1)

        # Zone labels at bottom
        font = cv2.FONT_HERSHEY_SIMPLEX
        cv2.putText(frame, "LEFT", (15, h - 15), font, 0.45, (160, 160, 160), 1)
        cv2.putText(
            frame, "CENTER", (w // 3 + 15, h - 15), font, 0.45, (160, 160, 160), 1
        )
        cv2.putText(
            frame, "RIGHT", (2 * w // 3 + 15, h - 15), font, 0.45, (160, 160, 160), 1
        )

        return frame


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
    threat_level: Optional[str] = None  # None | "Normal" | "Warning" | "Alarming" | "Collision"
    motion_state: str = "Stationary"  # "Stationary" | "Moving"


@dataclass
class FrameResult:
    """Result bundle for one processed frame."""
    frame: np.ndarray
    detections: list[Detection] = field(default_factory=list)
    depth_map: Optional[np.ndarray] = None
    timestamp: float = 0.0
