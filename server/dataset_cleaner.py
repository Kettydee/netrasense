"""
NetraSense — Dataset Cleaning Pipeline
=======================================
Cleans the collected dataset (frames + labels + metadata.csv) by:

1. Removing corrupt / unreadable JPEG frames
2. Removing blank frames (all-black, all-white, near-zero variance)
3. Removing duplicate / near-duplicate frames via perceptual hashing
4. Filtering rows with low-confidence detections from metadata
5. Validating YOLO label files (matching frame count, class IDs in range,
   bounding box values normalized to [0,1], no degenerate boxes)
6. Reconciling metadata.csv with surviving frames/labels on disk
7. Producing a clean dataset/ directory and a cleaning report

Directory layout assumed (produced by DatasetCollector)::

    dataset/
        metadata.csv
        frames/*.jpg
        labels/*.txt

Usage::

    # Dry run — report only, no files deleted
    python dataset_cleaner.py --input dataset --dry-run

    # Clean in-place (backups originals into dataset/.backup/)
    python dataset_cleaner.py --input dataset

    # Clean to a new output directory (originals untouched)
    python dataset_cleaner.py --input dataset --output dataset_clean

    # With thresholds
    python dataset_cleaner.py --input dataset \\
        --min-confidence 0.3 \\
        --blank-threshold 5.0 \\
        --hash-distance 4
"""

from __future__ import annotations

import argparse
import csv
import filecmp
import hashlib
import json
import os
import shutil
import sys
import tempfile
import time
from collections import defaultdict
from dataclasses import dataclass, field
from pathlib import Path
from typing import List, Optional, Set

try:
    import cv2
    import numpy as np
    HAS_CV2 = True
except ImportError:
    HAS_CV2 = False


# ── Constants ────────────────────────────────────────────────────────

# YOLO class names recognised by NetraSense (matches dataset_collector.py)
VALID_CLASS_NAMES = [
    "person", "bicycle", "car", "motorcycle", "bus", "truck",
    "chair", "potted plant", "dog", "cat", "stairs", "pole",
    "wall", "door", "kerb",
]
VALID_CLASS_IDS = set(range(len(VALID_CLASS_NAMES)))

# Metadata CSV fieldnames expected
CSV_FIELDS = [
    "frame_path", "timestamp", "timestamp_iso", "fps", "mode",
    "closest_object", "closest_distance_cm", "threat_level",
    "ultrasonic_cm", "ultrasonic_threat", "ensemble_threat",
    "ensemble_confidence", "ensemble_signal_count", "detection_count",
    "labels", "source",
]

VALID_THREAT_LEVELS = {"NORMAL", "WARNING", "ALARM", "CRITICAL", "NO DATA", "Unknown", None, ""}
VALID_SOURCES = {"capture", "auto", "manual", ""}


# ── Cleaning Report ──────────────────────────────────────────────────

@dataclass
class CleaningReport:
    """Accumulates stats from every cleaning stage."""
    total_frames_before: int = 0
    total_frames_after: int = 0

    corrupt_removed: List[str] = field(default_factory=list)
    blank_removed: List[str] = field(default_factory=list)
    duplicates_removed: List[str] = field(default_factory=list)
    low_conf_removed: List[str] = field(default_factory=list)
    invalid_labels_removed: List[str] = field(default_factory=list)
    orphan_labels_removed: List[str] = field(default_factory=list)
    orphan_frames_removed: List[str] = field(default_factory=list)
    invalid_rows_fixed: int = 0

    def to_dict(self) -> dict:
        return {
            "frames_before": self.total_frames_before,
            "frames_after": self.total_frames_after,
            "frames_removed": self.total_frames_before - self.total_frames_after,
            "removals": {
                "corrupt_frames": len(self.corrupt_removed),
                "blank_frames": len(self.blank_removed),
                "duplicate_frames": len(self.duplicates_removed),
                "low_confidence_rows": len(self.low_conf_removed),
                "invalid_label_files": len(self.invalid_labels_removed),
                "orphan_labels": len(self.orphan_labels_removed),
                "orphan_frames": len(self.orphan_frames_removed),
            },
            "invalid_rows_fixed": self.invalid_rows_fixed,
        }

    def summary(self) -> str:
        d = self.to_dict()
        lines = [
            "=" * 60,
            "  NetraSense Dataset Cleaning Report",
            "=" * 60,
            f"  Frames before       : {d['frames_before']}",
            f"  Frames after        : {d['frames_after']}",
            f"  Total removed       : {d['frames_removed']}",
            f"    Corrupt JPEGs     : {d['removals']['corrupt_frames']}",
            f"    Blank / solid     : {d['removals']['blank_frames']}",
            f"    Duplicates (pHash): {d['removals']['duplicate_frames']}",
            f"    Low-confidence    : {d['removals']['low_confidence_rows']}",
            f"    Invalid labels    : {d['removals']['invalid_label_files']}",
            f"    Orphan labels     : {d['removals']['orphan_labels']}",
            f"    Orphan frames     : {d['removals']['orphan_frames']}",
            f"  Metadata rows fixed : {d['invalid_rows_fixed']}",
            "=" * 60,
        ]
        return "\n".join(lines)


# ── Perceptual Hash (simple average hash — no PIL dependency) ────────

def _average_hash(img_gray: np.ndarray, hash_size: int = 8) -> int:
    """Compute a simple average perceptual hash as an integer."""
    resized = cv2.resize(img_gray, (hash_size, hash_size), interpolation=cv2.INTER_AREA)
    mean_val = resized.mean()
    bits = (resized > mean_val).flatten()
    h = 0
    for bit in bits:
        h = (h << 1) | int(bit)
    return h


def _hamming_distance(h1: int, h2: int) -> int:
    """Hamming distance between two hashes."""
    return bin(h1 ^ h2).count("1")


# ── Core Cleaning Functions ──────────────────────────────────────────

class DatasetCleaner:
    """Full pipeline to clean a NetraSense dataset directory.

    Parameters
    ----------
    input_dir : str | Path
        Path to the dataset root (must contain metadata.csv, frames/, labels/).
    output_dir : str | Path | None
        If set, cleaned data is written here; originals are not modified.
        If None, cleaning happens in-place (with backup).
    dry_run : bool
        If True, only report what *would* be removed; nothing is deleted.
    min_confidence : float
        Drop rows where ensemble_confidence is below this threshold.
    blank_threshold : float
        Frames with grayscale std-dev below this are considered blank/solid.
    hash_distance : int
        Perceptual hash Hamming distance threshold for deduplication.
        0 = exact match, 4 = very similar, 8 = somewhat similar.
    """

    def __init__(
        self,
        input_dir: str | Path,
        output_dir: str | Path | None = None,
        dry_run: bool = False,
        min_confidence: float = 0.3,
        blank_threshold: float = 5.0,
        hash_distance: int = 4,
    ) -> None:
        self._input = Path(input_dir)
        self._output = Path(output_dir) if output_dir else None
        self._dry_run = dry_run
        self._min_conf = min_confidence
        self._blank_thresh = blank_threshold
        self._hash_dist = hash_distance

        self._report = CleaningReport()

        # Validate input directory
        if not self._input.is_dir():
            raise FileNotFoundError(f"Dataset directory not found: {self._input}")
        if not (self._input / "metadata.csv").exists():
            raise FileNotFoundError(f"metadata.csv not found in {self._input}")

    @property
    def report(self) -> CleaningReport:
        return self._report

    def run(self) -> CleaningReport:
        """Execute the full cleaning pipeline. Returns the cleaning report."""
        print(f"\n{'=' * 60}")
        print(f"  NetraSense Dataset Cleaner")
        print(f"{'=' * 60}")
        print(f"  Input     : {self._input}")
        print(f"  Output    : {self._output or '(in-place with backup)'}")
        print(f"  Dry run   : {self._dry_run}")
        print(f"  Thresholds: min_conf={self._min_conf}, blank_std={self._blank_thresh}, hash_dist={self._hash_dist}")
        print(f"{'=' * 60}\n")

        t0 = time.time()

        # Load metadata
        rows = self._load_csv()
        self._report.total_frames_before = len(rows)
        print(f"  Loaded {len(rows)} rows from metadata.csv")

        # Build lookup sets
        frame_files = self._list_frame_files()
        label_files = self._list_label_files()
        print(f"  Found {len(frame_files)} frame files, {len(label_files)} label files")

        # Stage 1: Remove corrupt frames
        print(f"\n[Stage 1] Checking for corrupt / unreadable frames...")
        rows, removed = self._remove_corrupt_frames(rows, frame_files)
        self._report.corrupt_removed.extend(removed)
        print(f"          Removed {len(removed)} corrupt frames")

        # Stage 2: Remove blank / solid frames
        print(f"[Stage 2] Checking for blank / solid-color frames...")
        rows, removed = self._remove_blank_frames(rows, frame_files)
        self._report.blank_removed.extend(removed)
        print(f"          Removed {len(removed)} blank frames")

        # Stage 3: Deduplicate via perceptual hashing
        print(f"[Stage 3] Deduplicating via perceptual hashing (dist <= {self._hash_dist})...")
        rows, removed = self._deduplicate_frames(rows, frame_files)
        self._report.duplicates_removed.extend(removed)
        print(f"          Removed {len(removed)} duplicate frames")

        # Stage 4: Filter low-confidence rows
        print(f"[Stage 4] Filtering rows with confidence < {self._min_conf}...")
        rows, removed = self._filter_low_confidence(rows)
        self._report.low_conf_removed.extend(removed)
        print(f"          Removed {len(removed)} low-confidence rows")

        # Stage 5: Validate YOLO label files
        print(f"[Stage 5] Validating YOLO label files...")
        rows, removed = self._validate_labels(rows, frame_files, label_files)
        self._report.invalid_labels_removed.extend(removed)
        print(f"          Removed {len(removed)} frames with invalid labels")

        # Stage 6: Remove orphan frames / labels
        print(f"[Stage 6] Removing orphan files not in metadata...")
        orphan_labels, orphan_frames = self._remove_orphans(rows, frame_files, label_files)
        self._report.orphan_labels_removed.extend(orphan_labels)
        self._report.orphan_frames_removed.extend(orphan_frames)
        print(f"          Removed {len(orphan_labels)} orphan labels, {len(orphan_frames)} orphan frames")

        # Stage 7: Fix invalid metadata rows
        print(f"[Stage 7] Normalizing metadata fields...")
        rows, fixed = self._normalize_metadata(rows)
        self._report.invalid_rows_fixed = fixed
        print(f"          Fixed {fixed} metadata rows")

        # Write clean dataset
        self._report.total_frames_after = len(rows)
        if not self._dry_run:
            self._write_clean_dataset(rows)
        else:
            print(f"\n  [DRY RUN] Would write {len(rows)} clean rows")

        elapsed = time.time() - t0
        print(f"\n  Completed in {elapsed:.1f}s")
        print(self._report.summary())

        return self._report

    # ── CSV I/O ────────────────────────────────────────────────────

    def _load_csv(self) -> List[dict]:
        rows = []
        with open(self._input / "metadata.csv", "r") as f:
            reader = csv.DictReader(f)
            for row in reader:
                rows.append(row)
        return rows

    # ── File discovery ─────────────────────────────────────────────

    def _list_frame_files(self) -> Set[str]:
        frames_dir = self._input / "frames"
        if not frames_dir.is_dir():
            return set()
        return {f.name for f in frames_dir.glob("*.jpg")}

    def _list_label_files(self) -> Set[str]:
        labels_dir = self._input / "labels"
        if not labels_dir.is_dir():
            return set()
        return {f.name for f in labels_dir.glob("*.txt")}

    def _frame_filename_from_row(self, row: dict) -> str:
        """Extract the bare filename from a row's frame_path (e.g. 'frames/foo.jpg' → 'foo.jpg')."""
        return Path(row.get("frame_path", "")).name

    def _label_filename_from_frame(self, frame_name: str) -> str:
        """Convert frame filename to label filename ('foo.jpg' → 'foo.txt')."""
        return Path(frame_name).with_suffix(".txt").name

    # ── Stage 1: Corrupt frames ────────────────────────────────────

    def _remove_corrupt_frames(self, rows: List[dict], frame_files: Set[str]) -> tuple:
        keep = []
        removed = []
        for row in rows:
            fname = self._frame_filename_from_row(row)
            if not fname:
                removed.append(row.get("frame_path", "?"))
                continue

            # Check file exists on disk
            fpath = self._input / "frames" / fname
            if not fpath.exists() or fpath.stat().st_size == 0:
                removed.append(fname)
                continue

            # Try to decode with OpenCV
            if HAS_CV2:
                img = cv2.imread(str(fpath))
                if img is None:
                    removed.append(fname)
                    continue

            keep.append(row)
        return keep, removed

    # ── Stage 2: Blank / solid frames ──────────────────────────────

    def _remove_blank_frames(self, rows: List[dict], frame_files: Set[str]) -> tuple:
        keep = []
        removed = []
        if not HAS_CV2:
            return rows, []

        for row in rows:
            fname = self._frame_filename_from_row(row)
            fpath = self._input / "frames" / fname
            if not fpath.exists():
                keep.append(row)
                continue

            img = cv2.imread(str(fpath), cv2.IMREAD_GRAYSCALE)
            if img is None:
                keep.append(row)
                continue

            std_dev = float(np.std(img))
            if std_dev < self._blank_thresh:
                removed.append(fname)
                continue

            keep.append(row)
        return keep, removed

    # ── Stage 3: Deduplication ─────────────────────────────────────

    def _deduplicate_frames(self, rows: List[dict], frame_files: Set[str]) -> tuple:
        keep = []
        removed = []
        if not HAS_CV2:
            return rows, []
        if self._hash_dist <= 0:
            return rows, []

        seen_hashes: dict[int, str] = {}  # hash → filename of first occurrence

        for row in rows:
            fname = self._frame_filename_from_row(row)
            fpath = self._input / "frames" / fname
            if not fpath.exists():
                keep.append(row)
                continue

            img = cv2.imread(str(fpath), cv2.IMREAD_GRAYSCALE)
            if img is None:
                keep.append(row)
                continue

            h = _average_hash(img)

            # Check against all seen hashes
            is_dup = False
            for seen_h, seen_name in seen_hashes.items():
                if _hamming_distance(h, seen_h) <= self._hash_dist:
                    is_dup = True
                    removed.append(fname)
                    break

            if not is_dup:
                seen_hashes[h] = fname
                keep.append(row)

        return keep, removed

    # ── Stage 4: Low confidence filter ─────────────────────────────

    def _filter_low_confidence(self, rows: List[dict]) -> tuple:
        keep = []
        removed = []
        for row in rows:
            conf_str = row.get("ensemble_confidence", "")
            if conf_str and conf_str != "":
                try:
                    conf = float(conf_str)
                    if conf < self._min_conf:
                        removed.append(self._frame_filename_from_row(row))
                        continue
                except (ValueError, TypeError):
                    pass  # Keep rows with unparseable confidence
            keep.append(row)
        return keep, removed

    # ── Stage 5: Validate YOLO labels ──────────────────────────────

    def _validate_labels(self, rows: List[dict], frame_files: Set[str], label_files: Set[str]) -> tuple:
        keep = []
        removed = []
        labels_dir = self._input / "labels"

        for row in rows:
            fname = self._frame_filename_from_row(row)
            label_name = self._label_filename_from_frame(fname)
            label_path = labels_dir / label_name

            if not label_path.exists():
                # No label file — keep the frame (it's a valid background frame)
                keep.append(row)
                continue

            # Validate label file content
            valid = self._validate_single_label(label_path)
            if not valid:
                removed.append(fname)
                # Delete the invalid label file in non-dry-run mode
                if not self._dry_run and label_path.exists():
                    label_path.unlink()
                continue

            keep.append(row)
        return keep, removed

    def _validate_single_label(self, label_path: Path) -> bool:
        """Validate a single YOLO label file. Returns True if valid."""
        try:
            content = label_path.read_text().strip()
        except Exception:
            return False

        if not content:
            return True  # Empty label file is valid (no detections)

        for line_no, line in enumerate(content.split("\n"), 1):
            line = line.strip()
            if not line:
                continue
            parts = line.split()
            if len(parts) != 5:
                return False  # YOLO format: class_id cx cy w h

            try:
                class_id = int(parts[0])
                cx, cy, bw, bh = float(parts[1]), float(parts[2]), float(parts[3]), float(parts[4])
            except (ValueError, IndexError):
                return False

            # Class ID must be in valid range
            if class_id < 0 or class_id > len(VALID_CLASS_NAMES):
                return False

            # All bbox values must be in [0, 1]
            if not (0.0 <= cx <= 1.0 and 0.0 <= cy <= 1.0 and 0.0 <= bw <= 1.0 and 0.0 <= bh <= 1.0):
                return False

            # No degenerate box (width or height ≈ 0)
            if bw < 0.001 or bh < 0.001:
                return False

        return True

    # ── Stage 6: Orphan cleanup ────────────────────────────────────

    def _remove_orphans(
        self, rows: List[dict], frame_files: Set[str], label_files: Set[str]
    ) -> tuple:
        # Build set of frame basenames referenced in metadata
        referenced_frames = {self._frame_filename_from_row(r) for r in rows}
        referenced_labels = {self._label_filename_from_frame(f) for f in referenced_frames}

        orphan_labels = []
        orphan_frames = []

        # Remove label files not in metadata
        labels_dir = self._input / "labels"
        for lf in label_files:
            if lf not in referenced_labels:
                orphan_labels.append(lf)
                if not self._dry_run:
                    p = labels_dir / lf
                    if p.exists():
                        p.unlink()

        # Remove frame files not in metadata
        frames_dir = self._input / "frames"
        for ff in frame_files:
            if ff not in referenced_frames:
                orphan_frames.append(ff)
                if not self._dry_run:
                    p = frames_dir / ff
                    if p.exists():
                        p.unlink()

        return orphan_labels, orphan_frames

    # ── Stage 7: Normalize metadata ────────────────────────────────

    def _normalize_metadata(self, rows: List[dict]) -> tuple:
        fixed = 0
        for row in rows:
            # Ensure detection_count is a non-negative integer
            try:
                dc = int(row.get("detection_count", 0))
                if dc < 0:
                    row["detection_count"] = 0
                    fixed += 1
            except (ValueError, TypeError):
                row["detection_count"] = 0
                fixed += 1

            # Ensure closest_distance_cm is numeric or empty
            v = row.get("closest_distance_cm", "")
            if v and v != "":
                try:
                    row["closest_distance_cm"] = str(round(float(v), 1))
                except (ValueError, TypeError):
                    row["closest_distance_cm"] = ""
                    fixed += 1

            # Ensure ensemble_confidence is numeric or empty
            v = row.get("ensemble_confidence", "")
            if v and v != "":
                try:
                    row["ensemble_confidence"] = str(round(float(v), 3))
                except (ValueError, TypeError):
                    row["ensemble_confidence"] = ""
                    fixed += 1

            # Ensure threat_level is a known value
            tl = row.get("threat_level", "")
            if tl and tl not in VALID_THREAT_LEVELS and tl not in {"Normal", "Warning", "Alarming", "Collision"}:
                row["threat_level"] = "Unknown"
                fixed += 1

            # Ensure source is known
            src = row.get("source", "")
            if src and src not in VALID_SOURCES:
                row["source"] = "unknown"
                fixed += 1

        return rows, fixed

    # ── Output ─────────────────────────────────────────────────────

    def _write_clean_dataset(self, rows: List[dict]) -> None:
        """Write the cleaned dataset to the output directory."""
        if self._output:
            out = self._output
        else:
            out = self._input

        frames_out = out / "frames"
        labels_out = out / "labels"
        frames_out.mkdir(parents=True, exist_ok=True)
        labels_out.mkdir(parents=True, exist_ok=True)

        # Back up originals if cleaning in-place
        if not self._output and not self._dry_run:
            backup = self._input / ".backup"
            if not backup.exists():
                print(f"  Backing up originals to {backup}")
                for sub in ["frames", "labels", "metadata.csv"]:
                    src = self._input / sub
                    dst = backup / sub
                    if src.is_dir():
                        shutil.copytree(src, dst, dirs_exist_ok=True)
                    elif src.exists():
                        dst.parent.mkdir(parents=True, exist_ok=True)
                        shutil.copy2(src, dst)

        # Copy surviving frames
        copied_frames = 0
        for row in rows:
            fname = self._frame_filename_from_row(row)
            src = self._input / "frames" / fname
            dst = frames_out / fname
            if src.exists() and not dst.exists():
                shutil.copy2(src, dst)
                copied_frames += 1

        # Copy surviving labels
        copied_labels = 0
        for row in rows:
            fname = self._frame_filename_from_row(row)
            label_name = self._label_filename_from_frame(fname)
            src = self._input / "labels" / label_name
            dst = labels_out / label_name
            if src.exists() and not dst.exists():
                shutil.copy2(src, dst)
                copied_labels += 1

        # Write clean metadata.csv
        csv_path = out / "metadata.csv"
        with open(csv_path, "w", newline="") as f:
            if rows:
                writer = csv.DictWriter(f, fieldnames=rows[0].keys())
                writer.writeheader()
                writer.writerows(rows)
            else:
                writer = csv.DictWriter(f, fieldnames=CSV_FIELDS)
                writer.writeheader()

        print(f"  Wrote {len(rows)} rows to {csv_path}")
        print(f"  Copied {copied_frames} frames, {copied_labels} labels to {out}")


# ── Standalone test ──────────────────────────────────────────────────

def _run_test():
    """Smoke test: build a dirty dataset, clean it, verify results."""
    if not HAS_CV2:
        print("Skipping test: opencv-python and numpy are required.")
        print("  Install with: pip install opencv-python numpy")
        return

    import tempfile

    print("=" * 60)
    print("  NetraSense Dataset Cleaner — Smoke Test")
    print("=" * 60)

    with tempfile.TemporaryDirectory() as tmpdir:
        dataset_dir = Path(tmpdir) / "dirty_dataset"
        frames_dir = dataset_dir / "frames"
        labels_dir = dataset_dir / "labels"
        frames_dir.mkdir(parents=True)
        labels_dir.mkdir(parents=True)

        csv_path = dataset_dir / "metadata.csv"
        rows_written = []

        def _write_frame(name: str, content: str = "random", threat: str = "NORMAL", conf: float = 0.9):
            if content == "random":
                img = np.random.randint(0, 255, (480, 640, 3), dtype=np.uint8)
            elif content == "blank":
                img = np.zeros((480, 640, 3), dtype=np.uint8)
            elif content == "corrupt":
                # Write garbage bytes
                frames_dir.joinpath(name).write_bytes(b"NOT_A_JPEG")
                return
            elif content == "white":
                img = np.full((480, 640, 3), 255, dtype=np.uint8)
            else:
                img = np.random.randint(0, 255, (480, 640, 3), dtype=np.uint8)

            cv2.imwrite(str(frames_dir / name), img, [cv2.IMWRITE_JPEG_QUALITY, 95])

        def _write_label(name: str, content: str = "valid"):
            label_name = Path(name).with_suffix(".txt").name
            if content == "valid":
                labels_dir.joinpath(label_name).write_text("0 0.500000 0.500000 0.200000 0.300000\n")
            elif content == "bad_class":
                labels_dir.joinpath(label_name).write_text("99 0.5 0.5 0.2 0.3\n")
            elif content == "bad_bbox":
                labels_dir.joinpath(label_name).write_text("0 0.5 0.5 1.5 0.3\n")
            elif content == "empty":
                labels_dir.joinpath(label_name).write_text("")
            elif content == "malformed":
                labels_dir.joinpath(label_name).write_text("garbage here\n")

        # ── Build dirty dataset ────────────────────────────────────
        print("\n  Building dirty dataset...")

        # 1. Good frames
        for i in range(5):
            name = f"good_{i:03d}.jpg"
            _write_frame(name, "random")
            _write_label(name, "valid")
            rows_written.append({
                "frame_path": f"frames/{name}",
                "timestamp": f"20260901_{i:06d}",
                "timestamp_iso": f"2026-09-01T00:00:{i:02d}Z",
                "fps": "12.5",
                "mode": "all",
                "closest_object": "person",
                "closest_distance_cm": str(100 + i * 50),
                "threat_level": "WARNING",
                "ultrasonic_cm": str(100 + i * 50),
                "ultrasonic_threat": "WARNING",
                "ensemble_threat": "WARNING",
                "ensemble_confidence": "0.85",
                "ensemble_signal_count": "2",
                "detection_count": "1",
                "labels": "person",
                "source": "manual",
            })

        # 2. Corrupt frame
        _write_frame("corrupt.jpg", "corrupt")
        _write_label("corrupt.jpg", "valid")
        rows_written.append({
            "frame_path": "frames/corrupt.jpg", "timestamp": "20260901_999990",
            "timestamp_iso": "2026-09-01T00:01:00Z", "fps": "0", "mode": "all",
            "closest_object": "", "closest_distance_cm": "", "threat_level": "NORMAL",
            "ultrasonic_cm": "", "ultrasonic_threat": "", "ensemble_threat": "",
            "ensemble_confidence": "", "ensemble_signal_count": "0",
            "detection_count": "0", "labels": "", "source": "auto",
        })

        # 3. Blank frame
        _write_frame("blank_001.jpg", "blank")
        _write_label("blank_001.jpg", "valid")
        rows_written.append({
            "frame_path": "frames/blank_001.jpg", "timestamp": "20260901_999991",
            "timestamp_iso": "2026-09-01T00:01:01Z", "fps": "0", "mode": "all",
            "closest_object": "", "closest_distance_cm": "", "threat_level": "NORMAL",
            "ultrasonic_cm": "", "ultrasonic_threat": "", "ensemble_threat": "",
            "ensemble_confidence": "", "ensemble_signal_count": "0",
            "detection_count": "0", "labels": "", "source": "auto",
        })

        # 4. Near-duplicate (same image repeated)
        dup_img = np.random.randint(0, 255, (480, 640, 3), dtype=np.uint8)
        cv2.imwrite(str(frames_dir / "dup_a.jpg"), dup_img, [cv2.IMWRITE_JPEG_QUALITY, 95])
        # Slightly different JPEG quality to create a slightly different file
        cv2.imwrite(str(frames_dir / "dup_b.jpg"), dup_img, [cv2.IMWRITE_JPEG_QUALITY, 50])
        _write_label("dup_a.jpg", "valid")
        _write_label("dup_b.jpg", "valid")
        for nm in ["dup_a.jpg", "dup_b.jpg"]:
            rows_written.append({
                "frame_path": f"frames/{nm}", "timestamp": "20260901_999992",
                "timestamp_iso": "2026-09-01T00:01:02Z", "fps": "12", "mode": "all",
                "closest_object": "car", "closest_distance_cm": "200",
                "threat_level": "WARNING", "ultrasonic_cm": "200",
                "ultrasonic_threat": "WARNING", "ensemble_threat": "WARNING",
                "ensemble_confidence": "0.80", "ensemble_signal_count": "2",
                "detection_count": "1", "labels": "car", "source": "manual",
            })

        # 5. Low-confidence row
        _write_frame("lowconf.jpg", "random")
        _write_label("lowconf.jpg", "valid")
        rows_written.append({
            "frame_path": "frames/lowconf.jpg", "timestamp": "20260901_999993",
            "timestamp_iso": "2026-09-01T00:01:03Z", "fps": "8", "mode": "all",
            "closest_object": "person", "closest_distance_cm": "150",
            "threat_level": "WARNING", "ultrasonic_cm": "150",
            "ultrasonic_threat": "WARNING", "ensemble_threat": "WARNING",
            "ensemble_confidence": "0.10", "ensemble_signal_count": "1",
            "detection_count": "1", "labels": "person", "source": "capture",
        })

        # 6. Bad label (invalid class ID)
        _write_frame("badlabel.jpg", "random")
        _write_label("badlabel.jpg", "bad_class")
        rows_written.append({
            "frame_path": "frames/badlabel.jpg", "timestamp": "20260901_999994",
            "timestamp_iso": "2026-09-01T00:01:04Z", "fps": "10", "mode": "all",
            "closest_object": "dog", "closest_distance_cm": "80",
            "threat_level": "ALARM", "ultrasonic_cm": "80",
            "ultrasonic_threat": "ALARM", "ensemble_threat": "ALARM",
            "ensemble_confidence": "0.70", "ensemble_signal_count": "2",
            "detection_count": "1", "labels": "dog", "source": "manual",
        })

        # 7. Orphan frame (file on disk but not in CSV)
        _write_frame("orphan.jpg", "random")

        # Write metadata CSV
        with open(csv_path, "w", newline="") as f:
            writer = csv.DictWriter(f, fieldnames=rows_written[0].keys())
            writer.writeheader()
            writer.writerows(rows_written)

        print(f"  Built dataset with {len(rows_written)} CSV rows + 1 orphan frame")
        print(f"  Total frame files: {len(list(frames_dir.glob('*.jpg')))}")

        # ── Run cleaner ────────────────────────────────────────────
        output_dir = Path(tmpdir) / "clean_dataset"
        cleaner = DatasetCleaner(
            input_dir=dataset_dir,
            output_dir=output_dir,
            dry_run=False,
            min_confidence=0.3,
            blank_threshold=5.0,
            hash_distance=4,
        )
        report = cleaner.run()

        # ── Verify results ─────────────────────────────────────────
        print("\n  Verifying clean dataset...")

        # Check that corrupt frame was removed
        assert not (output_dir / "frames" / "corrupt.jpg").exists(), "Corrupt frame should be removed"
        print("    ✓ Corrupt frame removed")

        # Check that blank frame was removed
        assert not (output_dir / "frames" / "blank_001.jpg").exists(), "Blank frame should be removed"
        print("    ✓ Blank frame removed")

        # Check that one duplicate was removed
        dup_count = len(list(output_dir.glob("frames/dup_*.jpg")))
        assert dup_count == 1, f"Expected 1 duplicate frame, got {dup_count}"
        print("    ✓ Duplicate removed (1 of 2 kept)")

        # Check low-confidence was removed
        assert not (output_dir / "frames" / "lowconf.jpg").exists(), "Low-confidence frame should be removed"
        print("    ✓ Low-confidence row removed")

        # Check bad label was removed
        assert not (output_dir / "frames" / "badlabel.jpg").exists(), "Bad label frame should be removed"
        print("    ✓ Invalid label frame removed")

        # Check orphan was removed
        assert not (output_dir / "frames" / "orphan.jpg").exists(), "Orphan frame should be removed"
        print("    ✓ Orphan frame removed")

        # Check clean CSV
        with open(output_dir / "metadata.csv") as f:
            clean_rows = list(csv.DictReader(f))
        print(f"    ✓ Clean metadata: {len(clean_rows)} rows (was {len(rows_written)})")

        # Check all remaining frames have valid labels
        for row in clean_rows:
            fname = Path(row["frame_path"]).name
            label_name = Path(fname).with_suffix(".txt").name
            assert (output_dir / "frames" / fname).exists(), f"Frame missing: {fname}"
            assert (output_dir / "labels" / label_name).exists(), f"Label missing: {label_name}"
        print("    ✓ All clean frames have matching labels")

        # Report check
        assert report.total_frames_after == len(clean_rows), "Report count mismatch"
        print(f"    ✓ Report matches: {report.total_frames_after} frames after cleaning")

    print("\n" + "=" * 60)
    print("  All tests passed!")
    print("=" * 60)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="NetraSense Dataset Cleaner")
    parser.add_argument("--input", type=str, help="Input dataset directory")
    parser.add_argument("--output", type=str, default=None, help="Output directory (default: clean in-place)")
    parser.add_argument("--dry-run", action="store_true", help="Report only, do not delete files")
    parser.add_argument("--min-confidence", type=float, default=0.3, help="Minimum ensemble confidence threshold")
    parser.add_argument("--blank-threshold", type=float, default=5.0, help="Grayscale std-dev below this = blank")
    parser.add_argument("--hash-distance", type=int, default=4, help="pHash Hamming distance for dedup (0=exact)")
    parser.add_argument("--test", action="store_true", help="Run built-in smoke test")

    args = parser.parse_args()

    if args.test or not args.input:
        _run_test()
    else:
        cleaner = DatasetCleaner(
            input_dir=args.input,
            output_dir=args.output,
            dry_run=args.dry_run,
            min_confidence=args.min_confidence,
            blank_threshold=args.blank_threshold,
            hash_distance=args.hash_distance,
        )
        cleaner.run()
