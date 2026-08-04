import assert from "node:assert/strict";
import { test } from "node:test";

import {
  aggregateEvents,
  computeMetrics,
  emptyCounters,
  summarizeByRule,
} from "../../src/toasts/analytics.ts";

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
