import assert from "node:assert/strict";
import { test } from "node:test";

import {
  DISCOUNT_METHODS,
  DISCOUNT_TARGET_KINDS,
  DISCOUNT_VALUE_KINDS,
  type DiscountRule,
} from "@won/core/discounts/config";

import {
  collectWarnings,
  describeLimits,
  describeMethod,
  describeMinimum,
  describeMoreOptions,
  describeProSettings,
  describeRuleLine,
  describeSchedule,
  describeValue,
  missingCurrencies,
} from "../../app/components/model/describe.ts";
import { formatMoney, minorToInput, parseMoneyInput } from "../../app/components/model/money.ts";
import { translator, type Locale } from "../../app/i18n/index.ts";

// Doctrine §17 / §4c: every state-at-rest line the admin shows comes from one
// formatter module and never contains a raw enum key, an i18n key, a leftover
// `{placeholder}` or "undefined". The Czech admin must not leak any English
// enum word at all.

const NBSP = "\u00a0";
const cs = translator("cs");
const en = translator("en");
const CURRENCIES = ["CZK", "EUR"];

const ENUM_KEYS: string[] = [...DISCOUNT_METHODS, ...DISCOUNT_VALUE_KINDS, ...DISCOUNT_TARGET_KINDS];

function rule(partial: Partial<DiscountRule>): DiscountRule {
  return {
    id: "r1",
    enabled: true,
    name: "Test",
    method: "automatic",
    value: { kind: "percentage", percent: 10 },
    target: { kind: "order" },
    ...partial,
  };
}

function* everyRule(): Generator<DiscountRule> {
  const values: DiscountRule["value"][] = [
    { kind: "percentage", percent: 12.5 },
    { kind: "fixed", amount: { CZK: 10000, EUR: 400 } },
    { kind: "fixed", amount: { CZK: 10000 } },
    { kind: "fixed", amount: {} },
    { kind: "freeShipping" },
  ];
  const targets: DiscountRule["target"][] = [
    { kind: "order" },
    { kind: "products", productIds: ["gid://shopify/Product/1"], variantIds: [] },
    { kind: "collections", ids: [] },
    { kind: "shipping" },
  ];
  for (const value of values) {
    for (const target of targets) {
      for (const method of DISCOUNT_METHODS) {
        for (const codes of [undefined, [], ["VIP10"], ["A", "B", "C", "D", "E"]]) {
          yield rule({
            value,
            target,
            method,
            codes,
            minimum: { subtotal: { CZK: 100000 }, quantity: 3 },
            schedule: { startsAt: "2026-11-01T00:00:00+01:00", endsAt: "2026-12-01T00:00:00+01:00" },
            limits: { usageLimit: 100, oncePerCustomer: true },
            targeting: { markets: ["sk"] },
            combinesWith: { ruleIds: ["r2"] },
          });
        }
      }
    }
  }
}

function assertHuman(text: string, locale: Locale, where: string) {
  assert.doesNotMatch(text, /\{\w+\}/, `${where}: leftover placeholder in "${text}"`);
  assert.doesNotMatch(text, /undefined|NaN|null|\[object/, `${where}: machine value in "${text}"`);
  assert.doesNotMatch(text, /\b[a-z]+\.[a-z]+[A-Za-z.]*\b/, `${where}: looks like an i18n key: "${text}"`);
  assert.doesNotMatch(text, /\b[a-z]+[A-Z][A-Za-z]*\b/, `${where}: camelCase enum in "${text}"`);
  if (locale === "cs") {
    for (const key of ENUM_KEYS) {
      assert.doesNotMatch(text, new RegExp(`\\b${key}\\b`, "i"), `${where}: raw enum "${key}" in "${text}"`);
    }
  } else {
    for (const key of ["freeShipping", "percentage", "fixed"]) {
      assert.doesNotMatch(text, new RegExp(`\\b${key}\\b`), `${where}: raw enum "${key}" in "${text}"`);
    }
  }
}

test("describe* state lines never contain raw enum keys, i18n keys or placeholders (cs + en)", () => {
  let count = 0;
  for (const r of everyRule()) {
    for (const tr of [cs, en]) {
      const names = new Map([["r2", "Druhá sleva"]]);
      const lines = [
        describeRuleLine(r, tr, CURRENCIES),
        describeValue(r, tr, CURRENCIES),
        describeMethod(r, tr),
        describeMinimum(r, tr, CURRENCIES),
        describeSchedule(r, tr),
        describeLimits(r, tr),
        describeMoreOptions(r, tr, CURRENCIES),
        describeProSettings(r, tr, names),
      ];
      for (const line of lines) assertHuman(line, tr.locale, `${r.value.kind}/${r.target.kind}/${r.method}`);
      count++;
    }
  }
  assert.ok(count > 300, `exercised ${count} combinations`);
});

test("the rule line reads value · method · minimum · schedule, per currency", () => {
  assert.equal(describeRuleLine(rule({}), cs, ["CZK"]), `10${NBSP}% z objednávky · automaticky`);
  assert.equal(describeRuleLine(rule({}), en, ["CZK"]), "10% off the order · automatic");
  assert.equal(
    describeRuleLine(rule({ value: { kind: "fixed", amount: { CZK: 10000, EUR: 400 } } }), cs, CURRENCIES),
    `100${NBSP}Kč / 4${NBSP}€ z objednávky · automaticky`,
  );
  assert.equal(
    describeRuleLine(
      rule({ method: "code", codes: ["VIP10"], minimum: { subtotal: { CZK: 100000 } } }),
      cs,
      CURRENCIES,
    ),
    `10${NBSP}% z objednávky · kód VIP10 · od 1${NBSP}000${NBSP}Kč · v EUR se nenabízí`,
  );
  assert.equal(
    describeRuleLine(rule({ value: { kind: "freeShipping" }, target: { kind: "shipping" } }), en, CURRENCIES),
    "Free shipping · automatic",
  );
  assert.equal(
    describeRuleLine(rule({ method: "code", codes: ["A", "B", "C", "D", "E"] }), cs, []),
    `10${NBSP}% z objednávky · kódy A, B, C a 2 další`,
  );
  assert.equal(
    describeSchedule(rule({ schedule: { startsAt: "2026-11-01T00:00:00+01:00", endsAt: "2026-12-01T00:00:00+01:00" } }), cs),
    "1. 11. 2026 až 30. 11. 2026",
  );
});

test("missingCurrencies: a fixed value or a minimum without a currency is 'not offered' there", () => {
  assert.deepEqual(missingCurrencies(rule({}), CURRENCIES), []);
  assert.deepEqual(missingCurrencies(rule({ value: { kind: "fixed", amount: { CZK: 100 } } }), CURRENCIES), ["EUR"]);
  assert.deepEqual(missingCurrencies(rule({ minimum: { subtotal: { EUR: 100 } } }), CURRENCIES), ["CZK"]);
  // An empty minimum map means "no minimum", not "not offered anywhere".
  assert.deepEqual(missingCurrencies(rule({ minimum: { subtotal: {} } }), CURRENCIES), []);
});

test("collectWarnings: missing currency, a code rule without a code, a product rule with nothing selected", () => {
  const warnings = collectWarnings(
    [
      rule({ id: "a", name: "Fixní", value: { kind: "fixed", amount: { CZK: 100 } } }),
      rule({ id: "b", name: "Kódová", method: "code", codes: [] }),
      rule({ id: "c", name: "Produkty", target: { kind: "products", productIds: [], variantIds: [] } }),
      rule({ id: "d", name: "Vypnutá", enabled: false, value: { kind: "fixed", amount: {} } }),
    ],
    CURRENCIES,
  );
  assert.deepEqual(
    warnings.map((w) => [w.kind, w.ruleId]),
    [
      ["missingCurrency", "a"],
      ["noCode", "b"],
      ["noTarget", "c"],
    ],
  );
  assert.deepEqual(warnings[0].currencies, ["EUR"]);
});

test("money: format per locale, parse what a merchant types, round-trip the field value", () => {
  assert.equal(formatMoney(123450, "CZK", "cs"), `1${NBSP}234,50${NBSP}Kč`);
  assert.equal(formatMoney(123450, "CZK", "en"), "CZK 1,234.50");
  assert.equal(formatMoney(4000, "EUR", "en"), "€40");
  assert.equal(formatMoney(500, "JPY", "cs"), `500${NBSP}JPY`);
  assert.equal(parseMoneyInput("100", "CZK"), 10000);
  assert.equal(parseMoneyInput("100,5", "CZK"), 10050);
  assert.equal(parseMoneyInput("1 000.25", "EUR"), 100025);
  assert.equal(parseMoneyInput("", "EUR"), null);
  assert.ok(Number.isNaN(parseMoneyInput("-5", "EUR")));
  assert.ok(Number.isNaN(parseMoneyInput("1.234", "EUR")));
  assert.equal(parseMoneyInput("500", "JPY"), 500);
  assert.equal(minorToInput(10050, "CZK"), "100.5");
  assert.equal(minorToInput(10000, "CZK"), "100");
});
