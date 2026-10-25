# Physical Sensor Test Protocol (PHASE 7)

## Purpose

This protocol documents the experiments needed to evaluate the complete
NetraSense warning system, not the object-detection numbers already
reported above. The software pipeline is well understood; the physical
side requires real hardware.

## What the existing code actually fuses

The warning decision consumes two layers:

1. **Ultrasonic (HC-SR04 via Arduino)**: direct distance measurement
   (`server/serial_sensor.py` → `server/obstacle_warning.py`).
   The evaluator classifies into OBSTACLE_WARNING / CLEAR /
   SENSOR_ERROR / SENSOR_UNAVAILABLE and applies hysteresis, debounce,
   and staleness timeout (3 s).
2. **Vision (YOLO11n + optionally Depth Anything V2)**:
   `server/vision.py` detects objects and assigns spatial zone, but its
   distance is **from the optional depth model**, not from the
   ultrasonic measurement.

The ensemble (`server/ensemble.py`) is the single conservative fusion
point. It combines ultrasonic distance/threat, YOLO detections, and
depth. **Important caveat**: it does NOT average distances or vote a
warning down; it preserves object-level separation, which matches the
real sensor physics but means the "fusion" metric is an agreement metric
rather than a fused-range metric.

## Physical measurements required (unperformed pending hardware)

| Measurement | Method | Blocked by |
|---|---|---|
| Ultrasonic accuracy (MAE, RMSE, bias) | Measure known-reflectance targets at 10/30/50/100/200/350 cm | HC-SR04 on Arduino |
| Serial read reliability | Send/record valid lines, invalid lines, dropout frequency | USB cable + Arduino |
| Warning precision / recall | Present known obstacles at known distances | Physical obstacle + sensor |
| False-warning / missed-warning rate | Repeated trials at boundary (100 cm, 300 cm) | Physical hardware |
| End-to-end warning latency | Measure time from raw ultrasonic line to dashboard threat badge | Physical hardware |
| Staleness behaviour | Cut the USB link mid-run; verify SENSOR_UNAVAILABLE appears | Physical hardware |
| Serial-disconnection safety | Unplug USB; confirm no fabricated distance is reported | Physical hardware |

## Mocked test boundary

Software tests (e.g. `server/test_obstacle_warning.py`) verify the
evaluator state machine on mock data. Those are **not** physical
measurements and must be reported as such. The paper must keep them
separate from the physical hardware experiments.

## Reproduction command

This protocol requires the physical hardware and cannot be executed from
source alone:

```bash
# Review hardware protocol (this file) — executed with real sensor hardware
# Not a command a CI runner can reproduce.
```
