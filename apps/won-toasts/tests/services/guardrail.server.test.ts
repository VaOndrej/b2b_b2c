import assert from "node:assert/strict";
import { test } from "node:test";

import { createGuardrailService } from "../../app/services/guardrail.server";

// A running experiment whose baseline had a healthy 10% conversion.
function baseDeps(overrides = {}) {
  const decisions: Array<{ outcome: string; detail?: string }> = [];
  const applied: unknown[] = [];
  const deps = {
    getActiveExperiment: async () => ({
      id: "exp1",
      variantPercent: 50,
      variant: { global: { durationMs: 2000 } },
      baseline: { conversionRate: 0.1, dismissRate: 0.2, jsErrors: 0, sessions: 500 },
      createdAt: new Date("2026-08-01T00:00:00Z"),
    }),
    // Healthy default: 10% conversion, matching the baseline (no breach).
    loadWindowCounts: async () => ({ orders: 50, sessions: 500, dismisses: 100, shown: 500, jsErrors: 0 }),
    loadArmStats: async () => ({
      control: { conversions: 100, sessions: 1000 },
      variant: { conversions: 100, sessions: 1000 },
    }),
    decideExperiment: async (_shop: string, _id: string, outcome: string, detail?: string) => {
      decisions.push({ outcome, detail });
      return { status: outcome };
    },
    applyVariant: async (_shop: string, overlay: unknown) => {
      applied.push(overlay);
    },
    ...overrides,
  };
  return { deps, decisions, applied };
}

const SINCE = "2026-08-05";
const NOW = Date.UTC(2026, 7, 12); // ~11 days after createdAt

test("no active experiment → nothing checked", async () => {
  const { deps } = baseDeps({ getActiveExperiment: async () => null });
  const svc = createGuardrailService(deps);
  const r = await svc.runChecks("s.myshopify.com", { sinceDate: SINCE, now: NOW });
  assert.equal(r.checked, false);
});

test("guardrail breach (conversion crash) → auto-rollback", async () => {
  const { deps, decisions } = baseDeps({
    // conversion collapses to ~2% vs 10% baseline, plenty of traffic
    loadWindowCounts: async () => ({ orders: 10, sessions: 500, dismisses: 100, shown: 500, jsErrors: 0 }),
  });
  const svc = createGuardrailService(deps);
  const r = await svc.runChecks("s.myshopify.com", { sinceDate: SINCE, now: NOW });
  assert.equal(r.action, "rollback");
  assert.equal(decisions[0].outcome, "guardrail_rollback");
});

test("guardrail stays silent below the traffic floor (no false alarm)", async () => {
  const { deps, decisions } = baseDeps({
    loadWindowCounts: async () => ({ orders: 0, sessions: 20, dismisses: 18, shown: 20, jsErrors: 5 }),
  });
  const svc = createGuardrailService(deps);
  const r = await svc.runChecks("s.myshopify.com", { sinceDate: SINCE, now: NOW });
  assert.notEqual(r.action, "rollback");
  assert.equal(decisions.length, 0);
});

test("significant variant win past min duration → auto-promote (applies variant)", async () => {
  const { deps, decisions, applied } = baseDeps({
    loadArmStats: async () => ({
      control: { conversions: 100, sessions: 1000 },
      variant: { conversions: 180, sessions: 1000 }, // clear winner
    }),
  });
  const svc = createGuardrailService(deps);
  const r = await svc.runChecks("s.myshopify.com", { sinceDate: SINCE, now: NOW });
  assert.equal(r.action, "promote");
  assert.equal(decisions[0].outcome, "promoted");
  assert.deepEqual(applied[0], { global: { durationMs: 2000 } });
});

test("captureBaseline builds guard metrics from the window counts", async () => {
  const { deps } = baseDeps();
  const svc = createGuardrailService(deps);
  const baseline = await svc.captureBaseline("s.myshopify.com", SINCE);
  assert.equal(baseline.conversionRate, 50 / 500);
  assert.equal(baseline.sessions, 500);
});
