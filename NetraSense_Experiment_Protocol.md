# NetraSense Physical Validation Protocol

**Status:** Prepared for execution. No hardware was available in the current environment; the tests below have **not** been run.

**Applies to:** Part 4 (Physical Validation) and Part 5 (Experimental Evaluation) of the NetraSense research paper.

---

## 1. Equipment

| Item | Notes |
|---|---|
| Arduino-compatible board (Uno or equivalent) | |
| USB data cable | |
| HC-SR04 ultrasonic distance sensor | |
| Passive piezo buzzer | |
| Host computer (Windows/macOS/Linux) | Runs Python backend |
| Webcam | USB, compatible with YOLO11n pipeline |
| Tape measure / range reference | For calibration |
| Tripod / stable mount | For repeatable positioning |
| Test log storage | Notebook or file for operator records |
| Clock source | External clock or synchronized computer clock for latency measurement |

---

## 2. Setup and Preflight

1. **Power down** the host and Arduino before wiring.
2. **Confirm wiring** manually:
   - HC-SR04 VCC → Arduino 5V
   - HC-SR04 GND → Arduino GND
   - HC-SR04 TRIG → Arduino D9
   - HC-SR04 ECHO → Arduino D10
   - Buzzer positive → Arduino D11
   - Buzzer negative → Arduino GND
3. **Confirm board compatibility** before applying power. Check the board's voltage ratings.
4. **Power up** and confirm the host can open the Arduino serial port at 9600 baud.
5. **Record in the session log:**
   - Arduino board model and firmware version
   - Serial port path
   - Camera model and mount
   - Python backend version and dependency versions
   - Clock source and synchronization method

---

## 3. Serial Connectivity and Telemetry Validation

1. Run the Python backend with the Arduino connected.
2. Confirm `/api/hardware-status` reports the Arduino port as connected and the ultrasonic telemetry as active.
3. Confirm `/api/latest` returns a `distance_cm` within the accepted range (2–380 cm for the firmware merchant).
4. Verify the JSON payload shape: `{"distance_cm":N,"valid":true}`.
5. Confirm the timestamp is a valid ISO-8601 string and that it changes between consecutive readings.

---

## 4. Known-Distance Measurements

For each reference distance, record at least three repeats:

1. Place a large, flat, perpendicular target at the measured distance.
2. Start the Python backend and the vision server.
3. Read one or more consecutive serial lines; record the raw line, the parsed `distance_cm`, and the timestamp.
4. Record the tape-measure value measured from the sensor face to the target face.
5. Compute the mean and standard deviation of the three repeats.

**Distances to cover:** 30 cm, 70 cm, 150 cm, 250 cm, 350 cm.

**Rules:**
- Do not replace a failed/no-echo reading with a distance value.
- Record every failed/no-echo result as a separate event.

---

## 5. Threat-Classification Boundary Tests

Verify the host threat boundaries:

| Distance | Expected host threat |
|---|---|
| >300 cm | NORMAL |
| 100–300 cm | WARNING |
| 50–<100 cm | ALARM |
| <50 cm | CRITICAL |

**Procedure:**
1. Position the target at 49.9 cm, 50.0 cm, 50.1 cm, 99.9 cm, 100.0 cm, 100.1 cm, 299.9 cm, 300.0 cm, and 300.1 cm.
2. Record the sensor's `distance_cm` and the host `threat_level`.
3. Verify the boundary behavior is deterministic and reproducible.
4. Do not average multiple readings in a way that masks a boundary error.

---

## 6. Invalid Echoes and Disconnected Sensors

1. **No-echo test:** Block the sensor face and confirm the firmware reports `{"distance_cm":null,"valid":false,"status":"NO_ECHO"}`.
2. **Out-of-range test:** Block the sensor against a very close object and confirm `OUT_OF_RANGE`.
3. **Disconnection test:** Unplug the USB connection and verify the backend marks the sensor as disconnected, not as a valid measurement.
4. **Recovery test:** Reconnect the USB and verify the backend resumes receiving fresh readings.
5. **Recovery-success rule:** Valid ultrasonic data must be present on predefined recovery events, and recovery success must be computed as valid ultrasonic data on such events divided by such events.

**Do not** treat a disconnected sensor as a clear-path reading.

---

## 7. Stale-Data Behavior

1. Start the backend and confirm a fresh reading.
2. Simulate stale telemetry by manually sending records with `ultrasonic_age_s` > 3.0 s.
3. Verify the evaluator represents the state as SENSOR_UNAVAILABLE.
4. Confirm that an old CLEAR state does not persist after data becomes stale.
5. Confirm that the stale evaluation is produced by the evaluator's own `evaluate()` call, not by a display timer.

---

## 8. Camera Connectivity and Object Detection

1. Mount the webcam on a tripod and target a stationary object in the field of view.
2. Run the vision server and confirm YOLO11n reports detections with label, confidence, and bounding box.
3. Vary lighting and object distance within a reasonable range and record detection success rate.
4. Record the checkpoint hash and inference configuration.

**Note:** Camera detections do not provide calibrated metric distances. A detection may produce a threat level but not a distance, unless a depth estimate is available (which is not active in the evaluated baseline).

---

## 9. Combined Sensor Operation

1. With both camera and ultrasonic active, record simultaneous serial and vision-server state.
2. Test the four-state logic:
   - OBSTACLE_WARNING
   - CLEAR
   - SENSOR_ERROR
   - SENSOR_UNAVAILABLE
3. Verify that losing ultrasonic telemetry does not discard a usable visual detection.
4. Verify that a fresh valid ultrasonic obstacle still warns without a camera detection.
5. Verify that a usable visual detection supports WARNING when ultrasonic data is unavailable.

---

## 10. Buzzer Behavior

**Important:** The host does not command the buzzer. The Arduino firmware owns it locally.

1. With a stationary reference obstacle placed at known distances, observe the buzzer and log the pattern.
2. Record the observed pattern at distances ≥300 cm, 200–299 cm, 100–199 cm, and <100 cm.
3. Log the observed pattern as a **physical observation**; do not infer it from serial writes.
4. Record the actual beep rate, tone frequency, and pauses.

---

## 11. Dashboard Warning States

1. Open the web dashboard.
2. Confirm the four-state display: OBSTACLE_WARNING, CLEAR, SENSOR_ERROR, SENSOR_UNAVAILABLE.
3. Verify that the dashboard does not imply a clear path when no fresh measurement is available.
4. Verify that the dashboard does not imply a clear path when the sensor is disconnected.
5. Verify that the dashboard labels the fused score as signal agreement.

---

## 12. Repeated Trials and Data Recording

1. For each scenario, predefine the repetition count before review.
2. Record raw JSONL lines to a read-only log.
3. Run `validate_recordings.py` on the raw log to produce a validation report.
4. Run `fusion_experiment.py` to produce replay records.
5. Retain the raw JSONL, validation report, replay report, and SHA-256 manifest hashes.
6. Record exclusions and their reasons.

---

## 13. Clock Alignment (Required for Latency)

1. Record a physical-time reference (e.g., synchronized computer clock or external time source) for each event.
2. Document the clock alignment procedure.
3. Do not derive physical sensor-to-warning latency from replay timestamps or program execution time.

---

## 14. Safety Rules

- Never ask a participant to navigate blindly.
- Never use a public roadway.
- Never rely on a warning to avoid impact.
- Test only stationary obstacles in a controlled area.
- Use an observer, manual stop procedure, clear walking route, and no person in the potential collision path.
- Stop immediately on unexpected behavior, overheating, loose wiring, erratic buzzer output, or lost observation.

---

## 15. Completion Criteria

Physical readiness requires operator completion of this protocol. It is not established by automated tests. The protocol is complete when the data-recording template is filled and the operator confirms all safety and recording rules.
