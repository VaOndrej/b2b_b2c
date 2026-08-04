import assert from "node:assert/strict";
import { test } from "node:test";

import {
  countWithinWindow,
  formatAggregateCount,
} from "../../src/toasts/aggregates.ts";

test("countWithinWindow counts only real events inside the window", () => {
  const now = 1_000_000;
  const hour = 3_600_000;
  const events = [
    now - 30 * 60_000, // 30 min ago — in
    now - 2 * hour, // 2h ago — out (window 1h)
    now - 59 * 60_000, // 59 min ago — in
    now + 10_000, // future — out
  ];
  assert.equal(countWithinWindow(events, now, hour), 2);
});

test("countWithinWindow never invents data: empty in, zero out", () => {
  assert.equal(countWithinWindow([], 1000, 1000), 0);
  assert.equal(countWithinWindow(null as unknown as number[], 1000, 1000), 0);
});

test("countWithinWindow with a non-positive window counts nothing", () => {
  assert.equal(countWithinWindow([1, 2, 3], 5, 0), 0);
});

test("formatAggregateCount is honest: 0 → empty (never '0 people')", () => {
  assert.equal(formatAggregateCount("{count} people added this", 0), "");
  assert.equal(
    formatAggregateCount("{count} people added this", 4),
    "4 people added this",
  );
});
