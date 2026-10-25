"""Standalone NetraSense dual-detector camera trial.

Run locally (not in Vercel):
  python -m pip install ultralytics opencv-python
  python experimental/compare_camera.py --camera 0

Press 1 to show Ultralytics predictions, q to quit. This does NOT
replace or claim to integrate the website's COCO-SSD browser pipeline.
"""
import argparse
import time
import cv2
from dual_detection import OptionalUltralyticsDetector

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--camera", default="0", help="Camera index or DroidCam video URL")
    parser.add_argument("--weights", default="yolo26s.pt")
    parser.add_argument("--confidence", type=float, default=0.35)
    args = parser.parse_args()
    source = int(args.camera) if args.camera.isdigit() else args.camera
    camera = cv2.VideoCapture(source)
    if not camera.isOpened():
        raise SystemExit("Camera unavailable. Try --camera 1 or your DroidCam video URL.")
    try:
        detector = OptionalUltralyticsDetector(args.weights, args.confidence)
        while True:
            ok, frame = camera.read()
            if not ok:
                break
            started = time.monotonic()
            detections = detector.detect(frame)
            for item in detections:
                x1, y1, x2, y2 = [int(v) for v in item["bbox"]]
                cv2.rectangle(frame, (x1, y1), (x2, y2), (0, 255, 0), 2)
                cv2.putText(frame, f'{item["label"]} {item["confidence"]:.0%}',
                            (x1, max(20, y1 - 8)), cv2.FONT_HERSHEY_SIMPLEX, .55, (0, 255, 0), 2)
            elapsed = max(time.monotonic() - started, 1e-6)
            cv2.putText(frame, f'Ultralytics YOLO | {1 / elapsed:.1f} FPS | q: quit',
                        (10, 25), cv2.FONT_HERSHEY_SIMPLEX, .6, (255, 255, 255), 2)
            cv2.imshow("NetraSense experimental detector", frame)
            if cv2.waitKey(1) & 0xFF == ord("q"):
                break
    finally:
        camera.release()
        cv2.destroyAllWindows()

if __name__ == "__main__":
    main()
