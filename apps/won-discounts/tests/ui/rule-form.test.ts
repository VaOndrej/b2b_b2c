import assert from "node:assert/strict";
import { test } from "node:test";

import type { DiscountRule } from "@won/core/discounts/config";

import {
  FIELD,
  fieldSection,
  isAutoName,
  minorToInput,
  parseMoneyInput,
  readRuleForm,
  recipeRule,
  ruleFormDefaults,
  ruleVersionToken,
  shopMidnightIso,
  type RuleFormContext,
} from "../../app/components/model/rule-form.ts";

// SEC-1: the rule editor's form is parsed by ONE function on the server (and,
// for the live summary, in the browser). It decides what a submitted form means;
// anything it does not recognise is ignored or reported, never stored.

function form(entries: [string, string][]): FormData {
  const fd = new FormData();
  for (const [k, v] of entries) fd.append(k, v);
  return fd;
}

const CTX: RuleFormContext = {
  id: "r_new",
  currencies: ["CZK", "EUR"],
  timezone: "Europe/Prague",
  pro: false,
  marketHandles: ["cz", "sk"],
  otherRules: [{ id: "r_other", name: "Jiná", codes: ["TAKEN"] }],
};

const base: [string, string][] = [
  [FIELD.name, "Podzimní sleva"],
  [FIELD.enabled, "on"],
  [FIELD.valueKind, "percentage"],
  [FIELD.percent, "15"],
  [FIELD.target, "order"],
  [FIELD.method, "automatic"],
];

const errorsOf = (entries: [string, string][], ctx: RuleFormContext = CTX) =>
  readRuleForm(form(entries), ctx).errors.map((e) => `${e.field}:${e.key}`);

test("a valid percentage rule round-trips; the id comes from the server context, never the form", () => {
  const { rule, errors } = readRuleForm(form([...base, ["id", "evil"], ["shop", "victim.myshopify.com"]]), CTX);
  assert.deepEqual(errors, []);
  assert.deepEqual(rule, {
    id: "r_new",
    enabled: true,
    name: "Podzimní sleva",
    method: "automatic",
    value: { kind: "percentage", percent: 15 },
    target: { kind: "order" },
  });
});

test("percent must be 1–100 like the copy says; decimals with a comma are fine", () => {
  const set = (v: string) => base.map(([k, x]) => [k, k === FIELD.percent ? v : x] as [string, string]);
  assert.deepEqual(errorsOf(set("0")), ["percent:editor.error.percent"]);
  assert.deepEqual(errorsOf(set("0,5")), ["percent:editor.error.percent"]);
  assert.deepEqual(errorsOf(set("100,5")), ["percent:editor.error.percent"]);
  assert.deepEqual(errorsOf(set("1")), []);
  assert.deepEqual(errorsOf(set("100")), []);
  assert.deepEqual(errorsOf(set("150")), ["percent:editor.error.percent"]);
  assert.deepEqual(errorsOf(set("abc")), ["percent:editor.error.percent"]);
  assert.deepEqual(readRuleForm(form(set("12,5")), CTX).rule.value, { kind: "percentage", percent: 12.5 });
});

test("an unknown value kind, target or method is refused, not defaulted silently", () => {
  const swap = (field: string, v: string) => base.map(([k, x]) => [k, k === field ? v : x] as [string, string]);
  assert.deepEqual(errorsOf(swap(FIELD.valueKind, "bogus")), ["valueKind:result.invalid"]);
  assert.deepEqual(errorsOf(swap(FIELD.target, "everything")), ["target:result.invalid"]);
  assert.deepEqual(errorsOf(swap(FIELD.method, "magic")), ["method:result.invalid"]);
});

test("fixed amounts: one field per shop currency, empty = not offered, unknown currencies ignored", () => {
  const entries: [string, string][] = [
    ...base.filter(([k]) => k !== FIELD.valueKind && k !== FIELD.percent),
    [FIELD.valueKind, "fixed"],
    [FIELD.amount("CZK"), "100"],
    [FIELD.amount("EUR"), ""],
    [FIELD.amount("USD"), "5"],
  ];
  const { rule, errors } = readRuleForm(form(entries), CTX);
  assert.deepEqual(errors, []);
  assert.deepEqual(rule.value, { kind: "fixed", amount: { CZK: 10000 } });

  const none = entries.map(([k, v]) => [k, k === FIELD.amount("CZK") ? "" : v] as [string, string]);
  assert.deepEqual(errorsOf(none), ["amount:editor.error.amountNone"]);
  const negative = entries.map(([k, v]) => [k, k === FIELD.amount("CZK") ? "-1" : v] as [string, string]);
  assert.deepEqual(errorsOf(negative), ["amount_CZK:editor.error.amount"]);
});

test("free shipping always targets shipping", () => {
  const entries = base.map(([k, v]) => [k, k === FIELD.valueKind ? "freeShipping" : v] as [string, string]);
  const { rule, errors } = readRuleForm(form(entries), CTX);
  assert.deepEqual(errors, []);
  assert.deepEqual(rule.value, { kind: "freeShipping" });
  assert.deepEqual(rule.target, { kind: "shipping" });
});

test("codes: trimmed, upper-cased, deduplicated; required for a code rule; a code of another rule is refused", () => {
  const code = (codes: string) =>
    [...base.filter(([k]) => k !== FIELD.method), [FIELD.method, "code"], [FIELD.codes, codes]] as [string, string][];
  assert.deepEqual(readRuleForm(form(code(" vip10\nVIP10\n\nleto ")), CTX).rule.codes, ["VIP10", "LETO"]);
  assert.deepEqual(errorsOf(code("")), ["codes:editor.error.codes"]);
  assert.deepEqual(errorsOf(code("taken")), ["codes:editor.error.codeTaken"]);
  assert.deepEqual(errorsOf(code("X".repeat(256))), ["codes:editor.error.codeLength"]);
  // A Won code has at most 64 characters, counted as stored (audit round 6): "ß" × 40 is "SS" × 40.
  assert.deepEqual(errorsOf(code("X".repeat(65))), ["codes:editor.error.codeLength"]);
  assert.deepEqual(errorsOf(code("ß".repeat(40))), ["codes:editor.error.codeLength"]);
  assert.deepEqual(readRuleForm(form(code(` ${"x".repeat(64)} `)), CTX).rule.codes, ["X".repeat(64)]);
  // An automatic rule keeps no codes and no usage limits (Shopify: code discounts only).
  const auto = readRuleForm(form([...base, [FIELD.codes, "IGNORED"], [FIELD.usageLimit, "5"], [FIELD.oncePerCustomer, "on"]]), CTX).rule;
  assert.equal(auto.codes, undefined);
  assert.equal(auto.limits, undefined);
});

test("products / collections: only Shopify GIDs are kept, and at least one is required", () => {
  const withTarget = (target: string, extra: [string, string][]) =>
    [...base.filter(([k]) => k !== FIELD.target), [FIELD.target, target], ...extra] as [string, string][];
  const products = readRuleForm(
    form(withTarget("products", [[FIELD.productIds, "gid://shopify/Product/1"], [FIELD.productIds, "javascript:alert(1)"]])),
    CTX,
  );
  assert.deepEqual(products.errors, []);
  assert.deepEqual(products.rule.target, { kind: "products", productIds: ["gid://shopify/Product/1"], variantIds: [] });
  assert.deepEqual(errorsOf(withTarget("products", [])), ["target:editor.error.products"]);
  assert.deepEqual(errorsOf(withTarget("collections", [])), ["target:editor.error.collections"]);
});

test("minimum per currency and minimum quantity", () => {
  const { rule, errors } = readRuleForm(
    form([...base, [FIELD.minimum("CZK"), "1000"], [FIELD.minimum("EUR"), ""], [FIELD.minQty, "3"]]),
    CTX,
  );
  assert.deepEqual(errors, []);
  assert.deepEqual(rule.minimum, { subtotal: { CZK: 100000 }, quantity: 3, scope: "cart" });
  assert.deepEqual(errorsOf([...base, [FIELD.minQty, "-2"]]), ["minQty:editor.error.minQty"]);
  assert.equal(readRuleForm(form(base), CTX).rule.minimum, undefined);
});

test("schedule: whole days in the shop time zone; the end day is inclusive", () => {
  const { rule, errors } = readRuleForm(form([...base, [FIELD.startDate, "2026-11-01"], [FIELD.endDate, "2026-11-30"]]), CTX);
  assert.deepEqual(errors, []);
  assert.deepEqual(rule.schedule, { startsAt: "2026-11-01T00:00:00+01:00", endsAt: "2026-12-01T00:00:00+01:00" });
  assert.equal(shopMidnightIso("2026-07-01", "Europe/Prague"), "2026-07-01T00:00:00+02:00");
  assert.equal(shopMidnightIso("2026-07-01", null), "2026-07-01T00:00:00Z");
  assert.equal(shopMidnightIso("2026-07-01", "Not/AZone"), "2026-07-01T00:00:00Z");
  assert.deepEqual(errorsOf([...base, [FIELD.startDate, "2026-11-30"], [FIELD.endDate, "2026-11-01"]]), [
    "endDate:editor.error.schedule",
  ]);
  assert.deepEqual(errorsOf([...base, [FIELD.startDate, "2026-02-30"]]), ["startDate:editor.error.date"]);
  // Defaults read the same days back.
  const defaults = ruleFormDefaults(rule, ["CZK"]);
  assert.equal(defaults.startDate, "2026-11-01");
  assert.equal(defaults.endDate, "2026-11-30");
});

test("limits for a code rule", () => {
  const entries: [string, string][] = [
    ...base.filter(([k]) => k !== FIELD.method),
    [FIELD.method, "code"],
    [FIELD.codes, "VIP"],
    [FIELD.usageLimit, "100"],
    [FIELD.oncePerCustomer, "on"],
  ];
  assert.deepEqual(readRuleForm(form(entries), CTX).rule.limits, { usageLimit: 100, oncePerCustomer: true });
  const bad = entries.map(([k, v]) => [k, k === FIELD.usageLimit ? "0" : v] as [string, string]);
  assert.deepEqual(errorsOf(bad), ["usageLimit:editor.error.usage"]);
});

test("BILL-1: without Pro the form cannot set targeting or combinations; stored values are kept (§14a)", () => {
  const existing: DiscountRule = {
    id: "r_new",
    enabled: true,
    name: "x",
    method: "automatic",
    value: { kind: "percentage", percent: 5 },
    target: { kind: "order" },
    targeting: { markets: ["cz"] },
    combinesWith: { ruleIds: ["r_other"] },
    priority: 7,
    origin: { nativeId: "gid://shopify/DiscountCodeNode/1" },
  };
  const proFields: [string, string][] = [
    [FIELD.markets, "sk"],
    [FIELD.combinesWith, "r_other"],
  ];
  const free = readRuleForm(form([...base, ...proFields]), { ...CTX, existing });
  assert.deepEqual(free.rule.targeting, { markets: ["cz"] });
  assert.deepEqual(free.rule.combinesWith, { ruleIds: ["r_other"] });
  assert.equal(free.rule.priority, 7);
  assert.deepEqual(free.rule.origin, { nativeId: "gid://shopify/DiscountCodeNode/1" });

  const pro = readRuleForm(
    form([...base, ...proFields, [FIELD.markets, "unknown-market"], [FIELD.combinesWith, "r_new"], [FIELD.combinesWith, "ghost"]]),
    { ...CTX, existing, pro: true },
  );
  assert.deepEqual(pro.rule.targeting, { markets: ["sk"] });
  assert.deepEqual(pro.rule.combinesWith, { ruleIds: ["r_other"] });
});

test("a name is required and bounded", () => {
  const unnamed = base.map(([k, v]) => [k, k === FIELD.name ? "   " : v] as [string, string]);
  assert.deepEqual(errorsOf(unnamed), ["name:editor.error.name"]);
  const long = base.map(([k, v]) => [k, k === FIELD.name ? "x".repeat(500) : v] as [string, string]);
  assert.equal(readRuleForm(form(long), CTX).rule.name.length, 200);
});

test("recipes pre-fill sensible values per currency; every recipe reads back through the form without errors", () => {
  for (const recipe of ["percentAll", "amountOff", "freeShipping", "welcomeCode", "blank"] as const) {
    const rule = recipeRule(recipe, { id: "r_new", locale: "cs", currencies: ["CZK", "EUR"] });
    const defaults = ruleFormDefaults(rule, ["CZK", "EUR"]);
    const entries: [string, string][] = [];
    for (const [k, v] of Object.entries(defaults.fields)) {
      if (Array.isArray(v)) for (const item of v) entries.push([k, item]);
      else if (v !== false) entries.push([k, v === true ? "on" : v]);
    }
    const parsed = readRuleForm(form(entries), CTX);
    assert.deepEqual(parsed.errors, [], `recipe ${recipe}`);
  }
  const welcome = recipeRule("welcomeCode", { id: "r1", locale: "cs", currencies: ["CZK"] });
  assert.equal(welcome.method, "code");
  assert.deepEqual(welcome.codes, ["VITEJ10"]);
  assert.deepEqual(welcome.limits, { oncePerCustomer: true });
  const amountOff = recipeRule("amountOff", { id: "r1", locale: "en", currencies: ["CZK", "EUR", "HUF"] });
  assert.deepEqual(amountOff.value, { kind: "fixed", amount: { CZK: 10000, EUR: 400 } });
});

test("§14a: stored values in currencies whose market is off are kept, unless removed explicitly", () => {
  const existing: DiscountRule = {
    id: "r_new",
    enabled: true,
    name: "x",
    method: "automatic",
    value: { kind: "fixed", amount: { CZK: 10000, HUF: 300000 } },
    target: { kind: "order" },
    minimum: { subtotal: { CZK: 100000, HUF: 1500000 } },
  };
  const fixedForm: [string, string][] = [
    ...base.filter(([k]) => k !== FIELD.valueKind && k !== FIELD.percent),
    [FIELD.valueKind, "fixed"],
    [FIELD.amount("CZK"), "200"],
    [FIELD.minimum("CZK"), "1000"],
  ];
  const kept = readRuleForm(form(fixedForm), { ...CTX, existing });
  assert.deepEqual(kept.errors, []);
  assert.deepEqual(kept.rule.value, { kind: "fixed", amount: { CZK: 20000, HUF: 300000 } });
  assert.deepEqual(kept.rule.minimum, { subtotal: { CZK: 100000, HUF: 1500000 }, scope: "cart" });

  const dropped = readRuleForm(form([...fixedForm, [FIELD.dropCurrency, "HUF"]]), { ...CTX, existing });
  assert.deepEqual(dropped.rule.value, { kind: "fixed", amount: { CZK: 20000 } });
  assert.deepEqual(dropped.rule.minimum, { subtotal: { CZK: 100000 }, scope: "cart" });

  // The form shows them read-only, never as editable fields that would be lost.
  const defaults = ruleFormDefaults(existing, ["CZK", "EUR"]);
  assert.deepEqual(defaults.outside, [{ currency: "HUF", amount: 300000, minimum: 1500000 }]);
  assert.equal(defaults.fields[FIELD.amount("HUF")], undefined);
});

test("money input: parsed and printed by the engine's converter", () => {
  assert.equal(parseMoneyInput("100", "CZK"), 10000);
  assert.equal(parseMoneyInput("100,5", "CZK"), 10050);
  assert.equal(parseMoneyInput("1 000.25", "EUR"), 100025);
  assert.equal(parseMoneyInput("", "EUR"), null);
  assert.ok(Number.isNaN(parseMoneyInput("-5", "EUR")));
  assert.ok(Number.isNaN(parseMoneyInput("abc", "EUR")));
  assert.equal(parseMoneyInput("500", "JPY"), 500);
  assert.equal(minorToInput(10050, "CZK"), "100.5");
  assert.equal(minorToInput(10000, "CZK"), "100");
  assert.equal(minorToInput(500, "JPY"), "500");
});

// --- F2 item 15 (F1 concerns 3–4) + item 13 --------------------------------------------------------

test("F1 concern 3: the minimum's scope is kept on edit (an old form without the field never resets it), chosen in the form, cart for new rules", () => {
  const collections: [string, string][] = [
    ...base.filter(([k]) => k !== FIELD.target),
    [FIELD.target, "collections"],
    [FIELD.collectionIds, "gid://shopify/Collection/1"],
    [FIELD.minimum("CZK"), "1000"],
  ];
  const existing: DiscountRule = {
    id: "r_new",
    enabled: true,
    name: "Kolekce",
    method: "automatic",
    value: { kind: "percentage", percent: 10 },
    target: { kind: "collections", ids: ["gid://shopify/Collection/1"] },
    minimum: { subtotal: { CZK: 100000 }, scope: "entitled" },
  };
  assert.equal(readRuleForm(form(collections), { ...CTX, existing }).rule.minimum?.scope, "entitled", "kept");
  assert.equal(readRuleForm(form([...collections, [FIELD.minScope, "cart"]]), { ...CTX, existing }).rule.minimum?.scope, "cart", "changed");
  assert.equal(readRuleForm(form([...collections, [FIELD.minScope, "entitled"]]), CTX).rule.minimum?.scope, "entitled", "chosen");
  assert.equal(readRuleForm(form([...collections, [FIELD.minScope, "junk"]]), CTX).rule.minimum?.scope, "cart", "junk → cart");
  assert.equal(readRuleForm(form(collections), CTX).rule.minimum?.scope, "cart", "new rule: cart");
  assert.equal(ruleFormDefaults(existing, ["CZK"]).minScope, "entitled");
  assert.equal(ruleFormDefaults(existing, ["CZK"]).fields[FIELD.minScope], "entitled", "an untouched submit sends it back");
});

test("F1 concern 4: shopMidnightIso is core shopDayStart — Santiago's spring-forward day starts at 01:00, never 23:00 the day before", () => {
  assert.equal(shopMidnightIso("2026-09-06", "America/Santiago"), "2026-09-06T01:00:00-03:00");
  assert.equal(shopMidnightIso("2026-11-01", "Europe/Prague"), "2026-11-01T00:00:00+01:00");
  assert.equal(shopMidnightIso("2026-07-01", "Europe/Prague"), "2026-07-01T00:00:00+02:00");
  assert.equal(shopMidnightIso("2026-07-01", null), "2026-07-01T00:00:00Z");
  assert.equal(shopMidnightIso("2026-07-01", "Not/AZone"), "2026-07-01T00:00:00Z");
  // A schedule starting that Santiago day is read back as that day.
  const rule = readRuleForm(form([...base, [FIELD.startDate, "2026-09-06"]]), { ...CTX, timezone: "America/Santiago" }).rule;
  assert.equal(rule.schedule?.startsAt, "2026-09-06T01:00:00-03:00");
});

test("F12: ruleVersionToken changes with the rule and not with key order", () => {
  const a: DiscountRule = { id: "x", enabled: true, name: "A", method: "automatic", value: { kind: "percentage", percent: 10 }, target: { kind: "order" } };
  const reordered = { target: { kind: "order" }, value: { percent: 10, kind: "percentage" }, method: "automatic", name: "A", enabled: true, id: "x" } as DiscountRule;
  assert.equal(ruleVersionToken(a), ruleVersionToken(reordered));
  assert.notEqual(ruleVersionToken(a), ruleVersionToken({ ...a, value: { kind: "percentage", percent: 11 } }));
  assert.match(ruleVersionToken(a), /^rv[0-9a-f]{8}[0-9a-f]+$/);
});

// --- Wave 6. 10. 2026: B3, B4, B8, B9 and the generated name (P5) ---------------------------------

test("P5: an automatic name is derived by the parser from the settings (never taken from the field) and read back as automatic; a typed name is the merchant's", () => {
  const NBSP = "\u00a0";
  const auto: [string, string][] = [...base.filter(([k]) => k !== FIELD.name), [FIELD.name, "whatever the field held"], [FIELD.nameAuto, "1"]];
  const parsed = readRuleForm(form(auto), CTX);
  assert.deepEqual(parsed.errors, []);
  assert.equal(parsed.rule.name, `15${NBSP}% z objednávky`);
  // The name follows every setting that is part of it.
  const withMinimum = readRuleForm(form([...auto, [FIELD.minimum("CZK"), "1000"], [FIELD.minimum("EUR"), "40"]]), CTX).rule;
  assert.equal(withMinimum.name, `15${NBSP}% z objednávky od 1${NBSP}000${NBSP}Kč / 40${NBSP}€`);
  assert.equal(readRuleForm(form(auto), { ...CTX, locale: "en" }).rule.name, "15% off the order");
  // An empty name field is fine in automatic mode, an error otherwise.
  assert.deepEqual(errorsOf([...base.filter(([k]) => k !== FIELD.name), [FIELD.nameAuto, "1"]]), []);
  assert.deepEqual(errorsOf([...base.filter(([k]) => k !== FIELD.name), [FIELD.nameAuto, "0"]]), ["name:editor.error.name"]);
  // No flag is stored: the stored name equal to the generated one IS automatic after a reload.
  assert.equal(ruleFormDefaults(parsed.rule, ["CZK", "EUR"]).nameAuto, true);
  assert.equal(ruleFormDefaults(parsed.rule, ["CZK", "EUR"]).fields[FIELD.nameAuto], true);
  assert.equal(isAutoName({ ...parsed.rule, name: "Podzimní sleva" }, ["CZK", "EUR"]), false);
  assert.equal(readRuleForm(form(base), CTX).rule.name, "Podzimní sleva", "a typed name is stored as typed");
  // Recipes start automatic, except the welcome code (its name says what the code is for).
  for (const recipe of ["percentAll", "amountOff", "freeShipping", "blank"] as const) {
    const r = recipeRule(recipe, { id: "r", locale: "cs", currencies: ["CZK", "EUR"] });
    assert.ok(r.name.trim().length > 0, recipe);
    assert.equal(ruleFormDefaults(r, ["CZK", "EUR"]).nameAuto, true, recipe);
  }
  assert.equal(recipeRule("freeShipping", { id: "r", locale: "cs", currencies: ["CZK"] }).name, `Doprava zdarma od 1${NBSP}500${NBSP}Kč`);
  const welcome = recipeRule("welcomeCode", { id: "r", locale: "cs", currencies: ["CZK"] });
  assert.equal(welcome.name, "Uvítací sleva");
  assert.equal(ruleFormDefaults(welcome, ["CZK"]).nameAuto, false);
});

test("B3: a stored market that is switched off stays while the form still sends it, and goes when the merchant unticks it", () => {
  const existing: DiscountRule = {
    id: "r_new",
    enabled: true,
    name: "x",
    method: "automatic",
    value: { kind: "percentage", percent: 5 },
    target: { kind: "order" },
    targeting: { markets: ["hu", "cz"] },
  };
  const pro = { ...CTX, pro: true, existing };
  // "hu" is not an enabled market (CTX.marketHandles = cz, sk) but the rule has it stored.
  assert.deepEqual(readRuleForm(form([...base, [FIELD.markets, "hu"], [FIELD.markets, "cz"]]), pro).rule.targeting, { markets: ["hu", "cz"] });
  assert.deepEqual(readRuleForm(form([...base, [FIELD.markets, "cz"]]), pro).rule.targeting, { markets: ["cz"] }, "unticked");
  assert.equal(readRuleForm(form(base), pro).rule.targeting, undefined, "all unticked: no targeting");
  // A switched-off market the rule never had cannot be added through the form.
  assert.deepEqual(readRuleForm(form([...base, [FIELD.markets, "hu"]]), { ...CTX, pro: true }).rule.targeting, undefined);
  assert.deepEqual(ruleFormDefaults(existing, ["CZK"]).markets, ["hu", "cz"]);
});

test("B4: stored variant ids are kept until removed explicitly", () => {
  const products: [string, string][] = [
    ...base.filter(([k]) => k !== FIELD.target),
    [FIELD.target, "products"],
    [FIELD.productIds, "gid://shopify/Product/1"],
    [FIELD.variantIds, "gid://shopify/ProductVariant/9"],
  ];
  assert.deepEqual(readRuleForm(form(products), CTX).rule.target, { kind: "products", productIds: ["gid://shopify/Product/1"], variantIds: ["gid://shopify/ProductVariant/9"] });
  assert.deepEqual(readRuleForm(form([...products, [FIELD.dropVariants, "on"]]), CTX).rule.target, { kind: "products", productIds: ["gid://shopify/Product/1"], variantIds: [] });
  // Only variants stored, removed, nothing else picked: the rule targets nothing and says so.
  const onlyVariants = products.filter(([k]) => k !== FIELD.productIds);
  assert.deepEqual(errorsOf([...onlyVariants, [FIELD.dropVariants, "on"]]), ["target:editor.error.products"]);
});

test("B8: the minimum's scope is read only for a product / collection rule that has a minimum", () => {
  const order: [string, string][] = [...base, [FIELD.minimum("CZK"), "1000"], [FIELD.minimum("EUR"), "40"], [FIELD.minScope, "entitled"]];
  assert.equal(readRuleForm(form(order), CTX).rule.minimum?.scope, "cart", "an order rule: the hidden choice is ignored");
  const existing: DiscountRule = {
    id: "r_new",
    enabled: true,
    name: "x",
    method: "automatic",
    value: { kind: "percentage", percent: 10 },
    target: { kind: "collections", ids: ["gid://shopify/Collection/1"] },
    minimum: { subtotal: { CZK: 100000 }, scope: "entitled" },
  };
  // The target changed to the whole order: the stored "entitled" does not survive either.
  assert.equal(readRuleForm(form(order.filter(([k]) => k !== FIELD.minScope)), { ...CTX, existing }).rule.minimum?.scope, "cart");
  const shipping = order.map(([k, v]) => [k, k === FIELD.valueKind ? "freeShipping" : v] as [string, string]);
  assert.equal(readRuleForm(form(shipping), CTX).rule.minimum?.scope, "cart");
  // No minimum: no scope at all, whatever the field says.
  const collections: [string, string][] = [...base.filter(([k]) => k !== FIELD.target), [FIELD.target, "collections"], [FIELD.collectionIds, "gid://shopify/Collection/1"], [FIELD.minScope, "entitled"]];
  assert.equal(readRuleForm(form(collections), CTX).rule.minimum, undefined);
  assert.equal(readRuleForm(form([...collections, [FIELD.minQty, "3"]]), CTX).rule.minimum?.scope, "entitled");
});

test("B9 + P3: stored segments, and on Free stored markets / combinations, are removed only by their explicit controls", () => {
  const existing: DiscountRule = {
    id: "r_new",
    enabled: true,
    name: "x",
    method: "automatic",
    value: { kind: "percentage", percent: 5 },
    target: { kind: "order" },
    targeting: { segments: ["gid://shopify/Segment/1"], markets: ["cz"] },
    combinesWith: { ruleIds: ["r_other"] },
  };
  const free = { ...CTX, existing };
  assert.deepEqual(readRuleForm(form(base), free).rule.targeting, { segments: ["gid://shopify/Segment/1"], markets: ["cz"] }, "kept");
  assert.deepEqual(readRuleForm(form([...base, [FIELD.dropSegments, "on"]]), free).rule.targeting, { markets: ["cz"] });
  assert.deepEqual(readRuleForm(form([...base, [FIELD.dropMarkets, "on"]]), free).rule.targeting, { segments: ["gid://shopify/Segment/1"] });
  assert.equal(readRuleForm(form([...base, [FIELD.dropSegments, "on"], [FIELD.dropMarkets, "on"]]), free).rule.targeting, undefined);
  assert.deepEqual(readRuleForm(form(base), free).rule.combinesWith, { ruleIds: ["r_other"] });
  assert.equal(readRuleForm(form([...base, [FIELD.dropCombines, "on"]]), free).rule.combinesWith, undefined);
  // Pro: segments stay next to the form's markets until removed; the Free-only drop fields mean nothing.
  const pro = { ...free, pro: true };
  assert.deepEqual(readRuleForm(form([...base, [FIELD.markets, "sk"], [FIELD.dropMarkets, "on"]]), pro).rule.targeting, { segments: ["gid://shopify/Segment/1"], markets: ["sk"] });
  assert.deepEqual(readRuleForm(form([...base, [FIELD.markets, "sk"], [FIELD.dropSegments, "on"]]), pro).rule.targeting, { markets: ["sk"] });
  assert.equal(ruleFormDefaults(existing, ["CZK"]).segments, 1);
});

// --- Bod 8 (plan 2026-10-06): a minimum quantity per selected product / collection (Pro) ----------

test("bod 8: on Pro each selected product / collection may carry its own minimum; an empty field is none, a bad number is an error at that field; a field of an item no longer selected is ignored", () => {
  const P1 = "gid://shopify/Product/1";
  const P2 = "gid://shopify/Product/2";
  const products: [string, string][] = [...base.filter(([k]) => k !== FIELD.target), [FIELD.target, "products"], [FIELD.productIds, P1], [FIELD.productIds, P2]];
  const pro = { ...CTX, pro: true };
  assert.deepEqual(readRuleForm(form([...products, [FIELD.itemMin(P1), "3"], [FIELD.itemMin(P2), ""]]), pro).rule.target, {
    kind: "products",
    productIds: [P1, P2],
    variantIds: [],
    itemMinimums: [{ id: P1, quantity: 3 }],
  });
  // No minimum typed anywhere: the target carries no list at all.
  assert.deepEqual(readRuleForm(form(products), pro).rule.target, { kind: "products", productIds: [P1, P2], variantIds: [] });
  // A field left behind by a removed row never reaches the rule.
  const removed = readRuleForm(form([...products, [FIELD.itemMin("gid://shopify/Product/99"), "5"]]), pro);
  assert.deepEqual(removed.errors, []);
  assert.equal(removed.rule.target.kind === "products" ? removed.rule.target.itemMinimums : "x", undefined);
  for (const bad of ["2.5", "-1", "abc", "10001"]) {
    const parsed = readRuleForm(form([...products, [FIELD.itemMin(P1), bad]]), pro);
    assert.deepEqual(parsed.errors.map((e) => `${e.field}:${e.key}`), [`${FIELD.itemMin(P1)}:editor.error.itemMin`], bad);
  }
  // Collections: the same, keyed by the collection.
  const C1 = "gid://shopify/Collection/7";
  const collections: [string, string][] = [...base.filter(([k]) => k !== FIELD.target), [FIELD.target, "collections"], [FIELD.collectionIds, C1], [FIELD.itemMin(C1), "4"]];
  assert.deepEqual(readRuleForm(form(collections), pro).rule.target, { kind: "collections", ids: [C1], itemMinimums: [{ id: C1, quantity: 4 }] });
  // The defaults read the stored minimums back as field text.
  assert.deepEqual(ruleFormDefaults(readRuleForm(form(collections), pro).rule, ["CZK", "EUR"]).itemMinimums, { [C1]: "4" });
});

test("bod 8: on Free the form cannot write a per-item minimum (BILL-1); stored ones stay for the items still selected until removed explicitly", () => {
  const P1 = "gid://shopify/Product/1";
  const P2 = "gid://shopify/Product/2";
  const products: [string, string][] = [...base.filter(([k]) => k !== FIELD.target), [FIELD.target, "products"], [FIELD.productIds, P1]];
  const free = { ...CTX, pro: false };
  const typed = readRuleForm(form([...products, [FIELD.itemMin(P1), "3"]]), free).rule.target;
  assert.deepEqual(typed, { kind: "products", productIds: [P1], variantIds: [] }, "a typed minimum is ignored on Free");
  const existing: DiscountRule = {
    id: "r_new",
    enabled: true,
    name: "x",
    method: "automatic",
    value: { kind: "percentage", percent: 10 },
    target: { kind: "products", productIds: [P1, P2], variantIds: [], itemMinimums: [{ id: P1, quantity: 3 }, { id: P2, quantity: 4 }] },
  };
  // P2 is no longer selected: its minimum goes with it; P1's stays (§14a).
  assert.deepEqual(readRuleForm(form(products), { ...free, existing }).rule.target, { kind: "products", productIds: [P1], variantIds: [], itemMinimums: [{ id: P1, quantity: 3 }] });
  assert.deepEqual(readRuleForm(form([...products, [FIELD.dropItemMinimums, "on"]]), { ...free, existing }).rule.target, { kind: "products", productIds: [P1], variantIds: [] });
});

// --- Bod 6 (plan 2026-10-06): generated code batches ----------------------------------------------

const seededBytes = () => {
  let x = 7;
  return (n: number) => Uint8Array.from({ length: n }, () => (x = (x * 73 + 41) % 251));
};

test("bod 6: a count in the generator makes a batch on the server (core createCodeBatch) and the rule needs no hand-typed code; the live draft only reports the pending spec", async () => {
  const { createCodeBatch, listBatchCodes, ruleHasCodes } = await import("@won/core/discounts/code-batch");
  const code: [string, string][] = [...base.filter(([k]) => k !== FIELD.method && k !== FIELD.codes), [FIELD.method, "code"], [FIELD.codes, ""]];
  // No code and no generator: the old error.
  assert.deepEqual(errorsOf(code), ["codes:editor.error.codes"]);
  // The editor's draft (no createBatch): no error, the spec comes back as pending.
  const draft = readRuleForm(form([...code, [FIELD.batchCount, "25"]]), CTX);
  assert.deepEqual(draft.errors, []);
  assert.deepEqual(draft.pendingBatch, { count: 25 });
  assert.equal(ruleHasCodes(draft.rule), false, "nothing is generated in the browser");
  // The server: a batch is appended, its codes exist, the seed is in the stored rule only.
  const server = { ...CTX, createBatch: (spec: Parameters<typeof createCodeBatch>[0], existingIds: readonly string[]) => createCodeBatch(spec, { plan: "free" as const, randomBytes: seededBytes(), existingIds }) };
  const saved = readRuleForm(form([...code, [FIELD.batchCount, "25"]]), server);
  assert.deepEqual(saved.errors, []);
  assert.equal(saved.pendingBatch, undefined);
  assert.equal(saved.rule.codeBatches?.length, 1);
  const codes = listBatchCodes(saved.rule.codeBatches![0]!);
  assert.equal(codes.length, 25);
  assert.equal(new Set(codes).size, 25);
  assert.ok(codes.every((c) => /^[A-Z]{4}-[A-Z0-9]{10}$/.test(c) && !/[01OIL]/.test(c.slice(5))), codes.slice(0, 3).join(" "));
  // Free: at most 100, and the pattern fields are never read, whatever the form sends (BILL-1).
  assert.deepEqual(readRuleForm(form([...code, [FIELD.batchCount, "101"]]), server).errors.map((e) => `${e.field}:${e.key}`), ["batchCount:editor.error.batchCount"]);
  const sneaky = readRuleForm(form([...code, [FIELD.batchCount, "5"], [FIELD.batchPrefix, "VIP-"], [FIELD.batchAlphabet, "digits"]]), server);
  assert.deepEqual(sneaky.errors, []);
  assert.ok(!listBatchCodes(sneaky.rule.codeBatches![0]!)[0]!.startsWith("VIP-"));
});

test("bod 6: on Pro the pattern is read (prefix, middle, suffix, length, characters) and a refusal lands on its field; stored batches are kept, a deleted batch or code goes on save", async () => {
  const { createCodeBatch, listBatchCodes } = await import("@won/core/discounts/code-batch");
  const code: [string, string][] = [...base.filter(([k]) => k !== FIELD.method && k !== FIELD.codes), [FIELD.method, "code"], [FIELD.codes, ""]];
  const pro = (existing?: DiscountRule, otherPrefixes: string[] = []) => ({
    ...CTX,
    pro: true,
    ...(existing ? { existing } : {}),
    createBatch: (spec: Parameters<typeof createCodeBatch>[0], existingIds: readonly string[]) => createCodeBatch(spec, { plan: "pro" as const, randomBytes: seededBytes(), existingIds, otherPrefixes }),
  });
  const made = readRuleForm(form([...code, [FIELD.batchCount, "40"], [FIELD.batchPrefix, "bf-"], [FIELD.batchSuffix, "-vip"], [FIELD.batchLength, "14"], [FIELD.batchAlphabet, "digits"]]), pro());
  assert.deepEqual(made.errors, []);
  const first = made.rule.codeBatches![0]!;
  const codes = listBatchCodes(first);
  assert.equal(codes.length, 40);
  assert.ok(codes.every((c) => /^BF-[2-9]{14}-VIP$/.test(c)), codes[0]);
  // Refusals at the field they are about.
  const at = (extra: [string, string][], ctx = pro()) => readRuleForm(form([...code, [FIELD.batchCount, "10"], ...extra]), ctx).errors.map((e) => `${e.field}:${e.key}`);
  assert.deepEqual(at([[FIELD.batchPrefix, "a"]]), ["batchPrefix:editor.error.batchPrefix"]);
  assert.deepEqual(at([[FIELD.batchPrefix, "BF-"]], pro(undefined, ["BF-"])), ["batchPrefix:editor.error.batchPrefixTaken"]);
  assert.deepEqual(at([[FIELD.batchSuffix, "ČŘ"]]), ["batchSuffix:editor.error.batchLiteral"]);
  assert.deepEqual(at([[FIELD.batchLength, "3"]]), ["batchLength:editor.error.batchLength"]);
  // A later save without touching the generator keeps the batch exactly (same seed, same codes).
  const kept = readRuleForm(form(code), pro(made.rule));
  assert.deepEqual(kept.errors, []);
  assert.deepEqual(kept.rule.codeBatches, made.rule.codeBatches);
  // One code deleted, then the whole batch.
  const without = readRuleForm(form([...code, [FIELD.dropBatchCode, `${first.id}|${codes[0]}`]]), pro(made.rule));
  assert.deepEqual(listBatchCodes(without.rule.codeBatches![0]!), codes.slice(1));
  const dropped = readRuleForm(form([...code, [FIELD.dropBatch, first.id]]), pro(made.rule));
  assert.equal(dropped.rule.codeBatches, undefined);
  assert.deepEqual(dropped.errors.map((e) => `${e.field}:${e.key}`), ["codes:editor.error.codes"], "the last codes are gone: the rule says it has none");
  // At most 5 batches a rule.
  const five: DiscountRule = { ...made.rule, codeBatches: Array.from({ length: 5 }, (_, i) => ({ ...first, id: `b${i}` })) };
  assert.deepEqual(readRuleForm(form([...code, [FIELD.batchCount, "10"]]), pro(five)).errors.map((e) => `${e.field}:${e.key}`), ["batchCount:editor.error.batchTooMany"]);
});

// Navigace a stav (8 Oct 2026), bod 5: a refused save marks the section of every field it names.
test("fieldSection: every field of the form sits in one of the editor's five sections", () => {
  for (const field of [FIELD.name, FIELD.valueKind, FIELD.percent, FIELD.amount("EUR"), "amount", FIELD.target, FIELD.itemMin("gid://shopify/Product/1")]) assert.equal(fieldSection(field), "discount", field);
  for (const field of [FIELD.minimum("CZK"), FIELD.minQty, FIELD.minScope]) assert.equal(fieldSection(field), "conditions", field);
  for (const field of [FIELD.method, FIELD.codes, FIELD.usageLimit, FIELD.batchCount, FIELD.batchPrefix, FIELD.batchLength]) assert.equal(fieldSection(field), "codes", field);
  for (const field of [FIELD.startDate, FIELD.endDate]) assert.equal(fieldSection(field), "schedule", field);
  for (const field of [FIELD.markets, FIELD.combinesWith, FIELD.dropMarkets]) assert.equal(fieldSection(field), "pro", field);
  // The version token belongs to the form as a whole: the refusal is said at the top, no section is marked.
  assert.equal(fieldSection(FIELD.ruleVersion), null);
  // Every error the parser can report lands in a section.
  const ctx: RuleFormContext = { id: "new", currencies: ["CZK", "EUR"], timezone: "Europe/Prague", pro: false, existing: null, marketHandles: [], otherRules: [], locale: "cs" };
  const form = new FormData();
  for (const [k, v] of [[FIELD.valueKind, "fixed"], [FIELD.target, "products"], [FIELD.method, "code"], [FIELD.startDate, "x"], [FIELD.minQty, "-1"], [FIELD.usageLimit, "-2"]] as const) form.set(k, v);
  const { errors } = readRuleForm(form, ctx);
  assert.ok(errors.length >= 5, JSON.stringify(errors));
  assert.deepEqual([...new Set(errors.map((e) => fieldSection(e.field)))].sort(), ["codes", "conditions", "discount", "schedule"]);
});
