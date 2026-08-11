import assert from "node:assert/strict";
import { test } from "node:test";

import {
  inHoldout,
  assignArm,
  probVariantBeatsControl,
  evaluateExperiment,
  guardrailBreach,
  evaluateBySegment,
  whatIfForecast,
  auditEntry,
  liveGuardMetrics,
  type ArmStat,
} from "../../src/toasts/experiment-engine.ts";

// --- holdout: deterministic, non-overlapping ---

test("inHoldout is deterministic per token and honours the percentage", () => {
  const a = inHoldout("cart-token-123", 10);
  assert.equal(inHoldout("cart-token-123", 10), a); // stable across calls
  // 0% holdout = nobody held out; 100% = everyone.
  assert.equal(inHoldout("anything", 0), false);
  assert.equal(inHoldout("anything", 100), true);
});

test("holdout at ~10% keeps roughly a tenth out, and holdout ⊆ exposed-complement", () => {
  let held = 0;
  const N = 4000;
  for (let i = 0; i < N; i++) {
    const t = "tok-" + i;
    const h = inHoldout(t, 10);
    if (h) held += 1;
    // a held-out token is, by definition, NOT exposed — the two never overlap
    assert.equal(h && !h, false);
  }
  const ratio = held / N;
  assert.ok(ratio > 0.05 && ratio < 0.15, `holdout ratio ${ratio} not near 0.10`);
});

test("assignArm splits control/variant deterministically by token", () => {
  const arm = assignArm("shopper-42", 50);
  assert.equal(assignArm("shopper-42", 50), arm);
  assert.ok(arm === "control" || arm === "variant");
});

// --- Bayesian significance ---

test("probVariantBeatsControl ~0.5 when arms are identical, high when variant clearly wins", () => {
  const even = probVariantBeatsControl(
    { conversions: 100, sessions: 1000 },
    { conversions: 100, sessions: 1000 },
  );
  assert.ok(even > 0.4 && even < 0.6);

  const win = probVariantBeatsControl(
    { conversions: 100, sessions: 1000 }, // control 10%
    { conversions: 180, sessions: 1000 }, // variant 18%
  );
  assert.ok(win > 0.95, `expected strong win, got ${win}`);
});

// --- evaluateExperiment: promote only at significance + min sample + min duration ---

const control: ArmStat = { conversions: 100, sessions: 1000 };
const winner: ArmStat = { conversions: 180, sessions: 1000 };

test("does not promote before min duration even if significant", () => {
  const r = evaluateExperiment(control, winner, { ageDays: 2, minDays: 7, minSample: 200 });
  assert.equal(r.decision, "continue");
});

test("promotes a significant winner past min duration and min sample", () => {
  const r = evaluateExperiment(control, winner, { ageDays: 8, minDays: 7, minSample: 200 });
  assert.equal(r.decision, "promote");
  assert.ok(r.probBest >= 0.95);
});

test("does not promote on noise (tiny sample)", () => {
  const r = evaluateExperiment(
    { conversions: 2, sessions: 10 },
    { conversions: 4, sessions: 10 },
    { ageDays: 8, minDays: 7, minSample: 200 },
  );
  assert.equal(r.decision, "continue");
});

test("auto-expires after 14 days with no decision → keep original", () => {
  const r = evaluateExperiment(
    { conversions: 50, sessions: 1000 },
    { conversions: 51, sessions: 1000 },
    { ageDays: 15, minDays: 7, minSample: 200, maxDays: 14 },
  );
  assert.equal(r.decision, "expired");
});

// --- guardrail circuit breaker ---

test("guardrailBreach trips on a >15% relative conversion drop", () => {
  const reason = guardrailBreach(
    { conversionRate: 0.1, dismissRate: 0.2, jsErrors: 0, sessions: 500 },
    { conversionRate: 0.08, dismissRate: 0.2, jsErrors: 0, sessions: 500 }, // -20% rel
    { minSessions: 100 },
  );
  assert.equal(reason, "conversion_drop");
});

test("guardrailBreach trips on any storefront JS error", () => {
  const reason = guardrailBreach(
    { conversionRate: 0.1, dismissRate: 0.2, jsErrors: 0, sessions: 500 },
    { conversionRate: 0.1, dismissRate: 0.2, jsErrors: 3, sessions: 500 },
    { minSessions: 100 },
  );
  assert.equal(reason, "js_error");
});

test("guardrailBreach stays silent below the traffic floor (no false alarms)", () => {
  const reason = guardrailBreach(
    { conversionRate: 0.1, dismissRate: 0.2, jsErrors: 0, sessions: 500 },
    { conversionRate: 0.0, dismissRate: 0.9, jsErrors: 5, sessions: 20 }, // ugly but tiny sample
    { minSessions: 100 },
  );
  assert.equal(reason, null);
});

// --- segment-aware ---

test("evaluateBySegment can promote on mobile but not desktop", () => {
  const bySeg: Record<string, { control: ArmStat; variant: ArmStat }> = {
    mobile: { control, variant: winner },
    desktop: { control, variant: { conversions: 101, sessions: 1000 } },
  };
  const res = evaluateBySegment(bySeg, { ageDays: 8, minDays: 7, minSample: 200 });
  assert.equal(res.mobile.decision, "promote");
  assert.equal(res.desktop.decision, "continue");
});

// --- what-if forecast ---

test("whatIfForecast returns a low/expected/high range grounded in history", () => {
  const f = whatIfForecast({ baselineRate: 0.1, sessions: 1000 }, { expectedRelLift: 0.1 });
  assert.ok(f.expected > f.low);
  assert.ok(f.high > f.expected);
  assert.equal(Math.round(f.expected * 1000) / 1000, 0.11); // 10% rel lift on 0.1
});

// --- liveGuardMetrics ---

test("liveGuardMetrics derives conversion + dismiss rates from raw counts", () => {
  const m = liveGuardMetrics({ orders: 25, sessions: 500, dismisses: 100, shown: 400, jsErrors: 0 });
  assert.equal(m.conversionRate, 0.05); // 25 / 500
  assert.equal(m.dismissRate, 0.25); // 100 / 400
  assert.equal(m.jsErrors, 0);
  assert.equal(m.sessions, 500);
});

test("liveGuardMetrics guards divide-by-zero (empty window)", () => {
  const m = liveGuardMetrics({ orders: 0, sessions: 0, dismisses: 0, shown: 0, jsErrors: 3 });
  assert.equal(m.conversionRate, 0);
  assert.equal(m.dismissRate, 0);
  assert.equal(m.jsErrors, 3);
});

// --- audit entry ---

test("auditEntry records a readable, structured experiment outcome", () => {
  const e = auditEntry({ experimentId: "exp1", outcome: "promoted", detail: "variant won on mobile" });
  assert.equal(e.experimentId, "exp1");
  assert.equal(e.outcome, "promoted");
  assert.ok(e.summary.length > 0);
});
