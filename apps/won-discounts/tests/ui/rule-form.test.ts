import assert from "node:assert/strict";
import { test } from "node:test";

import type { DiscountRule } from "@won/core/discounts/config";

import {
  FIELD,
  minorToInput,
  parseMoneyInput,
  readRuleForm,
  recipeRule,
  ruleFormDefaults,
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
  assert.deepEqual(rule.minimum, { subtotal: { CZK: 100000 }, quantity: 3 });
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
  assert.deepEqual(kept.rule.minimum, { subtotal: { CZK: 100000, HUF: 1500000 } });

  const dropped = readRuleForm(form([...fixedForm, [FIELD.dropCurrency, "HUF"]]), { ...CTX, existing });
  assert.deepEqual(dropped.rule.value, { kind: "fixed", amount: { CZK: 20000 } });
  assert.deepEqual(dropped.rule.minimum, { subtotal: { CZK: 100000 } });

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
