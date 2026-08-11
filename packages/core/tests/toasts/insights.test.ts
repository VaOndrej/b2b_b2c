import assert from "node:assert/strict";
import { test } from "node:test";

import {
  TOAST_ATOMS,
  SUPPRESS_REASONS,
  scrubEvent,
  emptyRollupCounters,
  rollupEvents,
  mergeCounters,
  dateKeyUTC,
  type RawToastEvent,
} from "../../src/toasts/insights.ts";

// --- scrubEvent: shape validation + PII whitelist ---

test("scrubEvent keeps a valid event and clamps time dimensions", () => {
  const e = scrubEvent({
    atom: "shown",
    ruleId: "cart:added",
    dims: {
      type: "cart",
      device: "mobile",
      pageType: "product",
      customerState: "guest",
      hourOfDay: 30, // out of range → clamped
      dayOfWeek: -2, // out of range → clamped
      abVariant: 1.9, // → floored
    },
  });
  assert.ok(e);
  assert.equal(e!.atom, "shown");
  assert.equal(e!.dims.hourOfDay, 23);
  assert.equal(e!.dims.dayOfWeek, 0);
  assert.equal(e!.dims.abVariant, 1);
});

test("scrubEvent drops unknown/PII fields (whitelist only)", () => {
  const dirty = {
    atom: "click",
    clickTarget: "cta",
    ruleId: "announcement",
    dims: {
      type: "announcement",
      device: "desktop",
      // PII that must never reach analytics:
      email: "shopper@example.com",
      customerId: "gid://shopify/Customer/1",
      firstName: "Anna",
    },
  } as unknown as RawToastEvent;
  const e = scrubEvent(dirty);
  assert.ok(e);
  const dimKeys = Object.keys(e!.dims);
  assert.ok(!dimKeys.includes("email"));
  assert.ok(!dimKeys.includes("customerId"));
  assert.ok(!dimKeys.includes("firstName"));
  // and no PII leaked onto the event root either
  assert.ok(!("email" in (e as Record<string, unknown>)));
});

test("scrubEvent rejects an unknown atom", () => {
  assert.equal(scrubEvent({ atom: "explode", dims: { type: "cart" } } as never), null);
});

test("scrubEvent keeps suppressReason only for suppressed atoms", () => {
  const ok = scrubEvent({
    atom: "suppressed",
    dims: { type: "countdown" },
    suppressReason: "cooldown",
  });
  assert.equal(ok!.suppressReason, "cooldown");
  const bogus = scrubEvent({
    atom: "suppressed",
    dims: { type: "countdown" },
    suppressReason: "nope" as never,
  });
  // invalid reason dropped, but the suppressed event itself survives
  assert.ok(bogus);
  assert.equal(bogus!.suppressReason, undefined);
  const notSuppressed = scrubEvent({
    atom: "shown",
    dims: { type: "cart" },
    suppressReason: "cooldown",
  });
  assert.equal(notSuppressed!.suppressReason, undefined);
});

test("every declared suppress reason is a known constant", () => {
  for (const r of SUPPRESS_REASONS) {
    assert.equal(typeof r, "string");
  }
  assert.ok(SUPPRESS_REASONS.includes("cooldown"));
  assert.ok(TOAST_ATOMS.includes("suppressed"));
});

// --- rollupEvents: deterministic aggregation ---

const day = (date: string, over: Partial<RawToastEvent> & { dims?: object } = {}) =>
  ({
    date,
    atom: "shown",
    dims: { type: "cart", device: "desktop", pageType: "product", customerState: "guest" },
    ...over,
  }) as Parameters<typeof rollupEvents>[0][number];

test("rollupEvents tallies atoms into counters per (date,type,segment)", () => {
  const rows = rollupEvents([
    day("2026-08-10", { atom: "shown" }),
    day("2026-08-10", { atom: "visible" }),
    day("2026-08-10", { atom: "read_through" }),
    day("2026-08-10", { atom: "click", clickTarget: "cta" }),
    day("2026-08-10", { atom: "click", clickTarget: "body" }),
    day("2026-08-10", { atom: "dismiss" }),
    day("2026-08-10", { atom: "auto_fade" }),
    day("2026-08-10", { atom: "suppressed", suppressReason: "cap" }),
  ]);
  assert.equal(rows.length, 1);
  const c = rows[0].counters;
  assert.equal(c.shown, 1);
  assert.equal(c.visible, 1);
  assert.equal(c.readThrough, 1);
  assert.equal(c.clicks, 2);
  assert.equal(c.ctaClicks, 1);
  assert.equal(c.bodyClicks, 1);
  assert.equal(c.dismiss, 1);
  assert.equal(c.autoFade, 1);
  assert.equal(c.suppressed, 1);
  assert.equal(c.suppressedByReason.cap, 1);
});

test("rollupEvents splits rows by date and by segment dimensions", () => {
  const rows = rollupEvents([
    day("2026-08-10", { dims: { type: "cart", device: "desktop", pageType: "product", customerState: "guest" } }),
    day("2026-08-11", { dims: { type: "cart", device: "desktop", pageType: "product", customerState: "guest" } }),
    day("2026-08-10", { dims: { type: "cart", device: "mobile", pageType: "product", customerState: "guest" } }),
  ]);
  assert.equal(rows.length, 3);
});

test("rollupEvents accumulates dwell time for the average", () => {
  const rows = rollupEvents([
    day("2026-08-10", { atom: "auto_fade", dwellMs: 4000 }),
    day("2026-08-10", { atom: "dismiss", dwellMs: 1000 }),
  ]);
  assert.equal(rows[0].counters.dwellMsTotal, 5000);
  assert.equal(rows[0].counters.dwellCount, 2);
});

test("rollupEvents counts session and js_error atoms into their own counters", () => {
  const rows = rollupEvents([
    day("2026-08-10", { atom: "session" }),
    day("2026-08-10", { atom: "session" }),
    day("2026-08-10", { atom: "js_error" }),
  ]);
  assert.equal(rows[0].counters.sessions, 2);
  assert.equal(rows[0].counters.jsErrors, 1);
});

test("scrubEvent accepts session and js_error atoms", () => {
  assert.ok(scrubEvent({ atom: "session", dims: { type: "app" } }));
  assert.ok(scrubEvent({ atom: "js_error", dims: { type: "app" } }));
});

test("rollupEvents is deterministic: stable order regardless of input order", () => {
  const a = rollupEvents([
    day("2026-08-11", { dims: { type: "b", device: "mobile", pageType: "cart", customerState: "guest" } }),
    day("2026-08-10", { dims: { type: "a", device: "desktop", pageType: "product", customerState: "guest" } }),
  ]);
  const b = rollupEvents([
    day("2026-08-10", { dims: { type: "a", device: "desktop", pageType: "product", customerState: "guest" } }),
    day("2026-08-11", { dims: { type: "b", device: "mobile", pageType: "cart", customerState: "guest" } }),
  ]);
  assert.deepEqual(a, b);
});

test("emptyRollupCounters is all zeros", () => {
  const c = emptyRollupCounters();
  assert.equal(c.shown, 0);
  assert.equal(c.clicks, 0);
  assert.deepEqual(c.suppressedByReason, {});
});

// --- mergeCounters: incremental rollup upsert ---

test("mergeCounters sums two counter blobs including nested reasons", () => {
  const a = { ...emptyRollupCounters(), shown: 3, clicks: 1, suppressedByReason: { cap: 2 } };
  const b = { ...emptyRollupCounters(), shown: 2, dismiss: 1, suppressedByReason: { cap: 1, quiet: 4 } };
  const m = mergeCounters(a, b);
  assert.equal(m.shown, 5);
  assert.equal(m.clicks, 1);
  assert.equal(m.dismiss, 1);
  assert.deepEqual(m.suppressedByReason, { cap: 3, quiet: 4 });
});

test("mergeCounters tolerates a malformed/partial existing blob", () => {
  const m = mergeCounters({ shown: 2 } as never, { ...emptyRollupCounters(), shown: 1 });
  assert.equal(m.shown, 3);
  assert.equal(m.clicks, 0);
  assert.deepEqual(m.suppressedByReason, {});
});

// --- dateKeyUTC ---

test("dateKeyUTC produces a stable YYYY-MM-DD in UTC", () => {
  assert.equal(dateKeyUTC(Date.UTC(2026, 7, 10, 23, 59)), "2026-08-10");
  assert.equal(dateKeyUTC(new Date(Date.UTC(2026, 0, 3, 0, 0))), "2026-01-03");
});
