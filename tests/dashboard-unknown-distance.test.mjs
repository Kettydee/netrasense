import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("visual-only ensemble signals render an unknown distance marker", () => {
  const source = readFileSync("src/routes/_authenticated/dashboard.tsx", "utf8");
  assert.match(source, /active && sig\.data\.distance_cm !== null/);
  assert.doesNotMatch(source, /Math\.round\(sig\.data\.distance_cm!\)/);
});

test("dashboard preserves unknown visual distance instead of inventing 120 cm", () => {
  const source = readFileSync("src/components/BlindsEyeLens.tsx", "utf8");
  assert.match(source, /d\.distance_cm \?\?/);
  assert.doesNotMatch(source, /d\.depth_meters \? Math\.round\(d\.depth_meters \* 100\) : 120/);
});

test("dashboard honors the canonical 300 cm boundary and stale USB state", () => {
  const source = readFileSync("src/routes/_authenticated/dashboard.tsx", "utf8");
  assert.match(source, /webSerialAgeSeconds <= SENSOR_HEARTBEAT_TIMEOUT_S/);
  assert.match(source, /liveDistance > 300/);
  assert.match(source, /SENSOR UNAVAILABLE \(USB\)/);
});

test("camera-only events are not persisted with a fabricated zero distance", () => {
  const source = readFileSync("src/routes/_authenticated/dashboard.tsx", "utf8");
  assert.match(source, /if \(currentSensorDist === null\) return;/);
  assert.doesNotMatch(source, /distance_cm: currentSensorDist \?\? 0/);
});
