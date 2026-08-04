import assert from "node:assert/strict";
import { test } from "node:test";

import { exportConfig, importConfig } from "../../src/toasts/config-io.ts";
import {
  DEFAULT_TOAST_CONFIG,
  resolveToastConfig,
} from "../../src/toasts/config.defaults.ts";

test("export→import round-trip resolves to an identical config", () => {
  const cfg = resolveToastConfig({
    enabled: true,
    plan: "pro",
    global: { position: "bottom-center", durationMs: 5000 },
    theme: { mode: "dark", cornerRadius: 20 },
    messages: { added: { en: "Yay" } },
    milestones: [
      { id: "free_shipping", kind: "free_shipping", enabled: true, thresholdCents: 5000, label: "free shipping" },
    ],
    targeting: { pages: ["product"], device: "mobile", customerState: "both" },
  });

  const json = exportConfig(cfg);
  assert.equal(typeof json, "string");

  const roundTripped = resolveToastConfig(importConfig(json));
  assert.deepEqual(roundTripped, cfg);
});

test("default config round-trips cleanly", () => {
  const json = exportConfig(DEFAULT_TOAST_CONFIG);
  assert.deepEqual(resolveToastConfig(importConfig(json)), DEFAULT_TOAST_CONFIG);
});

test("importing malformed JSON yields an empty (safe) stored config", () => {
  assert.deepEqual(importConfig("not json"), {});
  // resolving the empty result is the default config
  assert.deepEqual(resolveToastConfig(importConfig("not json")), DEFAULT_TOAST_CONFIG);
});
