import assert from "node:assert/strict";
import { test } from "node:test";

import {
  currenciesWithoutValue,
  describeRule,
  describeRuleParts,
  describeSchedule,
  formatAmounts,
  ruleScheduleState,
  type DescribableRule,
} from "../../src/discounts/describe.ts";

// §17a / DATA-4: the admin's state lines and the engine's messages come from ONE
// formatter. The admin view shows every market currency at once and names the
// currencies a rule is not offered in (MKT-1); the engine's single-currency
// wording is unchanged (tests/discounts/explain.test.ts pins it).

const NBSP = " ";

const rule = (partial: Partial<DescribableRule>): DescribableRule => ({
  method: "automatic",
  value: { kind: "percentage", percent: 10 },
  target: { kind: "order" },
  ...partial,
});

test("admin view: every market currency in one line, missing ones named", () => {
  const fixed = rule({ value: { kind: "fixed", amount: { CZK: 100_00, EUR: 4_00 } } });
  assert.equal(describeRule(fixed, "cs", undefined, { currencies: ["CZK", "EUR"] }), `100${NBSP}Kč / 4${NBSP}€ z objednávky · automaticky`);
  assert.equal(describeRule(fixed, "en", undefined, { currencies: ["CZK", "EUR"] }), "CZK 100 / €4 off the order · automatic");

  const czkOnly = rule({
    method: "code",
    codes: ["VIP10"],
    minimum: { subtotal: { CZK: 1000_00 }, quantity: 3 },
  });
  assert.equal(
    describeRule(czkOnly, "cs", undefined, { currencies: ["CZK", "EUR"] }),
    `10${NBSP}% z objednávky · kód VIP10 · od 1${NBSP}000${NBSP}Kč · od 3 ks · v EUR se nenabízí`,
  );
  assert.equal(
    describeRule(czkOnly, "en", undefined, { currencies: ["CZK", "EUR", "HUF"] }),
    "10% off the order · code VIP10 · orders from CZK 1,000 · from 3 items · not offered in EUR and HUF",
  );

  const empty = rule({ value: { kind: "fixed", amount: {} } });
  assert.equal(describeRule(empty, "cs", undefined, { currencies: ["CZK"] }), "Pevná sleva zatím bez hodnoty · automaticky · v CZK se nenabízí");
  assert.equal(describeRule(empty, "en", undefined, { currencies: [] }), "Fixed amount, no value yet · automatic");
});

test("admin view: a code rule without any code says so; the engine keeps 'kódem' (it only knows hashes)", () => {
  const noCode = rule({ method: "code", codes: [] });
  assert.equal(describeRule(noCode, "cs", "CZK"), `10${NBSP}% z objednávky · kódem`);
  assert.equal(describeRule(noCode, "cs", undefined, { currencies: ["CZK"], codesKnown: true }), `10${NBSP}% z objednávky · kódem, zatím bez kódu`);
  assert.equal(describeRule(noCode, "en", undefined, { currencies: ["CZK"], codesKnown: true }), "10% off the order · by code, no code yet");
});

test("the single-currency engine wording is unchanged by the admin options", () => {
  const r = rule({ value: { kind: "fixed", amount: { CZK: 200_00 } }, minimum: { quantity: 3 } });
  assert.equal(describeRule(r, "cs", "CZK"), `200${NBSP}Kč z objednávky · automaticky · od 3 ks`);
  assert.equal(describeRule(r, "cs", "EUR"), "Pevná sleva (pro EUR bez hodnoty) · automaticky · od 3 ks");
  // An explicit currency wins over the admin list.
  assert.equal(describeRule(r, "cs", "CZK", { currencies: ["CZK", "EUR"] }), `200${NBSP}Kč z objednávky · automaticky · od 3 ks`);
});

test("describeRuleParts: the same pieces the line is made of", () => {
  const parts = describeRuleParts(
    rule({ method: "code", codes: ["A", "B", "C", "D"], minimum: { subtotal: { CZK: 500_00, EUR: 20_00 } } }),
    "cs",
    { currencies: ["CZK", "EUR"], codesKnown: true },
  );
  assert.deepEqual(parts, {
    value: `10${NBSP}% z objednávky`,
    method: "kódy A, B, C a 1 další",
    minimum: [`od 500${NBSP}Kč / 20${NBSP}€`],
    notOffered: null,
  });
});

test("formatAmounts and currenciesWithoutValue (MKT-1: never a converted number)", () => {
  assert.equal(formatAmounts({ EUR: 4_00, CZK: 100_00, HUF: 1000_00 }, ["CZK", "EUR"], "cs"), `100${NBSP}Kč / 4${NBSP}€`, "a currency no market uses is not offered");
  assert.equal(formatAmounts({ HUF: 1000_00 }, ["CZK", "HUF"], "cs"), `1${NBSP}000${NBSP}HUF`);
  assert.equal(formatAmounts({}, ["CZK"], "cs"), "");
  assert.deepEqual(currenciesWithoutValue(rule({}), ["CZK", "EUR"]), []);
  assert.deepEqual(currenciesWithoutValue(rule({ value: { kind: "fixed", amount: { CZK: 1 } } }), ["CZK", "EUR"]), ["EUR"]);
  assert.deepEqual(currenciesWithoutValue(rule({ minimum: { subtotal: { EUR: 1 } } }), ["CZK", "EUR"]), ["CZK"]);
  assert.deepEqual(currenciesWithoutValue(rule({ minimum: { subtotal: {} } }), ["CZK", "EUR"]), [], "an empty minimum is no minimum");
});

test("ruleScheduleState: the engine's day gate (start and end days inclusive)", () => {
  const days = { startsOn: "2026-11-27", endsOn: "2026-11-30" };
  assert.equal(ruleScheduleState(null, "2026-09-28"), "always");
  assert.equal(ruleScheduleState({}, "2026-09-28"), "always");
  assert.equal(ruleScheduleState(days, "2026-09-28"), "not_started");
  assert.equal(ruleScheduleState(days, "2026-11-27"), "live");
  assert.equal(ruleScheduleState(days, "2026-11-30"), "live");
  assert.equal(ruleScheduleState(days, "2026-12-01"), "ended");
  assert.equal(ruleScheduleState({ endsOn: "2026-01-01" }, "2026-09-28"), "ended");
  assert.equal(ruleScheduleState(days, null), "unknown");
});

test("describeSchedule: shop-local days in words", () => {
  assert.equal(describeSchedule({ startsOn: "2026-11-27", endsOn: "2026-11-30" }, "cs"), "27. 11. 2026 až 30. 11. 2026");
  assert.equal(describeSchedule({ startsOn: "2026-11-27" }, "en"), "from 27 Nov 2026");
  assert.equal(describeSchedule({ endsOn: "2026-11-30" }, "cs"), "do 30. 11. 2026");
  assert.equal(describeSchedule({}, "cs"), "");
});
