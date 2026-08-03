import assert from "node:assert/strict";
import { test } from "node:test";

import {
  DEFAULT_TOAST_CONFIG,
  TOAST_CONFIG_VERSION,
  resolveToastConfig,
} from "../../src/toasts/config.defaults.ts";

// These assertions encode the SPEC (won-toasts-mvp-plan.md §1), not the
// implementation. If a later MVP silently changes a default, this fails.

test("spec defaults: fresh install is disabled, free, top-right, 3500ms", () => {
  const c = DEFAULT_TOAST_CONFIG;
  assert.equal(c.version, TOAST_CONFIG_VERSION);
  assert.equal(c.enabled, false);
  assert.equal(c.plan, "free");
  assert.equal(c.global.position, "top-right");
  assert.equal(c.global.durationMs, 3500);
  assert.equal(c.global.maxVisible, 3);
  assert.equal(c.global.closeable, true);
  assert.equal(c.global.autoDismiss, true);
  assert.equal(c.global.clickAction, "open-cart");
});

test("spec defaults: burst window is 600ms and grouping is by-product", () => {
  assert.equal(DEFAULT_TOAST_CONFIG.global.grouping.burstWindowMs, 600);
  assert.equal(DEFAULT_TOAST_CONFIG.global.grouping.mode, "by-product");
  assert.equal(DEFAULT_TOAST_CONFIG.global.grouping.mergeDeltas, true);
});

test("spec defaults: neutral system theme with semantic accents", () => {
  assert.equal(DEFAULT_TOAST_CONFIG.theme.mode, "system");
  assert.equal(DEFAULT_TOAST_CONFIG.theme.showImage, true);
  assert.equal(typeof DEFAULT_TOAST_CONFIG.theme.accent.added, "string");
  assert.equal(typeof DEFAULT_TOAST_CONFIG.theme.accent.removed, "string");
  assert.notEqual(
    DEFAULT_TOAST_CONFIG.theme.accent.added,
    DEFAULT_TOAST_CONFIG.theme.accent.removed,
  );
});

test("resolveToastConfig fills a complete config from null/empty", () => {
  const fromNull = resolveToastConfig(null);
  assert.deepEqual(fromNull, DEFAULT_TOAST_CONFIG);
  const fromEmpty = resolveToastConfig({});
  assert.deepEqual(fromEmpty, DEFAULT_TOAST_CONFIG);
});

test("resolveToastConfig deep-merges partial overrides over defaults", () => {
  const resolved = resolveToastConfig({
    enabled: true,
    plan: "pro",
    global: { position: "bottom-left", grouping: { burstWindowMs: 900 } },
    theme: { accent: { added: "#000000" } },
  });
  assert.equal(resolved.enabled, true);
  assert.equal(resolved.plan, "pro");
  assert.equal(resolved.global.position, "bottom-left");
  // untouched sibling keeps its default
  assert.equal(resolved.global.durationMs, 3500);
  // nested grouping override applied, sibling default kept
  assert.equal(resolved.global.grouping.burstWindowMs, 900);
  assert.equal(resolved.global.grouping.mergeDeltas, true);
  // accent override applied, sibling accent kept
  assert.equal(resolved.theme.accent.added, "#000000");
  assert.equal(
    resolved.theme.accent.removed,
    DEFAULT_TOAST_CONFIG.theme.accent.removed,
  );
});

test("resolveToastConfig never trusts unknown plan / non-boolean enabled", () => {
  const resolved = resolveToastConfig({
    // deliberately invalid values as could arrive from an older/corrupt row
    plan: "enterprise" as unknown as "pro",
    enabled: "yes" as unknown as boolean,
  });
  assert.equal(resolved.plan, "free");
  assert.equal(resolved.enabled, false);
});
