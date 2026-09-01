"""
NetraSense — Structured Dataset Collection Pipeline
====================================================
Saves timestamped webcam frames alongside per-frame metadata (detections,
sensor readings, threat levels, ensemble results) into a structured folder
layout suitable for downstream ML training.

Directory Layout
----------------
dataset/
  metadata.csv              ← master index of every collected frame
  frames/
    YYYYMMDD_HHMMSS_NNN.jpg ← timestamped JPEG captures
  labels/
    YYYYMMDD_HHMMSS_NNN.txt ← YOLO-format bounding box annotations

Each row in metadata.csv contains:
  frame_path, timestamp, fps, mode, closest_object, closest_distance_cm,
  threat_level, ultrasonic_cm, ensemble_threat, ensemble_confidence,
  detection_count, labels (comma-separated), source (capture|auto|manual)

Usage::

    from dataset_collector import DatasetCollector

    collector = DatasetCollector("dataset")
    record = collector.save_frame(
        frame=frame_ndarray,
        detections=[{"label": "person", "bbox": [x1,y1,x2,y2], ...}],
        sensor_data={"distance_cm": 73, "threat_level": "ALARM"},
        ensemble_result={"fused_threat_level": "ALARM", ...},
        fps=12.5,
        mode="all",
    )
    print(record)  # {"frame_path": "frames/20260901_143022_123.jpg", ...}

Or run standalone to collect frames interactively:

    python dataset_collector.py --camera 0 --output dataset
"""

from __future__ import annotations

import csv
import os
import threading
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

try:
    import cv2
except ImportError:
    cv2 = None

try:
    import numpy as np
except ImportError:
    np = None


class DatasetCollector:
    """Thread-safe dataset collector that persists frames + metadata.

    Parameters
    ----------
    output_dir : str | Path
        Root directory for the dataset (created if missing).
    max_frames : int
        Stop auto-collecting after this many frames (0 = unlimited).
    auto_interval_s : float
        Seconds between automatic captures when using auto-collect mode.
    """

    def __init__(
        self,
        output_dir: str | Path = "dataset",
        max_frames: int = 0,
        auto_interval_s: float = 2.0,
    ) -> None:
        self._root = Path(output_dir)
        self._frames_dir = self._root / "frames"
        self._labels_dir = self._root / "labels"
        self._csv_path = self._root / "metadata.csv"
        self._max_frames = max_frames
        self._auto_interval = auto_interval_s

        self._lock = threading.Lock()
        self._frame_count = 0
        self._csv_file: Optional[Any] = None
        self._csv_writer: Optional[Any] = None

        self._ensure_dirs()
        self._init_csv()

    def _ensure_dirs(self) -> None:
        """Create dataset directory structure."""
        self._root.mkdir(parents=True, exist_ok=True)
        self._frames_dir.mkdir(exist_ok=True)
        self._labels_dir.mkdir(exist_ok=True)

    def _init_csv(self) -> None:
        """Initialize or resume the metadata CSV file."""
        fieldnames = [
            "frame_path",
            "timestamp",
            "timestamp_iso",
            "fps",
            "mode",
            "closest_object",
            "closest_distance_cm",
            "threat_level",
            "ultrasonic_cm",
            "ultrasonic_threat",
            "ensemble_threat",
            "ensemble_confidence",
            "ensemble_signal_count",
            "detection_count",
            "labels",
            "source",
        ]

        # Check if CSV already exists and has content
        if self._csv_path.exists() and self._csv_path.stat().st_size > 0:
            # Resume — count existing rows
            with open(self._csv_path, "r") as f:
                reader = csv.DictReader(f)
                self._frame_count = sum(1 for _ in reader)
            print(f"[DATASET] Resumed: {self._frame_count} existing frames at {self._csv_path}")
        else:
            # Create new CSV with header
            with open(self._csv_path, "w", newline="") as f:
                writer = csv.DictWriter(f, fieldnames=fieldnames)
                writer.writeheader()
            print(f"[DATASET] Created new dataset at {self._root}")

    def save_frame(
        self,
        frame: np.ndarray,
        detections: Optional[list[dict]] = None,
        sensor_data: Optional[dict] = None,
        ensemble_result: Optional[dict] = None,
        fps: float = 0.0,
        mode: str = "all",
        source: str = "capture",
    ) -> dict:
        """Save a single frame with full metadata.

        Parameters
        ----------
        frame : np.ndarray
            BGR image from OpenCV.
        detections : list[dict], optional
            YOLO detection results for this frame.
        sensor_data : dict, optional
            Latest ultrasonic sensor reading.
        ensemble_result : dict, optional
            Ensemble classifier output for this frame.
        fps : float
            Current processing FPS.
        mode : str
            Vision mode (all/indoor/outdoor).
        source : str
            Collection source: "capture" (manual), "auto" (timed), "manual" (API).

        Returns
        -------
        dict
            Metadata record for the saved frame.
        """
        if frame is None or (hasattr(frame, "size") and frame.size == 0):
            return {}
        if cv2 is None:
            raise RuntimeError("OpenCV is required for frame saving. Install with: pip install opencv-python")

        now = datetime.now(timezone.utc)
        ts_str = now.strftime("%Y%m%d_%H%M%S") + f"_{now.microsecond // 1000:03d}"
        frame_filename = f"{ts_str}.jpg"
        label_filename = f"{ts_str}.txt"
        frame_path = self._frames_dir / frame_filename
        label_path = self._labels_dir / label_filename

        detections = detections or []
        sensor_data = sensor_data or {}
        ensemble_result = ensemble_result or {}

        # ── Save JPEG frame ──────────────────────────────────────────
        with self._lock:
            cv2.imwrite(
                str(frame_path),
                frame,
                [cv2.IMWRITE_JPEG_QUALITY, 95],
            )

        # ── Save YOLO-format label file ──────────────────────────────
        h, w = frame.shape[:2]
        self._write_yolo_label(label_path, detections, w, h)

        # ── Extract metadata fields ──────────────────────────────────
        closest_obj = None
        closest_dist = None
        labels_set = set()

        for det in detections:
            label = det.get("label", "unknown")
            labels_set.add(label)
            dist = det.get("distance_cm")
            if dist is not None and (closest_dist is None or dist < closest_dist):
                closest_dist = dist
                closest_obj = label

        # Use ensemble threat if available, otherwise fall back to sensor
        threat_level = ensemble_result.get("fused_threat_level") or sensor_data.get("threat_level") or "Unknown"

        record = {
            "frame_path": f"frames/{frame_filename}",
            "timestamp": ts_str,
            "timestamp_iso": now.isoformat(),
            "fps": round(fps, 1),
            "mode": mode,
            "closest_object": closest_obj,
            "closest_distance_cm": closest_dist,
            "threat_level": threat_level,
            "ultrasonic_cm": sensor_data.get("distance_cm"),
            "ultrasonic_threat": sensor_data.get("threat_level"),
            "ensemble_threat": ensemble_result.get("fused_threat_level"),
            "ensemble_confidence": ensemble_result.get("confidence"),
            "ensemble_signal_count": ensemble_result.get("signal_count"),
            "detection_count": len(detections),
            "labels": ",".join(sorted(labels_set)),
            "source": source,
        }

        # ── Append to CSV ────────────────────────────────────────────
        with self._lock:
            with open(self._csv_path, "a", newline="") as f:
                writer = csv.DictWriter(f, fieldnames=record.keys())
                writer.writerow(record)
                self._frame_count += 1

        return record

    def _write_yolo_label(
        self,
        path: Path,
        detections: list[dict],
        img_width: int,
        img_height: int,
    ) -> None:
        """Write YOLO-format annotation file.

        Format per line: class_id cx cy w h
        All values normalized to [0, 1].
        """
        # Simple label -> class_id mapping (extend as needed)
        class_names = [
            "person", "bicycle", "car", "motorcycle", "bus", "truck",
            "chair", "potted plant", "dog", "cat", "stairs", "pole",
            "wall", "door", "kerb",
        ]
        class_to_id = {name: i for i, name in enumerate(class_names)}

        lines = []
        for det in detections:
            bbox = det.get("bbox")
            label = det.get("label", "unknown")
            if not bbox or len(bbox) != 4:
                continue

            x1, y1, x2, y2 = bbox
            # Convert to YOLO normalized center format
            cx = ((x1 + x2) / 2) / img_width
            cy = ((y1 + y2) / 2) / img_height
            bw = (x2 - x1) / img_width
            bh = (y2 - y1) / img_height

            # Clamp to [0, 1]
            cx = max(0, min(1, cx))
            cy = max(0, min(1, cy))
            bw = max(0, min(1, bw))
            bh = max(0, min(1, bh))

            class_id = class_to_id.get(label.lower(), len(class_names))
            lines.append(f"{class_id} {cx:.6f} {cy:.6f} {bw:.6f} {bh:.6f}")

        with open(path, "w") as f:
            f.write("\n".join(lines))

    @property
    def frame_count(self) -> int:
        """Total frames collected so far."""
        return self._frame_count

    @property
    def stats(self) -> dict:
        """Dataset collection statistics."""
        csv_size = self._csv_path.stat().st_size if self._csv_path.exists() else 0
        frame_files = list(self._frames_dir.glob("*.jpg"))
        label_files = list(self._labels_dir.glob("*.txt"))
        return {
            "total_frames": self._frame_count,
            "frame_files": len(frame_files),
            "label_files": len(label_files),
            "csv_size_bytes": csv_size,
            "root_dir": str(self._root),
        }

    def close(self) -> None:
        """Close any open file handles."""
        if self._csv_file and not self._csv_file.closed:
            self._csv_file.close()


# ── Standalone test ──────────────────────────────────────────────────

def _run_test():
    """Smoke test: create a synthetic dataset with dummy frames."""
    import tempfile

    if cv2 is None or np is None:
        print("Skipping test: opencv-python and numpy are required. Install with: pip install opencv-python numpy")
        return

    print("=" * 60)
    print("  NetraSense Dataset Collector — Smoke Test")
    print("=" * 60)

    with tempfile.TemporaryDirectory() as tmpdir:
        collector = DatasetCollector(tmpdir, max_frames=5)

        # Generate 5 synthetic frames
        for i in range(5):
            frame = np.random.randint(0, 255, (480, 640, 3), dtype=np.uint8)
            detections = [
                {
                    "label": "person",
                    "bbox": [100 + i * 10, 50, 200 + i * 10, 200],
                    "confidence": 0.8 + i * 0.02,
                    "distance_cm": 300 - i * 50,
                    "threat_level": ["NORMAL", "WARNING", "ALARM", "CRITICAL"][min(i, 3)],
                }
            ]
            sensor = {"distance_cm": 300 - i * 50, "threat_level": ["NORMAL", "WARNING", "ALARM", "CRITICAL"][min(i, 3)]}
            ensemble = {"fused_threat_level": ["NORMAL", "WARNING", "ALARM", "CRITICAL"][min(i, 3)], "confidence": 0.9, "signal_count": 2}

            record = collector.save_frame(
                frame=frame,
                detections=detections,
                sensor_data=sensor,
                ensemble_result=ensemble,
                fps=12.5,
                mode="all",
                source="auto",
            )
            print(f"  [{i+1}] Saved: {record['frame_path']} | {record['threat_level']} | {record['detection_count']} detections")

        stats = collector.stats
        print(f"\n  Stats: {stats}")

        # Verify CSV content
        csv_path = Path(tmpdir) / "metadata.csv"
        with open(csv_path) as f:
            reader = csv.DictReader(f)
            rows = list(reader)
        assert len(rows) == 5, f"Expected 5 rows, got {len(rows)}"
        print(f"  CSV rows: {len(rows)}")

        # Verify YOLO labels exist
        label_files = list(Path(tmpdir).labels_dir.glob("*.txt"))
        print(f"  Label files: {len(label_files)}")
        assert len(label_files) == 5

        # Verify a label file has content
        first_label = sorted(label_files)[0]
        content = first_label.read_text()
        assert "0 " in content, f"Expected class_id in label, got: {content}"
        print(f"  Sample label: {content.strip()}")

        # Verify frame files
        frame_files = list(Path(tmpdir).frames_dir.glob("*.jpg"))
        assert len(frame_files) == 5
        print(f"  Frame files: {len(frame_files)}")

        collector.close()

    print("\n" + "=" * 60)
    print("  All tests passed!")
    print("=" * 60)


if __name__ == "__main__":
    _run_test()
