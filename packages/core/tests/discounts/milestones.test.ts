// Milníky (feedback 6 Oct 2026, bod 9): one ladder of steps by the value of the cart, as a VIEW of what the config
// already stores (milestones.ts). Free shipping and the gift tiers stay in modules.rewards; a discount off the
// whole order is an automatic order rule with the id prefix "ms-" and a minimum subtotal — the checkout function is
// not touched. Amounts are minor units (haléře): 1000_00 = 1 000 Kč.

import assert from "node:assert/strict";
import { test } from "node:test";

import type { CartLineInput } from "../../src/discounts/cart.ts";
import { sanitizeConfig, type WonDiscountsConfig } from "../../src/discounts/config.ts";
import { buildShopFunctionConfig } from "../../src/discounts/function-payload.ts";
import { collapseConfigAmounts, expandConfigAmounts, withUnknownMarketFallback } from "../../src/discounts/market-amounts.ts";
import { isMilestoneRule, MILESTONE_LIMITS, milestoneRule, milestoneSteps, milestonesOverLimit, withMilestones, type MilestoneStep } from "../../src/discounts/milestones.ts";
import { explainGate, gateConfigForPlan } from "../../src/discounts/plan-gate.ts";
import { planCart } from "../../src/discounts/plan.ts";
import { buildStorefrontConfig } from "../../src/discounts/storefront-config.ts";
import { cartOf, code, costLine, FIXTURE_NOW, FIXTURE_TZ, line, orderPct, outcome, payloadOf, pct, type RawRule } from "./engine-fixtures.ts";

const V = (n: number) => `gid://shopify/ProductVariant/${n}`;
const step = (id: string, from: Record<string, number>, value: Record<string, unknown>): RawRule => ({
  id,
  name: "",
  method: "automatic",
  value,
  target: { kind: "order" },
  minimum: { subtotal: from, scope: "cart" },
});
const MS_5 = step("ms-five", { CZK: 1000_00 }, { kind: "percentage", percent: 5 });
const MS_10 = step("ms-ten", { CZK: 2000_00 }, { kind: "percentage", percent: 10 });
const GIFT = { id: "gift-1", threshold: { CZK: 1000_00 }, choices: [V(9001)] };
const giftLine = (unitPrice = 300_00): CartLineInput => ({ ...line("g", unitPrice), variantId: V(9001), giftTierId: "gift-1" });
const orderOf = (plan: ReturnType<typeof planCart>) => plan.order?.components.map((c) => [c.ruleId, c.amount]) ?? [];

// --- The ladder is a view of the stored config ---------------------------------------------------------

/** A config as shops stored it BEFORE Milníky: free shipping, two gift tiers, ordinary discounts. */
const STORED_BEFORE = {
  markets: [
    { handle: "cz", currency: "CZK", enabled: true, countries: ["CZ"] },
    { handle: "sk", currency: "EUR", enabled: true, countries: ["SK"] },
  ],
  modules: {
    codes: { rules: [orderPct("r_summer", 15, { name: "Léto", method: "code", codes: ["LETO"] }), pct("r_tees", 10, { name: "Trička" })] },
    rewards: {
      freeShipping: { threshold: { CZK: 1500_00, EUR: 60_00 } },
      gifts: [
        { id: "gift-a", threshold: { CZK: 1000_00, EUR: 40_00 }, choices: [V(1)], fallbackVariantId: V(2) },
        { id: "gift-b", threshold: { CZK: 3000_00 }, choices: [V(3), V(4), V(5)] },
      ],
      countOtherDiscounts: true,
      giftDeclinable: true,
    },
  },
};

test("stored rewards read as steps, in ladder order, with nothing lost; writing them back gives the same config", () => {
  const { config, issues } = sanitizeConfig(STORED_BEFORE);
  assert.deepEqual(issues, []);
  const steps = milestoneSteps(config);
  assert.deepEqual(
    steps.map((s) => [s.kind, s.id, s.threshold]),
    [
      ["gift", "gift-a", { CZK: 1000_00, EUR: 40_00 }],
      ["shipping", "shipping", { CZK: 1500_00, EUR: 60_00 }],
      ["gift", "gift-b", { CZK: 3000_00 }],
    ],
  );
  assert.deepEqual(steps[0], { kind: "gift", id: "gift-a", threshold: { CZK: 1000_00, EUR: 40_00 }, choices: [V(1)], fallbackVariantId: V(2) });
  assert.deepEqual((steps[2] as Extract<MilestoneStep, { kind: "gift" }>).choices, [V(3), V(4), V(5)]);
  // The round trip: the same stored config, byte for byte (the other discounts and the counting switch included).
  const back = sanitizeConfig(withMilestones(config, steps)).config;
  assert.equal(JSON.stringify(back), JSON.stringify(config));
  // …and it can be undone: taking the steps away again leaves the shop's own discounts as they were.
  assert.deepEqual(withMilestones(config, []).modules.codes.rules, config.modules.codes.rules);
});

test("a discount step is an automatic order rule with the ms- prefix; any other rule stays an ordinary discount", () => {
  const rule = milestoneRule({ id: "ms-a", threshold: { CZK: 1000_00 }, value: { kind: "percentage", percent: 5 } });
  assert.deepEqual(rule, {
    id: "ms-a",
    enabled: true,
    name: "",
    method: "automatic",
    value: { kind: "percentage", percent: 5 },
    target: { kind: "order" },
    minimum: { subtotal: { CZK: 1000_00 }, scope: "cart" },
  });
  assert.equal(isMilestoneRule(rule), true);
  // The sanitizer keeps it exactly (nothing Milníky writes is dropped or renamed on save).
  assert.deepEqual(sanitizeConfig({ modules: { codes: { rules: [rule] } } }).config.modules.codes.rules, [rule]);
  const no = (r: RawRule) => isMilestoneRule(sanitizeConfig({ modules: { codes: { rules: [r] } } }).config.modules.codes.rules[0]!);
  assert.equal(no(orderPct("r_plain", 5)), false, "no prefix");
  assert.equal(no(pct("ms-products", 5)), false, "a product discount");
  assert.equal(no(orderPct("ms-code", 5, code(["X"]))), false, "a code");
  assert.equal(no({ id: "ms-ship", name: "", method: "automatic", value: { kind: "freeShipping" }, target: { kind: "shipping" } }), false, "shipping");
});

test("withMilestones writes free shipping, gifts and discount steps where the checkout already reads them", () => {
  const { config } = sanitizeConfig(STORED_BEFORE);
  const steps: MilestoneStep[] = [
    { kind: "discount", id: "ms-b", threshold: { CZK: 4000_00, EUR: 160_00 }, value: { kind: "fixed", amount: { CZK: 400_00, EUR: 16_00 } } },
    { kind: "gift", id: "gift-a", threshold: { CZK: 2000_00 }, choices: [V(1)] },
    { kind: "discount", id: "ms-a", threshold: { CZK: 1000_00 }, value: { kind: "percentage", percent: 5 } },
  ];
  const next = sanitizeConfig(withMilestones(config, steps)).config;
  assert.equal(next.modules.rewards.freeShipping, undefined, "free shipping is not a step any more");
  assert.equal(next.modules.rewards.countOtherDiscounts, true);
  assert.deepEqual(next.modules.rewards.gifts, [{ id: "gift-a", threshold: { CZK: 2000_00 }, choices: [V(1)] }]);
  assert.deepEqual(next.modules.codes.rules.map((r) => r.id), ["r_summer", "r_tees", "ms-a", "ms-b"]);
  assert.deepEqual(milestoneSteps(next).map((s) => s.id), ["ms-a", "gift-a", "ms-b"]);
});

// --- The checkout: a discount step is an order discount with a minimum ------------------------------------

test("two discount steps (5 % from 1 000 Kč, 10 % from 2 000 Kč): only the higher one applies", () => {
  const payload = payloadOf([MS_5, MS_10]);
  const at = (unitPrice: number) => planCart(cartOf([line("a", unitPrice)]), payload);
  assert.deepEqual(orderOf(at(999_99)), []);
  assert.equal(outcome(at(999_99), "ms-five").state, "below_minimum");
  assert.deepEqual(outcome(at(999_99), "ms-five").missing, { subtotal: 1, minimumSubtotal: 1000_00 });
  assert.deepEqual(orderOf(at(1000_00)), [["ms-five", 50_00]]);
  assert.deepEqual(orderOf(at(1999_99)), [["ms-five", 100_00]]);
  // 2 000 Kč: both steps are reached, the better one wins — never 15 %.
  const both = at(2000_00);
  assert.deepEqual(orderOf(both), [["ms-ten", 200_00]]);
  assert.equal(outcome(both, "ms-five").state, "outranked");
  assert.equal(both.totals.orderDiscount, 200_00);
});

test("a discount step measures the cart exactly as a gift step does: goods before every discount, gift lines left out", () => {
  // The same amount on a gift tier and on a discount step: both are reached by the same carts.
  const payload = payloadOf([MS_5, pct("r_tees", 50)], { modules: { rewards: { gifts: [GIFT] } } });
  const reached = (lines: CartLineInput[]) => {
    const plan = planCart(cartOf(lines), payload);
    return { discount: outcome(plan, "ms-five").state !== "below_minimum", gift: plan.gifts[0]!.state === "earned" };
  };
  // 999,99 Kč of goods and a 300 Kč gift line: the gift's price does not count for either.
  assert.deepEqual(reached([line("a", 999_99), giftLine()]), { discount: false, gift: false });
  assert.deepEqual(reached([line("a", 1000_00), giftLine()]), { discount: true, gift: true });
  // A product discount of 50 % on the line: both still count the price BEFORE it.
  assert.deepEqual(reached([line("a", 1000_00, 1, ["r_tees"]), giftLine()]), { discount: true, gift: true });
  // An outlet line counts toward both (it is what the customer pays)…
  assert.deepEqual(reached([line("a", 400_00), line("o", 600_00, 1, [], { outlet: true }), giftLine()]), { discount: true, gift: true });
});

test("where a discount step differs from a gift: it is taken from the goods after product discounts, and not from outlet lines", () => {
  const payload = payloadOf([MS_10, pct("r_tees", 50)]);
  // 2 000 Kč of goods, half off the tees: the step is reached by 2 000 Kč and gives 10 % of the 1 000 Kč that is left.
  const afterProducts = planCart(cartOf([line("a", 2000_00, 1, ["r_tees"])]), payload);
  assert.deepEqual(orderOf(afterProducts), [["ms-ten", 100_00]]);
  // 1 000 Kč of goods and 1 000 Kč of outlet: reached by 2 000 Kč, the discount comes from the 1 000 Kč of goods only.
  const outlet = planCart(cartOf([line("a", 1000_00), line("o", 1000_00, 1, [], { outlet: true })]), payload);
  assert.deepEqual(orderOf(outlet), [["ms-ten", 100_00]]);
  assert.deepEqual(outlet.order?.excludedLineIds, ["o"]);
  // Only outlet in the cart: nothing to take the discount from.
  assert.equal(outcome(planCart(cartOf([line("o", 2000_00, 1, [], { outlet: true })]), payload), "ms-ten").state, "outlet_only");
});

test("a discount step and a discount code: the better order discount wins, never a sum; a product code adds up by the switch", () => {
  const codeRule = orderPct("r_code", 15, code(["VIP15"], { name: "VIP" }));
  const payload = payloadOf([MS_5, MS_10, codeRule]);
  const cart = (codes: string[]) => cartOf([line("a", 2000_00)], { enteredCodes: codes });
  assert.deepEqual(orderOf(planCart(cart([]), payload)), [["ms-ten", 200_00]]);
  const withCode = planCart(cart(["VIP15"]), payload);
  assert.deepEqual(orderOf(withCode), [["r_code", 300_00]], "the code is better: it replaces the step");
  assert.equal(outcome(withCode, "ms-ten").state, "outranked");
  // A weaker code loses to the step (the customer keeps the better one).
  const weak = payloadOf([MS_10, orderPct("r_code", 3, code(["VIP3"]))]);
  assert.deepEqual(orderOf(planCart(cartOf([line("a", 2000_00)], { enteredCodes: ["VIP3"] }), weak)), [["ms-ten", 200_00]]);
  // A PRODUCT code combines with the step while "product with order" is on (the default), and is exclusive when it is off.
  const productCode = pct("r_pc", 20, code(["TEES20"]));
  const on = planCart(cartOf([line("a", 2000_00, 1, ["r_pc"])], { enteredCodes: ["TEES20"] }), payloadOf([MS_10, productCode]));
  assert.equal(on.totals.productDiscount, 400_00);
  assert.deepEqual(orderOf(on), [["ms-ten", 160_00]]);
  const off = planCart(
    cartOf([line("a", 2000_00, 1, ["r_pc"])], { enteredCodes: ["TEES20"] }),
    payloadOf([MS_10, productCode], { engine: { combination: { productWithOrder: false } } }),
  );
  assert.equal(off.totals.productDiscount, 400_00, "the product code gives more: it wins");
  assert.equal(off.order, null);
  assert.equal(outcome(off, "ms-ten").state, "not_combinable");
});

test("margin protection lowers a discount step, never a gift", () => {
  // Cost 950 Kč, minimum margin 0 %: the 1 000 Kč line may lose 50 Kč at most; the gift line is outside protection.
  const rewards = { gifts: [{ ...GIFT, threshold: { CZK: 2000_00 } }] };
  const payload = payloadOf([MS_10], { modules: { margin: { enabled: true, global: { maxDiscountPercent: 50, minMarginPercent: 0 } }, rewards } });
  const plan = planCart(cartOf([costLine("a", 1000_00, 950), costLine("b", 1000_00, 100), giftLine()]), payload);
  assert.equal(plan.gifts[0]!.state, "earned");
  assert.ok(plan.order, "the step still applies");
  assert.ok(plan.order!.amount < 200_00, `the order discount is lowered (${plan.order!.amount})`);
  assert.equal(plan.order!.marginProtected, true);
  const unprotected = planCart(cartOf([costLine("a", 1000_00, 950), costLine("b", 1000_00, 100), giftLine()]), payloadOf([MS_10], { modules: { rewards } }));
  assert.equal(unprotected.order!.amount, 200_00);
});

test("a step without an amount for the cart's currency is not offered there (MKT-1), whatever its type", () => {
  const fixedStep = step("ms-fix", { CZK: 1000_00, EUR: 40_00 }, { kind: "fixed", amount: { CZK: 100_00 } });
  const payload = payloadOf([MS_5, fixedStep]);
  const eur = planCart(cartOf([line("a", 500_00)], { currency: "EUR" }), payload);
  assert.equal(outcome(eur, "ms-five").state, "currency_missing", "no cart value for EUR");
  assert.equal(outcome(eur, "ms-fix").state, "currency_missing", "no discount amount for EUR");
  assert.equal(eur.order, null);
  const czk = planCart(cartOf([line("a", 1000_00)]), payload);
  assert.deepEqual(orderOf(czk), [["ms-fix", 100_00]], "100 Kč beats 5 % of 1 000 Kč");
});

// --- Limits: Free 2 steps, Pro 6 ------------------------------------------------------------------------

const LADDER = {
  modules: {
    codes: { rules: [orderPct("r_plain", 3, { name: "Vždy" }), MS_5, MS_10] },
    rewards: {
      freeShipping: { threshold: { CZK: 1500_00 } },
      gifts: [{ id: "gift-1", threshold: { CZK: 500_00 }, choices: [V(1), V(2)] }, { id: "gift-2", threshold: { CZK: 3000_00 }, choices: [V(3)] }],
      countOtherDiscounts: false,
    },
  },
};

test("Free runs the first two steps of the ladder, whatever their type; the stored config keeps every step", () => {
  assert.deepEqual(MILESTONE_LIMITS, { free: 2, pro: 6 });
  const { config } = sanitizeConfig(LADDER);
  assert.deepEqual(milestoneSteps(config).map((s) => `${s.kind}:${s.id}`), ["gift:gift-1", "discount:ms-five", "shipping:shipping", "discount:ms-ten", "gift:gift-2"]);
  assert.deepEqual(milestonesOverLimit(config, "pro"), []);
  const before = JSON.stringify(config);
  const { config: free, stripped } = gateConfigForPlan(config, "free");
  assert.equal(JSON.stringify(config), before, "the stored config is untouched (§14a)");
  assert.equal(free.modules.rewards.freeShipping, undefined);
  assert.deepEqual(free.modules.rewards.gifts, [{ id: "gift-1", threshold: { CZK: 500_00 }, choices: [V(1)] }]);
  const enabled = Object.fromEntries(free.modules.codes.rules.map((r) => [r.id, r.enabled]));
  assert.deepEqual(enabled, { r_plain: true, "ms-five": true, "ms-ten": false }, "an ordinary discount is not a step: it stays");
  assert.deepEqual(
    stripped.map((s) => [s.capability, s.reason, s.count, s.removedIds]),
    [
      ["milestone_steps", "reduced", 3, ["shipping", "ms-ten", "gift-2"]],
      ["gift_choices", "reduced", 1, [V(2)]],
    ],
  );
  assert.equal(explainGate(stripped, "cs")[0]!.text, "Ve Free platí první 2 stupně Milníků, další 3 stupně se nenabízejí. V Pro jich platí 6.");
  // What a Free shop's checkout runs: 3 000 Kč gets the 5 % step and the gift, not 10 %, not free shipping.
  const payload = buildShopFunctionConfig(free, { now: FIXTURE_NOW, shopTimezone: FIXTURE_TZ, shopCurrency: "CZK" }).payload;
  const plan = planCart(cartOf([line("a", 3000_00)]), payload);
  assert.equal(plan.shipping, null);
  assert.equal(outcome(plan, "ms-ten").state, "disabled");
  assert.equal(outcome(plan, "ms-five").state, "applied");
  assert.deepEqual(plan.gifts.map((g) => g.tierId), ["gift-1"]);
  // Pro runs all of it.
  const pro = planCart(cartOf([line("a", 3000_00)]), buildShopFunctionConfig(gateConfigForPlan(config, "pro").config, { now: FIXTURE_NOW, shopTimezone: FIXTURE_TZ, shopCurrency: "CZK" }).payload);
  assert.deepEqual(orderOf(pro), [["ms-ten", 300_00]]);
  assert.equal(pro.shipping?.ruleId, "reward:shipping");
});

test("the storefront gets the discount steps the plan runs, in Liquid units, next to shipping and gifts", () => {
  const { config } = sanitizeConfig({
    ...LADDER,
    modules: { ...LADDER.modules, codes: { rules: [...LADDER.modules.codes.rules, step("ms-fix", { CZK: 5000_00, EUR: 200_00 }, { kind: "fixed", amount: { CZK: 500_00, EUR: 20_00 } })] } },
  });
  const sf = (plan: "free" | "pro") => buildStorefrontConfig(gateConfigForPlan(config, plan).config, { configVersion: "v1", variantHandles: { [V(1)]: "gift-one", [V(3)]: "gift-three" } }).rewards!;
  assert.deepEqual(sf("pro").disc, [
    { id: "ms-five", t: { CZK: 1000_00 }, pct: 5 },
    { id: "ms-ten", t: { CZK: 2000_00 }, pct: 10 },
    { id: "ms-fix", t: { CZK: 5000_00, EUR: 200_00 }, off: { CZK: 500_00, EUR: 20_00 } },
  ]);
  assert.deepEqual(sf("pro").ship, { CZK: 1500_00 });
  assert.deepEqual(sf("free").disc, [{ id: "ms-five", t: { CZK: 1000_00 }, pct: 5 }]);
  assert.equal(sf("free").ship, null);
  // Discount steps alone are enough for the storefront to have something to show; ordinary discounts are not steps.
  const only = sanitizeConfig({ modules: { codes: { rules: [MS_5, orderPct("r_plain", 3)] } } }).config;
  assert.deepEqual(buildStorefrontConfig(only, { configVersion: "v1" }).rewards, { ship: null, gifts: [], other: false, disc: [{ id: "ms-five", t: { CZK: 1000_00 }, pct: 5 }] });
  assert.equal(buildStorefrontConfig(sanitizeConfig({ modules: { codes: { rules: [orderPct("r_plain", 3)] } } }).config, { configVersion: "v1" }).rewards, undefined);
});

// --- Amounts per market --------------------------------------------------------------------------------

const TWO_EUR = [
  { handle: "cz", currency: "CZK", enabled: true, countries: ["CZ"] },
  { handle: "sk", currency: "EUR", enabled: true, countries: ["SK"] },
  { handle: "de", currency: "EUR", enabled: true, countries: ["DE"] },
];

test("two markets of one currency: every step has its own amount per market, in the admin's columns and at checkout", () => {
  const stored = sanitizeConfig({
    markets: TWO_EUR,
    modules: {
      codes: { rules: [step("ms-a", { CZK: 1000_00, "EUR@sk": 40_00, "EUR@de": 50_00 }, { kind: "fixed", amount: { CZK: 100_00, "EUR@sk": 4_00, "EUR@de": 5_00 } })] },
      rewards: { freeShipping: { threshold: { CZK: 1500_00, EUR: 60_00 } }, gifts: [{ id: "gift-1", threshold: { CZK: 2000_00, "EUR@sk": 80_00 }, choices: [V(1)] }] },
    },
  }).config;
  // The admin's columns: one key per market.
  const columns = milestoneSteps(expandConfigAmounts(stored));
  assert.deepEqual(columns.map((s) => [s.id, s.threshold]), [
    ["ms-a", { CZK: 1000_00, "EUR@sk": 40_00, "EUR@de": 50_00 }],
    ["shipping", { CZK: 1500_00, "EUR@sk": 60_00, "EUR@de": 60_00 }],
    ["gift-1", { CZK: 2000_00, "EUR@sk": 80_00 }],
  ]);
  // Saved from the columns, it is the stored config again.
  assert.equal(JSON.stringify(collapseConfigAmounts(sanitizeConfig(withMilestones(expandConfigAmounts(stored), columns)).config)), JSON.stringify(stored));
  const payload = buildShopFunctionConfig(stored, { now: FIXTURE_NOW, shopTimezone: FIXTURE_TZ, shopCurrency: "CZK" }).payload;
  const at = (countryCode: string, unitPrice: number) => planCart(cartOf([line("a", unitPrice)], { currency: "EUR", countryCode }), payload);
  assert.deepEqual(orderOf(at("SK", 40_00)), [["ms-a", 4_00]]);
  assert.deepEqual(orderOf(at("DE", 40_00)), [], "Germany's step starts at 50 €");
  assert.deepEqual(orderOf(at("DE", 50_00)), [["ms-a", 5_00]]);
  assert.deepEqual(orderOf(at("FR", 100_00)), [], "a country in no market: nothing, never another market's amount");
});

test("a cart from a country in no market: each step type follows its own kind of amount (lowest or highest)", () => {
  const build = (highest: string[]) =>
    withUnknownMarketFallback(
      collapseConfigAmounts(
        sanitizeConfig({
          markets: TWO_EUR,
          engine: { unknownMarketLowest: true, unknownMarketHighest: highest },
          modules: {
            codes: { rules: [step("ms-a", { CZK: 1000_00, "EUR@sk": 40_00, "EUR@de": 50_00 }, { kind: "fixed", amount: { CZK: 100_00, "EUR@sk": 4_00, "EUR@de": 5_00 } })] },
            rewards: {
              freeShipping: { threshold: { CZK: 1500_00, "EUR@sk": 60_00, "EUR@de": 70_00 } },
              gifts: [{ id: "gift-1", threshold: { CZK: 2000_00, "EUR@sk": 80_00, "EUR@de": 90_00 } , choices: [V(1)] }],
            },
          },
        }).config,
      ),
    );
  const eur = (config: WonDiscountsConfig) => {
    const rule = config.modules.codes.rules[0]!;
    return {
      discount: (rule.value as { amount: Record<string, number> }).amount.EUR,
      minimum: rule.minimum!.subtotal!.EUR,
      shipping: config.modules.rewards.freeShipping!.threshold.EUR,
      gift: config.modules.rewards.gifts[0]!.threshold.EUR,
    };
  };
  assert.deepEqual(eur(build([])), { discount: 4_00, minimum: 40_00, shipping: 60_00, gift: 80_00 });
  // A discount step: its amount is the kind "discount", the cart value it starts at the kind "minimum".
  assert.deepEqual(eur(build(["discount"])), { discount: 5_00, minimum: 40_00, shipping: 60_00, gift: 80_00 });
  assert.deepEqual(eur(build(["minimum"])), { discount: 4_00, minimum: 50_00, shipping: 60_00, gift: 80_00 });
  assert.deepEqual(eur(build(["shipping"])), { discount: 4_00, minimum: 40_00, shipping: 70_00, gift: 80_00 });
  assert.deepEqual(eur(build(["gift"])), { discount: 4_00, minimum: 40_00, shipping: 60_00, gift: 90_00 });
});
