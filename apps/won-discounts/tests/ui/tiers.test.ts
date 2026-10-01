import assert from "node:assert/strict";
import { test } from "node:test";

import { sanitizeConfig } from "@won/core/discounts/config";

import {
  formatShopMoney,
  missingCurrencies,
  newTierSetId,
  previewTiers,
  readTiersForm,
  scopeSummary,
  tierBreakText,
  tierSetToConfig,
  tierSetView,
  tierSummary,
  TIERS_FIELD,
  TIERS_INTENT,
  TIERS_SAMPLE_SET,
  TIER_MIN_QTY_MAX,
} from "../../app/components/model/tiers.ts";
import { scopeCss } from "../../app/components/tiers/scope-css.ts";
import { wordIssues } from "../../app/lib/integration/issue-copy.ts";
import type { CurrencyView, TierSetView } from "../../app/components/model/types.ts";
import { translator } from "../../app/i18n/index.ts";

// Množstevní slevy in the admin (MVP 3, Task 5): the form the screen posts is
// parsed by ONE function — the server validates it (SEC-1) and the screen reads
// its live draft with it (§2) — so the state line, the preview and what Save
// stores can never disagree. The preview math mirrors the storefront block
// (K6: the highest break whose minimum the count reaches; a missing currency =
// the break is not offered there, MKT-1).

const cs = translator("cs");
const en = translator("en");

const CURRENCIES: CurrencyView[] = [
  { code: "CZK", markets: [{ handle: "cz", name: "Česko" }] },
  { code: "EUR", markets: [{ handle: "sk", name: "Slovensko" }] },
];

function form(entries: [string, string][]): FormData {
  const fd = new FormData();
  for (const [k, v] of entries) fd.append(k, v);
  return fd;
}

const F = TIERS_FIELD;

test("form field names are the contract between the screen and the server parser", () => {
  assert.equal(F.intent, "intent");
  assert.equal(F.configVersion, "configVersion");
  assert.equal(F.replaceUnreadable, "replaceUnreadable");
  assert.equal(F.set, "set[]");
  assert.equal(F.scope("global"), "set.global.scope");
  assert.equal(F.count("global"), "set.global.count");
  assert.equal(F.product("t_1"), "set.t_1.product[]");
  assert.equal(F.collection("t_1"), "set.t_1.collection[]");
  assert.equal(F.row("global"), "set.global.row[]");
  assert.equal(F.min("global", "r0"), "set.global.r0.min");
  assert.equal(F.kind("global"), "set.global.kind", "one kind per set (controller ruling)");
  assert.equal(F.percent("global", "r0"), "set.global.r0.percent");
  assert.equal(F.amount("global", "r0", "EUR"), "set.global.r0.amount.EUR");
  assert.equal(F.amounts("global", "r0"), "set.global.r0.amount");
  assert.deepEqual(TIERS_INTENT, { save: "save" });
  assert.match(newTierSetId(), /^t_[A-Za-z0-9]{20}$/);
});

test("readTiersForm: breaks sorted ascending; one kind per set — percents, or amounts per item per currency (minor units)", () => {
  const read = readTiersForm(
    form([
      [F.set, "global"],
      [F.scope("global"), "global"],
      [F.count("global"), "product"],
      [F.kind("global"), "percent"],
      [F.row("global"), "r1"],
      [F.row("global"), "r0"],
      [F.min("global", "r0"), "3"],
      [F.percent("global", "r0"), "10"],
      [F.min("global", "r1"), "5"],
      [F.percent("global", "r1"), "12,5"],
      [F.set, "t_b"],
      [F.scope("t_b"), "selection"],
      [F.product("t_b"), "gid://shopify/Product/1"],
      [F.count("t_b"), "line"],
      [F.kind("t_b"), "amount"],
      [F.row("t_b"), "r0"],
      [F.min("t_b", "r0"), "2"],
      // A stray percent field of a set of amounts is never read.
      [F.percent("t_b", "r0"), "90"],
      [F.amount("t_b", "r0", "CZK"), "20,50"],
      [F.amount("t_b", "r0", "EUR"), ""],
    ]),
    { currencies: ["CZK", "EUR"] },
  );
  assert.deepEqual(read.errors, []);
  assert.deepEqual(read.sets[0], {
    id: "global",
    scope: { kind: "global" },
    countAcross: "product",
    breaks: [
      { minQty: 3, kind: "percent", percent: 10, amount: {} },
      { minQty: 5, kind: "percent", percent: 12.5, amount: {} },
    ],
  });
  // EUR empty = not offered in EUR (MKT-1), never 0.
  assert.deepEqual(read.sets[1]!.breaks, [{ minQty: 2, kind: "amount", percent: null, amount: { CZK: 2050 } }]);
  assert.deepEqual(tierSetToConfig(read.sets[0]!), {
    id: "global",
    scope: "global",
    countAcross: "product",
    breaks: [
      { minQty: 3, percent: 10 },
      { minQty: 5, percent: 12.5 },
    ],
  });
  assert.deepEqual(tierSetToConfig(read.sets[1]!).breaks, [{ minQty: 2, amountOff: { CZK: 2050 } }]);
});

test("readTiersForm: every wrong value is refused at its own field (SEC-1), nothing is rounded silently", () => {
  const read = readTiersForm(
    form([
      [F.set, "global"],
      [F.scope("global"), "global"],
      [F.count("global"), "line"],
      [F.kind("global"), "percent"],
      [F.row("global"), "r0"],
      [F.row("global"), "r1"],
      [F.row("global"), "r2"],
      [F.min("global", "r0"), "0"],
      [F.percent("global", "r0"), "10"],
      [F.min("global", "r1"), "3"],
      [F.percent("global", "r1"), "120"],
      [F.min("global", "r2"), "3"],
      [F.percent("global", "r2"), "12,555"],
      [F.set, "t_z"],
      [F.scope("t_z"), "selection"],
      [F.collection("t_z"), "gid://shopify/Collection/2"],
      [F.count("t_z"), "line"],
      [F.kind("t_z"), "amount"],
      [F.row("t_z"), "r3"],
      [F.row("t_z"), "r4"],
      [F.min("t_z", "r3"), "4"],
      [F.amount("t_z", "r3", "CZK"), ""],
      [F.amount("t_z", "r3", "EUR"), ""],
      [F.min("t_z", "r4"), "6"],
      [F.amount("t_z", "r4", "CZK"), "-5"],
      [F.amount("t_z", "r4", "EUR"), "0"],
    ]),
    { currencies: ["CZK", "EUR"] },
  );
  const byField = Object.fromEntries(read.errors.map((e) => [e.field, e.key]));
  assert.equal(byField[F.min("global", "r0")], "tiers.error.min");
  assert.equal(byField[F.percent("global", "r1")], "tiers.error.percent");
  assert.equal(byField[F.min("global", "r2")], "tiers.error.minTaken", "a second break with the same minimum");
  assert.equal(byField[F.percent("global", "r2")], "tiers.error.percent", "more than two decimals");
  assert.equal(byField[F.amounts("t_z", "r3")], "tiers.error.amountNone");
  assert.equal(byField[F.amount("t_z", "r4", "CZK")], "tiers.error.amount");
  assert.equal(byField[F.amount("t_z", "r4", "EUR")], "tiers.error.amount", "0 is not an amount off");
  assert.equal(read.errors.find((e) => e.field === F.min("global", "r0"))?.params?.max, TIER_MIN_QTY_MAX);
});

test("readTiersForm: at most 10 breaks per set, unknown counting refused", () => {
  const entries: [string, string][] = [
    [F.set, "global"],
    [F.scope("global"), "global"],
    [F.count("global"), "everything"],
  ];
  for (let i = 0; i < 11; i += 1) {
    entries.push([F.row("global"), `r${i}`], [F.min("global", `r${i}`), String(i + 2)], [F.percent("global", `r${i}`), "5"]);
  }
  const read = readTiersForm(form(entries), { currencies: ["CZK"] });
  const keys = read.errors.map((e) => `${e.field}:${e.key}`);
  assert.ok(keys.includes(`${F.row("global")}:tiers.error.tooManyBreaks`), keys.join(" "));
  assert.ok(keys.includes(`${F.count("global")}:tiers.error.count`), keys.join(" "));
});

test("readTiersForm: a Pro set needs products or collections (Shopify ids only), titles are never taken from the form", () => {
  const read = readTiersForm(
    form([
      [F.set, "t_a"],
      [F.scope("t_a"), "selection"],
      [F.count("t_a"), "cart"],
      [F.product("t_a"), "gid://shopify/Product/1"],
      [F.product("t_a"), "gid://shopify/Product/1"],
      [F.collection("t_a"), "gid://shopify/Collection/9"],
      [F.row("t_a"), "r0"],
      [F.min("t_a", "r0"), "2"],
      [F.kind("t_a"), "percent"],
      [F.percent("t_a", "r0"), "7,5"],
      [F.set, "t_b"],
      [F.scope("t_b"), "selection"],
      [F.count("t_b"), "line"],
      [F.set, "t_c"],
      [F.scope("t_c"), "selection"],
      [F.count("t_c"), "line"],
      [F.product("t_c"), "gid://shopify/Order/1"],
      [F.set, "bad id!"],
    ]),
    { currencies: ["CZK"], titles: new Map([["gid://shopify/Product/1", "Mikina"]]) },
  );
  const keys = read.errors.map((e) => `${e.field}:${e.key}`);
  assert.ok(keys.includes(`${F.scope("t_b")}:tiers.error.scopeEmpty`), keys.join(" "));
  assert.ok(keys.includes(`${F.product("t_c")}:tiers.error.product`), keys.join(" "));
  assert.ok(keys.includes(`${F.set}:tiers.error.set`), keys.join(" "));
  const a = read.sets.find((s) => s.id === "t_a")!;
  assert.deepEqual(a, {
    id: "t_a",
    scope: {
      kind: "selection",
      products: [{ id: "gid://shopify/Product/1", title: "Mikina" }],
      collections: [{ id: "gid://shopify/Collection/9", title: "" }],
    },
    countAcross: "cart",
    breaks: [{ minQty: 2, kind: "percent", percent: 7.5, amount: {} }],
  });
  assert.deepEqual(tierSetToConfig(a).scope, { productIds: ["gid://shopify/Product/1"], collectionIds: ["gid://shopify/Collection/9"] });
});

test("readTiersForm: a value kept for a market that is off is read when the screen passes it (§14a: off ≠ erased)", () => {
  const read = readTiersForm(
    form([
      [F.set, "global"],
      [F.scope("global"), "global"],
      [F.count("global"), "line"],
      [F.row("global"), "r0"],
      [F.min("global", "r0"), "3"],
      [F.kind("global"), "amount"],
      [F.amount("global", "r0", "CZK"), "10"],
      [F.amount("global", "r0", "HUF"), "300"],
    ]),
    { currencies: ["CZK"], keptCurrencies: ["HUF"] },
  );
  assert.deepEqual(read.errors, []);
  assert.deepEqual(read.sets[0]!.breaks[0]!.amount, { CZK: 1000, HUF: 30000 });
  // Without it, a currency that is not the screen's is ignored (never trusted from the form).
  const plain = readTiersForm(
    form([
      [F.set, "global"],
      [F.scope("global"), "global"],
      [F.count("global"), "line"],
      [F.row("global"), "r0"],
      [F.min("global", "r0"), "3"],
      [F.kind("global"), "amount"],
      [F.amount("global", "r0", "CZK"), "10"],
      [F.amount("global", "r0", "HUF"), "300"],
    ]),
    { currencies: ["CZK"] },
  );
  assert.deepEqual(plain.sets[0]!.breaks[0]!.amount, { CZK: 1000 });
});

test("tierSetView: a stored set as the form edits it; titles from Shopify, '' when unknown", () => {
  const view = tierSetView(
    {
      id: "t_x",
      scope: { productIds: ["gid://shopify/Product/2"], collectionIds: ["gid://shopify/Collection/3"] },
      countAcross: "product",
      breaks: [
        { minQty: 5, amountOff: { CZK: 5000 } },
        { minQty: 2, percent: 5 },
      ],
    },
    new Map([["gid://shopify/Collection/3", "Zimní"]]),
  );
  assert.deepEqual(view, {
    id: "t_x",
    scope: { kind: "selection", products: [{ id: "gid://shopify/Product/2", title: "" }], collections: [{ id: "gid://shopify/Collection/3", title: "Zimní" }] },
    countAcross: "product",
    breaks: [
      { minQty: 2, kind: "percent", percent: 5, amount: {} },
      { minQty: 5, kind: "amount", percent: null, amount: { CZK: 5000 } },
    ],
  });
});

const SET: TierSetView = {
  id: "global",
  scope: { kind: "global" },
  countAcross: "line",
  breaks: [
    { minQty: 3, kind: "percent", percent: 10, amount: {} },
    { minQty: 5, kind: "percent", percent: 15, amount: {} },
  ],
};

test("state line (§17a): core describeTierSet — the engine's own words; amounts per market currency, the missing one named (MKT-1)", () => {
  assert.equal(tierSummary(SET, cs, ["CZK", "EUR"]), "Od 3 ks −10\u00a0%, od 5 ks −15\u00a0%");
  assert.equal(tierSummary(SET, en, ["CZK", "EUR"]), "From 3 items −10%, from 5 items −15%");
  assert.equal(tierSummary({ ...SET, breaks: [] }, cs), "Bez množstevních slev");
  assert.equal(tierSummary(null, en), "No quantity tiers");
  const amount: TierSetView = {
    ...SET,
    breaks: [
      { minQty: 2, kind: "amount", percent: null, amount: { CZK: 2000, EUR: 80 } },
      { minQty: 4, kind: "amount", percent: null, amount: { CZK: 3000 } },
    ],
  };
  assert.equal(tierSummary(amount, cs, ["CZK", "EUR"]), "Od 2 ks −20\u00a0Kč / 0,80\u00a0€ za kus, od 4 ks −30\u00a0Kč za kus (v EUR se nenabízí)");
  assert.equal(tierBreakText(amount.breaks[1]!, cs, "EUR"), "Od 4 ks (v EUR se nenabízí)");
  assert.equal(scopeSummary({ kind: "selection", products: [{ id: "a", title: "" }], collections: [{ id: "b", title: "" }, { id: "c", title: "" }] }, cs), "1 produkt · 2 kolekce");
  assert.equal(scopeSummary({ kind: "global" }, cs), "Celý obchod");
});

test("a higher break never gives less than a lower one (controller ruling): refused at the higher row, per currency for amounts", () => {
  const read = readTiersForm(
    form([
      [F.set, "global"],
      [F.scope("global"), "global"],
      [F.count("global"), "line"],
      [F.kind("global"), "percent"],
      [F.row("global"), "r0"],
      [F.row("global"), "r1"],
      [F.min("global", "r0"), "3"],
      [F.percent("global", "r0"), "20"],
      [F.min("global", "r1"), "5"],
      [F.percent("global", "r1"), "10"],
      [F.set, "t_m"],
      [F.scope("t_m"), "selection"],
      [F.product("t_m"), "gid://shopify/Product/3"],
      [F.count("t_m"), "line"],
      [F.kind("t_m"), "amount"],
      [F.row("t_m"), "r0"],
      [F.row("t_m"), "r1"],
      [F.min("t_m", "r0"), "2"],
      [F.amount("t_m", "r0", "CZK"), "50"],
      [F.amount("t_m", "r0", "EUR"), "2"],
      [F.min("t_m", "r1"), "8"],
      [F.amount("t_m", "r1", "CZK"), "60"],
      [F.amount("t_m", "r1", "EUR"), "1"],
    ]),
    { currencies: ["CZK", "EUR"] },
  );
  assert.deepEqual(read.errors, [
    { field: F.percent("global", "r1"), key: "tiers.error.notAscending", params: { min: 3 } },
    { field: F.amount("t_m", "r1", "EUR"), key: "tiers.error.notAscending", params: { min: 2 } },
  ]);
  // Equal is fine.
  const ok = readTiersForm(
    form([
      [F.set, "global"],
      [F.scope("global"), "global"],
      [F.count("global"), "line"],
      [F.kind("global"), "percent"],
      [F.row("global"), "r0"],
      [F.row("global"), "r1"],
      [F.min("global", "r0"), "3"],
      [F.percent("global", "r0"), "10"],
      [F.min("global", "r1"), "5"],
      [F.percent("global", "r1"), "10"],
    ]),
    { currencies: ["CZK"] },
  );
  assert.deepEqual(ok.errors, []);
});

test("the sanitizer's new tier / look issues are worded in the admin language from code + params, never an id", () => {
  const { issues } = sanitizeConfig({
    modules: {
      tiers: {
        sets: [
          { id: "g", scope: "global", countAcross: "line", breaks: [{ minQty: 3, percent: 10, amountOff: { CZK: 100 } }, { minQty: 3, percent: 12 }, { minQty: 4 }, { percent: 5 }] },
          { id: "g", scope: "global", countAcross: "line", breaks: [] },
        ],
      },
    },
    storefront: { appearancePreset: "neon" },
  });
  const worded = wordIssues(issues, "cs", () => assert.fail("every issue has its own sentence"));
  assert.ok(worded.includes("Úroveň od 3 ks měla procento i částku, ponechalo se procento."), worded.join(" | "));
  assert.ok(worded.includes("Dvě úrovně začínaly od 3 ks, ponechala se první."), worded.join(" | "));
  assert.ok(worded.includes("Úroveň od 4 ks neměla procento ani částku, vyřadila se."), worded.join(" | "));
  assert.ok(worded.includes("Úroveň bez počtu kusů se vyřadila."), worded.join(" | "));
  assert.ok(worded.includes("Sada úrovní byla uložená dvakrát, druhá kopie se vyřadila."), worded.join(" | "));
  assert.ok(worded.includes("Neznámý vzhled, použil se výchozí (Tabulka)."), worded.join(" | "));
  assert.ok(worded.every((w) => !/\bg\b|neon/.test(w)), "no id or raw value");
  const en = wordIssues(issues, "en", () => assert.fail("worded"));
  assert.ok(en.includes("Two tiers started at 3 items; the first was kept."), en.join(" | "));
  assert.ok(en.includes("A quantity discount set was stored twice; the second copy was dropped."), "no 'ID' in English either");
  // invalid_percent next to an amount (review fix 15): the break keeps its amount — its own sentence.
  const junk = sanitizeConfig({ modules: { tiers: { sets: [{ id: "g", scope: "global", countAcross: "line", breaks: [{ minQty: 2, percent: "lots", amountOff: { CZK: 500 } }] }] } } });
  const junkText = wordIssues(junk.issues, "cs", () => assert.fail("worded"));
  assert.ok(junkText.includes("Úroveň od 2 ks měla neplatné procento, ponechala se její částka za kus."), junkText.join(" | "));
});

test("MKT-1: a break with an amount lacks a currency → the markets where it is not offered, by name", () => {
  const set: TierSetView = { ...SET, breaks: [{ minQty: 2, kind: "amount", percent: null, amount: { CZK: 2000 } }, SET.breaks[1]!] };
  assert.deepEqual(missingCurrencies(set, CURRENCIES), [{ currency: "EUR", markets: ["Slovensko"], minQty: [2] }]);
  assert.deepEqual(missingCurrencies(SET, CURRENCIES), []);
});

test("preview = the storefront block's arithmetic (K6): the highest break the count reaches, the row prices, the next break that lowers the price", () => {
  const at = (quantity: number) => previewTiers(SET, { unitPrice: 20000, currency: "CZK", quantity });
  assert.equal(at(1).active, null);
  assert.equal(at(1).unitPrice, 20000);
  assert.deepEqual(at(1).next, { minQty: 3, add: 2, unitPrice: 18000 });
  assert.equal(at(3).active, 3);
  assert.equal(at(3).unitPrice, 18000);
  assert.deepEqual(at(3).next, { minQty: 5, add: 2, unitPrice: 17000 });
  assert.equal(at(4).active, 3);
  assert.equal(at(5).active, 5);
  assert.equal(at(5).unitPrice, 17000);
  assert.equal(at(5).next, null);
  assert.deepEqual(
    at(5).rows.map((r) => [r.minQty, r.active, r.unitPrice, r.hidden]),
    [
      [3, false, 18000, false],
      [5, true, 17000, false],
    ],
  );
  assert.equal(at(1).empty, false);
  // The storefront's rounding (T4 7a4bb95): per item the percent is FLOORED (15 % of 9,99 = 1,4985 → 1,49, row 8,50);
  // the live line rounds ONCE per line like the engine (5 × 9,99 × 15 % = 7,4925 → 7,49), per item price − floor(7,49 / 5).
  const fraction = previewTiers(SET, { unitPrice: 999, currency: "CZK", quantity: 5 });
  assert.equal(fraction.rows.find((r) => r.minQty === 5)!.unitPrice, 850);
  assert.equal(fraction.total, 5 * 999 - 749);
  assert.equal(fraction.unitPrice, 999 - Math.floor(749 / 5));
  // A second line: 7 × 12,90 × 10 % = 9,03 rounds per line (not 7 × floor(1,29)).
  const seven = previewTiers(SET, { unitPrice: 1290, currency: "CZK", quantity: 4 });
  assert.equal(seven.total, 4 * 1290 - Math.round((1290 * 4 * 10) / 100));
  // Items already in the cart count toward the tier (K6; the admin preview has none, the block may).
  assert.equal(previewTiers(SET, { unitPrice: 20000, currency: "CZK", quantity: 1, inCart: 2 }).active, 3);
  // An amount per item never takes the price below 0; a currency without a value is not offered (row left out, MKT-1).
  const amount: TierSetView = {
    ...SET,
    breaks: [
      { minQty: 2, kind: "amount", percent: null, amount: { CZK: 50000 } },
      { minQty: 4, kind: "amount", percent: null, amount: { EUR: 100 } },
    ],
  };
  const p = previewTiers(amount, { unitPrice: 20000, currency: "CZK", quantity: 4 });
  assert.deepEqual(p.rows.map((r) => r.minQty), [2]);
  assert.deepEqual(p.rows[0]!.save, { kind: "amount", amount: 20000 });
  assert.equal(p.active, 2);
  assert.equal(p.unitPrice, 0);
  assert.equal(previewTiers(amount, { unitPrice: 20000, currency: "HUF", quantity: 4 }).empty, true);
  // The margin ceiling (the storefront's `max`) caps a percent and hides a row that saves nothing.
  const capped = previewTiers(SET, { unitPrice: 20000, currency: "CZK", quantity: 5, maxPercent: 12.5 });
  assert.deepEqual(capped.rows.map((r) => r.save), [
    { kind: "percent", percent: 10 },
    { kind: "percent", percent: 12.5 },
  ]);
  assert.equal(previewTiers(SET, { unitPrice: 20000, currency: "CZK", quantity: 5, maxPercent: 0 }).empty, true);
});

test("the sample set (nothing saved yet) is labelled as an example, never the shop's data", () => {
  assert.equal(TIERS_SAMPLE_SET.scope.kind, "global");
  assert.deepEqual(
    TIERS_SAMPLE_SET.breaks.map((b) => [b.minQty, b.percent]),
    [
      [3, 10],
      [5, 15],
    ],
  );
});

test("money like the storefront: the shop's money format (Liquid money units), HTML stripped; without one the admin format", () => {
  assert.equal(formatShopMoney(123450, "CZK", "{{amount_with_comma_separator}} Kč", "cs"), "1.234,50 Kč");
  assert.equal(formatShopMoney(123450, "EUR", "€{{amount}}", "en"), "€1,234.50");
  assert.equal(formatShopMoney(123400, "CZK", "{{ amount_no_decimals_with_space_separator }} Kč", "cs"), "1 234 Kč");
  assert.equal(formatShopMoney(1500, "JPY", "¥{{amount_no_decimals}}", "en"), "¥1,500");
  assert.equal(formatShopMoney(990, "CZK", '<span class="money">{{amount_with_comma_separator}} Kč</span>', "cs"), "9,90 Kč");
  assert.equal(formatShopMoney(123450, "CZK", null, "cs"), "1 234,50 Kč");
  assert.equal(formatShopMoney(123450, "CZK", "no placeholder", "cs"), "1 234,50 Kč");
  // HTML entities as the page shows them (review fix 8); every placeholder of the format is filled (like the block's money()).
  assert.equal(formatShopMoney(123450, "EUR", "&euro;{{amount_with_comma_separator}}", "cs"), "€1.234,50");
  assert.equal(formatShopMoney(990, "GBP", "&pound;{{amount}}&nbsp;GBP", "en"), "£9.90\u00a0GBP");
  assert.equal(formatShopMoney(990, "CZK", "{{amount}} / {{amount_no_decimals}}", "en"), "9.90 / 10");
});

test("scopeCss: the storefront CSS runs only inside the preview (nested under the scope); @keyframes / @font-face stay top-level", () => {
  const css = `/* c */\n.won-tiers { color: inherit; }\n@media (max-width: 600px) { .won-tiers__list { display: block; } }\n@keyframes won-pulse { from { opacity: 0 } to { opacity: 1 } }\n.won-tiers--chips .won-tiers__row { gap: 4px; }`;
  const out = scopeCss(css, ".won-tiers-preview");
  assert.match(out, /^@keyframes won-pulse \{ from \{ opacity: 0 \} to \{ opacity: 1 \} \}/);
  assert.match(out, /\.won-tiers-preview \{[\s\S]*\.won-tiers \{ color: inherit; \}[\s\S]*@media \(max-width: 600px\)[\s\S]*\.won-tiers--chips \.won-tiers__row/);
  assert.doesNotMatch(out, /\.won-tiers-preview \{[\s\S]*@keyframes/);
  // @layer (review fix 9): a layer BLOCK styles elements → nested under the scope; only an order statement is hoisted.
  const layered = scopeCss(`@layer base, theme;\n@layer theme { .won-tiers__row { padding: 0 } }`, ".s");
  assert.match(layered, /^@layer base, theme;\n\.s \{\n@layer theme \{ \.won-tiers__row \{ padding: 0 \} \}\n\}$/);
  // A closing brace inside a string or a comment does not break the split.
  assert.equal(scopeCss(`.a::after { content: "}"; } /* } */ .b { x: 1 }`, ".s"), `.s {\n.a::after { content: "}"; }\n.b { x: 1 }\n}`);
});
