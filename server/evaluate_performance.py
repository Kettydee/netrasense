"""
NetraSense Performance Evaluation & Benchmarking Suite
======================================================
Reproducible software-only benchmark and evaluation suite for:
1. YOLO11n Model Inference & Vision Pipeline Latency Benchmarking (CPU & MPS).
2. Lighting Variations & Exploratory Luminance Robustness (Original, -50%, +50%).
3. Object Detection Ground Truth Inspection & Metric Status Report.
4. Obstacle Warning Reliability (Mocked Sensor Software Test Suite).

Outputs structured evaluation results to JSON and CSV.
"""

from __future__ import annotations

import argparse
import csv
import json
import math
import os
import platform
import statistics
import sys
import time
from pathlib import Path
from typing import Any, Dict, List, Optional

import cv2
import numpy as np
import torch
from ultralytics import YOLO

# Import NetraSense obstacle warning engine
from obstacle_warning import ObstacleWarningEvaluator, ObstacleState


def get_hardware_info() -> Dict[str, Any]:
    """Capture authoritative hardware configuration."""
    info = {
        "platform": platform.platform(),
        "machine": platform.machine(),
        "processor": platform.processor(),
        "python_version": platform.python_version(),
        "torch_version": torch.__version__,
        "cuda_available": torch.cuda.is_available(),
        "mps_available": torch.backends.mps.is_available(),
        "device_evaluated": "mps" if torch.backends.mps.is_available() else "cpu",
    }
    # Query Apple CPU brand string on macOS if available
    try:
        import subprocess
        res = subprocess.run(["sysctl", "-n", "machdep.cpu.brand_string"], capture_output=True, text=True, check=False)
        if res.returncode == 0 and res.stdout.strip():
            info["cpu_brand"] = res.stdout.strip()
    except Exception:
        pass
    return info


def benchmark_yolo11n(
    model_path: str = "yolo11n.pt",
    test_images: Optional[List[str]] = None,
    frame_width: int = 640,
    confidence: float = 0.45,
    warmup_runs: int = 15,
    benchmark_runs: int = 100,
    device: str = "cpu",
) -> Dict[str, Any]:
    """Benchmark YOLO11n inference latency and end-to-end pipeline processing."""
    print(f"\n[BENCHMARK] Loading {model_path} on device='{device}'...")
    model = YOLO(model_path)
    
    # Load input images
    images_bgr = []
    if test_images:
        for p in test_images:
            if os.path.exists(p):
                img = cv2.imread(p)
                if img is not None:
                    # Resize to pipeline target frame width (640)
                    h, w = img.shape[:2]
                    scale = frame_width / float(w)
                    resized = cv2.resize(img, (frame_width, int(h * scale)))
                    images_bgr.append(resized)
    
    if not images_bgr:
        # Fallback to realistic synthetic frame if no images provided
        dummy = np.zeros((480, frame_width, 3), dtype=np.uint8)
        cv2.circle(dummy, (320, 240), 100, (255, 200, 100), -1)
        images_bgr = [dummy]

    print(f"[BENCHMARK] Using {len(images_bgr)} base image(s) scaled to width={frame_width}px.")

    # 1. Warm-up Phase
    print(f"[BENCHMARK] Performing {warmup_runs} warm-up iterations...")
    for i in range(warmup_runs):
        img = images_bgr[i % len(images_bgr)]
        _ = model(img, conf=confidence, device=device, verbose=False)

    # 2. Measurement Phase
    print(f"[BENCHMARK] Executing {benchmark_runs} timed iterations...")
    model_latencies_ms = []
    e2e_latencies_ms = []
    successful_inferences = 0

    for i in range(benchmark_runs):
        raw_img = images_bgr[i % len(images_bgr)]

        # End-to-end timing includes frame clone/resize checks and post-processing
        t_e2e_start = time.perf_counter()

        # Model pure inference timing
        t_model_start = time.perf_counter()
        results = model(raw_img, conf=confidence, device=device, verbose=False)
        t_model_end = time.perf_counter()

        # Post-processing bbox unpack (mirroring vision.py _detect)
        det_boxes = []
        if results and len(results) > 0:
            boxes = results[0].boxes
            for b in boxes:
                det_boxes.append(b.xyxy[0].cpu().numpy())
            successful_inferences += 1

        t_e2e_end = time.perf_counter()

        model_latencies_ms.append((t_model_end - t_model_start) * 1000.0)
        e2e_latencies_ms.append((t_e2e_end - t_e2e_start) * 1000.0)

    # Statistical computation
    def _calc_stats(data: List[float]) -> Dict[str, float]:
        data_sorted = sorted(data)
        p95_idx = int(math.ceil(0.95 * len(data_sorted))) - 1
        return {
            "mean_ms": round(statistics.mean(data), 2),
            "median_ms": round(statistics.median(data), 2),
            "std_dev_ms": round(statistics.stdev(data), 2) if len(data) > 1 else 0.0,
            "min_ms": round(min(data), 2),
            "max_ms": round(max(data), 2),
            "p95_ms": round(data_sorted[p95_idx], 2),
            "fps": round(1000.0 / statistics.mean(data), 2) if statistics.mean(data) > 0 else 0.0,
        }

    model_stats = _calc_stats(model_latencies_ms)
    e2e_stats = _calc_stats(e2e_latencies_ms)

    return {
        "model": "YOLO11n (yolo11n.pt)",
        "device": device,
        "input_frame_width": frame_width,
        "confidence_threshold": confidence,
        "total_frames_processed": benchmark_runs,
        "successful_inferences": successful_inferences,
        "warmup_runs": warmup_runs,
        "model_inference_latency": model_stats,
        "end_to_end_latency": e2e_stats,
    }


def evaluate_lighting_conditions(
    model_path: str = "yolo11n.pt",
    test_images: Optional[List[str]] = None,
    confidence: float = 0.45,
    device: str = "cpu",
) -> Dict[str, Any]:
    """Exploratory evaluation of YOLO11n detection behavior under controlled lighting variations."""
    print("\n[LIGHTING EVAL] Evaluating controlled synthetic brightness transforms...")
    model = YOLO(model_path)
    
    if not test_images:
        return {"status": "SKIPPED", "reason": "No test images available"}

    conditions = {
        "original": lambda img: img,
        "reduced_brightness_50pct": lambda img: cv2.convertScaleAbs(img, alpha=0.5, beta=-30),
        "increased_brightness_50pct": lambda img: cv2.convertScaleAbs(img, alpha=1.2, beta=45),
    }

    results_by_condition = {}

    for cond_name, transform in conditions.items():
        total_detections = 0
        confidences = []
        latencies_ms = []
        labels_detected = []

        for p in test_images:
            if not os.path.exists(p):
                continue
            orig = cv2.imread(p)
            if orig is None:
                continue
            transformed = transform(orig)
            
            t0 = time.perf_counter()
            res = model(transformed, conf=confidence, device=device, verbose=False)[0]
            latencies_ms.append((time.perf_counter() - t0) * 1000.0)

            boxes = res.boxes
            total_detections += len(boxes)
            for b in boxes:
                confidences.append(float(b.conf[0]))
                labels_detected.append(model.names[int(b.cls[0])])

        results_by_condition[cond_name] = {
            "total_detections": total_detections,
            "mean_confidence": round(float(np.mean(confidences)), 3) if confidences else 0.0,
            "mean_latency_ms": round(float(np.mean(latencies_ms)), 2) if latencies_ms else 0.0,
            "detected_labels": sorted(list(set(labels_detected))),
        }

    return {
        "exploratory_warning": "Synthetically transformed images are not a substitute for real-world lighting experiments.",
        "confidence_threshold": confidence,
        "conditions": results_by_condition,
    }


def evaluate_obstacle_warning_reliability() -> Dict[str, Any]:
    """Run comprehensive software-only tests for ObstacleWarningEvaluator."""
    print("\n[OBSTACLE WARNING] Testing obstacle warning reliability with simulated inputs...")
    evaluator = ObstacleWarningEvaluator(
        warning_threshold_cm=300.0,
        stale_timeout_s=3.0,
        hysteresis_cm=5.0,
        debounce_count=1,
        delta_alert_threshold_cm=15.0,
    )

    test_cases = [
        # (name, action_lambda, expected_state, expected_alert, expected_threat)
        (
            "Missing sensor data at startup",
            lambda: evaluator.evaluate(current_time=100.0),
            ObstacleState.SENSOR_UNAVAILABLE,
            False,
            "NONE",
        ),
        (
            "Valid obstacle distance below threshold (120 cm)",
            lambda: evaluator.process_reading(120.0, reading_timestamp="T1", current_time=100.5),
            ObstacleState.OBSTACLE_WARNING,
            True,
            "WARNING",
        ),
        (
            "Valid obstacle distance exactly at threshold (300 cm)",
            lambda: evaluator.process_reading(300.0, reading_timestamp="T2", current_time=101.0),
            ObstacleState.OBSTACLE_WARNING,
            True,
            "WARNING",
        ),
        (
            "Repeated measurement of same obstacle (121 cm, delta < 15cm)",
            lambda: [
                evaluator.process_reading(120.0, reading_timestamp="T3", current_time=101.5),
                evaluator.process_reading(121.0, reading_timestamp="T4", current_time=101.6),
            ][-1],
            ObstacleState.OBSTACLE_WARNING,
            False,  # Duplicate alert suppressed
            "WARNING",
        ),
        (
            "Significant change in obstacle distance (120 cm -> 60 cm, delta >= 15cm)",
            lambda: [
                evaluator.process_reading(120.0, reading_timestamp="T5", current_time=102.0),
                evaluator.process_reading(60.0, reading_timestamp="T6", current_time=102.1),
            ][-1],
            ObstacleState.OBSTACLE_WARNING,
            True,  # Genuine new alert triggered
            "ALARM",
        ),
        (
            "Valid clear distance above threshold (350 cm)",
            lambda: evaluator.process_reading(350.0, reading_timestamp="T7", current_time=102.5),
            ObstacleState.CLEAR,
            False,
            "NORMAL",
        ),
        (
            "Hysteresis boundary retention (302 cm after warning)",
            lambda: [
                evaluator.process_reading(295.0, reading_timestamp="T8", current_time=103.0),
                evaluator.process_reading(302.0, reading_timestamp="T9", current_time=103.1),
            ][-1],
            ObstacleState.OBSTACLE_WARNING,
            False,
            "NORMAL",  # 302 cm threat level classification is NORMAL (> 300) but warning state retained
        ),
        (
            "Invalid reading: corrupted string",
            lambda: evaluator.process_reading("corrupted_line", current_time=104.0),
            ObstacleState.SENSOR_ERROR,
            False,
            "NONE",
        ),
        (
            "Invalid reading: boolean True",
            lambda: evaluator.process_reading(True, current_time=104.1),
            ObstacleState.SENSOR_ERROR,
            False,
            "NONE",
        ),
        (
            "Invalid reading: physically out-of-bounds (0 cm)",
            lambda: evaluator.process_reading(0.0, current_time=104.2),
            ObstacleState.SENSOR_ERROR,
            False,
            "NONE",
        ),
        (
            "Recovery after sensor error to active warning (70 cm)",
            lambda: [
                evaluator.process_reading("bad", current_time=105.0),
                evaluator.process_reading(70.0, reading_timestamp="T10", current_time=105.5),
            ][-1],
            ObstacleState.OBSTACLE_WARNING,
            True,
            "ALARM",
        ),
        (
            "Stale timeout expiration: warning does not persist past timeout",
            lambda: [
                evaluator.process_reading(80.0, reading_timestamp="T11", current_time=106.0),
                evaluator.evaluate(current_time=109.5),  # 3.5s later > 3.0s timeout
            ][-1],
            ObstacleState.SENSOR_UNAVAILABLE,
            False,
            "NONE",
        ),
        (
            "Stale timeout expiration: clear does not persist indefinitely",
            lambda: [
                evaluator.process_reading(350.0, reading_timestamp="T12", current_time=110.0),
                evaluator.evaluate(current_time=113.5),
            ][-1],
            ObstacleState.SENSOR_UNAVAILABLE,
            False,
            "NONE",
        ),
    ]

    executed_tests = []
    passed = 0
    failed = 0

    for name, action, expected_state, expected_alert, expected_threat in test_cases:
        evaluator.reset()
        res = action()
        
        state_match = (res.state == expected_state)
        alert_match = (res.alert_triggered == expected_alert)
        threat_match = (res.threat_level == expected_threat)
        
        is_pass = state_match and alert_match and threat_match
        if is_pass:
            passed += 1
        else:
            failed += 1

        executed_tests.append({
            "test_name": name,
            "passed": is_pass,
            "expected_state": expected_state.value,
            "actual_state": res.state.value,
            "expected_alert_triggered": expected_alert,
            "actual_alert_triggered": res.alert_triggered,
            "expected_threat": expected_threat,
            "actual_threat": res.threat_level,
        })

    return {
        "evaluation_type": "Software unit verification with simulated inputs (not physical hardware)",
        "total_tests": len(test_cases),
        "passed": passed,
        "failed": failed,
        "tests": executed_tests,
    }


def check_dataset_and_ground_truth(test_dir: str = "dataset/processed/test") -> Dict[str, Any]:
    """Inspect repository for ground-truth annotations and determine metric feasibility."""
    print("\n[GROUND TRUTH INSPECTION] Checking available datasets and annotation files...")
    path = Path(test_dir)
    annotated_labels = list(path.glob("**/*.txt")) + list(path.glob("**/*.json")) + list(path.glob("**/*.xml"))
    images = list(path.glob("**/*.jpg")) + list(path.glob("**/*.png"))

    if not path.exists() or len(annotated_labels) == 0:
        return {
            "ground_truth_available": False,
            "annotated_dataset_path": str(path),
            "annotated_samples_found": len(annotated_labels),
            "status_message": (
                "Ground-truth object detection annotations are currently unavailable in the repository. "
                "Per academic integrity guidelines, precision, recall, and mAP cannot yet be measured reliably "
                "without authentic ground-truth labels. The model's own predictions must NOT be treated as ground truth."
            ),
            "metrics": {
                "precision": None,
                "recall": None,
                "f1_score": None,
                "mAP_50": None,
            }
        }

    return {
        "ground_truth_available": True,
        "annotated_dataset_path": str(path),
        "annotated_samples_found": len(annotated_labels),
        "images_found": len(images),
    }


def save_reports(
    results: Dict[str, Any],
    output_dir: str = "server/evaluation_results"
) -> None:
    """Save benchmark results to JSON and CSV formats."""
    out = Path(output_dir)
    out.mkdir(parents=True, exist_ok=True)

    json_path = out / "software_evaluation_report.json"
    with open(json_path, "w", encoding="utf-8") as f:
        json.dump(results, f, indent=2)
    print(f"\n[REPORT SAVED] JSON report saved to: {json_path}")

    # Save YOLO latency summary CSV
    csv_path = out / "yolo11n_benchmark_summary.csv"
    with open(csv_path, "w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow(["Metric", "Model Inference (ms)", "End-to-End Pipeline (ms)"])
        m_inf = results["yolo_benchmark"]["model_inference_latency"]
        m_e2e = results["yolo_benchmark"]["end_to_end_latency"]
        writer.writerow(["Mean", m_inf["mean_ms"], m_e2e["mean_ms"]])
        writer.writerow(["Median", m_inf["median_ms"], m_e2e["median_ms"]])
        writer.writerow(["Std Dev", m_inf["std_dev_ms"], m_e2e["std_dev_ms"]])
        writer.writerow(["95th Percentile", m_inf["p95_ms"], m_e2e["p95_ms"]])
        writer.writerow(["Min", m_inf["min_ms"], m_e2e["min_ms"]])
        writer.writerow(["Max", m_inf["max_ms"], m_e2e["max_ms"]])
        writer.writerow(["FPS", m_inf["fps"], m_e2e["fps"]])
    print(f"[REPORT SAVED] CSV summary saved to: {csv_path}")


def main():
    parser = argparse.ArgumentParser(description="NetraSense Performance Evaluation Suite")
    parser.add_argument("--model", type=str, default="yolo11n.pt")
    parser.add_argument("--images-dir", type=str, default="test_assets")
    parser.add_argument("--runs", type=int, default=100)
    parser.add_argument("--warmup", type=int, default=15)
    parser.add_argument("--output-dir", type=str, default="evaluation_results")
    args = parser.parse_args()

    # Discover images
    img_dir = Path(args.images_dir)
    test_images = [str(p) for p in img_dir.glob("*.jpg")] if img_dir.exists() else []

    hw_info = get_hardware_info()
    gt_info = check_dataset_and_ground_truth()

    # Benchmark on CPU (production tier) and MPS (accelerated tier)
    yolo_cpu = benchmark_yolo11n(
        model_path=args.model,
        test_images=test_images,
        warmup_runs=args.warmup,
        benchmark_runs=args.runs,
        device="cpu",
    )

    yolo_mps = None
    if hw_info.get("mps_available"):
        yolo_mps = benchmark_yolo11n(
            model_path=args.model,
            test_images=test_images,
            warmup_runs=args.warmup,
            benchmark_runs=args.runs,
            device="mps",
        )

    lighting_res = evaluate_lighting_conditions(
        model_path=args.model,
        test_images=test_images,
        device="cpu",
    )

    obstacle_res = evaluate_obstacle_warning_reliability()

    full_evaluation = {
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "hardware_environment": hw_info,
        "dataset_inspection": gt_info,
        "yolo_benchmark": yolo_cpu,
        "yolo_benchmark_accelerated_mps": yolo_mps,
        "lighting_variations_exploratory": lighting_res,
        "obstacle_warning_reliability": obstacle_res,
    }

    save_reports(full_evaluation, output_dir=args.output_dir)


if __name__ == "__main__":
    main()
