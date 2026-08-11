import assert from "node:assert/strict";
import { test } from "node:test";

import { monthlyRoi } from "../../src/toasts/roi.ts";

test("proven incremental revenue = exposed per-session minus holdout per-session, extrapolated", () => {
  const r = monthlyRoi(
    {
      exposedSessions: 1000,
      exposedRevenue: 1_000_000, // avg 1000 minor units / session
      holdoutSessions: 100,
      holdoutRevenue: 90_000, // avg 900 / session
    },
    { minSessions: 50 },
  );
  assert.equal(r.available, true);
  assert.equal(r.attribution, "holdout-proven");
  assert.equal(r.perSessionLift, 100); // 1000 - 900
  assert.equal(r.provenRevenue, 100_000); // 100 * 1000 exposed sessions
});

test("insufficient holdout sample → not available, claims nothing", () => {
  const r = monthlyRoi(
    { exposedSessions: 1000, exposedRevenue: 1_000_000, holdoutSessions: 5, holdoutRevenue: 4000 },
    { minSessions: 50 },
  );
  assert.equal(r.available, false);
  assert.equal(r.attribution, "insufficient");
  assert.equal(r.provenRevenue, 0);
});

test("zero holdout (holdout disabled) → cannot prove, not available", () => {
  const r = monthlyRoi({
    exposedSessions: 5000,
    exposedRevenue: 5_000_000,
    holdoutSessions: 0,
    holdoutRevenue: 0,
  });
  assert.equal(r.available, false);
  assert.equal(r.attribution, "insufficient");
});

test("negative lift is reported honestly, not floored to zero", () => {
  const r = monthlyRoi(
    { exposedSessions: 500, exposedRevenue: 400_000, holdoutSessions: 500, holdoutRevenue: 450_000 },
    { minSessions: 50 },
  );
  assert.equal(r.available, true);
  assert.equal(r.perSessionLift, -100);
  assert.equal(r.provenRevenue, -50_000);
});
