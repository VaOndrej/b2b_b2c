import assert from "node:assert/strict";
import { test } from "node:test";

import {
  DISCOUNT_METHODS,
  DISCOUNT_TARGET_KINDS,
  DISCOUNT_VALUE_KINDS,
  type DiscountRule,
} from "@won/core/discounts/config";
import { describeRule as coreDescribeRule } from "@won/core/discounts/describe";

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
  ruleDays,
} from "../../app/components/model/describe.ts";
import { translator, type Locale } from "../../app/i18n/index.ts";

// Doctrine §17 / §17a / DATA-4: the admin's state lines come from the ONE core
// formatter the engine also uses, and never contain a raw enum key, an i18n key,
// a leftover `{placeholder}` or "undefined". The Czech admin must not leak any
// English enum word at all.

const NBSP = " ";
const cs = translator("cs");
const en = translator("en");
const CURRENCIES = ["CZK", "EUR"];
const TZ = "Europe/Prague";

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
            targeting: { markets: ["sk"], segments: ["gid://shopify/Segment/1"] },
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
        describeRuleLine(r, tr, CURRENCIES, TZ),
        describeValue(r, tr, CURRENCIES),
        describeMethod(r, tr),
        describeMinimum(r, tr, CURRENCIES),
        describeSchedule(r, tr, TZ),
        describeLimits(r, tr),
        describeMoreOptions(r, tr, CURRENCIES, TZ),
        describeProSettings(r, tr, names, { sk: "Slovensko" }),
      ];
      for (const line of lines) assertHuman(line, tr.locale, `${r.value.kind}/${r.target.kind}/${r.method}`);
      count++;
    }
  }
  assert.ok(count > 300, `exercised ${count} combinations`);
});

test("§17a: the admin line IS the core formatter's line (+ the schedule); no second wording", () => {
  for (const r of everyRule()) {
    for (const tr of [cs, en]) {
      const core = coreDescribeRule(r, tr.locale, undefined, { currencies: CURRENCIES, codesKnown: true });
      const line = describeRuleLine({ ...r, schedule: undefined }, tr, CURRENCIES, TZ);
      assert.equal(line, core);
    }
  }
});

test("the rule line reads value · method · minimum · schedule · not offered in", () => {
  assert.equal(describeRuleLine(rule({}), cs, ["CZK"], TZ), `10${NBSP}% z objednávky · automaticky`);
  assert.equal(describeRuleLine(rule({}), en, ["CZK"], TZ), "10% off the order · automatic");
  assert.equal(
    describeRuleLine(rule({ value: { kind: "fixed", amount: { CZK: 10000, EUR: 400 } } }), cs, CURRENCIES, TZ),
    `100${NBSP}Kč / 4${NBSP}€ z objednávky · automaticky`,
  );
  assert.equal(
    describeRuleLine(
      rule({
        method: "code",
        codes: ["VIP10"],
        minimum: { subtotal: { CZK: 100000 }, quantity: 3 },
        schedule: { startsAt: "2026-11-27T00:00:00+01:00", endsAt: "2026-12-01T00:00:00+01:00" },
      }),
      cs,
      CURRENCIES,
      TZ,
    ),
    `10${NBSP}% z objednávky · kód VIP10 · od 1${NBSP}000${NBSP}Kč · od 3 ks · 27. 11. 2026 až 30. 11. 2026 · v EUR se nenabízí`,
  );
  assert.equal(describeMethod(rule({ method: "code", codes: [] }), cs), "kódem, zatím bez kódu");
  assert.equal(describeMethod(rule({ method: "code", codes: ["A", "B", "C", "D", "E"] }), cs), "kódy A, B, C a 2 další");
});

test("schedule days are the shop's days, exactly as the sync ships them (DST-safe)", () => {
  const r = rule({ schedule: { startsAt: "2026-06-30T22:00:00Z", endsAt: "2026-07-31T22:00:00Z" } });
  assert.deepEqual(ruleDays(r, TZ), { startsOn: "2026-07-01", endsOn: "2026-07-31" });
  assert.equal(describeSchedule(r, cs, TZ), "1. 7. 2026 až 31. 7. 2026");
  assert.deepEqual(ruleDays(rule({}), TZ), {});
  // Zone unknown: the days the schedule was written for, never re-read in UTC
  // (found in the v2 screenshots: 27. 11. +01:00 read as 26. 11. UTC).
  const written = rule({ schedule: { startsAt: "2026-11-27T00:00:00+01:00", endsAt: "2026-12-01T00:00:00+01:00" } });
  assert.deepEqual(ruleDays(written, null), { startsOn: "2026-11-27", endsOn: "2026-11-30" });
  assert.deepEqual(ruleDays(written, "Not/AZone"), { startsOn: "2026-11-27", endsOn: "2026-11-30" });
});

test("missingCurrencies: a fixed value or a minimum without a currency is 'not offered' there", () => {
  assert.deepEqual(missingCurrencies(rule({}), CURRENCIES), []);
  assert.deepEqual(missingCurrencies(rule({ value: { kind: "fixed", amount: { CZK: 100 } } }), CURRENCIES), ["EUR"]);
  assert.deepEqual(missingCurrencies(rule({ minimum: { subtotal: { EUR: 100 } } }), CURRENCIES), ["CZK"]);
  assert.deepEqual(missingCurrencies(rule({ minimum: { subtotal: {} } }), CURRENCIES), []);
});

test("collectWarnings: segment targeting (never sold as working), missing currency, no code, nothing selected", () => {
  const warnings = collectWarnings(
    [
      rule({ id: "s", name: "Segment", targeting: { segments: ["gid://shopify/Segment/1"] } }),
      rule({ id: "a", name: "Fixní", value: { kind: "fixed", amount: { CZK: 100 } } }),
      rule({ id: "b", name: "Kódová", method: "code", codes: [] }),
      rule({ id: "c", name: "Produkty", target: { kind: "products", productIds: [], variantIds: [] } }),
      rule({ id: "d", name: "Vypnutá", enabled: false, value: { kind: "fixed", amount: {} } }),
    ],
    CURRENCIES,
  );
  assert.deepEqual(
    warnings.map((w) => [w.kind, w.ruleId, w.field]),
    [
      ["unsupported", "s", "pro"],
      ["missingCurrency", "a", "value"],
      ["noCode", "b", "codes"],
      ["noTarget", "c", "target"],
    ],
  );
  assert.deepEqual(warnings[1].currencies, ["EUR"]);
  assert.match(describeProSettings(rule({ targeting: { segments: ["x"] } }), cs, new Map()), /v pokladně se zatím neuplatní/);
  assert.equal(
    describeProSettings(rule({ targeting: { markets: ["cz", "sk"] } }), cs, new Map(), { cz: "Česko" }),
    "Jen trhy Česko a sk · kombinuje se podle výchozích pravidel",
  );
});
