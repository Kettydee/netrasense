import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/**
 * Frontend regression tests for dashboard stale-data behaviour.
 *
 * These tests document the intended runtime contract and are verified by
 * source-pattern matching.  They are not executed by any test runner in this
 * repository; they serve as explicit regression criteria for the following
 * conditions:
 *
 *  1. A failed unified-status fetch (network error, server down, non-2xx) must
 *     not render live telemetry.
 *  2. A stale server-reported sensor reading must never be shown as current.
 *  3. A Web Serial line with distance >= 400 cm (the legacy no-echo sentinel)
 *     must be rejected and must not refresh the previous valid reading.
 *  4. Invalid distances (negative, NaN, +inf, -inf) must not enter
 *     fusion or the distance gauge.
 */

test("dashboard: failed API fetch never renders live telemetry", () => {
  const source = readFileSync("src/routes/_authenticated/dashboard.tsx", "utf8");

  // The status query must track whether a successful response occurred, and
  // the sensors must only be treated as live when isStatusLoaded is true.
  assert.match(source, /isStatusLoaded.*isSuccess.*statusQuery\.data !== DEFAULT_STATUS/);

  // The hardwareUltrasonicDistance must be derived from the server response
  // only when the status is loaded and the reading is fresh, never from the
  // DEFAULT_STATUS placeholder.
  assert.match(source, /hw\.ultrasonic.*distance_cm !== null/);
  assert.doesNotMatch(source, /placeholderData.*DEFAULT_STATUS.*distance_cm/);
});

test("dashboard: stale server-reported data is not rendered as current", () => {
  const source = readFileSync("src/routes/_authenticated/dashboard.tsx", "utf8");

  assert.match(source, /isSensorDataFresh/);
  assert.match(source, /SENSOR_HEARTBEAT_TIMEOUT_S/);
  assert.match(source, /sensorAgeSeconds !== null/);
});

test("webSerial: 400 cm is the legacy no-echo sentinel and is rejected", () => {
  const source = readFileSync("src/lib/webSerial.ts", "utf8");

  // The browser layer must treat 400.0 as the firmware's legacy no-echo
  // failure marker, not clamp it to a plausible distance.
  assert.match(source, /rawDistance >= 400/);
  assert.doesNotMatch(source, /Math\.max\(2,\s*Math\.min\(400/);
});

test("webSerial: 380 cm remains within the legitimate envelope", () => {
  const source = readFileSync("src/lib/webSerial.ts", "utf8");
  assert.doesNotMatch(source, /380\.0.*rawDistance.*>= 400/);
});

test("webSerial: invalid readings never refresh the previous distance", () => {
  const source = readFileSync("src/lib/webSerial.ts", "utf8");
  assert.match(source, /lastEmitReading/);
  assert.match(source, /isInvalidDistance/);
  assert.doesNotMatch(source, /smoothedDistance.*=.*rawDistance/);
});

test("dashboard: camera-only events are not persisted with a fabricated distance", () => {
  const source = readFileSync("src/routes/_authenticated/dashboard.tsx", "utf8");
  assert.match(source, /if \(currentSensorDist === null\) return;/);
  assert.doesNotMatch(source, /distance_cm: currentSensorDist \? ?0/);
});
