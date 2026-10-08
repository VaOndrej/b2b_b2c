// Kontrola kombinací (feedback 2026-10-06, bod 16) — the pure part: which carts the app builds from a config,
// that each is planned by planCart itself (one computation, no second set of rules), and what it reports.

import assert from "node:assert/strict";
import { test } from "node:test";

import { sanitizeConfig, type WonDiscountsConfig } from "@won/core/discounts/config";
import { checkoutPreview } from "@won/core/discounts/function-output";
import { buildNodeVars, buildShopFunctionConfig, campaignInputFromVars } from "@won/core/discounts/function-payload";
import { milestoneRule } from "@won/core/discounts/milestones";
import { planCart, type PlanConfig } from "@won/core/discounts/plan";
import { gateConfigForPlan } from "@won/core/discounts/plan-gate";

import { buildScenarios, FINDING_HREF, FINDING_KINDS, findingsOf, runScenario, runScenarios, SCENARIO_LIMIT, scenarioLines, type ScenarioFacts, type ScenarioProduct } from "../../app/lib/integration/combination-check.ts";
import { combinationView, findingLink, scenarioCartOf, scenarioTitle, storedCheck } from "../../app/lib/integration/combination-check.server.ts";
import { planTryCartDetail } from "../../app/lib/integration/try-cart-plan.ts";
import { translator } from "../../app/i18n/index.ts";

function configOf(input: Record<string, unknown>): WonDiscountsConfig {
  const { config, issues } = sanitizeConfig(input);
  assert.deepEqual(issues, []);
  return config;
}

const MARKETS = [
  { handle: "cz", currency: "CZK", enabled: true, countries: ["CZ"] },
  { handle: "sk", currency: "EUR", enabled: true, countries: ["SK"] },
];
const TIERS = { sets: [{ id: "g", scope: "global", countAcross: "product", breaks: [{ minQty: 3, percent: 10 }, { minQty: 5, percent: 20 }] }] };
const CODE = { id: "code", enabled: true, name: "LETO10", method: "code", codes: ["LETO10"], value: { kind: "percentage", percent: 10 }, target: { kind: "order" } };
const ORDER = { id: "order", enabled: true, name: "Sleva 5 %", method: "automatic", value: { kind: "percentage", percent: 5 }, target: { kind: "order" }, minimum: { subtotal: { CZK: 3000_00 } } };
const STEP5 = milestoneRule({ id: "ms-a", threshold: { CZK: 2000_00, EUR: 80_00 }, value: { kind: "percentage", percent: 5 } });
const STEP10 = milestoneRule({ id: "ms-b", threshold: { CZK: 4000_00, EUR: 160_00 }, value: { kind: "percentage", percent: 10 } });
const STEP15 = milestoneRule({ id: "ms-c", threshold: { CZK: 6000_00, EUR: 240_00 }, value: { kind: "percentage", percent: 15 } });
const GIFT = { id: "gift", threshold: { CZK: 1500_00 }, choices: ["gid://shopify/ProductVariant/900"] };

/** An automatic discount on a collection, and a stored product the sync's refs say it aims at. */
const AIMED_RULE = { id: "mikiny", enabled: true, name: "Mikiny −25 %", method: "automatic", value: { kind: "percentage", percent: 25 }, target: { kind: "collections", collectionIds: ["gid://shopify/Collection/7"] }, minimum: { quantity: 4 } };
const AIMED: ScenarioProduct = { variantId: "gid://shopify/ProductVariant/7", productId: "gid://shopify/Product/7", title: "Mikina z kolekce", unitPrice: 800_00, refs: { ruleIds: ["mikiny"], variantRuleIds: {} }, role: "targeted" };

const PRODUCT: ScenarioProduct = { variantId: "gid://shopify/ProductVariant/1", productId: "gid://shopify/Product/1", title: "Mikina", unitPrice: 500_00, role: "any" };
const factsOf = (products: ScenarioProduct[] = [PRODUCT]): ScenarioFacts => ({ products, shopCurrency: "CZK", shopTimezone: "Europe/Prague", date: "2026-10-08", time: "12:00:00", locale: "cs" });
const ids = (config: WonDiscountsConfig, facts = factsOf()) => buildScenarios(config, facts).map((s) => `${s.id}: ${s.parts.join("+")}`);

test("scenarios are built only from what the config runs; nothing runs → none", () => {
  assert.deepEqual(ids(configOf({ markets: MARKETS })), []);
  assert.deepEqual(ids(configOf({ markets: MARKETS, modules: { tiers: TIERS } })), ["tiers: tiers"]);
  assert.deepEqual(ids(configOf({ markets: MARKETS, modules: { codes: { rules: [CODE] } } })), ["code: code"]);
  // A switched-off rule is not a part of any scenario.
  assert.deepEqual(ids(configOf({ markets: MARKETS, modules: { tiers: TIERS, codes: { rules: [{ ...CODE, enabled: false }, { ...ORDER, enabled: false }] } } })), ["tiers: tiers"]);
  const full = configOf({ markets: MARKETS, modules: { tiers: TIERS, codes: { rules: [CODE, ORDER, STEP5, STEP10] }, rewards: { freeShipping: { threshold: { CZK: 1000_00 } }, gifts: [GIFT] } } });
  assert.deepEqual(ids(full), [
    // 3 × 500 Kč reaches the first tier, free shipping and the gift: one cart, one scenario with every part.
    "tiers: tiers+shipping+gift",
    "code: tiers+code+gift",
    "order: tiers+order",
    "steps: tiers+steps",
    "steps-code: steps+code",
    // Slovakia has its own amounts on the ladder: the same ladder there.
    "market-EUR: market+steps",
  ]);
  assert.ok(buildScenarios(full, factsOf()).length <= SCENARIO_LIMIT);
  assert.deepEqual(buildScenarios(full, factsOf()), buildScenarios(full, factsOf()), "the same config and facts give the same scenarios");
});

test("the carts: enough items of the shop's product to reach what the scenario is about; a code scenario enters the code", () => {
  const config = configOf({ markets: MARKETS, modules: { tiers: TIERS, codes: { rules: [CODE, ORDER, STEP5, STEP10] } } });
  const by = new Map(buildScenarios(config, factsOf()).map((s) => [s.id, s]));
  assert.deepEqual(by.get("tiers")!.lines.map((l) => [l.product.title, l.quantity]), [["Mikina", 3]], "the first tier");
  assert.deepEqual(by.get("order")!.lines.map((l) => l.quantity), [6], "3 000 Kč of 500 Kč items");
  assert.deepEqual(by.get("steps")!.lines.map((l) => l.quantity), [8], "the highest step, 4 000 Kč");
  assert.deepEqual([by.get("code")!.codes, by.get("code")!.ruleIds], [["LETO10"], ["code"]]);
  // Another currency: priced with the rate the merchant's own amounts imply (2 000 Kč = 80 €), said as an estimate.
  const sk = by.get("market-EUR")!;
  assert.deepEqual([sk.market.key, sk.market.country, sk.rate], ["EUR", "SK", 0.04]);
  assert.deepEqual(scenarioLines(sk, factsOf()).map((l) => [l.unitPrice, l.quantity]), [[20_00, 8]]);
});

test("the products are the shop's: the lowest margin for the main cart, the one with its own tiers and the one on sale for theirs; none stored → a sample one", () => {
  const VIP = { id: "vip", scope: { productIds: ["gid://shopify/Product/2"] }, countAcross: "product", breaks: [{ minQty: 2, percent: 15 }, { minQty: 6, percent: 25 }] };
  const config = configOf({ markets: MARKETS, modules: { tiers: { sets: [...TIERS.sets, VIP] }, codes: { rules: [CODE] } } });
  const low: ScenarioProduct = { ...PRODUCT, title: "Nízká marže", unitCost: 450, unitCostCurrency: "CZK", role: "lowMargin" };
  const own: ScenarioProduct = { variantId: "gid://shopify/ProductVariant/2", productId: "gid://shopify/Product/2", title: "S výjimkou", unitPrice: 300_00, refs: { ruleIds: [], variantRuleIds: {}, tierRef: "vip" }, role: "exception" };
  const sale: ScenarioProduct = { variantId: "gid://shopify/ProductVariant/3", productId: "gid://shopify/Product/3", title: "Ve výprodeji", unitPrice: 200_00, role: "outlet" };
  const scenarios = buildScenarios(config, factsOf([low, own, sale]));
  assert.deepEqual(scenarios.map((s) => [s.id, s.lines.map((l) => l.product.title)]), [
    ["tiers", ["Nízká marže"]],
    ["code", ["Nízká marže"]],
    ["exception", ["S výjimkou"]],
    ["outlet", ["Ve výprodeji", "Nízká marže"]],
  ]);
  assert.equal(scenarioLines(scenarios[3]!, factsOf())[0]!.outlet, true, "a sale line is outside every discount, as at checkout");
  assert.deepEqual(scenarios[2]!.lines.map((l) => l.quantity), [6], "enough items for the product's own highest tier");
  // On Free the product's own set is inert (the gate): no such scenario. A sale with nothing else running is none either.
  assert.equal(buildScenarios(gateConfigForPlan(config, "free").config, factsOf([low, own, sale])).some((s) => s.id === "exception"), false);
  assert.deepEqual(ids(configOf({ markets: MARKETS }), factsOf([low, own, sale])), []);
  const sample = buildScenarios(config, factsOf([]));
  assert.deepEqual(sample.map((s) => s.lines.map((l) => [l.product.role, l.product.unitPrice])), [[["sample", 500_00]], [["sample", 500_00]]]);
});

test("one computation: every scenario's result is planCart's own, on the payload checkout reads", () => {
  const config = configOf({
    markets: MARKETS,
    modules: { tiers: TIERS, codes: { rules: [CODE, { ...ORDER, minimum: { subtotal: { CZK: 3000_00, EUR: 120_00 } } }, STEP5, STEP10, AIMED_RULE] }, rewards: { freeShipping: { threshold: { CZK: 1000_00 } }, gifts: [] }, margin: { enabled: true, global: { minMarginPercent: 20, maxDiscountPercent: 40 }, perCollection: [] } },
  });
  const facts = factsOf([{ ...PRODUCT, unitCost: 380, unitCostCurrency: "CZK", role: "lowMargin" }, AIMED]);
  const results = runScenarios(config, facts);
  // The scenarios of every kind the check builds, the newer ones too: a product a discount aims at, another market's minimum spend.
  for (const id of ["tiers", "code", "order", "steps", "steps-code", "product", "market-EUR", "market-EUR-order"]) assert.ok(results.some((r) => r.scenario.id === id), id);
  for (const { scenario, detail, findings } of results) {
    const now = `${scenario.date}T${scenario.time}`;
    const encoded = buildShopFunctionConfig(config, { now, shopTimezone: "Europe/Prague", shopCurrency: "CZK" });
    assert.equal(encoded.fits, true);
    const plan = planCart(
      {
        currency: scenario.market.currency,
        countryCode: scenario.market.country ?? undefined,
        lines: scenarioLines(scenario, facts).map((line, i) => ({ id: `L${i + 1}`, variantId: line.variantId, productId: line.productId, quantity: line.quantity, unitPrice: line.unitPrice, ruleIds: [...(scenario.lines[i]!.product.refs?.ruleIds ?? [])], unitCost: line.unitCost, unitCostCurrency: line.unitCostCurrency })),
        enteredCodes: scenario.codes,
        campaign: campaignInputFromVars(buildNodeVars({ kind: "automatic" }, config, now), now),
        today: scenario.date,
        now,
        locale: "cs",
        shopToCartRate: scenario.rate ?? 1,
      },
      JSON.parse(encoded.json) as PlanConfig,
    );
    assert.deepEqual(detail.plan.totals, plan.totals, scenario.id);
    assert.deepEqual(detail.plan.rules.map((r) => [r.ruleId, r.state, r.amount]), plan.rules.map((r) => [r.ruleId, r.state, r.amount]), scenario.id);
    assert.deepEqual(detail.plan.lines.map((l) => l.marginCapped), plan.lines.map((l) => l.marginCapped), scenario.id);
    assert.deepEqual(findings, findingsOf(plan, checkoutPreview(plan, { lineCount: plan.lines.length })), scenario.id);
    // The view the page shows carries the same money.
    assert.equal(detail.view.totals.subtotal, plan.totals.subtotal);
  }
});

const only = (config: WonDiscountsConfig, id: string, facts = factsOf()) => {
  const scenario = buildScenarios(config, facts).find((s) => s.id === id);
  assert.ok(scenario, `scenario ${id} of ${buildScenarios(config, facts).map((s) => s.id).join(", ")}`);
  return runScenario(config, scenario, facts);
};

test("what it reports: margin protection lowered a discount; the discounts passed the highest one allowed; fine when nothing stands in the way", () => {
  const tiersOnly = configOf({ markets: MARKETS, modules: { tiers: TIERS } });
  assert.deepEqual(only(tiersOnly, "tiers").findings, []);
  // A purchase cost close to the price: 10 % off would go under the 20 % margin.
  const margin = configOf({ markets: MARKETS, modules: { tiers: TIERS, margin: { enabled: true, global: { minMarginPercent: 20, maxDiscountPercent: 60 }, perCollection: [] } } });
  const costly = factsOf([{ ...PRODUCT, unitCost: 390, unitCostCurrency: "CZK", role: "lowMargin" }]);
  const lowered = only(margin, "tiers", costly);
  assert.deepEqual(lowered.findings, [{ kind: "margin", cause: { type: "tiers", id: "g" } }], "the discount it lowered: the quantity tier");
  assert.ok(lowered.detail.view.totals.productDiscount < 150_00, "less than the 10 % the tier promises");
  // No purchase cost known: the highest discount allowed (5 %) is the limit, and the tier's 10 % passes it.
  const max = configOf({ markets: MARKETS, modules: { tiers: TIERS, margin: { enabled: true, global: { minMarginPercent: 0, maxDiscountPercent: 5 }, perCollection: [] } } });
  assert.deepEqual(only(max, "tiers").findings, [{ kind: "max", cause: { type: "tiers", id: "g" } }]);
});

test("what it reports: a discount that does not combine with another; a code that costs the gift; a discount step that lost", () => {
  // Product discounts and order discounts switched not to combine: the order discount does not apply next to the tier.
  const apart = configOf({ markets: MARKETS, engine: { combination: { productWithOrder: false } }, modules: { tiers: TIERS, codes: { rules: [ORDER] } } });
  assert.deepEqual(only(apart, "order").findings, [{ kind: "not_combinable", cause: { type: "rule", id: "order" } }]);
  // The gift's amount is measured after discounts: with the code the cart falls under it.
  const gift = configOf({ markets: MARKETS, modules: { codes: { rules: [CODE] }, rewards: { gifts: [GIFT], countOtherDiscounts: true } } });
  assert.deepEqual(only(gift, "gift-code").findings, [{ kind: "code_loses_gift", cause: { type: "step", id: "gift" } }], "the gift step that is lost");
  assert.deepEqual(only(gift, "gift").findings, [], "without the code the gift is earned");
  // Two discount steps reached: only the higher one applies.
  const steps = configOf({ markets: MARKETS, modules: { codes: { rules: [STEP5, STEP10] } } });
  const ladder = only(steps, "steps");
  assert.deepEqual(ladder.findings, [{ kind: "step_superseded", cause: { type: "step", id: "ms-a" } }], "the step that lost");
  assert.deepEqual(ladder.detail.plan.rules.map((r) => [r.ruleId, r.state]), [["ms-a", "outranked"], ["ms-b", "applied"]]);
  // …and a better code beats the step.
  const beaten = configOf({ markets: MARKETS, modules: { codes: { rules: [{ ...CODE, value: { kind: "percentage", percent: 30 } }, STEP5] } } });
  assert.deepEqual(only(beaten, "steps-code").findings, [{ kind: "step_superseded", cause: { type: "step", id: "ms-a" } }]);
});

test("what it reports: checkout shortens the discounts — read off the checkout preview, never computed here", () => {
  const { detail } = only(configOf({ markets: MARKETS, modules: { tiers: TIERS } }), "tiers");
  assert.deepEqual(findingsOf(detail.plan, detail.preview), []);
  assert.deepEqual(findingsOf(detail.plan, { ...detail.preview, degraded: true }), [{ kind: "checkout_cut" }]);
  assert.deepEqual(findingsOf(detail.plan, { ...detail.preview, shortfall: 1 }), [{ kind: "checkout_cut" }]);
  // Every finding has a page to lead to when the plan names no discount.
  for (const kind of FINDING_KINDS) assert.match(FINDING_HREF[kind], /^\/app\/(margin|settings#combination|rewards#steps|discounts)$/);
});

test("checkout really shortens a cart: 400 lines, each lowered by margin protection to its own amount, do not fit what one discount may send — the finding comes from that cart's own preview", () => {
  // Every product has another price and another purchase cost, so margin protection leaves each line a discount
  // of its own: 400 amounts cannot be grouped, and the output passes the checkout's limit.
  const config = configOf({ markets: MARKETS, modules: { tiers: TIERS, margin: { enabled: true, global: { minMarginPercent: 20, maxDiscountPercent: 60 }, perCollection: [] } } });
  const lines = Array.from({ length: 400 }, (_, i) => ({
    variantId: `gid://shopify/ProductVariant/${1000 + i}`,
    productId: `gid://shopify/Product/${1000 + i}`,
    title: `Produkt ${i + 1}`,
    quantity: 3,
    unitPrice: 500_00 + i * 7_00,
    collectionIds: [],
    unitCost: 380 + i * 5.31,
    unitCostCurrency: "CZK",
  }));
  const detail = planTryCartDetail(config, { lines, currency: "CZK", countryCode: "CZ", codes: [], date: "2026-10-08", time: "12:00:00", shopTimezone: "Europe/Prague", locale: "cs", shopCurrency: "CZK", shopToCartRate: 1, productRefs: new Map() });
  assert.equal(detail.plan.lines.filter((line) => line.marginCapped).length, 400, "every line is lowered");
  assert.equal(detail.preview.degraded, true, "the exact plan does not fit");
  assert.ok(detail.preview.nodes[0]!.output.exactBytes > detail.preview.nodes[0]!.output.budget);
  assert.ok(detail.preview.shortfall > 0 || detail.preview.droppedCandidates.length > 0 || detail.preview.relaxedTies.length > 0, "something was given up to fit");
  assert.deepEqual(findingsOf(detail.plan, detail.preview).map((f) => f.kind), ["margin", "checkout_cut"]);
  // The same shop's common cart of one product fits easily: no such finding.
  const small = planTryCartDetail(config, { lines: lines.slice(0, 1), currency: "CZK", countryCode: "CZ", codes: [], date: "2026-10-08", time: "12:00:00", shopTimezone: "Europe/Prague", locale: "cs", shopCurrency: "CZK", shopToCartRate: 1, productRefs: new Map() });
  assert.deepEqual(findingsOf(small.plan, small.preview).map((f) => f.kind), ["margin"]);
});

test("a product a product / collection discount aims at gets its own scenario, planned with the refs the sync wrote — the discount and the tier meet on one line", () => {
  const PRODUCT_RULE = AIMED_RULE;
  const config = configOf({ markets: MARKETS, modules: { tiers: TIERS, codes: { rules: [PRODUCT_RULE] } } });
  const aimed = AIMED;
  assert.deepEqual(ids(config, factsOf([PRODUCT, aimed])), ["tiers: tiers", "product: product+tiers"]);
  const result = only(config, "product", factsOf([PRODUCT, aimed]));
  assert.deepEqual(result.scenario.lines.map((l) => [l.product.title, l.quantity]), [["Mikina z kolekce", 4]], "the discount's own minimum, above the first tier");
  // 25 % from the discount beats the tier's 10 % on the same line: the plan says which one applies.
  assert.deepEqual(result.detail.plan.rules.map((r) => [r.ruleId, r.state]), [["mikiny", "applied"]]);
  assert.equal(result.detail.plan.totals.productDiscount, 800_00);
  assert.equal(scenarioTitle(result.scenario, "cs"), "Sleva na produkt + množstevní sleva");
  // The same computation as checkout: planCart on the payload, with the line's refs.
  const encoded = buildShopFunctionConfig(config, { now: "2026-10-08T12:00:00", shopTimezone: "Europe/Prague", shopCurrency: "CZK" });
  const plan = planCart(
    { currency: "CZK", countryCode: "CZ", lines: [{ id: "L1", variantId: aimed.variantId, productId: aimed.productId, quantity: 4, unitPrice: 800_00, ruleIds: ["mikiny"] }], enteredCodes: [], campaign: campaignInputFromVars(buildNodeVars({ kind: "automatic" }, config, "2026-10-08T12:00:00"), "2026-10-08T12:00:00"), today: "2026-10-08", now: "2026-10-08T12:00:00", locale: "cs", shopToCartRate: 1 },
    JSON.parse(encoded.json) as PlanConfig,
  );
  assert.deepEqual(result.detail.plan.totals, plan.totals);
  assert.deepEqual(result.detail.plan.rules.map((r) => [r.ruleId, r.state, r.amount]), plan.rules.map((r) => [r.ruleId, r.state, r.amount]));
  // No stored product the discount aims at, a switched-off discount, or one the product's refs do not name: no such scenario.
  assert.equal(ids(config, factsOf([PRODUCT])).some((id) => id.startsWith("product")), false);
  assert.equal(ids(configOf({ markets: MARKETS, modules: { tiers: TIERS, codes: { rules: [{ ...PRODUCT_RULE, enabled: false }] } } }), factsOf([PRODUCT, aimed])).some((id) => id.startsWith("product")), false);
  assert.equal(ids(config, factsOf([PRODUCT, { ...aimed, refs: { ruleIds: ["jina"], variantRuleIds: {} } }])).some((id) => id.startsWith("product")), false);
});

test("markets: a scenario runs in every other market where an amount is the market's own — an ordinary discount's minimum spend too, not only the ladder", () => {
  // No ladder at all: the order discount needs 3 000 Kč in Česko and 100 € in Slovensko, the code 1 000 Kč / 50 €.
  const order = { ...ORDER, minimum: { subtotal: { CZK: 3000_00, EUR: 100_00 } } };
  const code = { ...CODE, minimum: { subtotal: { CZK: 1000_00, EUR: 50_00 } } };
  const config = configOf({ markets: MARKETS, modules: { tiers: TIERS, codes: { rules: [code, order] } } });
  assert.deepEqual(ids(config), ["tiers: tiers", "code: tiers+code", "order: tiers+order", "market-EUR-order: market+order", "market-EUR-code: market+code"]);
  const there = only(config, "market-EUR-order");
  // 3 000 Kč = 100 €: a 500 Kč product is about 16,67 € there, and 6 of them reach the 100 € the discount needs.
  assert.deepEqual([there.scenario.market.key, there.scenario.market.country, there.scenario.lines[0]!.quantity], ["EUR", "SK", 6]);
  assert.ok(there.detail.plan.totals.subtotal >= 100_00);
  assert.deepEqual(there.detail.plan.rules.map((r) => [r.ruleId, r.state]).filter(([id]) => id === "order"), [["order", "applied"]]);
  const withCode = only(config, "market-EUR-code");
  assert.deepEqual([withCode.scenario.codes, withCode.scenario.market.key], [["LETO10"], "EUR"]);
  assert.ok(withCode.detail.plan.totals.subtotal >= 50_00);
  // A discount with an amount only in the shop's own market runs in no other one.
  assert.deepEqual(ids(configOf({ markets: MARKETS, modules: { tiers: TIERS, codes: { rules: [ORDER] } } })), ["tiers: tiers", "order: tiers+order"]);
  // With a ladder too: the ladder there and the discount there, each its own cart.
  const both = configOf({ markets: MARKETS, modules: { codes: { rules: [order, STEP5] } } });
  assert.deepEqual(ids(both), ["order: order", "steps: steps", "market-EUR: market+steps", "market-EUR-order: market+order"]);
});

test("a finding's link leads to the discount or the step behind it, by its name — not just to the module's page", () => {
  const tr = translator("cs");
  const config = configOf({
    markets: MARKETS,
    modules: { tiers: { sets: [...TIERS.sets, { id: "vip", scope: { productIds: ["gid://shopify/Product/2"] }, countAcross: "product", breaks: [{ minQty: 2, percent: 15 }] }] }, codes: { rules: [CODE, ORDER, STEP5, STEP10] }, rewards: { freeShipping: { threshold: { CZK: 1000_00 } }, gifts: [GIFT] } },
  });
  const link = (kind: (typeof FINDING_KINDS)[number], cause?: { type: "rule" | "step" | "tiers"; id: string }) => findingLink({ kind, ...(cause ? { cause } : {}) }, config, tr);
  assert.deepEqual(link("not_combinable", { type: "rule", id: "order" }), { href: "/app/discounts/order#combines", label: "Otevřít slevu Sleva 5 %" });
  assert.deepEqual(link("margin", { type: "rule", id: "code" }), { href: "/app/discounts/code", label: "Otevřít slevu LETO10" });
  // The ladder in the page's order: free shipping 1 000 Kč, the gift 1 500 Kč, then the discount steps.
  assert.deepEqual(link("code_loses_gift", { type: "step", id: "gift" }), { href: "/app/rewards#step-2", label: "Otevřít 2. stupeň Milníků" });
  assert.deepEqual(link("step_superseded", { type: "step", id: "ms-a" }), { href: "/app/rewards#step-3", label: "Otevřít 3. stupeň Milníků" });
  assert.deepEqual(link("not_combinable", { type: "step", id: "shipping" }), { href: "/app/rewards#step-1", label: "Otevřít 1. stupeň Milníků" });
  assert.deepEqual(link("margin", { type: "tiers", id: "g" }), { href: "/app/tiers#global", label: "Otevřít množstevní slevy" });
  assert.deepEqual(link("max", { type: "tiers", id: "vip" }), { href: "/app/tiers#pro", label: "Otevřít množstevní slevy" });
  // Nothing named, or a discount that is no longer stored: the module's page.
  assert.deepEqual(link("checkout_cut"), { href: "/app/discounts", label: "Otevřít nastavení" });
  assert.deepEqual(link("margin", { type: "rule", id: "gone" }), { href: "/app/margin", label: "Otevřít nastavení" });
});

test("the ladder's limit per market comes out as at checkout: Free runs the two lowest steps of each market, Pro all", () => {
  const stored = configOf({ markets: MARKETS, modules: { codes: { rules: [STEP5, STEP10, STEP15] } } });
  const applied = (plan: "free" | "pro", id: string) => {
    const gated = gateConfigForPlan(stored, plan, { now: "2026-10-08T12:00:00" }).config;
    const result = only(gated, id);
    return { cart: result.detail.plan.totals.subtotal, rules: result.detail.plan.rules.filter((r) => r.state === "applied").map((r) => r.ruleId) };
  };
  // Pro: the cart reaches the third step and gets it — in Česko and in Slovensko.
  assert.deepEqual(applied("pro", "steps"), { cart: 6000_00, rules: ["ms-c"] });
  assert.deepEqual(applied("pro", "market-EUR"), { cart: 240_00, rules: ["ms-c"] });
  // Free: the third step is past the limit in both markets, the cart is built to the second and gets that one.
  assert.deepEqual(applied("free", "steps"), { cart: 4000_00, rules: ["ms-b"] });
  assert.deepEqual(applied("free", "market-EUR"), { cart: 160_00, rules: ["ms-b"] });
});

test("a campaign is planned at its start, whatever the day is now", () => {
  const config = configOf({
    markets: MARKETS,
    modules: { tiers: TIERS, codes: { rules: [ORDER] } },
    campaigns: [{ id: "bf", name: "Black Friday", window: { start: "2026-11-27T00:00:00", end: "2026-11-30T23:59:00" }, overrides: [{ ruleId: "order", patch: { value: { kind: "percentage", percent: 25 } } }] }],
  });
  const scenario = buildScenarios(config, factsOf()).find((s) => s.id === "campaign-bf")!;
  assert.deepEqual([scenario.date, scenario.time, scenario.campaign, scenario.parts], ["2026-11-27", "00:00:00", "Black Friday", ["campaign", "tiers"]]);
  assert.equal(scenarioTitle(scenario, "cs"), "Kampaň Black Friday v den startu + množstevní sleva");
  // An ended campaign is not a scenario.
  assert.equal(buildScenarios(config, { ...factsOf(), date: "2026-12-05" }).some((s) => s.parts.includes("campaign")), false);
});

test("the page's view: every plan gets the two counts; which scenarios and why only Pro — Free's view carries no scenario at all", () => {
  const config = configOf({ markets: MARKETS, modules: { tiers: TIERS, codes: { rules: [CODE, STEP5, STEP10] } } });
  const results = runScenarios(config, factsOf());
  // What is stored after a sync carries no wording: the same row serves the Czech and the English admin.
  const stored = storedCheck(results, factsOf());
  assert.doesNotMatch(JSON.stringify(stored), /Množstevní|Stupeň|Otevřít|quantity discount/);
  assert.deepEqual(JSON.parse(JSON.stringify(stored)), stored, "plain data: it survives the database");
  const pro = combinationView(stored, { plan: "pro", locale: "cs", marketNames: { sk: "Slovensko" }, config })!;
  const free = combinationView(stored, { plan: "free", locale: "cs", marketNames: { sk: "Slovensko" }, config })!;
  assert.deepEqual(free, { ok: pro.ok, warnings: pro.warnings, sample: false });
  assert.equal(JSON.stringify(free).includes("LETO10"), false);
  assert.equal(pro.ok + pro.warnings, results.length);
  assert.ok(pro.warnings >= 1);
  const steps = pro.scenarios!.find((s) => s.id === "steps")!;
  assert.deepEqual(
    { title: steps.title, market: steps.market, status: steps.status, findings: steps.findings, open: steps.open, estimate: steps.estimate },
    {
      title: "Množstevní sleva + stupeň se slevou",
      market: null,
      status: "warning",
      findings: [{ kind: "step_superseded", text: "Stupeň se slevou z Milníků se neuplatní: přebil ho vyšší stupeň, jiná sleva z objednávky nebo kód.", href: "/app/rewards#step-1", label: "Otevřít 1. stupeň Milníků" }],
      open: "/app/try-cart?scenario=steps",
      estimate: false,
    },
  );
  const sk = pro.scenarios!.find((s) => s.id === "market-EUR")!;
  assert.deepEqual([sk.market, sk.estimate, sk.currency], ["Slovensko", true, "EUR"]);
  assert.equal(pro.scenarios!.find((s) => s.id === "code")!.title, "Množstevní sleva + kód LETO10");
  // A sample product is not the shop's: nothing to open in the manual cart.
  const sample = combinationView(storedCheck(runScenarios(config, factsOf([])), factsOf([])), { plan: "pro", locale: "en", marketNames: {}, config })!;
  assert.equal(sample.sample, true);
  assert.ok(sample.scenarios!.every((s) => s.open === null));
  assert.equal(combinationView({ scenarios: [], sample: false }, { plan: "pro", locale: "cs", marketNames: {}, config }), null);
  // The manual cart of a scenario comes from the same stored row: nothing is planned again to open it.
  assert.deepEqual(scenarioCartOf(stored, "steps-code", "cs"), {
    lines: [{ variantId: PRODUCT.variantId, productId: PRODUCT.productId, title: "Mikina", quantity: 8, unitPrice: { CZK: 500_00 } }],
    ruleIds: ["code"],
    currency: "CZK:cz",
    date: "2026-10-08",
    time: "12:00",
    opened: "Stupeň se slevou + kód LETO10",
  });
  assert.equal(scenarioCartOf(stored, "steps-code", "en")?.opened, "A discount step + code LETO10");
  assert.equal(scenarioCartOf(stored, "nope", "cs"), null);
});

test("the help page says what the check is honest about: when it is calculated, where the products come from, and that the best-selling product is not used", async () => {
  const { readFileSync } = await import("node:fs");
  const page = readFileSync(new URL("../../docs/tasks/try-a-cart.md", import.meta.url), "utf8").replace(/\s+/g, " ");
  assert.match(page, /calculated after you save any discount or setting, and once a day/);
  assert.match(page, /reads a few of your products from Shopify when you save \(at most once a day\)/);
  // Analytics keeps what discounts took off an order, never its products (OrderDiscountFact): there is no best seller to pick.
  assert.match(page, /The best-selling product is not used: the app stores what discounts took off each order, not which products were in it/);
  assert.match(page, /a link that opens the discount or the Milestones step behind it/);
});
