"""
NetraSense Dataset Collection Pipeline
Collects, structures, and logs timestamped frames, bounding boxes, and multi-modal sensor metadata.
"""

from __future__ import annotations

import csv
import json
import os
import time
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional
import cv2
import numpy as np


class DatasetCollector:
    """
    Structured dataset collector saving frames and metadata for model training and benchmarking.
    Folder structure:
        dataset/
            raw/
                {class_name}/
                    {timestamp}_{class_name}_{index}.jpg
            metadata.csv
    """

    def __init__(self, base_dir: str = "dataset") -> None:
        self.base_dir = Path(base_dir)
        self.raw_dir = self.base_dir / "raw"
        self.metadata_file = self.base_dir / "metadata.csv"
        
        self._init_storage()

    def _init_storage(self) -> None:
        """Initialize folder hierarchy and CSV metadata headers."""
        self.raw_dir.mkdir(parents=True, exist_ok=True)

        if not self.metadata_file.exists():
            with open(self.metadata_file, mode="w", newline="", encoding="utf-8") as f:
                writer = csv.writer(f)
                writer.writerow([
                    "timestamp",
                    "filename",
                    "relative_path",
                    "primary_class",
                    "all_classes",
                    "confidence",
                    "bbox_x1",
                    "bbox_y1",
                    "bbox_x2",
                    "bbox_y2",
                    "spatial_zone",
                    "ultrasonic_distance_cm",
                    "depth_estimate_m",
                    "threat_level",
                    "image_width",
                    "image_height"
                ])

    def save_sample(
        self,
        frame: np.ndarray,
        detections: Optional[List[Dict[str, Any]]] = None,
        ultrasonic_cm: Optional[float] = None,
        depth_m: Optional[float] = None,
        threat_level: str = "Normal",
        custom_class: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Save a single frame and its accompanying annotation/sensor metadata.
        """
        detections = detections or []
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S_%f")
        h, w = frame.shape[:2]

        # Determine primary class
        if custom_class:
            primary_class = custom_class
            primary_conf = 1.0
            primary_bbox = [0, 0, w, h]
            primary_zone = "center"
        elif detections:
            top_det = max(detections, key=lambda d: d.get("confidence", 0.0))
            primary_class = top_det.get("label", top_det.get("class", "object"))
            primary_conf = float(top_det.get("confidence", 0.0))
            primary_bbox = top_det.get("box", [0, 0, w, h])
            primary_zone = top_det.get("direction", "center")
        else:
            primary_class = "unlabeled"
            primary_conf = 0.0
            primary_bbox = [0, 0, w, h]
            primary_zone = "center"

        # Create class-specific folder
        class_folder = self.raw_dir / primary_class
        class_folder.mkdir(parents=True, exist_ok=True)

        filename = f"{timestamp}_{primary_class}.jpg"
        file_path = class_folder / filename
        relative_path = file_path.relative_to(self.base_dir).as_posix()

        # Write image
        cv2.imwrite(str(file_path), frame)

        # Collect all class labels
        all_classes_str = json.dumps([d.get("label", d.get("class")) for d in detections]) if detections else f'["{primary_class}"]'

        # Record to metadata CSV
        with open(self.metadata_file, mode="a", newline="", encoding="utf-8") as f:
            writer = csv.writer(f)
            writer.writerow([
                timestamp,
                filename,
                relative_path,
                primary_class,
                all_classes_str,
                f"{primary_conf:.3f}",
                primary_bbox[0],
                primary_bbox[1],
                primary_bbox[2],
                primary_bbox[3],
                primary_zone,
                f"{ultrasonic_cm:.1f}" if ultrasonic_cm is not None else "",
                f"{depth_m:.2f}" if depth_m is not None else "",
                threat_level,
                w,
                h
            ])

        return {
            "success": True,
            "filename": filename,
            "relative_path": relative_path,
            "primary_class": primary_class,
            "total_detections": len(detections),
            "threat_level": threat_level
        }

    def get_stats(self) -> Dict[str, Any]:
        """Return dataset size and distribution metrics."""
        if not self.metadata_file.exists():
            return {"total_samples": 0, "classes": {}}

        class_counts: Dict[str, int] = {}
        total = 0

        with open(self.metadata_file, mode="r", encoding="utf-8") as f:
            reader = csv.DictReader(f)
            for row in reader:
                cls = row.get("primary_class", "unknown")
                class_counts[cls] = class_counts.get(cls, 0) + 1
                total += 1

        return {
            "total_samples": total,
            "classes": class_counts,
            "dataset_path": str(self.base_dir.resolve())
        }


def collect_live(
    camera_index: int = 0,
    interval_seconds: float = 1.0,
    max_samples: int = 50,
    output_dir: str = "dataset"
) -> None:
    """Run an automated continuous dataset collection loop."""
    collector = DatasetCollector(base_dir=output_dir)
    cap = cv2.VideoCapture(camera_index)

    if not cap.isOpened():
        print(f"[ERROR] Could not open camera {camera_index}")
        return

    print(f"[COLLECTOR] Starting dataset collection -> saving to {output_dir}/")
    print(f"[COLLECTOR] Target: {max_samples} samples, Interval: {interval_seconds}s (Press 'q' to stop)")

    saved_count = 0
    last_capture_time = 0.0

    try:
        while saved_count < max_samples:
            ret, frame = cap.read()
            if not ret:
                break

            now = time.time()
            if now - last_capture_time >= interval_seconds:
                res = collector.save_sample(frame, custom_class="ambient_scene")
                saved_count += 1
                last_capture_time = now
                print(f"[CAPTURED {saved_count}/{max_samples}] {res['filename']}")

            cv2.imshow("NetraSense Dataset Collector (Press Q to quit)", frame)
            if cv2.waitKey(1) & 0xFF == ord('q'):
                break
    finally:
        cap.release()
        cv2.destroyAllWindows()
        print(f"[COLLECTOR] Collection finished. Summary: {collector.get_stats()}")


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description="NetraSense Dataset Collector")
    parser.add_argument("--camera", type=int, default=0, help="Camera index")
    parser.add_argument("--interval", type=float, default=1.0, help="Capture interval in seconds")
    parser.add_argument("--max", type=int, default=20, help="Max samples to collect")
    parser.add_argument("--dir", type=str, default="dataset", help="Output dataset directory")
    args = parser.parse_args()

    collect_live(camera_index=args.camera, interval_seconds=args.interval, max_samples=args.max, output_dir=args.dir)
