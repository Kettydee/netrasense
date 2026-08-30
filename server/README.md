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

### Laptop webcam (no AI required)

Preview a laptop webcam directly through OpenCV, with source FPS shown on the
video. Press `S` to save a timestamped JPEG frame and `Q` or `Esc` to quit:

```bash
python webcam_capture.py --camera 0 --output-dir captures
```

If the selected device cannot be opened or stops returning frames, the command
prints a clear camera-unavailable error and exits safely. When using
`vision_server.py`, use `POST /api/capture` to save the latest frame; camera
availability, source FPS, dimensions, and frame time are exposed as
`camera_status` in `GET /api/latest`.

### Arduino ultrasonic sensor (optional)

Connect the Arduino over USB and have it write one reading per line, e.g. `73`,
`73 cm`, or `{"distance_cm": 73}`. Run it independently while bringing up the
hardware:

An HC-SR04 sender is included at `../arduino/ultrasonic_sensor.ino`; its default
wiring is TRIG → D9 and ECHO → D10 (use an ECHO voltage divider with a 3.3 V
board).

```bash
python serial_sensor.py --port auto --baudrate 9600
```

It prints validated records in this standard format:

```json
{
  "distance_cm": 73,
  "timestamp": "2026-08-29T12:34:56.789Z",
  "device_id": "NETRA-001",
  "threat_level": "ALARM",
  "processing_latency_ms": 0.12
}
```

The reader automatically retries after a USB disconnect and rediscovery. It
rejects malformed, non-finite, and out-of-range values (default range: 2–400
cm). To expose the latest sensor record from the vision service, start it with:

```bash
python vision_server.py --serial-port auto --serial-baudrate 9600
```

`GET /api/latest` then includes `sensor_data` and `sensor_status`.

### View the live reading in the web dashboard

After signing in to the NetraSense website, open **Settings & Audio Preferences**
and save the address of this Python service under **Arduino ultrasonic sensor**
(the default is `http://localhost:5000`). The realtime dashboard polls the
service every 500 ms and shows the distance, native threat level, device ID,
timestamp, processing latency, and USB connection status.

### Non-AI threat detection test

The serial pipeline assigns a threat level before vision/AI processing:

| Distance      | Threat level |
| ------------- | ------------ |
| `> 300 cm`    | `NORMAL`     |
| `100–300 cm`  | `WARNING`    |
| `50–99.99 cm` | `ALARM`      |
| `< 50 cm`     | `CRITICAL`   |

Run the hardware-free validation to test 3 m, 2 m, 1 m, 70 cm, and 40 cm. It
prints a pass/fail row and local response latency for each input, plus average
and maximum latency:

```bash
python test_threat_detection.py
```

At the shared 100 cm and 300 cm boundaries, the wider upper range applies:
both values are `WARNING`.

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
