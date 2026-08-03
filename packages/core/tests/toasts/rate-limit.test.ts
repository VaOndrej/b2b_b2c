import assert from "node:assert/strict";
import { test } from "node:test";

import {
  isDuplicate,
  pruneTimestamps,
  withinRateLimit,
} from "../../src/toasts/rate-limit.ts";

test("withinRateLimit allows under the per-minute cap and blocks at it", () => {
  const now = 100_000;
  const recent = [now - 1000, now - 2000, now - 3000];
  assert.equal(withinRateLimit(recent, now, 5), true);
  assert.equal(withinRateLimit(recent, now, 3), false);
});

test("timestamps older than 60s do not count", () => {
  const now = 100_000;
  const recent = [now - 70_000, now - 65_000, now - 1000];
  assert.equal(withinRateLimit(recent, now, 2), true); // only 1 in window
});

test("perMin <= 0 disables the limit", () => {
  assert.equal(withinRateLimit([1, 2, 3, 4, 5], 10, 0), true);
});

test("pruneTimestamps drops anything older than 60s", () => {
  const now = 100_000;
  assert.deepEqual(pruneTimestamps([now - 61_000, now - 100, now], now), [
    now - 100,
    now,
  ]);
});

test("isDuplicate honours the dedupe window", () => {
  const seen = { "product:1": 100_000 };
  assert.equal(isDuplicate(seen, "product:1", 100_500, 1000), true);
  assert.equal(isDuplicate(seen, "product:1", 101_500, 1000), false);
  assert.equal(isDuplicate(seen, "product:2", 100_500, 1000), false);
  assert.equal(isDuplicate(seen, "product:1", 100_500, 0), false);
});
