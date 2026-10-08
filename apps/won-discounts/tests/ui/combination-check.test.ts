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
import { combinationView, scenarioTitle } from "../../app/lib/integration/combination-check.server.ts";

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
    modules: { tiers: TIERS, codes: { rules: [CODE, ORDER, STEP5, STEP10] }, rewards: { freeShipping: { threshold: { CZK: 1000_00 } }, gifts: [] }, margin: { enabled: true, global: { minMarginPercent: 20, maxDiscountPercent: 40 }, perCollection: [] } },
  });
  const facts = factsOf([{ ...PRODUCT, unitCost: 380, unitCostCurrency: "CZK", role: "lowMargin" }]);
  const results = runScenarios(config, facts);
  assert.ok(results.length >= 5);
  for (const { scenario, detail, findings } of results) {
    const now = `${scenario.date}T${scenario.time}`;
    const encoded = buildShopFunctionConfig(config, { now, shopTimezone: "Europe/Prague", shopCurrency: "CZK" });
    assert.equal(encoded.fits, true);
    const plan = planCart(
      {
        currency: scenario.market.currency,
        countryCode: scenario.market.country ?? undefined,
        lines: scenarioLines(scenario, facts).map((line, i) => ({ id: `L${i + 1}`, variantId: line.variantId, productId: line.productId, quantity: line.quantity, unitPrice: line.unitPrice, ruleIds: [], unitCost: line.unitCost, unitCostCurrency: line.unitCostCurrency })),
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
  assert.deepEqual(lowered.findings, ["margin"]);
  assert.ok(lowered.detail.view.totals.productDiscount < 150_00, "less than the 10 % the tier promises");
  // No purchase cost known: the highest discount allowed (5 %) is the limit, and the tier's 10 % passes it.
  const max = configOf({ markets: MARKETS, modules: { tiers: TIERS, margin: { enabled: true, global: { minMarginPercent: 0, maxDiscountPercent: 5 }, perCollection: [] } } });
  assert.deepEqual(only(max, "tiers").findings, ["max"]);
});

test("what it reports: a discount that does not combine with another; a code that costs the gift; a discount step that lost", () => {
  // Product discounts and order discounts switched not to combine: the order discount does not apply next to the tier.
  const apart = configOf({ markets: MARKETS, engine: { combination: { productWithOrder: false } }, modules: { tiers: TIERS, codes: { rules: [ORDER] } } });
  assert.deepEqual(only(apart, "order").findings, ["not_combinable"]);
  // The gift's amount is measured after discounts: with the code the cart falls under it.
  const gift = configOf({ markets: MARKETS, modules: { codes: { rules: [CODE] }, rewards: { gifts: [GIFT], countOtherDiscounts: true } } });
  assert.deepEqual(only(gift, "gift-code").findings, ["code_loses_gift"]);
  assert.deepEqual(only(gift, "gift").findings, [], "without the code the gift is earned");
  // Two discount steps reached: only the higher one applies.
  const steps = configOf({ markets: MARKETS, modules: { codes: { rules: [STEP5, STEP10] } } });
  const ladder = only(steps, "steps");
  assert.deepEqual(ladder.findings, ["step_superseded"]);
  assert.deepEqual(ladder.detail.plan.rules.map((r) => [r.ruleId, r.state]), [["ms-a", "outranked"], ["ms-b", "applied"]]);
  // …and a better code beats the step.
  const beaten = configOf({ markets: MARKETS, modules: { codes: { rules: [{ ...CODE, value: { kind: "percentage", percent: 30 } }, STEP5] } } });
  assert.deepEqual(only(beaten, "steps-code").findings, ["step_superseded"]);
});

test("what it reports: checkout shortens the discounts — read off the checkout preview, never computed here", () => {
  const { detail } = only(configOf({ markets: MARKETS, modules: { tiers: TIERS } }), "tiers");
  assert.deepEqual(findingsOf(detail.plan, detail.preview), []);
  assert.deepEqual(findingsOf(detail.plan, { ...detail.preview, degraded: true }), ["checkout_cut"]);
  assert.deepEqual(findingsOf(detail.plan, { ...detail.preview, shortfall: 1 }), ["checkout_cut"]);
  // Every finding leads to the setting behind it.
  for (const kind of FINDING_KINDS) assert.match(FINDING_HREF[kind], /^\/app\/(margin|settings#combination|rewards#steps|discounts)$/);
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
  const pro = combinationView(results, { plan: "pro", locale: "cs", marketNames: { sk: "Slovensko" }, sample: false })!;
  const free = combinationView(results, { plan: "free", locale: "cs", marketNames: { sk: "Slovensko" }, sample: false })!;
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
      findings: [{ kind: "step_superseded", text: "Stupeň se slevou z Milníků se neuplatní: přebil ho vyšší stupeň, jiná sleva z objednávky nebo kód.", href: "/app/rewards#steps" }],
      open: "/app/try-cart?scenario=steps",
      estimate: false,
    },
  );
  const sk = pro.scenarios!.find((s) => s.id === "market-EUR")!;
  assert.deepEqual([sk.market, sk.estimate, sk.currency], ["Slovensko", true, "EUR"]);
  assert.equal(pro.scenarios!.find((s) => s.id === "code")!.title, "Množstevní sleva + kód LETO10");
  // A sample product is not the shop's: nothing to open in the manual cart.
  const sample = combinationView(runScenarios(config, factsOf([])), { plan: "pro", locale: "en", marketNames: {}, sample: true })!;
  assert.equal(sample.sample, true);
  assert.ok(sample.scenarios!.every((s) => s.open === null));
  assert.equal(combinationView([], { plan: "pro", locale: "cs", marketNames: {}, sample: false }), null);
});
