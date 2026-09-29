// Value hardening from the Rust ↔ TS drift audit (MVP 1): money is capped so
// the TS engine (floats) and the Rust function (i64) can never read a stored
// amount differently (#6); texts are cut by whole code points and never carry a
// lone surrogate into the function payload (#10); shop-local days are right in
// zones whose clocks skip midnight (#8).

import assert from "node:assert/strict";
import { test } from "node:test";

import { CONFIG_LIMITS, sanitizeConfig } from "../../src/discounts/config.ts";
import { sanitizeString } from "../../src/discounts/config/sanitize-helpers.ts";
import { shopDayStart, shopLocalDates } from "../../src/discounts/function-payload.ts";
import { planCart } from "../../src/discounts/plan.ts";
import { cartOf, fixed, line, orderFixed, payloadOf } from "./engine-fixtures.ts";

test("money: every amount is capped at CONFIG_LIMITS.moneyMinorUnits with an issue", () => {
  assert.equal(CONFIG_LIMITS.moneyMinorUnits, 1e12);
  const { config, issues } = sanitizeConfig({
    modules: {
      codes: { rules: [fixed("F", { CZK: 5e15, EUR: 100 }, { minimum: { subtotal: { CZK: 1e20 } } })] },
      rewards: { freeShipping: { threshold: { CZK: 2e12 } }, gifts: [], countOtherDiscounts: false },
    },
  });
  const rule = config.modules.codes.rules[0];
  assert.deepEqual(rule.value, { kind: "fixed", amount: { CZK: 1e12, EUR: 100 } });
  assert.deepEqual(rule.minimum?.subtotal, { CZK: 1e12 });
  assert.deepEqual(config.modules.rewards.freeShipping?.threshold, { CZK: 1e12 });
  assert.deepEqual(
    issues.map((i) => [i.path, i.code]),
    [
      ["modules.codes.rules[0].value.amount", "clamped_money"],
      ["modules.codes.rules[0].minimum.subtotal", "clamped_money"],
      ["modules.rewards.freeShipping.threshold", "clamped_money"],
    ],
  );
});

test("money: the engine reads a hand-made amount over the cap as the cap (the Rust function does the same)", () => {
  const huge = { modules: { codes: { rules: [{ ...orderFixed("O", { CZK: 1 }), enabled: true, value: { kind: "fixed", amount: { CZK: 9e18 } } }] } } };
  const plan = planCart(cartOf([line("L1", 5e12)]), huge as never);
  assert.equal(plan.order?.amount, 1e12);
  assert.deepEqual(plan.order?.value, { fixedTotal: 1e12 });
  assert.equal(planCart(cartOf([line("L1", 100)]), payloadOf([orderFixed("O", { CZK: 50 })])).order?.amount, 50);
});

test("sanitizeString cuts by whole code points and drops lone surrogates", () => {
  const emoji = "😀"; // two UTF-16 units
  assert.equal(sanitizeString(`${"a".repeat(199)}${emoji}`, ""), "a".repeat(199), "a pair is never split at the cap");
  assert.equal(sanitizeString(`${"a".repeat(198)}${emoji}`, ""), `${"a".repeat(198)}${emoji}`);
  assert.equal(sanitizeString("a\ud83db\ude00c", ""), "abc", "lone high and low surrogates are dropped");
  assert.equal(sanitizeString(`x${emoji}y`, "", 3), `x${emoji}`);
  assert.equal(sanitizeString(5, "fallback"), "fallback");
  const name = sanitizeConfig({ modules: { codes: { rules: [fixed("F", { CZK: 1 }, { name: `${"é".repeat(199)}${emoji}` })] } } }).config.modules
    .codes.rules[0].name;
  assert.equal(name, "é".repeat(199));
  assert.ok(name.isWellFormed());
});

test("shopDayStart: the first instant of a shop day, also where the clocks skip midnight", () => {
  assert.equal(shopDayStart("2026-07-01", "Europe/Prague"), "2026-07-01T00:00:00+02:00");
  assert.equal(shopDayStart("2026-11-27", "America/New_York"), "2026-11-27T00:00:00-05:00");
  assert.equal(shopDayStart("2026-09-06", "America/Santiago"), "2026-09-06T01:00:00-03:00");
  assert.equal(shopDayStart("2026-03-08", "America/Havana"), "2026-03-08T01:00:00-04:00");
  assert.equal(shopDayStart("2026-09-05", "America/Santiago"), "2026-09-05T00:00:00-04:00");
  assert.throws(() => shopDayStart("2026-13-01", "Europe/Prague"), TypeError);
  assert.throws(() => shopDayStart("2026-07-01", "Not/AZone"), TypeError);
});

test("shopLocalDates: a schedule of whole days round-trips in DST-at-midnight zones (Santiago, Havana)", () => {
  for (const [tz, day, next] of [
    ["America/Santiago", "2026-09-06", "2026-09-07"],
    ["America/Havana", "2026-03-08", "2026-03-09"],
    ["Europe/Prague", "2026-03-29", "2026-03-30"],
  ] as const) {
    // A one-day rule: starts at the start of `day`, ends at the start of the next day (exclusive).
    assert.deepEqual(shopLocalDates({ startsAt: shopDayStart(day, tz), endsAt: shopDayStart(next, tz) }, tz), { startsOn: day, endsOn: day }, tz);
    // Ending at the start of `day` means the day before was the last one.
    const before = shopLocalDates({ endsAt: shopDayStart(day, tz) }, tz).endsOn;
    assert.ok(before !== undefined && before < day, `${tz}: ${before}`);
  }
  // An end one second after the start of the day keeps that day.
  assert.deepEqual(shopLocalDates({ endsAt: "2026-09-06T04:00:01Z" }, "America/Santiago"), { endsOn: "2026-09-06" });
  // A start is the local day of its instant: 23:00 before the skipped midnight is still the 5th.
  assert.deepEqual(shopLocalDates({ startsAt: "2026-09-06T03:00:00Z" }, "America/Santiago"), { startsOn: "2026-09-05" });
});
