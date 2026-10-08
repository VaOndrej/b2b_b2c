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
  autoRuleName,
  collectWarnings,
  describeLimits,
  describeMethod,
  describeMinimum,
  describeProSettings,
  describeRuleLine,
  describeSchedule,
  describeValue,
  EDITOR_SECTION_OF,
  EDITOR_SECTIONS,
  editorSectionOf,
  missingCurrencies,
  ruleDays,
} from "../../app/components/model/describe.ts";
import type { RuleStatus, RuleStatusKind } from "../../app/components/model/rule-status.ts";
import { previewModel } from "../../app/components/rule-editor/CustomerPreview.tsx";
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
        describeRuleLine(r, tr, CURRENCIES, TZ, { ruleNames: names, marketNames: { sk: "Slovensko" } }),
        autoRuleName(r, tr, CURRENCIES),
        describeProSettings(r, tr, names, { sk: "Slovensko" }),
      ];
      for (const line of lines) assertHuman(line, tr.locale, `${r.value.kind}/${r.target.kind}/${r.method}`);
      count++;
    }
  }
  assert.ok(count > 300, `exercised ${count} combinations`);
});

test("§17a: the admin line IS the core formatter's line (+ the schedule, limits, markets, combinations when set); no second wording", () => {
  for (const r of everyRule()) {
    for (const tr of [cs, en]) {
      const core = coreDescribeRule(r, tr.locale, undefined, { currencies: CURRENCIES, codesKnown: true });
      const line = describeRuleLine({ ...r, schedule: undefined, limits: undefined, targeting: undefined, combinesWith: undefined }, tr, CURRENCIES, TZ);
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
      ["unsupported", "s", "segments"],
      ["missingCurrency", "a", "value"],
      ["noCode", "b", "codes"],
      ["noTarget", "c", "target"],
    ],
  );
  assert.deepEqual(warnings[1].currencies, ["EUR"]);
  assert.match(describeProSettings(rule({ targeting: { segments: ["x"] } }), cs, new Map()), /v pokladně se zatím neuplatní/);
  assert.equal(
    describeProSettings(rule({ targeting: { markets: ["cz", "sk"] } }), cs, new Map(), { cz: "Česko" }),
    "Jen trhy Česko a sk · se slevou stejného druhu se nesčítá, platí výhodnější",
  );
  // One verb everywhere: "sčítá se s".
  assert.equal(
    describeProSettings(rule({ combinesWith: { ruleIds: ["r2"] } }), cs, new Map([["r2", "Druhá sleva"]])),
    "Všichni zákazníci a trhy · sčítá se s Druhá sleva",
  );
});

test("collectWarnings: a missing minimum points at the conditions; a rule limited to switched-off markets is reported only when the enabled markets are given (B3)", () => {
  const rules = [
    rule({ id: "m", name: "Minimum", minimum: { subtotal: { CZK: 100000 } } }),
    rule({ id: "t", name: "Trh", targeting: { markets: ["hu"] } }),
    rule({ id: "u", name: "Trhy", targeting: { markets: ["hu", "cz"] } }),
  ];
  assert.deepEqual(
    collectWarnings(rules, CURRENCIES).map((w) => [w.kind, w.ruleId, w.field]),
    [["missingCurrency", "m", "conditions"]],
  );
  assert.deepEqual(
    collectWarnings(rules, CURRENCIES, { enabledMarkets: ["cz", "sk"] }).map((w) => [w.kind, w.ruleId, w.field]),
    [
      ["missingCurrency", "m", "conditions"],
      ["marketOff", "t", "markets"],
    ],
  );
});

test("P5: the one-line state adds usage limits, market targeting and combinations when they are set", () => {
  const r = rule({
    method: "code",
    codes: ["VIP10"],
    limits: { usageLimit: 100, oncePerCustomer: true },
    targeting: { markets: ["cz", "sk"] },
    combinesWith: { ruleIds: ["r2", "r3"] },
  });
  assert.equal(
    describeRuleLine(r, cs, ["CZK"], TZ, { marketNames: { cz: "Česko", sk: "Slovensko" }, ruleNames: new Map([["r2", "Druhá"], ["r3", ""]]) }),
    `10${NBSP}% z objednávky · kód VIP10 · 1× na zákazníka · nejvýš 100× celkem · jen trhy Česko a Slovensko · sčítá se s Druhá a Sleva bez názvu`,
  );
  // Without the names (a caller that does not know them): handles and a count, never an id.
  assert.equal(describeRuleLine(r, cs, ["CZK"], TZ), `10${NBSP}% z objednávky · kód VIP10 · 1× na zákazníka · nejvýš 100× celkem · jen trhy cz a sk · sčítá se s dalšími slevami (2)`);
  // Limits belong to code rules only (Shopify): an automatic rule never shows them.
  assert.equal(describeRuleLine({ ...r, method: "automatic", codes: undefined, targeting: undefined, combinesWith: undefined }, cs, ["CZK"], TZ), `10${NBSP}% z objednávky · automaticky`);
});

test("P5: the generated name is the value + target phrase with the minimum", () => {
  assert.equal(autoRuleName(rule({}), cs, CURRENCIES), `10${NBSP}% z objednávky`);
  assert.equal(autoRuleName(rule({ value: { kind: "fixed", amount: { CZK: 10000 } }, target: { kind: "shipping" } }), cs, ["CZK"]), `100${NBSP}Kč z dopravy`);
  assert.equal(
    autoRuleName(rule({ value: { kind: "freeShipping" }, target: { kind: "shipping" }, minimum: { subtotal: { CZK: 100000 } } }), cs, ["CZK"]),
    `Doprava zdarma od 1${NBSP}000${NBSP}Kč`,
  );
  assert.equal(
    autoRuleName(rule({ target: { kind: "collections", ids: ["gid://shopify/Collection/1"] }, minimum: { quantity: 3, scope: "entitled" } }), cs, CURRENCIES),
    `10${NBSP}% na vybrané kolekce, od 3 ks z vybraných kolekcí`,
  );
  assert.equal(autoRuleName(rule({ minimum: { subtotal: { CZK: 100000 } } }), en, ["CZK"]), "10% off the order, orders from CZK 1,000");
});

// --- P5: every combination of the editor's main choices -------------------------------------------

const VIEWS = [
  { code: "CZK", markets: [{ handle: "cz", name: "Česko" }] },
  { code: "EUR", markets: [{ handle: "sk", name: "Slovensko" }] },
];
const LIVE: RuleStatus = { kind: "live" };

function previewText(r: DiscountRule, tr: typeof cs, status: RuleStatus = LIVE): string {
  const p = previewModel(r, VIEWS, status, tr);
  return [p.name, p.notNow ?? "", p.code ?? "", ...p.lines.map((l) => `${l.currency ?? "*"}=${l.offer ?? "-"}`)].join(" | ");
}

test("P5: every value × target × method (+ minimum scope) has a summary line, a generated name and a preview that name the right target and change with every option", () => {
  const values: DiscountRule["value"][] = [{ kind: "percentage", percent: 10 }, { kind: "fixed", amount: { CZK: 10000, EUR: 400 } }, { kind: "freeShipping" }];
  const targets: DiscountRule["target"][] = [
    { kind: "order" },
    { kind: "products", productIds: ["gid://shopify/Product/1"], variantIds: [] },
    { kind: "collections", ids: ["gid://shopify/Collection/1"] },
    { kind: "shipping" },
  ];
  const TARGET_WORDS: Record<Locale, Record<string, RegExp>> = {
    cs: { order: /z objednávky/, products: /vybran(é|ých) produkt/, collections: /kolekc/, shipping: /z dopravy/, freeShipping: /Doprava zdarma/ },
    en: { order: /off the order/, products: /selected (products|item)/, collections: /selected collections/, shipping: /off shipping/, freeShipping: /Free shipping/ },
  };
  for (const tr of [cs, en]) {
    const lines = new Set<string>();
    const names = new Map<string, string>();
    const previews = new Set<string>();
    let count = 0;
    for (const value of values) {
      // Free shipping always targets shipping (the parser's rule): the other targets do not exist for it.
      for (const target of value.kind === "freeShipping" ? targets.filter((t) => t.kind === "shipping") : targets) {
        const lineTarget = target.kind === "products" || target.kind === "collections";
        const minimums: (DiscountRule["minimum"] | undefined)[] = [undefined, { subtotal: { CZK: 100000, EUR: 4000 }, quantity: 2, scope: "cart" }];
        if (lineTarget) minimums.push({ subtotal: { CZK: 100000, EUR: 4000 }, quantity: 2, scope: "entitled" });
        for (const minimum of minimums) {
          for (const method of DISCOUNT_METHODS) {
            const base = rule({ value, target, method, minimum, ...(method === "code" ? { codes: ["VIP10"] } : {}) });
            const name = autoRuleName(base, tr, CURRENCIES);
            const r = { ...base, name };
            const where = `${tr.locale} ${value.kind}/${target.kind}/${method}/${minimum?.scope ?? "none"}`;
            const line = describeRuleLine(r, tr, CURRENCIES, TZ);
            const preview = previewModel(r, VIEWS, LIVE, tr);
            const text = previewText(r, tr);
            for (const s of [line, name, text]) {
              assert.ok(s.trim().length > 0, `${where}: empty`);
              assertHuman(s.replace(/\b(CZK|EUR)=/g, ""), tr.locale, where);
              assert.match(s, TARGET_WORDS[tr.locale][value.kind === "freeShipping" ? "freeShipping" : target.kind], `${where}: the target in "${s}"`);
            }
            // The method: the code (line + preview), or "automatically" (line only; the customer enters nothing).
            if (method === "code") {
              assert.match(line, /VIP10/, where);
              assert.match(preview.code ?? "", /VIP10/, where);
            } else {
              assert.match(line, tr.locale === "cs" ? /automaticky/ : /automatic/, where);
              assert.equal(preview.code, null, where);
            }
            // The minimum, in the words of what it is measured on.
            if (minimum) {
              const word = tr.locale === "cs" ? (minimum.scope === "entitled" ? /nákup od/ : lineTarget ? /košík od/ : /od 1/) : minimum.scope === "entitled" ? /from .* (of|in) selected/ : lineTarget ? /cart from/ : /orders from/;
              for (const s of [line, name, text]) assert.match(s, word, `${where}: the minimum in "${s}"`);
            }
            // One line when every currency reads the same; one per currency when the amounts differ.
            const perCurrency = value.kind === "fixed" || minimum !== undefined;
            assert.equal(preview.lines.length, perCurrency ? 2 : 1, `${where}: preview lines`);
            assert.equal(preview.lines[0].currency, perCurrency ? "CZK" : null, where);
            assert.equal(preview.notNow, null, where);
            lines.add(line);
            previews.add(text);
            names.set(`${value.kind}/${target.kind}/${minimum?.scope ?? "none"}`, name);
            count++;
          }
        }
      }
    }
    assert.equal(count, 44, "(2 values × 10 target/minimum pairs + free shipping × 2) × 2 methods");
    // Changing any one option changes the text.
    assert.equal(lines.size, count, `${tr.locale}: every summary line is different`);
    assert.equal(previews.size, count, `${tr.locale}: every preview is different`);
    assert.equal(new Set(names.values()).size, names.size, `${tr.locale}: every generated name is different (the method is not part of a name)`);
    assert.equal(names.size, count / 2);
  }
});

test("P5: the preview says 'does not run' for every status but Běží / Zapisuje se, and lists only the currencies of the targeted markets", () => {
  const kinds: RuleStatusKind[] = ["off", "unsupported", "pro_off", "no_code", "no_target", "no_value", "market_off", "scheduled", "ended", "not_synced", "sync_failed", "draft"];
  for (const kind of kinds) {
    for (const tr of [cs, en]) {
      const p = previewModel(rule({}), VIEWS, { kind, date: "2026-11-27" }, tr);
      assert.ok(p.notNow && p.notNow.trim().length > 0, `${kind}: says it does not run`);
      assertHuman(p.notNow ?? "", tr.locale, kind);
    }
  }
  assert.equal(previewModel(rule({}), VIEWS, { kind: "live" }, cs).notNow, null);
  assert.equal(previewModel(rule({}), VIEWS, { kind: "refreshing" }, cs).notNow, null);
  assert.equal(previewModel(rule({}), VIEWS, { kind: "off" }, cs).notNow, "Vypnuto");

  const fixed = rule({ value: { kind: "fixed", amount: { CZK: 10000 } } });
  assert.deepEqual(previewModel(fixed, VIEWS, LIVE, cs).lines, [
    { currency: "CZK", offer: `100${NBSP}Kč z objednávky` },
    { currency: "EUR", offer: null },
  ]);
  // Limited to Slovensko: the CZK line is gone, EUR is "not offered".
  assert.deepEqual(previewModel({ ...fixed, targeting: { markets: ["sk"] } }, VIEWS, LIVE, cs).lines, [{ currency: "EUR", offer: null }]);
  assert.deepEqual(previewModel({ ...fixed, targeting: { markets: ["cz"] } }, VIEWS, LIVE, cs).lines, [{ currency: null, offer: `100${NBSP}Kč z objednávky` }]);
  // A code rule without a code shows no code line (the status says why it does not run).
  assert.equal(previewModel(rule({ method: "code", codes: [] }), VIEWS, { kind: "no_code" }, cs).code, null);
  assert.equal(previewModel(rule({ method: "code", codes: ["VIP10", "LETO"] }), VIEWS, LIVE, cs).code, "Zákazník zadá kódy VIP10, LETO.");
});

// Navigace a stav (8 Oct 2026), bod 5: the editor's list of sections and the deep links share one table.
test("every editor anchor sits in one of the five sections; an old alias still resolves, an unknown name does not", () => {
  assert.deepEqual([...EDITOR_SECTIONS], ["discount", "conditions", "codes", "schedule", "pro"]);
  for (const section of EDITOR_SECTIONS) assert.equal(EDITOR_SECTION_OF[section], section, "a section's own anchor");
  assert.equal(editorSectionOf("value"), "discount");
  assert.equal(editorSectionOf("target"), "discount");
  assert.equal(editorSectionOf("markets"), "pro");
  assert.equal(editorSectionOf("combines"), "pro");
  assert.equal(editorSectionOf("more"), "conditions", "the retired #more lands on the conditions");
  assert.equal(editorSectionOf("nope"), null);
  assert.equal(editorSectionOf("toString"), null, "not a name inherited from Object");
});
