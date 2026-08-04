import assert from "node:assert/strict";
import { test } from "node:test";

import {
  isScheduledNow,
  sanitizeSchedule,
} from "../../src/toasts/scheduling.ts";

// A fixed reference instant: 2026-08-04T12:30:00Z is a Tuesday.
// In Europe/Prague (UTC+2 in summer) that is 14:30 local, still Tuesday.
const TUE_1230Z = Date.parse("2026-08-04T12:30:00.000Z");

test("no schedule (or empty) → always active", () => {
  assert.equal(isScheduledNow(undefined, TUE_1230Z, "Europe/Prague"), true);
  assert.equal(isScheduledNow({}, TUE_1230Z, "Europe/Prague"), true);
});

test("startsAt / endsAt window is respected", () => {
  assert.equal(
    isScheduledNow({ startsAt: "2026-08-05T00:00:00Z" }, TUE_1230Z, "UTC"),
    false, // window not open yet
  );
  assert.equal(
    isScheduledNow({ endsAt: "2026-08-04T00:00:00Z" }, TUE_1230Z, "UTC"),
    false, // window already closed
  );
  assert.equal(
    isScheduledNow(
      { startsAt: "2026-08-01T00:00:00Z", endsAt: "2026-08-31T00:00:00Z" },
      TUE_1230Z,
      "UTC",
    ),
    true,
  );
});

test("daysOfWeek gates by the shop-local weekday (0=Sun..6=Sat)", () => {
  // Tuesday = 2
  assert.equal(isScheduledNow({ daysOfWeek: [2] }, TUE_1230Z, "UTC"), true);
  assert.equal(isScheduledNow({ daysOfWeek: [1, 3] }, TUE_1230Z, "UTC"), false);
});

test("hours window uses shop-local hour; Prague is 2h ahead of UTC in summer", () => {
  // 12:30 UTC → 14:30 in Prague. A 13–18 window includes it in Prague...
  assert.equal(isScheduledNow({ hours: [13, 18] }, TUE_1230Z, "Europe/Prague"), true);
  // ...but the same window in UTC (12:30) also includes 12? no: 13 > 12.5 → excluded
  assert.equal(isScheduledNow({ hours: [13, 18] }, TUE_1230Z, "UTC"), false);
});

test("overnight hours window (from > to) wraps past midnight", () => {
  // 22–6 overnight; 14:30 Prague is outside
  assert.equal(isScheduledNow({ hours: [22, 6] }, TUE_1230Z, "Europe/Prague"), false);
  // 6–22 daytime; 14:30 inside
  assert.equal(isScheduledNow({ hours: [6, 22] }, TUE_1230Z, "Europe/Prague"), true);
});

test("sanitizeSchedule drops junk and clamps hours/days", () => {
  const s = sanitizeSchedule({
    startsAt: "2026-01-01T00:00:00Z",
    endsAt: "not-a-date",
    daysOfWeek: [0, 3, 9, "x", 6],
    hours: [25, -3],
  });
  assert.equal(s?.startsAt, "2026-01-01T00:00:00Z");
  assert.equal(s?.endsAt, undefined);
  assert.deepEqual(s?.daysOfWeek, [0, 3, 6]); // 9 and "x" dropped
  assert.deepEqual(s?.hours, [23, 0]); // clamped into 0..23
  assert.equal(sanitizeSchedule(null), undefined);
  assert.equal(sanitizeSchedule({}), undefined);
});
