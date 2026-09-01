"""
NetraSense Data Normalization & Annotation Standardization Pipeline
Standardizes image sizes to 640x640 letterbox, converts annotations to YOLO txt and COCO JSON, and splits into train/val/test.
"""

from __future__ import annotations

import csv
import json
import random
import shutil
from pathlib import Path
from typing import Any, Dict, List, Tuple
import cv2
import numpy as np


class DataNormalizer:
    """
    Normalizes images and annotations into standard YOLO and COCO ML training formats.
    """

    COCO_CLASSES = [
        "person", "bicycle", "car", "motorcycle", "airplane", "bus", "train", "truck", "boat",
        "traffic light", "fire hydrant", "stop sign", "parking meter", "bench", "bird", "cat",
        "dog", "horse", "sheep", "cow", "elephant", "bear", "zebra", "giraffe", "backpack",
        "umbrella", "handbag", "tie", "suitcase", "frisbee", "skis", "snowboard", "sports ball",
        "kite", "baseball bat", "baseball glove", "skateboard", "surfboard", "tennis racket",
        "bottle", "wine glass", "cup", "fork", "knife", "spoon", "bowl", "banana", "apple",
        "sandwich", "orange", "broccoli", "carrot", "hot dog", "pizza", "donut", "cake", "chair",
        "couch", "potted plant", "bed", "dining table", "toilet", "tv", "laptop", "mouse",
        "remote", "keyboard", "cell phone", "microwave", "oven", "toaster", "sink", "refrigerator",
        "book", "clock", "vase", "scissors", "teddy bear", "hair drier", "toothbrush"
    ]

    def __init__(self, target_size: int = 640) -> None:
        self.target_size = target_size
        self.class_to_id = {name: i for i, name in enumerate(self.COCO_CLASSES)}

    def letterbox(
        self,
        img: np.ndarray,
        new_shape: Tuple[int, int] = (640, 640),
        color: Tuple[int, int, int] = (114, 114, 114)
    ) -> Tuple[np.ndarray, float, Tuple[float, float]]:
        """Resize and pad image while maintaining aspect ratio."""
        shape = img.shape[:2]  # [height, width]
        r = min(new_shape[0] / shape[0], new_shape[1] / shape[1])

        new_unpad = int(round(shape[1] * r)), int(round(shape[0] * r))
        dw, dh = new_shape[1] - new_unpad[0], new_shape[0] - new_unpad[1]
        dw /= 2
        dh /= 2

        if shape[::-1] != new_unpad:
            img = cv2.resize(img, new_unpad, interpolation=cv2.INTER_LINEAR)

        top, bottom = int(round(dh - 0.1)), int(round(dh + 0.1))
        left, right = int(round(dw - 0.1)), int(round(dw + 0.1))
        img = cv2.copyMakeBorder(img, top, bottom, left, right, cv2.BORDER_CONSTANT, value=color)
        return img, r, (dw, dh)

    def normalize_box(
        self,
        box: List[float],
        orig_w: int,
        orig_h: int,
        ratio: float,
        pad: Tuple[float, float]
    ) -> Tuple[float, float, float, float]:
        """Convert pixel bbox [x1, y1, x2, y2] to normalized YOLO format [xc, yc, w, h]."""
        x1, y1, x2, y2 = box
        dw, dh = pad

        # Map to letterboxed coordinates
        x1_scaled = x1 * ratio + dw
        y1_scaled = y1 * ratio + dh
        x2_scaled = x2 * ratio + dw
        y2_scaled = y2 * ratio + dh

        # Clip to target_size
        x1_scaled = max(0.0, min(float(self.target_size), x1_scaled))
        y1_scaled = max(0.0, min(float(self.target_size), y1_scaled))
        x2_scaled = max(0.0, min(float(self.target_size), x2_scaled))
        y2_scaled = max(0.0, min(float(self.target_size), y2_scaled))

        # Normalized center coordinates and dimensions
        xc = ((x1_scaled + x2_scaled) / 2.0) / self.target_size
        yc = ((y1_scaled + y2_scaled) / 2.0) / self.target_size
        w = abs(x2_scaled - x1_scaled) / self.target_size
        h = abs(y2_scaled - y1_scaled) / self.target_size

        return round(xc, 6), round(yc, 6), round(w, 6), round(h, 6)

    def process_and_split(
        self,
        cleaned_dir: str = "dataset/cleaned",
        output_dir: str = "dataset/processed",
        train_ratio: float = 0.70,
        val_ratio: float = 0.15,
        test_ratio: float = 0.15,
        seed: int = 42
    ) -> Dict[str, Any]:
        """
        Normalize all samples, create YOLO txt + COCO JSON annotations, and split into train/val/test sets.
        """
        random.seed(seed)
        cleaned_path = Path(cleaned_dir)
        out_path = Path(output_dir)

        # Create split folders
        splits = ["train", "val", "test"]
        for s in splits:
            (out_path / s / "images").mkdir(parents=True, exist_ok=True)
            (out_path / s / "labels").mkdir(parents=True, exist_ok=True)

        metadata_csv = cleaned_path / "metadata.csv"
        samples: List[Dict[str, Any]] = []

        if metadata_csv.exists():
            with open(metadata_csv, mode="r", encoding="utf-8") as f:
                reader = csv.DictReader(f)
                samples = list(reader)
        else:
            for p in cleaned_path.glob("**/*.jpg"):
                samples.append({
                    "filename": p.name,
                    "relative_path": p.relative_to(cleaned_path).as_posix(),
                    "primary_class": p.parent.name,
                    "bbox_x1": "0", "bbox_y1": "0", "bbox_x2": "640", "bbox_y2": "480"
                })

        random.shuffle(samples)
        total = len(samples)
        train_end = int(total * train_ratio)
        val_end = train_end + int(total * val_ratio)

        split_map = {}
        for i, sample in enumerate(samples):
            if i < train_end:
                split_map[sample["filename"]] = "train"
            elif i < val_end:
                split_map[sample["filename"]] = "val"
            else:
                split_map[sample["filename"]] = "test"

        coco_datasets = {
            s: {"images": [], "annotations": [], "categories": [{"id": i, "name": c} for i, c in enumerate(self.COCO_CLASSES)]}
            for s in splits
        }
        ann_id = 1

        stats = {"train": 0, "val": 0, "test": 0, "total_processed": 0}

        for idx, sample in enumerate(samples):
            fname = sample["filename"]
            split = split_map.get(fname, "train")
            cls_name = sample.get("primary_class", "object").lower()
            cls_id = self.class_to_id.get(cls_name, 0)

            # Resolve image file
            img_path = cleaned_path / sample.get("relative_path", "")
            if not img_path.exists():
                img_path = cleaned_path / "raw" / cls_name / fname

            if not img_path.exists():
                continue

            orig_img = cv2.imread(str(img_path))
            if orig_img is None:
                continue

            orig_h, orig_w = orig_img.shape[:2]

            # 1. Letterbox Image to 640x640
            norm_img, ratio, pad = self.letterbox(orig_img, (self.target_size, self.target_size))
            dest_img_path = out_path / split / "images" / fname
            cv2.imwrite(str(dest_img_path), norm_img)

            # 2. Compute normalized YOLO bbox
            try:
                x1 = float(sample.get("bbox_x1", 0))
                y1 = float(sample.get("bbox_y1", 0))
                x2 = float(sample.get("bbox_x2", orig_w))
                y2 = float(sample.get("bbox_y2", orig_h))
            except (ValueError, TypeError):
                x1, y1, x2, y2 = 0.0, 0.0, float(orig_w), float(orig_h)

            xc, yc, bw, bh = self.normalize_box([x1, y1, x2, y2], orig_w, orig_h, ratio, pad)

            # 3. Write YOLO annotation (.txt)
            label_fname = Path(fname).stem + ".txt"
            dest_label_path = out_path / split / "labels" / label_fname
            with open(dest_label_path, "w", encoding="utf-8") as f_lbl:
                f_lbl.write(f"{cls_id} {xc} {yc} {bw} {bh}\n")

            # 4. Add to COCO JSON format
            coco_img_id = idx + 1
            coco_datasets[split]["images"].append({
                "id": coco_img_id,
                "file_name": fname,
                "width": self.target_size,
                "height": self.target_size
            })
            coco_datasets[split]["annotations"].append({
                "id": ann_id,
                "image_id": coco_img_id,
                "category_id": cls_id,
                "bbox": [round((xc - bw / 2) * self.target_size, 2), round((yc - bh / 2) * self.target_size, 2), round(bw * self.target_size, 2), round(bh * self.target_size, 2)],
                "area": round((bw * self.target_size) * (bh * self.target_size), 2),
                "iscrowd": 0
            })
            ann_id += 1

            stats[split] += 1
            stats["total_processed"] += 1

        # Write COCO JSON files
        for s in splits:
            with open(out_path / s / "annotations.json", "w", encoding="utf-8") as f_coco:
                json.dump(coco_datasets[s], f_coco, indent=2)

        # Generate YOLO data.yaml configuration file
        data_yaml_content = f"""# NetraSense YOLO Dataset Configuration
path: {out_path.resolve().as_posix()}
train: train/images
val: val/images
test: test/images

# Number of classes
nc: {len(self.COCO_CLASSES)}

# Class names
names: {self.COCO_CLASSES}
"""
        with open(out_path / "data.yaml", "w", encoding="utf-8") as f_yaml:
            f_yaml.write(data_yaml_content)

        print(f"[DATA NORMALIZATION] Completed! Train: {stats['train']}, Val: {stats['val']}, Test: {stats['test']}")
        print(f"[DATA NORMALIZATION] YOLO data.yaml generated at {out_path / 'data.yaml'}")
        return stats


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description="NetraSense Data Normalization & Annotation Standardization")
    parser.add_argument("--input", type=str, default="dataset/cleaned", help="Cleaned dataset input directory")
    parser.add_argument("--output", type=str, default="dataset/processed", help="Processed training dataset directory")
    parser.add_argument("--size", type=int, default=640, help="Target image dimension (640x640)")
    args = parser.parse_args()

    normalizer = DataNormalizer(target_size=args.size)
    normalizer.process_and_split(cleaned_dir=args.input, output_dir=args.output)
