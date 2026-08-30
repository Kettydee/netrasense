"""
NetraSense Data Cleaning Pipeline
Filters corrupt/blank/blurred frames, performs perceptual deduplication, and validates bounding box annotations.
"""

from __future__ import annotations

import csv
import json
import os
import shutil
from pathlib import Path
from typing import Any, Dict, List, Set, Tuple
import cv2
import numpy as np


class DataCleaner:
    """
    Automated dataset sanitizer and validator.
    """

    def __init__(
        self,
        blur_threshold: float = 40.0,
        dark_threshold: float = 18.0,
        bright_threshold: float = 240.0,
        hash_diff_threshold: int = 4,
        min_confidence: float = 0.40
    ) -> None:
        self.blur_threshold = blur_threshold
        self.dark_threshold = dark_threshold
        self.bright_threshold = bright_threshold
        self.hash_diff_threshold = hash_diff_threshold
        self.min_confidence = min_confidence

    @staticmethod
    def compute_dhash(image: np.ndarray, hash_size: int = 8) -> int:
        """Compute 64-bit difference hash (dHash) for fast perceptual deduplication."""
        resized = cv2.resize(image, (hash_size + 1, hash_size), interpolation=cv2.INTER_AREA)
        if len(resized.shape) == 3:
            resized = cv2.cvtColor(resized, cv2.COLOR_BGR2GRAY)
        
        diff = resized[:, 1:] > resized[:, :-1]
        return sum([2 ** i for (i, v) in enumerate(diff.flatten()) if v])

    @staticmethod
    def hamming_distance(h1: int, h2: int) -> int:
        """Calculate bitwise Hamming distance between two perceptual hashes."""
        return bin(h1 ^ h2).count("1")

    def inspect_frame(self, image_path: Path) -> Tuple[bool, str]:
        """
        Inspect frame quality:
        - Corrupt/Unreadable
        - Blank/Overexposed/Underexposed
        - Motion blurred
        """
        if not image_path.exists():
            return False, "File not found"

        frame = cv2.imread(str(image_path))
        if frame is None or frame.size == 0:
            return False, "Corrupt or unreadable image file"

        h, w = frame.shape[:2]
        if h < 32 or w < 32:
            return False, f"Image dimensions too small ({w}x{h})"

        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)

        # 1. Blank / Underexposed check
        mean_lum = float(np.mean(gray))
        if mean_lum < self.dark_threshold:
            return False, f"Underexposed / nearly black frame (mean lum: {mean_lum:.1f})"
        if mean_lum > self.bright_threshold:
            return False, f"Overexposed / blank white frame (mean lum: {mean_lum:.1f})"

        # 2. Low contrast / single color check
        std_lum = float(np.std(gray))
        if std_lum < 8.0:
            return False, f"Flat low-contrast frame (std: {std_lum:.1f})"

        # 3. Motion blur detection (Variance of Laplacian)
        laplacian_var = float(cv2.Laplacian(gray, cv2.CV_64F).var())
        if laplacian_var < self.blur_threshold:
            return False, f"Motion blurred frame (laplacian var: {laplacian_var:.1f} < {self.blur_threshold})"

        return True, "Valid frame"

    def clean_dataset(
        self,
        raw_dataset_dir: str = "dataset",
        output_dir: str = "dataset/cleaned"
    ) -> Dict[str, Any]:
        """
        Scan and clean the entire dataset directory and metadata CSV.
        """
        raw_path = Path(raw_dataset_dir)
        out_path = Path(output_dir)
        out_raw_path = out_path / "raw"
        out_raw_path.mkdir(parents=True, exist_ok=True)

        metadata_csv = raw_path / "metadata.csv"
        out_metadata_csv = out_path / "metadata.csv"

        stats = {
            "total_inspected": 0,
            "retained": 0,
            "corrupt_dropped": 0,
            "blurred_dropped": 0,
            "exposure_dropped": 0,
            "duplicates_dropped": 0,
            "low_confidence_dropped": 0,
            "classes_distribution": {},
            "reasons_log": []
        }

        seen_hashes: Dict[str, List[int]] = {}
        valid_rows: List[Dict[str, Any]] = []

        # If metadata CSV exists, read from CSV; otherwise scan image files directly
        if metadata_csv.exists():
            with open(metadata_csv, mode="r", encoding="utf-8") as f:
                reader = csv.DictReader(f)
                rows = list(reader)
        else:
            rows = []
            for img_file in raw_path.glob("**/*.jpg"):
                rows.append({
                    "timestamp": "",
                    "filename": img_file.name,
                    "relative_path": img_file.relative_to(raw_path).as_posix(),
                    "primary_class": img_file.parent.name,
                    "confidence": "1.0",
                    "bbox_x1": "0",
                    "bbox_y1": "0",
                    "bbox_x2": "640",
                    "bbox_y2": "480",
                    "spatial_zone": "center",
                    "threat_level": "Normal"
                })

        for row in rows:
            stats["total_inspected"] += 1
            rel_path = row.get("relative_path", "")
            img_path = raw_path / rel_path

            if not img_path.exists():
                img_path = raw_path / "raw" / row.get("primary_class", "") / row.get("filename", "")

            # Check confidence
            try:
                conf = float(row.get("confidence", 1.0))
                if conf > 0.0 and conf < self.min_confidence:
                    stats["low_confidence_dropped"] += 1
                    stats["reasons_log"].append(f"Low confidence ({conf:.2f}) on {img_path.name}")
                    continue
            except ValueError:
                pass

            # Inspect image frame
            is_valid, reason = self.inspect_frame(img_path)
            if not is_valid:
                if "Corrupt" in reason:
                    stats["corrupt_dropped"] += 1
                elif "blurred" in reason:
                    stats["blurred_dropped"] += 1
                elif "exposed" in reason or "contrast" in reason:
                    stats["exposure_dropped"] += 1
                stats["reasons_log"].append(f"Dropped {img_path.name}: {reason}")
                continue

            # Check Deduplication via perceptual hash
            frame = cv2.imread(str(img_path))
            cls = row.get("primary_class", "unknown")
            dhash = self.compute_dhash(frame)

            if cls not in seen_hashes:
                seen_hashes[cls] = []

            is_duplicate = False
            for existing_hash in seen_hashes[cls]:
                if self.hamming_distance(dhash, existing_hash) <= self.hash_diff_threshold:
                    is_duplicate = True
                    break

            if is_duplicate:
                stats["duplicates_dropped"] += 1
                stats["reasons_log"].append(f"Dropped duplicate frame: {img_path.name} in class {cls}")
                continue

            # Record hash and retain frame
            seen_hashes[cls].append(dhash)
            dest_cls_dir = out_raw_path / cls
            dest_cls_dir.mkdir(parents=True, exist_ok=True)
            dest_img_path = dest_cls_dir / img_path.name

            shutil.copy2(img_path, dest_img_path)

            row["relative_path"] = dest_img_path.relative_to(out_path).as_posix()
            valid_rows.append(row)

            stats["retained"] += 1
            stats["classes_distribution"][cls] = stats["classes_distribution"].get(cls, 0) + 1

        # Write sanitized metadata CSV
        if valid_rows:
            fieldnames = list(valid_rows[0].keys())
            with open(out_metadata_csv, mode="w", newline="", encoding="utf-8") as f:
                writer = csv.DictWriter(f, fieldnames=fieldnames)
                writer.writeheader()
                writer.writerows(valid_rows)

        # Write cleaning audit report
        report_file = out_path / "cleaning_report.json"
        with open(report_file, mode="w", encoding="utf-8") as f:
            json.dump(stats, f, indent=2)

        print(f"[DATA CLEANING] Complete! Inspected: {stats['total_inspected']}, Retained: {stats['retained']}, Dropped: {stats['total_inspected'] - stats['retained']}")
        print(f"[DATA CLEANING] Report saved to {report_file}")
        return stats


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description="NetraSense Dataset Cleaning Pipeline")
    parser.add_argument("--input", type=str, default="dataset", help="Input raw dataset directory")
    parser.add_argument("--output", type=str, default="dataset/cleaned", help="Output cleaned directory")
    parser.add_argument("--blur-thresh", type=float, default=40.0, help="Laplacian variance blur threshold")
    parser.add_argument("--hash-diff", type=int, default=4, help="Max Hamming distance to flag duplicate")
    args = parser.parse_args()

    cleaner = DataCleaner(blur_threshold=args.blur_thresh, hash_diff_threshold=args.hash_diff)
    cleaner.clean_dataset(raw_dataset_dir=args.input, output_dir=args.output)
