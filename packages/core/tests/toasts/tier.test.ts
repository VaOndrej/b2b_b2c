import assert from "node:assert/strict";
import { test } from "node:test";

import {
  DEFAULT_GROUPING,
  DEFAULT_THEME,
  DEFAULT_TOAST_CONFIG,
  resolveToastConfig,
} from "../../src/toasts/config.defaults.ts";
import {
  FREE_CURRENCY_LIMIT,
  FREE_MAX_PER_SESSION,
  capCurrencyThresholds,
  effectiveMaxPerSession,
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

test("Free is pinned to a session cap it cannot raise, Pro owns the number", () => {
  // A Free merchant setting 0 ("no limit") must not be able to flood a shopper:
  // protecting the shopper is quality, and Pro gates scope, never quality.
  const free = gateConfigForPlan(
    resolveToastConfig({
      plan: "free",
      global: { frequency: { maxPerSession: 0 } },
    } as never),
  );
  assert.equal(free.global.frequency.maxPerSession, FREE_MAX_PER_SESSION);

  const alsoFree = gateConfigForPlan(
    resolveToastConfig({
      plan: "free",
      global: { frequency: { maxPerSession: 99 } },
    } as never),
  );
  assert.equal(alsoFree.global.frequency.maxPerSession, FREE_MAX_PER_SESSION);

  // Pro keeps whatever it configured, including 0 = unlimited.
  const pro = gateConfigForPlan(
    resolveToastConfig({
      plan: "pro",
      global: { frequency: { maxPerSession: 0 } },
    } as never),
  );
  assert.equal(pro.global.frequency.maxPerSession, 0);
});

test("Free gating leaves the rest of global behaviour alone", () => {
  const base = resolveToastConfig({
    plan: "free",
    global: { position: "top-left", durationMs: 7000, frequency: { cooldownMs: 1234 } },
  } as never);
  const gated = gateConfigForPlan(base);
  assert.equal(gated.global.position, "top-left");
  assert.equal(gated.global.durationMs, 7000);
  assert.equal(gated.global.frequency.cooldownMs, 1234);
});

test("effectiveMaxPerSession is what the admin must display", () => {
  assert.equal(effectiveMaxPerSession("free", 0), FREE_MAX_PER_SESSION);
  assert.equal(effectiveMaxPerSession("free", 40), FREE_MAX_PER_SESSION);
  assert.equal(effectiveMaxPerSession("pro", 0), 0);
  assert.equal(effectiveMaxPerSession("pro", 40), 40);
});

test("a downgraded store stops being served its Pro grouping (BILL-1)", () => {
  // The admin disables these fields on Free, but a disabled field is a courtesy,
  // not a gate: a store that was Pro has the tuned values stored already.
  const wasPro = resolveToastConfig({
    plan: "free",
    global: {
      grouping: {
        mode: "by-type",
        burstWindowMs: 4000,
        mergeDeltas: false,
        dedupeWindowMs: 9000,
        rateLimitPerMin: 240,
      },
    },
  } as never);
  const gated = gateConfigForPlan(wasPro);
  assert.deepEqual(gated.global.grouping, DEFAULT_GROUPING);

  // Free still merges — the DEFAULT is sensible. Pro gates the numbers, not the
  // protection.
  assert.equal(gated.global.grouping.mode, "by-product");

  // Pro keeps everything it configured.
  const pro = gateConfigForPlan({ ...wasPro, plan: "pro" });
  assert.equal(pro.global.grouping.mode, "by-type");
  assert.equal(pro.global.grouping.rateLimitPerMin, 240);
});

test("Free keeps at most FREE_CURRENCY_LIMIT per-currency thresholds", () => {
  const config = resolveToastConfig({
    plan: "free",
    milestones: [
      {
        id: "ship",
        kind: "free_shipping",
        enabled: true,
        thresholdCents: 100000,
        thresholds: { CZK: 100000, EUR: 4000, GBP: 3500, USD: 4500 },
        label: "free shipping",
      },
    ],
  } as never);
  const gated = gateConfigForPlan(config);
  const kept = gated.milestones[0].thresholds ?? {};
  assert.equal(Object.keys(kept).length, FREE_CURRENCY_LIMIT);
  // Deterministic (alphabetical) — the same two every request, so a shopper's
  // free-shipping bar can't flicker between reads.
  assert.deepEqual(Object.keys(kept).sort(), ["CZK", "EUR"]);

  const pro = gateConfigForPlan({ ...config, plan: "pro" });
  assert.equal(Object.keys(pro.milestones[0].thresholds ?? {}).length, 4);
});

test("capCurrencyThresholds leaves a small set and undefined untouched", () => {
  assert.equal(capCurrencyThresholds(undefined, 2), undefined);
  const two = { EUR: 100, USD: 200 };
  assert.equal(capCurrencyThresholds(two, 2), two);
});
