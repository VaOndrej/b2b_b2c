import assert from "node:assert/strict";
import { test } from "node:test";

import {
  DEFAULT_THEME,
  DEFAULT_TOAST_CONFIG,
} from "../../src/toasts/config.defaults.ts";
import {
  gateConfigForPlan,
  isFeatureAllowed,
  showsBranding,
} from "../../src/toasts/tier.ts";
import type { ToastAppConfig } from "../../src/toasts/config.types.ts";

test("free is blocked from Pro features but keeps everything else", () => {
  assert.equal(isFeatureAllowed("free", "design_studio"), false);
  assert.equal(isFeatureAllowed("free", "targeting"), false);
  assert.equal(isFeatureAllowed("pro", "design_studio"), true);
});

test("gating a free config forces the default look and caps milestones", () => {
  const proConfig: ToastAppConfig = {
    ...DEFAULT_TOAST_CONFIG,
    plan: "free",
    theme: { ...DEFAULT_THEME, mode: "dark", cornerRadius: 30 },
    milestones: [
      { id: "a", kind: "free_shipping", enabled: true, thresholdCents: 1, label: "a" },
      { id: "b", kind: "gift", enabled: true, thresholdCents: 0, label: "b" },
      { id: "c", kind: "qty_discount", enabled: true, thresholdCents: 1, label: "c" },
    ],
  };
  const gated = gateConfigForPlan(proConfig);
  assert.equal(gated.theme.mode, "system"); // default look forced
  assert.equal(gated.theme.cornerRadius, DEFAULT_THEME.cornerRadius);
  assert.equal(gated.milestones.length, 2); // capped
  // usability preserved: messages + behaviour untouched
  assert.equal(gated.global.durationMs, proConfig.global.durationMs);
});

test("pro config passes through unchanged", () => {
  const pro: ToastAppConfig = {
    ...DEFAULT_TOAST_CONFIG,
    plan: "pro",
    theme: { ...DEFAULT_THEME, mode: "dark" },
  };
  assert.equal(gateConfigForPlan(pro).theme.mode, "dark");
});

test("branding shows on free only", () => {
  assert.equal(showsBranding("free"), true);
  assert.equal(showsBranding("pro"), false);
});
