import assert from "node:assert/strict";
import { test } from "node:test";

import {
  aggregateEvents,
  computeMetrics,
  emptyCounters,
  impressionsByTypeKey,
  summarizeByRule,
} from "../../src/toasts/analytics.ts";
import type { RuleCounters } from "../../src/toasts/analytics.ts";

test("emptyCounters is all zeros", () => {
  assert.deepEqual(emptyCounters(), {
    impressions: 0,
    clicks: 0,
    dismisses: 0,
    undos: 0,
  });
});

test("aggregateEvents tallies lifecycle events per rule; junk ignored", () => {
  const counters = aggregateEvents([
    { ruleId: "a", type: "impression" },
    { ruleId: "a", type: "impression" },
    { ruleId: "a", type: "click" },
    { ruleId: "a", type: "dismiss" },
    { ruleId: "b", type: "impression" },
    { ruleId: "b", type: "undo" },
    { ruleId: "a", type: "bogus" as unknown as "click" },
    { ruleId: "", type: "impression" }, // no rule id → ignored
  ]);
  assert.deepEqual(counters.a, { impressions: 2, clicks: 1, dismisses: 1, undos: 0 });
  assert.deepEqual(counters.b, { impressions: 1, clicks: 0, dismisses: 0, undos: 1 });
});

test("computeMetrics derives CTR/dismiss/undo rates and guards divide-by-zero", () => {
  const m = computeMetrics({ impressions: 4, clicks: 1, dismisses: 2, undos: 0 });
  assert.equal(m.ctr, 0.25);
  assert.equal(m.dismissRate, 0.5);
  assert.equal(m.undoRate, 0);
  const zero = computeMetrics(emptyCounters());
  assert.equal(zero.ctr, 0);
  assert.equal(zero.dismissRate, 0);
});

test("summarizeByRule returns metrics per rule id", () => {
  const summary = summarizeByRule([
    { ruleId: "x", type: "impression" },
    { ruleId: "x", type: "click" },
  ]);
  assert.equal(summary.x.impressions, 1);
  assert.equal(summary.x.ctr, 1);
});

test("impressionsByTypeKey folds cart deltas and milestones into the cart toast", () => {
  const folded = impressionsByTypeKey({
    "cart:added": { impressions: 100, clicks: 3, dismisses: 1, undos: 0 },
    "cart:removed": { impressions: 40, clicks: 0, dismisses: 0, undos: 5 },
    "milestone:free_shipping": { impressions: 12, clicks: 2, dismisses: 0, undos: 0 },
    announcement: { impressions: 7, clicks: 1, dismisses: 0, undos: 0 },
    "stock.low": { impressions: 0, clicks: 0, dismisses: 0, undos: 0 },
  });
  assert.equal(folded.cart, 152);
  assert.equal(folded.announcement, 7);
  // Zero impressions must not create a key — the admin distinguishes "no data
  // yet" from "shown 0 times", and inventing a 0 row would blur that.
  assert.equal("stock.low" in folded, false);
});

test("impressionsByTypeKey tolerates empty and malformed input", () => {
  assert.deepEqual(impressionsByTypeKey({}), {});
  assert.deepEqual(
    impressionsByTypeKey(undefined as unknown as Record<string, RuleCounters>),
    {},
  );
});
