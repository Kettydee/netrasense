"""Threaded OpenCV webcam capture with FPS and snapshot support."""

from __future__ import annotations

import threading
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

import cv2


class CameraStream:
    """Keep the newest OpenCV frame available without buffering stale video."""

    def __init__(self, src: int | str = 0, capture_dir: str | Path = "captures") -> None:
        self.src = src
        self.capture_dir = Path(capture_dir)
        self.cap = cv2.VideoCapture(src)
        self.ret = False
        self.frame = None
        self.running = False
        self.last_error: Optional[str] = None
        self.frame_timestamp: Optional[float] = None
        self._fps = 0.0
        self._frame_count = 0
        self._fps_window_started = time.monotonic()
        self._lock = threading.Lock()
        self._thread: Optional[threading.Thread] = None

        if not self.cap.isOpened():
            self.last_error = f"Camera source {src!r} could not be opened"
            return

        self.running = True
        self._thread = threading.Thread(target=self._update, daemon=True, name="camera-stream")
        self._thread.start()

    def _update(self) -> None:
        while self.running:
            try:
                ret, frame = self.cap.read()
            except cv2.error as exc:
                ret, frame = False, None
                self.last_error = f"OpenCV read error: {exc}"

            if not ret or frame is None:
                with self._lock:
                    self.ret = False
                    self.last_error = self.last_error or f"No frame received from camera source {self.src!r}"
                time.sleep(0.05)
                continue

            now = time.monotonic()
            with self._lock:
                self.ret = True
                self.frame = frame
                self.frame_timestamp = time.time()
                self.last_error = None
                self._frame_count += 1
                elapsed = now - self._fps_window_started
                if elapsed >= 1.0:
                    self._fps = self._frame_count / elapsed
                    self._frame_count = 0
                    self._fps_window_started = now

    def read(self):
        """Return the latest frame. The copy prevents callers from mutating shared data."""
        with self._lock:
            return self.ret, None if self.frame is None else self.frame.copy()

    def isOpened(self) -> bool:
        return bool(self.cap and self.cap.isOpened())

    def status(self) -> dict[str, object]:
        """Return serializable camera health and source FPS information."""
        with self._lock:
            height = int(self.frame.shape[0]) if self.frame is not None else None
            width = int(self.frame.shape[1]) if self.frame is not None else None
            return {
                "available": self.isOpened() and self.ret,
                "source": str(self.src),
                "fps": round(self._fps, 1),
                "frame_width": width,
                "frame_height": height,
                "last_frame_timestamp": self.frame_timestamp,
                "last_error": self.last_error,
            }

    def capture_frame(self, output_dir: str | Path | None = None) -> Optional[Path]:
        """Save the latest frame as a timestamped JPEG and return its path."""
        ret, frame = self.read()
        if not ret or frame is None:
            return None

        target_dir = Path(output_dir) if output_dir is not None else self.capture_dir
        try:
            target_dir.mkdir(parents=True, exist_ok=True)
        except OSError as exc:
            self.last_error = f"Could not create capture directory {target_dir}: {exc}"
            return None
        timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S_%fZ")
        output_path = target_dir / f"netrasense_frame_{timestamp}.jpg"
        if not cv2.imwrite(str(output_path), frame):
            self.last_error = f"Could not save frame to {output_path}"
            return None
        return output_path

    def release(self) -> None:
        self.running = False
        if self._thread and self._thread.is_alive():
            self._thread.join(timeout=2.0)
        if self.cap:
            self.cap.release()
