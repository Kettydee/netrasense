import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("visual-only ensemble signals render an unknown distance marker", () => {
  const source = readFileSync("src/routes/_authenticated/dashboard.tsx", "utf8");
  assert.match(source, /active && sig\.data\.distance_cm !== null/);
  assert.doesNotMatch(source, /Math\.round\(sig\.data\.distance_cm!\)/);
});
