"""
NetraSense — Dataset Normalization & Train/Val/Test Split
=========================================================
Prepares the cleaned dataset for YOLO training by:

1. Resizing / letterbox-padding frames to a target resolution
2. Adjusting YOLO bounding-box annotations to match any crop/resize
3. Optionally applying lightweight augmentation (horizontal flip,
   brightness/contrast jitter, Gaussian noise)
4. Splitting into train / val / test partitions
5. Generating a YOLO-compatible data.yaml config

Directory Layout Expected (from DatasetCleaner output)::

    dataset_clean/
        metadata.csv
        frames/*.jpg
        labels/*.txt

Output Layout (YOLO training-ready)::

    dataset_normalized/
        data.yaml                 ← YOLO training config
        train/
            images/*.jpg
            labels/*.txt
        val/
            images/*.jpg
            labels/*.txt
        test/
            images/*.jpg
            labels/*.txt
        split_stats.json          ← per-split counts + class distribution

Usage::

    # Default: 640x640, 80/10/10 split, no augmentation
    python dataset_normalizer.py --input dataset_clean --output dataset_normalized

    # Custom resolution + augmentation
    python dataset_normalizer.py --input dataset_clean --output dataset_normalized \\
        --target-size 416 --augment --augment-count 2

    # Verbose / dry run
    python dataset_normalizer.py --input dataset_clean --output dataset_normalized --dry-run

    # Run built-in test
    python dataset_normalizer.py --test
"""

from __future__ import annotations

import argparse
import csv
import json
import math
import os
import random
import shutil
import sys
import tempfile
import time
from collections import defaultdict
from pathlib import Path
from typing import List, Optional, Tuple

try:
    import cv2
    import numpy as np
    HAS_CV2 = True
except ImportError:
    HAS_CV2 = False

# ── Constants ────────────────────────────────────────────────────────

VALID_CLASS_NAMES = [
    "person", "bicycle", "car", "motorcycle", "bus", "truck",
    "chair", "potted plant", "dog", "cat", "stairs", "pole",
    "wall", "door", "kerb",
]

# YOLO-compatible class name map (spaces → underscores for data.yaml)
YOLO_CLASS_NAMES = [c.replace(" ", "_") for c in VALID_CLASS_NAMES]

CSV_FIELDS = [
    "frame_path", "timestamp", "timestamp_iso", "fps", "mode",
    "closest_object", "closest_distance_cm", "threat_level",
    "ultrasonic_cm", "ultrasonic_threat", "ensemble_threat",
    "ensemble_confidence", "ensemble_signal_count", "detection_count",
    "labels", "source",
]


# ── Resize / Letterbox ──────────────────────────────────────────────

def letterbox_resize(
    img: np.ndarray,
    target_w: int,
    target_h: int,
    pad_color: Tuple[int, int, int] = (114, 114, 114),
) -> Tuple[np.ndarray, float, float, float, float]:
    """Resize image to fit inside target dimensions with letterbox padding.

    Returns:
        (resized_img, scale, pad_x, pad_y, original_size_ratio)
        - scale: resize ratio applied
        - pad_x, pad_y: padding added (in pixels)
        - ratio: always 1.0 (kept for API compat)
    """
    h, w = img.shape[:2]
    scale = min(target_w / w, target_h / h)
    new_w = int(w * scale)
    new_h = int(h * scale)

    resized = cv2.resize(img, (new_w, new_h), interpolation=cv2.INTER_LINEAR)

    # Create padded canvas
    canvas = np.full((target_h, target_w, 3), pad_color, dtype=np.uint8)
    pad_x = (target_w - new_w) // 2
    pad_y = (target_h - new_h) // 2
    canvas[pad_y:pad_y + new_h, pad_x:pad_x + new_w] = resized

    return canvas, scale, pad_x, pad_y, 1.0


def resize_keep_aspect(
    img: np.ndarray,
    target_w: int,
    target_h: int,
) -> Tuple[np.ndarray, float, float, float, float]:
    """Resize image keeping aspect ratio (may exceed target dims slightly).

    Returns:
        (resized_img, scale_x, scale_y, 0.0, 0.0)
    """
    h, w = img.shape[:2]
    scale_x = target_w / w
    scale_y = target_h / h
    resized = cv2.resize(img, (target_w, target_h), interpolation=cv2.INTER_LINEAR)
    return resized, scale_x, scale_y, 0.0, 0.0


# ── Label Adjustment ────────────────────────────────────────────────

def adjust_label_for_letterbox(
    label_path: Path,
    out_label_path: Path,
    orig_w: int,
    orig_h: int,
    scale: float,
    pad_x: float,
    pad_y: float,
) -> None:
    """Read a YOLO label, adjust coords for letterbox, write to output.

    YOLO format: class_id cx cy w h (normalized 0-1).
    After letterbox, coordinates need to account for scale + padding.
    """
    if not label_path.exists():
        # Empty label file → write empty
        out_label_path.write_text("")
        return

    content = label_path.read_text().strip()
    if not content:
        out_label_path.write_text("")
        return

    lines = []
    for line in content.split("\n"):
        line = line.strip()
        if not line:
            continue
        parts = line.split()
        if len(parts) != 5:
            continue

        try:
            class_id = int(parts[0])
            cx_norm = float(parts[1])
            cy_norm = float(parts[2])
            w_norm = float(parts[3])
            h_norm = float(parts[4])
        except (ValueError, IndexError):
            continue

        # Convert normalized → pixel coords in original image
        cx_px = cx_norm * orig_w
        cy_px = cy_norm * orig_h
        w_px = w_norm * orig_w
        h_px = h_norm * orig_h

        # Convert to top-left corner
        x1 = cx_px - w_px / 2
        y1 = cy_px - h_px / 2
        x2 = cx_px + w_px / 2
        y2 = cy_px + h_px / 2

        # Apply scale + padding
        x1 = x1 * scale + pad_x
        y1 = y1 * scale + pad_y
        x2 = x2 * scale + pad_x
        y2 = y2 * scale + pad_y

        # Clip to canvas bounds (0..target)
        target_w = orig_w * scale + 2 * pad_x  # approximate
        target_h = orig_h * scale + 2 * pad_y
        x1 = max(0, min(x1, target_w))
        y1 = max(0, min(y1, target_h))
        x2 = max(0, min(x2, target_w))
        y2 = max(0, min(y2, target_h))

        # Check for degenerate box
        bw = x2 - x1
        bh = y2 - y1
        if bw < 1 or bh < 1:
            continue

        # Convert back to normalized center format (in output image)
        out_w = scale * orig_w + 2 * pad_x if pad_x > 0 else orig_w * scale
        out_h = scale * orig_h + 2 * pad_y if pad_y > 0 else orig_h * scale
        out_cx = ((x1 + x2) / 2) / out_w
        out_cy = ((y1 + y2) / 2) / out_h
        out_bw = bw / out_w
        out_bh = bh / out_h

        # Clamp to [0, 1]
        out_cx = max(0, min(1, out_cx))
        out_cy = max(0, min(1, out_cy))
        out_bw = max(0, min(1, out_bw))
        out_bh = max(0, min(1, out_bh))

        lines.append(f"{class_id} {out_cx:.6f} {out_cy:.6f} {out_bw:.6f} {out_bh:.6f}")

    out_label_path.write_text("\n".join(lines) + "\n" if lines else "")


def adjust_label_for_resize(
    label_path: Path,
    out_label_path: Path,
    orig_w: int,
    orig_h: int,
    scale_x: float,
    scale_y: float,
) -> None:
    """Adjust YOLO labels for a direct resize (no padding).

    Since YOLO labels are normalized and the resize is uniform to the
    same target dimensions, the normalized labels remain valid.
    We only need to validate and copy.
    """
    if not label_path.exists():
        out_label_path.write_text("")
        return

    content = label_path.read_text().strip()
    if not content:
        out_label_path.write_text("")
        return

    lines = []
    for line in content.split("\n"):
        line = line.strip()
        if not line:
            continue
        parts = line.split()
        if len(parts) != 5:
            continue
        try:
            class_id = int(parts[0])
            cx = float(parts[1])
            cy = float(parts[2])
            bw = float(parts[3])
            bh = float(parts[4])
        except (ValueError, IndexError):
            continue

        # Labels are already normalized [0,1] — they remain valid
        # after a uniform resize. Just clamp for safety.
        cx = max(0, min(1, cx))
        cy = max(0, min(1, cy))
        bw = max(0, min(1, bw))
        bh = max(0, min(1, bh))
        if bw < 0.001 or bh < 0.001:
            continue

        lines.append(f"{class_id} {cx:.6f} {cy:.6f} {bw:.6f} {bh:.6f}")

    out_label_path.write_text("\n".join(lines) + "\n" if lines else "")


# ── Augmentation ─────────────────────────────────────────────────────

def augment_horizontal_flip(
    img: np.ndarray,
    label_path: Path,
    out_label_path: Path,
) -> Tuple[np.ndarray, str]:
    """Flip image horizontally and mirror bounding boxes."""
    flipped = cv2.flip(img, 1)
    h, w = img.shape[:2]

    if not label_path.exists() or label_path.stat().st_size == 0:
        return flipped, ""

    content = label_path.read_text().strip()
    lines = []
    for line in content.split("\n"):
        line = line.strip()
        if not line:
            continue
        parts = line.split()
        if len(parts) != 5:
            continue
        try:
            class_id = int(parts[0])
            cx = float(parts[1])
            cy = float(parts[2])
            bw = float(parts[3])
            bh = float(parts[4])
        except (ValueError, IndexError):
            continue
        # Mirror cx: 1.0 - cx
        lines.append(f"{class_id} {1.0 - cx:.6f} {cy:.6f} {bw:.6f} {bh:.6f}")

    return flipped, "\n".join(lines)


def augment_brightness_jitter(
    img: np.ndarray,
    alpha_range: Tuple[float, float] = (0.7, 1.3),
    beta_range: Tuple[float, float] = (-30, 30),
) -> np.ndarray:
    """Random brightness/contrast jitter."""
    alpha = random.uniform(*alpha_range)
    beta = random.randint(*beta_range)
    return cv2.convertScaleAbs(img, alpha=alpha, beta=beta)


def augment_gaussian_noise(
    img: np.ndarray,
    sigma: float = 15.0,
) -> np.ndarray:
    """Add Gaussian noise."""
    noise = np.random.normal(0, sigma, img.shape).astype(np.float32)
    noisy = img.astype(np.float32) + noise
    return np.clip(noisy, 0, 255).astype(np.uint8)


# ── Splitting ───────────────────────────────────────────────────────

def split_dataset(
    filenames: List[str],
    train_ratio: float = 0.8,
    val_ratio: float = 0.1,
    test_ratio: float = 0.1,
    seed: int = 42,
) -> dict:
    """Shuffle and split filenames into train/val/test.

    Returns {"train": [...], "val": [...], "test": [...]}
    """
    assert abs(train_ratio + val_ratio + test_ratio - 1.0) < 1e-6, \
        f"Ratios must sum to 1.0, got {train_ratio + val_ratio + test_ratio}"

    rng = random.Random(seed)
    shuffled = list(filenames)
    rng.shuffle(shuffled)

    n = len(shuffled)
    n_train = int(n * train_ratio)
    n_val = int(n * val_ratio)

    return {
        "train": shuffled[:n_train],
        "val": shuffled[n_train:n_train + n_val],
        "test": shuffled[n_train + n_val:],
    }


# ── data.yaml Generation ────────────────────────────────────────────

def generate_data_yaml(
    output_dir: Path,
    num_classes: int,
    class_names: List[str],
) -> Path:
    """Generate a YOLO-compatible data.yaml configuration file."""
    yaml_path = output_dir / "data.yaml"

    lines = [
        "# NetraSense YOLO Training Configuration",
        f"# Generated by dataset_normalizer.py",
        "",
        f"train: {output_dir / 'train' / 'images'}",
        f"val: {output_dir / 'val' / 'images'}",
        f"test: {output_dir / 'test' / 'images'}",
        "",
        f"nc: {num_classes}",
        f"names: {class_names}",
    ]

    yaml_path.write_text("\n".join(lines) + "\n")
    return yaml_path


# ── Main Normalizer ─────────────────────────────────────────────────

class DatasetNormalizer:
    """Normalizes a cleaned dataset for YOLO training.

    Parameters
    ----------
    input_dir : str | Path
        Cleaned dataset directory (must contain metadata.csv, frames/, labels/).
    output_dir : str | Path
        Output directory for the normalized, split dataset.
    target_size : int
        Target resolution (frames become target_size x target_size).
    mode : str
        Resize mode: "letterbox" (pad with gray bars) or "stretch" (distort to fit).
    augment : bool
        Apply data augmentation during normalization.
    augment_count : int
        Number of augmented copies per original frame.
    train_ratio, val_ratio, test_ratio : float
        Dataset split ratios.
    seed : int
        Random seed for reproducible splits.
    dry_run : bool
        If True, only report what would be done.
    """

    def __init__(
        self,
        input_dir: str | Path,
        output_dir: str | Path,
        target_size: int = 640,
        mode: str = "letterbox",
        augment: bool = False,
        augment_count: int = 1,
        train_ratio: float = 0.8,
        val_ratio: float = 0.1,
        test_ratio: float = 0.1,
        seed: int = 42,
        dry_run: bool = False,
    ) -> None:
        self._input = Path(input_dir)
        self._output = Path(output_dir)
        self._target = target_size
        self._mode = mode
        self._augment = augment
        self._aug_count = augment_count
        self._train_r = train_ratio
        self._val_r = val_ratio
        self._test_r = test_ratio
        self._seed = seed
        self._dry_run = dry_run

        if not self._input.is_dir():
            raise FileNotFoundError(f"Input directory not found: {self._input}")
        if not (self._input / "metadata.csv").exists():
            raise FileNotFoundError(f"metadata.csv not found in {self._input}")

    def run(self) -> dict:
        """Execute the full normalization pipeline. Returns split statistics."""
        print(f"\n{'=' * 60}")
        print(f"  NetraSense Dataset Normalizer")
        print(f"{'=' * 60}")
        print(f"  Input       : {self._input}")
        print(f"  Output      : {self._output}")
        print(f"  Target size : {self._target}x{self._target}")
        print(f"  Mode        : {self._mode}")
        print(f"  Augment     : {self._augment} (×{self._aug_count})")
        print(f"  Split       : {self._train_r:.0%} / {self._val_r:.0%} / {self._test_r:.0%}")
        print(f"  Seed        : {self._seed}")
        print(f"  Dry run     : {self._dry_run}")
        print(f"{'=' * 60}\n")

        t0 = time.time()

        # Load metadata
        rows = self._load_csv()
        print(f"  Loaded {len(rows)} rows from metadata.csv")

        # Collect valid frame/label pairs
        pairs = self._collect_pairs(rows)
        print(f"  Found {len(pairs)} valid frame/label pairs")

        # Split
        split = split_dataset(
            [p[0] for p in pairs],
            train_ratio=self._train_r,
            val_ratio=self._val_r,
            test_ratio=self._test_r,
            seed=self._seed,
        )
        print(f"  Split: train={len(split['train'])}, val={len(split['val'])}, test={len(split['test'])}")

        # Build pair lookup
        pair_lookup = {p[0]: p for p in pairs}

        # Process each split
        stats = {}
        for split_name, filenames in split.items():
            n = self._process_split(split_name, filenames, pair_lookup)
            stats[split_name] = n
            print(f"  {split_name}: {n} images written")

        # Generate data.yaml
        if not self._dry_run:
            yaml_path = generate_data_yaml(
                self._output,
                num_classes=len(VALID_CLASS_NAMES),
                class_names=YOLO_CLASS_NAMES,
            )
            print(f"  Generated {yaml_path}")

        # Write split stats
        class_dist = self._compute_class_distribution(pairs)
        split_stats = {
            "input_dir": str(self._input),
            "output_dir": str(self._output),
            "target_size": self._target,
            "mode": self._mode,
            "augment": self._augment,
            "augment_count": self._aug_count,
            "splits": stats,
            "total_output": sum(stats.values()),
            "class_distribution": class_dist,
            "class_names": VALID_CLASS_NAMES,
        }

        if not self._dry_run:
            stats_path = self._output / "split_stats.json"
            stats_path.write_text(json.dumps(split_stats, indent=2))
            print(f"  Wrote {stats_path}")

        elapsed = time.time() - t0
        print(f"\n  Completed in {elapsed:.1f}s")
        print(f"  Output: {self._output}")
        print(f"{'=' * 60}\n")

        return split_stats

    # ── CSV I/O ────────────────────────────────────────────────────

    def _load_csv(self) -> List[dict]:
        rows = []
        with open(self._input / "metadata.csv", "r") as f:
            reader = csv.DictReader(f)
            for row in reader:
                rows.append(row)
        return rows

    # ── Pair collection ────────────────────────────────────────────

    def _collect_pairs(self, rows: List[dict]) -> List[Tuple[str, Path, Path]]:
        """Collect (basename, frame_path, label_path) triples that exist on disk."""
        pairs = []
        frames_dir = self._input / "frames"
        labels_dir = self._input / "labels"

        for row in rows:
            fname = Path(row.get("frame_path", "")).name
            if not fname:
                continue
            frame_path = frames_dir / fname
            label_path = labels_dir / Path(fname).with_suffix(".txt").name
            if frame_path.exists():
                pairs.append((fname, frame_path, label_path))

        return pairs

    # ── Process one split ──────────────────────────────────────────

    def _process_split(
        self,
        split_name: str,
        filenames: List[str],
        pair_lookup: dict,
    ) -> int:
        """Resize/augment/copy frames+labels for one split. Returns count."""
        if not filenames:
            return 0

        if self._dry_run:
            return len(filenames) * (1 + (self._aug_count if self._augment else 0))

        images_dir = self._output / split_name / "images"
        labels_dir = self._output / split_name / "labels"
        images_dir.mkdir(parents=True, exist_ok=True)
        labels_dir.mkdir(parents=True, exist_ok=True)

        count = 0
        for fname in filenames:
            if fname not in pair_lookup:
                continue
            _, frame_path, label_path = pair_lookup[fname]

            img = cv2.imread(str(frame_path))
            if img is None:
                continue

            orig_h, orig_w = img.shape[:2]
            stem = Path(fname).stem

            # ── Original (resized) ────────────────────────────────
            if self._mode == "letterbox":
                resized, scale, pad_x, pad_y, _ = letterbox_resize(
                    img, self._target, self._target
                )
                out_frame = images_dir / f"{stem}.jpg"
                out_label = labels_dir / f"{stem}.txt"
                cv2.imwrite(str(out_frame), resized, [cv2.IMWRITE_JPEG_QUALITY, 95])
                adjust_label_for_letterbox(
                    label_path, out_label, orig_w, orig_h, scale, pad_x, pad_y
                )
            else:
                resized, sx, sy, _, _ = resize_keep_aspect(
                    img, self._target, self._target
                )
                out_frame = images_dir / f"{stem}.jpg"
                out_label = labels_dir / f"{stem}.txt"
                cv2.imwrite(str(out_frame), resized, [cv2.IMWRITE_JPEG_QUALITY, 95])
                adjust_label_for_resize(
                    label_path, out_label, orig_w, orig_h, sx, sy
                )
            count += 1

            # ── Augmented copies ──────────────────────────────────
            if self._augment:
                for aug_i in range(self._aug_count):
                    aug_img = resized.copy()
                    aug_label_content = out_label.read_text() if out_label.exists() else ""

                    # Random augmentations
                    if random.random() > 0.5:
                        aug_img = augment_brightness_jitter(aug_img)
                    if random.random() > 0.5:
                        aug_img = augment_gaussian_noise(aug_img)

                    aug_stem = f"{stem}_aug{aug_i}"
                    aug_frame = images_dir / f"{aug_stem}.jpg"
                    aug_label = labels_dir / f"{aug_stem}.txt"
                    cv2.imwrite(str(aug_frame), aug_img, [cv2.IMWRITE_JPEG_QUALITY, 95])
                    aug_label.write_text(aug_label_content)
                    count += 1

        return count

    # ── Class distribution ─────────────────────────────────────────

    def _compute_class_distribution(self, pairs: List[Tuple]) -> dict:
        """Count how many frames contain each class."""
        dist = defaultdict(int)
        labels_dir = self._input / "labels"

        for fname, _, _ in pairs:
            label_path = labels_dir / Path(fname).with_suffix(".txt").name
            if not label_path.exists():
                continue
            content = label_path.read_text().strip()
            for line in content.split("\n"):
                parts = line.strip().split()
                if len(parts) >= 1:
                    try:
                        class_id = int(parts[0])
                        if 0 <= class_id < len(VALID_CLASS_NAMES):
                            dist[VALID_CLASS_NAMES[class_id]] += 1
                    except ValueError:
                        pass

        return dict(dist)


# ── Standalone test ──────────────────────────────────────────────────

def _run_test():
    """Smoke test: build a synthetic dataset, normalize it, verify output."""
    if not HAS_CV2:
        print("Skipping test: opencv-python and numpy are required.")
        print("  Install with: pip install opencv-python numpy")
        return

    print("=" * 60)
    print("  NetraSense Dataset Normalizer — Smoke Test")
    print("=" * 60)

    with tempfile.TemporaryDirectory() as tmpdir:
        # Build a synthetic input dataset
        input_dir = Path(tmpdir) / "input_dataset"
        frames_dir = input_dir / "frames"
        labels_dir = input_dir / "labels"
        frames_dir.mkdir(parents=True)
        labels_dir.mkdir(parents=True)

        rows = []
        class_counts = defaultdict(int)

        for i in range(20):
            name = f"frame_{i:04d}.jpg"
            # Varied resolutions to test resize
            h = random.choice([360, 480, 720, 1080])
            w = random.choice([640, 800, 1280])
            img = np.random.randint(0, 255, (h, w, 3), dtype=np.uint8)
            cv2.imwrite(str(frames_dir / name), img, [cv2.IMWRITE_JPEG_QUALITY, 95])

            # YOLO labels (1-3 detections per frame)
            n_dets = random.randint(1, 3)
            label_lines = []
            for d in range(n_dets):
                cid = random.randint(0, min(5, len(VALID_CLASS_NAMES) - 1))
                cx = random.uniform(0.1, 0.9)
                cy = random.uniform(0.1, 0.9)
                bw = random.uniform(0.05, 0.3)
                bh = random.uniform(0.05, 0.3)
                label_lines.append(f"{cid} {cx:.6f} {cy:.6f} {bw:.6f} {bh:.6f}")
                class_counts[VALID_CLASS_NAMES[cid]] += 1

            labels_dir.joinpath(Path(name).with_suffix(".txt").name).write_text(
                "\n".join(label_lines)
            )

            rows.append({
                "frame_path": f"frames/{name}",
                "timestamp": f"20260901_{i:06d}",
                "timestamp_iso": f"2026-09-01T00:00:{i:02d}Z",
                "fps": "12.0", "mode": "all",
                "closest_object": "person", "closest_distance_cm": str(100 + i * 10),
                "threat_level": "WARNING", "ultrasonic_cm": str(100 + i * 10),
                "ultrasonic_threat": "WARNING", "ensemble_threat": "WARNING",
                "ensemble_confidence": "0.85", "ensemble_signal_count": "2",
                "detection_count": str(n_dets),
                "labels": ",".join(sorted(set(VALID_CLASS_NAMES[int(l.split()[0])]
                    for l in label_lines if l.strip()))),
                "source": "manual",
            })

        with open(input_dir / "metadata.csv", "w", newline="") as f:
            writer = csv.DictWriter(f, fieldnames=rows[0].keys())
            writer.writeheader()
            writer.writerows(rows)

        print(f"\n  Built input: {len(rows)} frames, varied resolutions")

        # ── Test 1: Letterbox resize, no augmentation ──────────────
        out1 = Path(tmpdir) / "output_letterbox"
        normalizer = DatasetNormalizer(
            input_dir=input_dir,
            output_dir=out1,
            target_size=640,
            mode="letterbox",
            augment=False,
            train_ratio=0.7,
            val_ratio=0.15,
            test_ratio=0.15,
            seed=42,
        )
        stats1 = normalizer.run()

        # Verify output structure
        assert (out1 / "train" / "images").is_dir()
        assert (out1 / "val" / "images").is_dir()
        assert (out1 / "test" / "images").is_dir()
        assert (out1 / "data.yaml").exists()
        assert (out1 / "split_stats.json").exists()
        print("  ✓ Output directory structure correct")

        # Verify split counts sum to total
        total = stats1["splits"]["train"] + stats1["splits"]["val"] + stats1["splits"]["test"]
        assert total == 20, f"Expected 20 total, got {total}"
        print(f"  ✓ Split counts correct: {stats1['splits']}")

        # Verify image dimensions
        sample = cv2.imread(str((out1 / "train" / "images").glob("*.jpg").__next__()))
        assert sample.shape[:2] == (640, 640), f"Expected 640x640, got {sample.shape[:2]}"
        print("  ✓ Images resized to 640x640")

        # Verify labels exist and are non-empty
        train_labels = list((out1 / "train" / "labels").glob("*.txt"))
        assert len(train_labels) > 0
        non_empty = sum(1 for l in train_labels if l.stat().st_size > 0)
        print(f"  ✓ Labels: {len(train_labels)} total, {non_empty} with detections")

        # Verify data.yaml content
        yaml_content = (out1 / "data.yaml").read_text()
        assert "nc: 15" in yaml_content
        assert "train:" in yaml_content
        print("  ✓ data.yaml generated correctly")

        # ── Test 2: With augmentation ──────────────────────────────
        out2 = Path(tmpdir) / "output_augmented"
        normalizer2 = DatasetNormalizer(
            input_dir=input_dir,
            output_dir=out2,
            target_size=416,
            mode="letterbox",
            augment=True,
            augment_count=2,
            train_ratio=0.8,
            val_ratio=0.1,
            test_ratio=0.1,
            seed=42,
        )
        stats2 = normalizer2.run()

        # With augment_count=2, total should be 20 × 3 = 60
        assert stats2["total_output"] == 60, f"Expected 60 (20×3), got {stats2['total_output']}"
        print(f"  ✓ Augmentation produced {stats2['total_output']} frames (20 × 3)")

        # Verify augmented files
        aug_files = list((out2 / "train" / "images").glob("*_aug*.jpg"))
        assert len(aug_files) > 0, "No augmented files found"
        print(f"  ✓ Augmented files present: {len(aug_files)}")

        # Verify class distribution exists
        assert "class_distribution" in stats2
        assert len(stats2["class_distribution"]) > 0
        print(f"  ✓ Class distribution: {dict(stats2['class_distribution'])}")

    print("\n" + "=" * 60)
    print("  All tests passed!")
    print("=" * 60)


# ── CLI ──────────────────────────────────────────────────────────────

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="NetraSense Dataset Normalizer")
    parser.add_argument("--input", type=str, help="Input dataset directory (cleaned)")
    parser.add_argument("--output", type=str, help="Output directory for normalized dataset")
    parser.add_argument("--target-size", type=int, default=640, help="Target image size (NxN), default: 640")
    parser.add_argument("--mode", type=str, choices=["letterbox", "stretch"], default="letterbox",
                        help="Resize mode: letterbox (pad) or stretch (distort)")
    parser.add_argument("--augment", action="store_true", help="Apply data augmentation")
    parser.add_argument("--augment-count", type=int, default=1, help="Number of augmented copies per frame")
    parser.add_argument("--train-ratio", type=float, default=0.8, help="Training split ratio")
    parser.add_argument("--val-ratio", type=float, default=0.1, help="Validation split ratio")
    parser.add_argument("--test-ratio", type=float, default=0.1, help="Test split ratio")
    parser.add_argument("--seed", type=int, default=42, help="Random seed for reproducibility")
    parser.add_argument("--dry-run", action="store_true", help="Report only, do not write files")
    parser.add_argument("--test", action="store_true", help="Run built-in smoke test")

    args = parser.parse_args()

    if args.test or not args.input:
        _run_test()
    else:
        if not args.output:
            parser.error("--output is required when --input is specified")

        normalizer = DatasetNormalizer(
            input_dir=args.input,
            output_dir=args.output,
            target_size=args.target_size,
            mode=args.mode,
            augment=args.augment,
            augment_count=args.augment_count,
            train_ratio=args.train_ratio,
            val_ratio=args.val_ratio,
            test_ratio=args.test_ratio,
            seed=args.seed,
            dry_run=args.dry_run,
        )
        normalizer.run()
