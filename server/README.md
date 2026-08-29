# NetraSense YOLO Vision & Assistive TTS Engine

Real-time YOLO11 object detection, spatial zone classification (Left/Center/Right), monocular depth estimation, and priority offline Text-to-Speech engine integrated from Blind's Eye.

## Quick Start

### 1. Install Dependencies
```bash
pip install -r requirements.txt
```

### 2. Start the Vision Server
```bash
python vision_server.py --port 5000
```

### 3. Server Endpoints
- **Live Video Stream (MJPEG)**: `http://localhost:5000/video_feed`
  - High-speed annotated video with YOLO bounding boxes, direction tags, and distance readouts.
- **Telemetry API (JSON)**: `http://localhost:5000/api/latest`
  - Returns detected objects, directional quadrant, estimated distance in cm, and threat levels.
- **Configuration API**: `http://localhost:5000/api/config`
  - Dynamic update of confidence thresholds and context modes (`all`, `indoor`, `outdoor`).

### 4. Options
- `--camera 0`: Default webcam device index or RTSP/HTTP camera stream URL.
- `--mode indoor`: Limit recognition to indoor obstacles (furniture, stairs, doorways).
- `--mode outdoor`: Prioritize vehicles, pedestrians, traffic lights, curbs.
- `--mute`: Turn off local audio output on the server machine.
- `--confidence 0.5`: Adjust detection sensitivity.
