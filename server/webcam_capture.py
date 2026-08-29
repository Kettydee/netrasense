"""Run a webcam-only NetraSense capture preview, with no AI model required."""

from __future__ import annotations

import argparse
import sys
import time

def main() -> int:
    try:
        import cv2
        from camera import CameraStream
    except ImportError:
        print("[CAMERA] OpenCV is not installed. Run: pip install -r requirements.txt", file=sys.stderr)
        return 2

    parser = argparse.ArgumentParser(description="Preview a webcam and capture timestamped frames")
    parser.add_argument("--camera", default="0", help="Camera index or OpenCV source URL (default: 0)")
    parser.add_argument("--output-dir", default="captures", help="Directory for saved JPEG frames")
    args = parser.parse_args()
    source = int(args.camera) if args.camera.isdigit() else args.camera
    camera = CameraStream(source, args.output_dir)

    deadline = time.monotonic() + 3.0
    while time.monotonic() < deadline:
        ret, _ = camera.read()
        if ret:
            break
        time.sleep(0.05)

    ret, _ = camera.read()
    if not ret:
        print(f"[CAMERA] Unavailable: {camera.status()['last_error']}", file=sys.stderr)
        camera.release()
        return 1

    print("[CAMERA] Live preview started. Press S to save a frame, Q or Esc to quit.")
    try:
        while True:
            ret, frame = camera.read()
            if not ret or frame is None:
                print(f"[CAMERA] Stream unavailable: {camera.status()['last_error']}", file=sys.stderr)
                break
            cv2.putText(
                frame,
                f"Webcam FPS: {camera.status()['fps']:.1f} | S: capture | Q: quit",
                (12, 30),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.65,
                (0, 255, 255),
                2,
            )
            cv2.imshow("NetraSense Webcam", frame)
            key = cv2.waitKey(1) & 0xFF
            if key in (ord("q"), 27):
                break
            if key == ord("s"):
                captured = camera.capture_frame()
                print(f"[CAMERA] Frame saved: {captured}" if captured else "[CAMERA] Frame capture failed")
    finally:
        camera.release()
        cv2.destroyAllWindows()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
