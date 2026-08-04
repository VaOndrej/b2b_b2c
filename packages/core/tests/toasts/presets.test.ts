import assert from "node:assert/strict";
import { test } from "node:test";

import {
  PRESET_BEHAVIORS,
  PRESET_LOOKS,
  applyBehaviorPreset,
  applyLookPreset,
} from "../../src/toasts/presets.ts";
import { DEFAULT_GLOBAL, DEFAULT_THEME } from "../../src/toasts/config.defaults.ts";

test("look presets are named and applying one deterministically sets fields", () => {
  assert.ok(Object.keys(PRESET_LOOKS).length >= 4);

  const bold = applyLookPreset(DEFAULT_THEME, "bold");
  // deterministic: same input + preset → same output
  assert.deepEqual(bold, applyLookPreset(DEFAULT_THEME, "bold"));
  // preset fields are applied over the base
  assert.equal(bold.shadow, PRESET_LOOKS.bold.shadow);
  assert.equal(bold.cornerRadius, PRESET_LOOKS.bold.cornerRadius);
  // untouched fields keep the base value
  assert.equal(bold.minWidth, DEFAULT_THEME.minWidth);
  // accent object stays complete (all semantic types present)
  assert.equal(Object.keys(bold.accent).length, Object.keys(DEFAULT_THEME.accent).length);
});

test("an unknown look preset id is a no-op (returns base theme)", () => {
  assert.deepEqual(applyLookPreset(DEFAULT_THEME, "nope"), DEFAULT_THEME);
});

test("behavior presets set expected global fields and merge grouping deeply", () => {
  assert.ok(Object.keys(PRESET_BEHAVIORS).length >= 3);

  const urgent = applyBehaviorPreset(DEFAULT_GLOBAL, "high-urgency");
  assert.deepEqual(urgent, applyBehaviorPreset(DEFAULT_GLOBAL, "high-urgency"));
  assert.equal(urgent.durationMs, PRESET_BEHAVIORS["high-urgency"].durationMs);
  // grouping merges over the default grouping (stays complete)
  assert.equal(typeof urgent.grouping.burstWindowMs, "number");
  assert.equal(urgent.grouping.rateLimitPerMin, DEFAULT_GLOBAL.grouping.rateLimitPerMin);
});
