import assert from "node:assert/strict";
import { test } from "node:test";

import { applyConfigOverlay } from "../../src/toasts/config-overlay.ts";

test("scalar overlay overrides the base value", () => {
  const out = applyConfigOverlay({ enabled: true, plan: "free" }, { plan: "pro" });
  assert.equal(out.plan, "pro");
  assert.equal(out.enabled, true);
});

test("nested overlay merges, leaving sibling fields intact", () => {
  const base = { global: { durationMs: 5000, position: "top-right", maxVisible: 3 } };
  const out = applyConfigOverlay(base, { global: { durationMs: 2000 } });
  assert.equal(out.global.durationMs, 2000);
  assert.equal(out.global.position, "top-right");
  assert.equal(out.global.maxVisible, 3);
});

test("array values are replaced wholesale, not merged", () => {
  const base = { milestones: [{ id: "a" }, { id: "b" }] };
  const out = applyConfigOverlay(base, { milestones: [{ id: "c" }] });
  assert.deepEqual(out.milestones, [{ id: "c" }]);
});

test("empty / nullish overlay returns an equal config", () => {
  const base = { global: { durationMs: 5000 } };
  assert.deepEqual(applyConfigOverlay(base, {}), base);
  assert.deepEqual(applyConfigOverlay(base, null), base);
  assert.deepEqual(applyConfigOverlay(base, undefined), base);
});

test("does not mutate the base config (variant serving must be side-effect free)", () => {
  const base = { global: { durationMs: 5000, position: "top-right" } };
  const snapshot = JSON.parse(JSON.stringify(base));
  applyConfigOverlay(base, { global: { durationMs: 1000 } });
  assert.deepEqual(base, snapshot);
});

test("overlay can introduce a new nested key", () => {
  const out = applyConfigOverlay({ theme: { colorBg: "#fff" } }, { theme: { colorText: "#000" } });
  assert.equal(out.theme.colorBg, "#fff");
  assert.equal(out.theme.colorText, "#000");
});
