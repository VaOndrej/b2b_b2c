import assert from "node:assert/strict";
import { test } from "node:test";

import {
  countdownRemainingMs,
  formatCountdown,
  isExpired,
  isLowStock,
} from "../../src/toasts/page-view.ts";

test("countdown: fixed endsAt counts down and clamps at zero", () => {
  const now = 1_000_000;
  assert.equal(countdownRemainingMs(now, { endsAt: now + 5000 }), 5000);
  assert.equal(countdownRemainingMs(now, { endsAt: now - 5000 }), 0); // past → 0
});

test("countdown: evergreen counts down from a per-session start", () => {
  const started = 1_000_000;
  const now = started + 2000;
  assert.equal(
    countdownRemainingMs(now, { evergreenMs: 10_000, startedAt: started }),
    8000,
  );
  // after the window → 0
  assert.equal(
    countdownRemainingMs(started + 999_999, { evergreenMs: 10_000, startedAt: started }),
    0,
  );
});

test("formatCountdown splits ms into d/h/m/s", () => {
  const f = formatCountdown((((1 * 24 + 2) * 60 + 3) * 60 + 4) * 1000);
  assert.deepEqual(f, { days: 1, hours: 2, minutes: 3, seconds: 4 });
  assert.deepEqual(formatCountdown(-500), {
    days: 0,
    hours: 0,
    minutes: 0,
    seconds: 0,
  });
});

test("isExpired is true only at/after zero", () => {
  assert.equal(isExpired(0), true);
  assert.equal(isExpired(-1), true);
  assert.equal(isExpired(1), false);
});

test("isLowStock: only when 0 < inventory < threshold", () => {
  assert.equal(isLowStock(3, 5), true);
  assert.equal(isLowStock(5, 5), false); // not below threshold
  assert.equal(isLowStock(0, 5), false); // out of stock, don't shout
  assert.equal(isLowStock(9, 5), false); // plenty
  assert.equal(isLowStock(3, 0), false); // threshold disabled
  assert.equal(isLowStock(null as unknown as number, 5), false);
});
