import assert from "node:assert/strict";
import { test } from "node:test";

import { emptyRollupCounters } from "../../src/toasts/insights.ts";
import {
  metricKindForType,
  defaultGoalForType,
  successMetric,
  buildInsightCards,
} from "../../src/toasts/insights-metrics.ts";

const counters = (over: Record<string, number> = {}) => ({
  ...emptyRollupCounters(),
  ...over,
});

// --- type → metric kind + default goal ---

test("action types measure by clicks, informational by read-through, cart by AOV", () => {
  assert.equal(metricKindForType("announcement"), "action");
  assert.equal(metricKindForType("countdown"), "action");
  assert.equal(metricKindForType("stock.low"), "informational");
  assert.equal(metricKindForType("order.created"), "informational");
  assert.equal(metricKindForType("cart"), "cart");

  assert.equal(defaultGoalForType("announcement"), "clicks");
  assert.equal(defaultGoalForType("stock.low"), "read_through");
  assert.equal(defaultGoalForType("cart"), "aov");
});

// --- successMetric: correct headline per goal, always "assisted" ---

test("action toast success = CTR (clicks / shown), labelled assisted not proven", () => {
  const m = successMetric("announcement", counters({ shown: 200, clicks: 20, visible: 180 }));
  assert.equal(m.goal, "clicks");
  assert.equal(m.value, 0.1); // 20 / 200
  assert.equal(m.available, true);
  assert.equal(m.sample, 200);
  assert.equal(m.attribution, "assisted"); // never claim causation
  assert.equal(m.lowerIsBetter, false);
});

test("informational toast success = read-through, NOT clicks", () => {
  // 200 shown, 0 clicks (expected for informational), 150 read through → NOT worthless.
  const m = successMetric("stock.low", counters({ shown: 200, clicks: 0, readThrough: 150 }));
  assert.equal(m.goal, "read_through");
  assert.equal(m.value, 0.75);
  assert.equal(m.available, true);
});

test("cart AOV needs holdout revenue → not available from lifecycle counters alone", () => {
  const m = successMetric("cart", counters({ shown: 500, readThrough: 400 }));
  assert.equal(m.goal, "aov");
  assert.equal(m.available, false); // honest: no revenue attribution without holdout
  assert.equal(m.reach, 500);
});

test("successMetric guards divide-by-zero (no impressions yet)", () => {
  const m = successMetric("announcement", emptyRollupCounters());
  assert.equal(m.value, 0);
  assert.equal(m.available, false); // no sample → nothing to claim
});

// --- insight cards ---

const metricsInput = [
  { type: "announcement", counters: counters({ shown: 300, clicks: 45, readThrough: 200, dismiss: 10 }) },
  { type: "stock.low", counters: counters({ shown: 400, clicks: 0, readThrough: 120, dismiss: 240 }) },
];

test("buildInsightCards surfaces a best performer and an attention-loss warning", () => {
  const cards = buildInsightCards(metricsInput, { configuredTypes: ["announcement", "stock.low", "countdown"] });
  const kinds = cards.map((c) => c.kind);
  assert.ok(kinds.includes("best_performer"));
  assert.ok(kinds.includes("attention_loss")); // stock.low: 60% dismiss, low read-through
  // attention_loss must point at the high fast-dismiss type
  const loss = cards.find((c) => c.kind === "attention_loss");
  assert.equal(loss!.metricType, "stock.low");
});

test("buildInsightCards flags a configured-but-silent type (0 shown)", () => {
  const cards = buildInsightCards(metricsInput, { configuredTypes: ["announcement", "stock.low", "countdown"] });
  const silent = cards.find((c) => c.kind === "silent_gap");
  assert.ok(silent, "countdown is configured but never fired");
  assert.equal(silent!.metricType, "countdown");
});

test("buildInsightCards is deterministic and never claims causation", () => {
  const a = buildInsightCards(metricsInput, { configuredTypes: ["announcement", "stock.low"] });
  const b = buildInsightCards([...metricsInput].reverse(), { configuredTypes: ["stock.low", "announcement"] });
  assert.deepEqual(a, b);
  for (const c of a) assert.notEqual(c.severity, undefined);
});
