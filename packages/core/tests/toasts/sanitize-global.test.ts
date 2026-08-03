import assert from "node:assert/strict";
import { test } from "node:test";

import { sanitizeGlobalSettings } from "../../src/toasts/config.defaults.ts";

test("keeps valid enums and clamps numeric ranges", () => {
  const out = sanitizeGlobalSettings({
    position: "bottom-left",
    clickAction: "go-to-product",
    stackDirection: "newest-bottom",
    overflowStrategy: "queue",
    durationMs: 4000,
    maxVisible: 4,
    offsetTop: 20,
    offsetInline: 24,
    autoDismiss: false,
    closeable: true,
  });
  assert.equal(out.position, "bottom-left");
  assert.equal(out.clickAction, "go-to-product");
  assert.equal(out.stackDirection, "newest-bottom");
  assert.equal(out.durationMs, 4000);
  assert.equal(out.maxVisible, 4);
  assert.equal(out.autoDismiss, false);
});

test("guardrail: too-short duration is clamped up, huge values clamped down", () => {
  assert.equal(sanitizeGlobalSettings({ durationMs: 100 }).durationMs, 800);
  assert.equal(sanitizeGlobalSettings({ durationMs: 999999 }).durationMs, 60000);
  assert.equal(sanitizeGlobalSettings({ maxVisible: 99 }).maxVisible, 6);
  assert.equal(sanitizeGlobalSettings({ maxVisible: 0 }).maxVisible, 1);
});

test("drops unknown enum values instead of defaulting them", () => {
  const out = sanitizeGlobalSettings({
    position: "diagonal",
    clickAction: "explode",
  });
  assert.equal("position" in out, false);
  assert.equal("clickAction" in out, false);
});

test("non-object input yields an empty patch", () => {
  assert.deepEqual(sanitizeGlobalSettings(null), {});
  assert.deepEqual(sanitizeGlobalSettings("nope"), {});
});

test("grouping sub-settings are validated and clamped", () => {
  const out = sanitizeGlobalSettings({
    grouping: {
      mode: "by-type",
      burstWindowMs: 900,
      dedupeWindowMs: 99999,
      rateLimitPerMin: 500,
      mergeDeltas: false,
      bogus: "x",
    },
  });
  assert.equal(out.grouping?.mode, "by-type");
  assert.equal(out.grouping?.burstWindowMs, 900);
  assert.equal(out.grouping?.dedupeWindowMs, 10000); // clamped
  assert.equal(out.grouping?.rateLimitPerMin, 240); // clamped
  assert.equal(out.grouping?.mergeDeltas, false);
});

test("invalid grouping mode is dropped", () => {
  const out = sanitizeGlobalSettings({ grouping: { mode: "by-moon" } });
  assert.equal(out.grouping, undefined);
});
