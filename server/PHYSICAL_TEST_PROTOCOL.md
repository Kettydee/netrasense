# NetraSense controlled physical-test protocol

## Scope and safety

NetraSense is an experimental prototype, not a validated mobility aid. Never
ask a participant to navigate blindly, use a public roadway, or rely on a
warning to avoid impact. Test only stationary obstacles in a controlled area,
with an observer, manual stop procedure, clear walking route, and no person in
the potential collision path. Stop immediately on unexpected behavior,
overheating, loose wiring, erratic buzzer output, or lost observation.

## Equipment and verified configuration

- Arduino compatible board, USB data cable, HC-SR04, passive piezo buzzer,
  host computer, camera, tape measure/range reference, tripod/mount, and test
  log storage.
- Firmware: `arduino/ultrasonic_sensor.ino`.
- Verified wiring: HC-SR04 VCC→Arduino 5V, GND→GND, TRIG→D9, ECHO→D10;
  buzzer positive→D11, negative→GND. Confirm board-specific electrical
  compatibility before powering it.
- Firmware serial baud: 9600. Nominal sampling interval: 75 ms; this is not a
  measured physical sampling rate.
- The firmware owns buzzer behavior locally. It does not accept host buzzer
  commands. Its valid telemetry is JSON with `distance_cm` and `valid:true`;
  failed echoes are `valid:false` with `NO_ECHO` or `OUT_OF_RANGE`.

## Preflight and startup

1. Inspect wiring with power disconnected; confirm the listed pins manually.
2. Place the device on a stable mount; establish a clear manual termination
   path (unplug USB/power only after safely ending the trial).
3. Start the vision server with the intended camera and `--serial-port`; record
   model identifier, software revision, serial port, and camera source in the
   session log. Do not run automatic actuator commands.
4. Confirm `/api/hardware-status`: camera state, Arduino port, fresh ultrasonic
   telemetry, and configured 300/100/50 cm software zones. A port-open state
   alone is not a healthy sensor.
5. Confirm local buzzer behavior only with a stationary reference obstacle and
   an observer. Mark this as a physical observation in the log; do not infer it
   from serial writes.

## Calibration and ground truth

Use a tape measure from the HC-SR04 face to a large, flat, perpendicular
reference target at measured positions. Record at least three repeats per
position and retain every failed/no-echo result. Do not replace failures with
400 cm. Camera labels, obstacle presence, and required-warning labels are made
by an independent observer or pre-measured setup—not YOLO output.

Ground-truth event time should come from a synchronized video/observer clock.
Firmware has no acquisition timestamp; Python serial `timestamp` is host
receipt/processing time. Document any clock alignment and do not derive
physical end-to-end latency from incomparable clocks.

## Controlled scenarios and repetition

For each category, use the same scenario ID family and predefine repetitions,
environment, obstacle, range, lighting, camera mount/motion, and labeling
rules before review:

1. camera-only; 2. ultrasonic-only; 3. both modalities; 4. visual object with
unknown metric distance; 5. invalid/no-echo ultrasonic; 6. intentionally stale
telemetry (observe safely, never fabricate); 7. conflicting observations; 8.
camera disconnection; 9. serial/Arduino disconnection; 10. reconnection and
recovery; 11. multiple measured distances; 12. documented lighting conditions;
13. controlled camera movement; 14. physical end-to-end latency; 15. actual
firmware buzzer patterns. Repeat each predeclared condition enough times for
the study plan; do not select thresholds from final-evaluation trials.

## Recording and validation

Record metadata rather than unnecessary video. If video is required, minimize
retention, avoid identifiable people, obtain appropriate consent, and protect
files. The metadata recorder does not read hardware; the operator supplies
event timestamps and independent labels:

```sh
cd server
printf '%s\n' '{"scenario_id":"physical-0001","timestamp":"2026-10-15T08:30:00Z","timestamp_source":"video","scenario_category":"85cm-flat-target","ground_truth_obstacle_present":true,"ground_truth_warning":true,"ground_truth_distance_cm":85.0,"camera_available":true,"camera_detections":[],"ultrasonic_valid":true,"ultrasonic_distance_cm":84.7,"ultrasonic_age_s":0.01,"fault_event":"NONE"}' | python3 record_scenario_metadata.py recordings/session.jsonl
python3 validate_recordings.py recordings/session.jsonl --output recordings/session_validation.json
python3 fusion_experiment.py recordings/session.jsonl recordings/session_replay.json
```

Keep raw JSONL read-only after collection, back it up with validation/replay
reports and hashes, and separate `physical`, `fault_injection`, and simulated
fixtures. Unknown labels remain null and are not negative outcomes.

## Completion and termination

End a session after all pre-registered repeats or immediately on a safety,
hardware, timestamp, or recording-integrity failure. Log exclusions and
recovery attempts. Physical readiness requires operator completion of this
protocol; it is not established by automated tests.
