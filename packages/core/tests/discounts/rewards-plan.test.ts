// MVP 4 contracts R1–R4: rewards in planCart. The reward base is the subtotal of
// the non-gift lines BEFORE every discount, in the cart currency (R1). Free
// shipping (R2) is a shipping candidate `reward:shipping` (100 %) once the base
// reaches its threshold in that currency. A gift (R3) is the first line carrying
// `_won_gift = <tierId>` with a variant the tier offers (or its fallback): one
// item free (`fixedTotal` = its price) once the tier is reached. A currency
// without a threshold offers nothing (MKT-1). Progress and warnings (R4) are for
// the storefront and the admin; the function never needs them.
// Amounts are minor units (haléře): 1500_00 = 1 500 Kč.

import assert from "node:assert/strict";
import { test } from "node:test";

import type { CartLineInput } from "../../src/discounts/cart.ts";
import { emitForNode } from "../../src/discounts/emit.ts";
import { explainPlan } from "../../src/discounts/explain.ts";
import { checkoutPreview } from "../../src/discounts/function-output.ts";
import { gateConfigForPlan } from "../../src/discounts/plan-gate.ts";
import { buildShopFunctionConfig } from "../../src/discounts/function-payload.ts";
import { planCart, type CartPlan } from "../../src/discounts/plan.ts";
import {
  cartOf,
  code,
  configOf,
  FIXTURE_NOW,
  FIXTURE_TZ,
  lineOf,
  orderPct,
  payloadOf,
  pct,
  freeShip,
  type RawRule,
} from "./engine-fixtures.ts";

const V = (n: number) => `gid://shopify/ProductVariant/${n}`;
const GIFT_VARIANT = 9001;
const FALLBACK_VARIANT = 9002;

/** A plain line: numeric ids so the variant can be matched like the function does. */
function pl(id: number, unitPrice: number, quantity = 1, extra: Partial<CartLineInput> = {}): CartLineInput {
  return {
    id: `gid://shopify/CartLine/${id}`,
    variantId: V(id),
    productId: `gid://shopify/Product/${id}`,
    quantity,
    unitPrice,
    ruleIds: [],
    ...extra,
  };
}

/** A gift line: the `_won_gift` attribute names the tier. */
function giftLine(id: number, tierId: string, variant = GIFT_VARIANT, unitPrice = 300_00, quantity = 1): CartLineInput {
  return { ...pl(id, unitPrice, quantity), variantId: V(variant), giftTierId: tierId };
}

const GIFT_1 = { id: "gift-1", threshold: { CZK: 1500_00, EUR: 60_00 }, choices: [V(GIFT_VARIANT)], fallbackVariantId: V(FALLBACK_VARIANT) };
const GIFT_2 = { id: "gift-2", threshold: { CZK: 3000_00 }, choices: [V(9003), V(9004), V(9005)] };

function rewardsPayload(rewards: Record<string, unknown>, rules: RawRule[] = [], extra: Record<string, unknown> = {}) {
  const modules = (extra.modules as Record<string, unknown> | undefined) ?? {};
  return payloadOf(rules, { ...extra, modules: { ...modules, rewards: { gifts: [], ...rewards } } });
}

const lineId = (n: number) => `gid://shopify/CartLine/${n}`;
const giftOf = (plan: CartPlan, tierId: string) => plan.gifts.find((g) => g.tierId === tierId);
const warningCodes = (plan: CartPlan) => plan.warnings.map((w) => w.code);

// --- R1: the base ------------------------------------------------------------------------------

test("R1: the reward base = non-gift lines before discounts (a 50 % product rule does not lower it, the gift line is out)", () => {
  const payload = rewardsPayload({ freeShipping: { threshold: { CZK: 1000_00 } } }, [pct("half", 50, { target: { kind: "products" } })]);
  const plan = planCart(
    cartOf([pl(1, 1000_00, 1, { ruleIds: ["half"] }), giftLine(2, "gift-1")]),
    payload,
  );
  assert.equal(lineOf(plan, lineId(1)).product?.amount, 500_00, "the product rule applies");
  assert.deepEqual(plan.progress.freeShipping, { threshold: 1000_00, remaining: 0, reached: true });
  assert.equal(plan.shipping?.ruleId, "reward:shipping", "reached on the base BEFORE discounts");
});

test("R1: outlet lines count toward the threshold (the customer pays them)", () => {
  const payload = rewardsPayload({ freeShipping: { threshold: { CZK: 1000_00 } } });
  const plan = planCart(cartOf([pl(1, 600_00), pl(2, 400_00, 1, { outlet: true })]), payload);
  assert.equal(plan.shipping?.ruleId, "reward:shipping");
});

// --- R2: free shipping -------------------------------------------------------------------------

test("R2: free shipping at exactly the threshold, not one haléř below", () => {
  const payload = rewardsPayload({ freeShipping: { threshold: { CZK: 1000_00 } } });
  const at = planCart(cartOf([pl(1, 1000_00)]), payload);
  assert.deepEqual(at.shipping, {
    ruleId: "reward:shipping",
    method: "automatic",
    ownerRuleId: "reward:shipping",
    ownerMethod: "automatic",
    value: { percent: 100 },
    amount: null,
    message: "Doprava zdarma",
  });
  const below = planCart(cartOf([pl(1, 999_99)]), payload);
  assert.equal(below.shipping, null);
  assert.deepEqual(below.progress.freeShipping, { threshold: 1000_00, remaining: 1, reached: false });
});

test("R2: a currency without a threshold offers nothing and says so (MKT-1)", () => {
  const payload = rewardsPayload({ freeShipping: { threshold: { CZK: 1000_00 } } });
  const plan = planCart(cartOf([pl(1, 5000_00)], { currency: "EUR" }), payload);
  assert.equal(plan.shipping, null);
  assert.equal(plan.progress.freeShipping, undefined);
  assert.deepEqual(plan.warnings, [{ code: "market_missing_threshold", ruleId: "reward:shipping" }]);
});

test("R2: next to a 50 % shipping rule the 100 % reward wins; the rule is outranked", () => {
  const payload = rewardsPayload({ freeShipping: { threshold: { CZK: 1000_00 } } }, [
    { id: "ship50", name: "Ship 50", method: "automatic", value: { kind: "percentage", percent: 50 }, target: { kind: "shipping" } },
  ]);
  const plan = planCart(cartOf([pl(1, 1000_00)]), payload);
  assert.equal(plan.shipping?.ruleId, "reward:shipping");
  assert.equal(plan.rules.find((r) => r.ruleId === "ship50")?.state, "outranked");
});

test("R2: a free-shipping RULE with priority above 0 wins the 100 % tie over the reward", () => {
  const payload = rewardsPayload({ freeShipping: { threshold: { CZK: 1000_00 } } }, [freeShip("fs", { priority: 1 })]);
  const plan = planCart(cartOf([pl(1, 1000_00)]), payload);
  assert.equal(plan.shipping?.ruleId, "fs");
});

test("R2: the Free switch 'product + shipping off' drops the reward like any shipping discount", () => {
  const payload = rewardsPayload({ freeShipping: { threshold: { CZK: 1000_00 } } }, [pct("p10", 10, { target: { kind: "products" } })], {
    engine: { combination: { productWithShipping: false } },
  });
  const plan = planCart(cartOf([pl(1, 1000_00, 1, { ruleIds: ["p10"] })]), payload);
  assert.equal(plan.shipping, null);
  assert.ok(warningCodes(plan).includes("reward_not_combinable"));
});

// --- R3: the gift ------------------------------------------------------------------------------

test("R3: a reached tier makes ONE item of its gift line free (fixedTotal = the item price), outside every other discount", () => {
  const payload = rewardsPayload({ gifts: [GIFT_1] }, [pct("all20", 20, { target: { kind: "products" } }), orderPct("o10", 10)]);
  const plan = planCart(cartOf([pl(1, 1600_00, 1, { ruleIds: ["all20"] }), giftLine(2, "gift-1")]), payload);
  assert.deepEqual(lineOf(plan, lineId(2)).product, {
    components: [{ ruleId: "gift:gift-1", method: "automatic", module: "rewards", amount: 300_00 }],
    amount: 300_00,
    ownerRuleId: "gift:gift-1",
    ownerMethod: "automatic",
    value: { fixedTotal: 300_00 },
    message: "Dárek zdarma",
  });
  assert.equal(lineOf(plan, lineId(2)).excluded, "gift");
  assert.ok(plan.order?.excludedLineIds.includes(lineId(2)), "the gift line stays out of the order discount");
  assert.deepEqual(plan.gifts, [{ tierId: "gift-1", lineId: lineId(2), state: "earned" }]);
  assert.deepEqual(plan.warnings, []);
});

test("R3: below the threshold the gift line is paid and the plan says why", () => {
  const payload = rewardsPayload({ gifts: [GIFT_1] });
  const plan = planCart(cartOf([pl(1, 1499_99), giftLine(2, "gift-1")]), payload);
  assert.equal(lineOf(plan, lineId(2)).product, null);
  assert.deepEqual(giftOf(plan, "gift-1"), { tierId: "gift-1", lineId: lineId(2), state: "below" });
  assert.deepEqual(plan.warnings, [{ code: "gift_not_earned", ruleId: "gift:gift-1" }]);
  assert.deepEqual(plan.progress.gifts, [{ tierId: "gift-1", threshold: 1500_00, remaining: 1, reached: false }]);
});

test("R3: two items of the gift: one is free, the other is paid", () => {
  const payload = rewardsPayload({ gifts: [GIFT_1] });
  const plan = planCart(cartOf([pl(1, 2000_00), giftLine(2, "gift-1", GIFT_VARIANT, 300_00, 2)]), payload);
  assert.equal(lineOf(plan, lineId(2)).product?.amount, 300_00);
  assert.deepEqual(lineOf(plan, lineId(2)).product?.value, { fixedTotal: 300_00 });
  assert.deepEqual(plan.warnings, [{ code: "gift_extra_paid", ruleId: "gift:gift-1" }]);
});

test("R3: only the FIRST gift line of a tier is free", () => {
  const payload = rewardsPayload({ gifts: [GIFT_1] });
  const plan = planCart(cartOf([pl(1, 2000_00), giftLine(2, "gift-1"), giftLine(3, "gift-1", FALLBACK_VARIANT, 250_00)]), payload);
  assert.equal(lineOf(plan, lineId(2)).product?.amount, 300_00);
  assert.equal(lineOf(plan, lineId(3)).product, null);
  assert.deepEqual(plan.warnings, [{ code: "gift_extra_paid", ruleId: "gift:gift-1" }]);
});

test("R3: the fallback variant is a valid gift; a variant the tier does not offer is not", () => {
  const payload = rewardsPayload({ gifts: [GIFT_1] });
  const fallback = planCart(cartOf([pl(1, 2000_00), giftLine(2, "gift-1", FALLBACK_VARIANT, 250_00)]), payload);
  assert.equal(lineOf(fallback, lineId(2)).product?.amount, 250_00);
  const foreign = planCart(cartOf([pl(1, 2000_00), giftLine(2, "gift-1", 7777)]), payload);
  assert.equal(lineOf(foreign, lineId(2)).product, null);
  assert.deepEqual(foreign.warnings, [{ code: "gift_not_earned", ruleId: "gift:gift-1" }]);
  assert.deepEqual(giftOf(foreign, "gift-1"), { tierId: "gift-1", state: "missing" });
});

test("R3: a gift line naming an unknown tier is paid", () => {
  const payload = rewardsPayload({ gifts: [GIFT_1] });
  const plan = planCart(cartOf([pl(1, 2000_00), giftLine(2, "nope")]), payload);
  assert.equal(lineOf(plan, lineId(2)).product, null);
  assert.deepEqual(plan.warnings, [{ code: "gift_not_earned", ruleId: "gift:nope" }]);
});

test("R3: reached without a gift line = missing (the storefront offers it)", () => {
  const payload = rewardsPayload({ gifts: [GIFT_1] });
  const plan = planCart(cartOf([pl(1, 2000_00)]), payload);
  assert.deepEqual(plan.gifts, [{ tierId: "gift-1", state: "missing" }]);
});

test("R3: a ladder — both tiers reached give both gifts; the next tier shows what is missing", () => {
  const payload = rewardsPayload({ gifts: [GIFT_1, GIFT_2] });
  const both = planCart(cartOf([pl(1, 3000_00), giftLine(2, "gift-1"), giftLine(3, "gift-2", 9004, 400_00)]), payload);
  assert.deepEqual(
    both.gifts.map((g) => [g.tierId, g.state]),
    [
      ["gift-1", "earned"],
      ["gift-2", "earned"],
    ],
  );
  assert.equal(lineOf(both, lineId(3)).product?.amount, 400_00);

  const first = planCart(cartOf([pl(1, 2000_00), giftLine(2, "gift-1")]), payload);
  assert.deepEqual(first.progress.gifts, [
    { tierId: "gift-1", threshold: 1500_00, remaining: 0, reached: true },
    { tierId: "gift-2", threshold: 3000_00, remaining: 1000_00, reached: false },
  ]);
});

test("R3: a tier without a threshold in the cart currency is not offered (the gift line is paid)", () => {
  const payload = rewardsPayload({ gifts: [GIFT_2] });
  const plan = planCart(cartOf([pl(1, 9000_00), giftLine(2, "gift-2", 9003)], { currency: "EUR" }), payload);
  assert.equal(lineOf(plan, lineId(2)).product, null);
  assert.deepEqual(giftOf(plan, "gift-2"), { tierId: "gift-2", lineId: lineId(2), state: "not_offered" });
  assert.ok(plan.warnings.some((w) => w.code === "market_missing_threshold" && w.ruleId === "gift:gift-2"));
});

test("R3: margin protection never touches the gift (it is free whatever the cost)", () => {
  const payload = payloadOf([], {
    modules: { margin: { enabled: true, global: { minMarginPercent: 50, maxDiscountPercent: 10 } }, rewards: { gifts: [GIFT_1] } },
  });
  const plan = planCart(cartOf([pl(1, 2000_00), { ...giftLine(2, "gift-1"), unitCost: 250, unitCostCurrency: "CZK" }]), payload);
  assert.equal(lineOf(plan, lineId(2)).product?.amount, 300_00);
  assert.equal(lineOf(plan, lineId(2)).marginCapped, undefined);
});

// --- R4: countOtherDiscounts, warnings --------------------------------------------------------

test("R4: countOtherDiscounts — a code that takes the cart under the threshold warns, the gift stays free (the function counts before discounts)", () => {
  const payload = rewardsPayload({ gifts: [GIFT_1], countOtherDiscounts: true }, [orderPct("o20", 20, code(["SAVE20"]))]);
  const plan = planCart(cartOf([pl(1, 1600_00), giftLine(2, "gift-1")], { enteredCodes: ["SAVE20"] }), payload);
  assert.equal(lineOf(plan, lineId(2)).product?.amount, 300_00, "checkout: before discounts");
  assert.deepEqual(plan.warnings, [{ code: "code_loses_gift", ruleId: "gift:gift-1" }]);
  assert.deepEqual(plan.progress.gifts, [
    { tierId: "gift-1", threshold: 1500_00, remaining: 0, reached: true, afterDiscounts: { remaining: 220_00, reached: false } },
  ]);
});

test("R4: countOtherDiscounts off (default) — the same code warns nothing", () => {
  const payload = rewardsPayload({ gifts: [GIFT_1] }, [orderPct("o20", 20, code(["SAVE20"]))]);
  const plan = planCart(cartOf([pl(1, 1600_00), giftLine(2, "gift-1")], { enteredCodes: ["SAVE20"] }), payload);
  assert.deepEqual(plan.warnings, []);
  assert.equal(plan.progress.gifts?.[0]?.afterDiscounts, undefined);
});

// --- emission ----------------------------------------------------------------------------------

test("emission: the automatic node emits the gift and the shipping reward; a code node emits neither", () => {
  const payload = rewardsPayload({ gifts: [GIFT_1], freeShipping: { threshold: { CZK: 1000_00 } } }, [orderPct("o10", 10, code(["TEN"]))]);
  const plan = planCart(cartOf([pl(1, 2000_00), giftLine(2, "gift-1")], { enteredCodes: ["TEN"] }), payload);
  const auto = emitForNode(plan, { kind: "automatic" }, null);
  assert.deepEqual(auto.productCandidates, [
    { lineId: lineId(2), ruleId: "gift:gift-1", message: "Dárek zdarma", amount: 300_00, fixedTotal: 300_00 },
  ]);
  assert.deepEqual(auto.deliveryCandidates, [{ ruleId: "reward:shipping", message: "Doprava zdarma", amount: null, percent: 100 }]);
  const codeNode = emitForNode(plan, { kind: "code", ruleId: "o10" }, "TEN");
  assert.deepEqual(codeNode.productCandidates, []);
  assert.deepEqual(codeNode.deliveryCandidates, []);
  assert.equal(codeNode.orderCandidates.length, 1);
});

test("emission: English messages", () => {
  const payload = rewardsPayload({ gifts: [GIFT_1], freeShipping: { threshold: { CZK: 1000_00 } } });
  const plan = planCart(cartOf([pl(1, 2000_00), giftLine(2, "gift-1")], { locale: "en" }), payload);
  assert.equal(lineOf(plan, lineId(2)).product?.message, "Free gift");
  assert.equal(plan.shipping?.message, "Free shipping");
});

// --- Free gate ---------------------------------------------------------------------------------

test("Free: only the first tier and its first gift (the fallback stays); Pro keeps the ladder and the choice", () => {
  const config = configOf([], { modules: { rewards: { gifts: [{ ...GIFT_1, choices: [V(GIFT_VARIANT), V(9006)] }, GIFT_2] } } });
  const build = (plan: "free" | "pro") =>
    buildShopFunctionConfig(gateConfigForPlan(config, plan).config, { now: FIXTURE_NOW, shopTimezone: FIXTURE_TZ, shopCurrency: "CZK" }).payload;
  const free = build("free");
  const pro = build("pro");
  const cart = cartOf([pl(1, 5000_00), giftLine(2, "gift-1", 9006), giftLine(3, "gift-2", 9003, 400_00)]);
  const freePlan = planCart(cart, free);
  assert.equal(lineOf(freePlan, lineId(2)).product, null, "Free: the second choice is not a gift");
  assert.equal(lineOf(freePlan, lineId(3)).product, null, "Free: no second tier");
  const proPlan = planCart(cart, pro);
  assert.equal(lineOf(proPlan, lineId(2)).product?.amount, 300_00);
  assert.equal(lineOf(proPlan, lineId(3)).product?.amount, 400_00);
});

// --- tierHint (MVP 3 debt): only when the extra items really get the tier --------------------

test("tierHint: dropped when an exclusive order discount would still win with the extra items", () => {
  const tiers = { sets: [{ id: "g", scope: "global", countAcross: "line", breaks: [{ minQty: 3, percent: 5 }] }] };
  const exclusive = payloadOf([orderPct("o20", 20)], { engine: { combination: { productWithOrder: false } }, modules: { tiers } });
  const plan = planCart(cartOf([pl(1, 100_00, 2)]), exclusive);
  assert.equal(plan.progress.tierHint, undefined);

  const combined = payloadOf([], { modules: { tiers } });
  const hinted = planCart(cartOf([pl(1, 100_00, 2)]), combined);
  assert.equal(hinted.progress.tierHint?.missing, 1);
  assert.equal(hinted.progress.tierHint?.marginCapped, undefined);
});

test("tierHint: margin cuts the next tier → the hint stays but carries marginCapped (no number promised)", () => {
  const tiers = { sets: [{ id: "g", scope: "global", countAcross: "line", breaks: [{ minQty: 3, percent: 30 }] }] };
  const payload = payloadOf([], { modules: { margin: { enabled: true, global: { minMarginPercent: 0, maxDiscountPercent: 10 } }, tiers } });
  const plan = planCart(cartOf([pl(1, 100_00, 2)]), payload);
  assert.equal(plan.progress.tierHint?.missing, 1);
  assert.equal(plan.progress.tierHint?.marginCapped, true);
});

// --- explain (admin "Vyzkoušet košík") ---------------------------------------------------------

const NBSP = "\u00a0";
const texts = (plan: CartPlan, locale: "cs" | "en") => explainPlan(plan, locale).map((i) => `${i.tone}: ${i.text.replaceAll(NBSP, " ")}`);

test("explain: earned gift and free shipping, what is missing, and the paid gift", () => {
  const payload = rewardsPayload({ gifts: [GIFT_1, GIFT_2], freeShipping: { threshold: { CZK: 1000_00 } } });
  const plan = planCart(cartOf([pl(1, 2000_00), giftLine(2, "gift-1"), giftLine(3, "gift-2", 9003, 400_00)]), payload);
  assert.deepEqual(
    texts(plan, "cs").filter((t) => /Dárek|dárk|Doprava/.test(t)),
    [
      "success: Doprava zdarma: nákup od 1 000 Kč.",
      "success: Dárek zdarma: nákup od 1 500 Kč.",
      "info: Do dárku zdarma zbývá 1 000 Kč.",
      "warning: Dárek v košíku se zaplatí: nákup nedosáhl prahu, nebo to není nabízený dárek.",
    ],
  );
  assert.ok(texts(plan, "en").includes("success: Free gift: orders from CZK 1,500."), JSON.stringify(texts(plan, "en")));
});

test("explain: a margin-capped tier hint promises a lower price, not a value", () => {
  const tiers = { sets: [{ id: "g", scope: "global", countAcross: "line", breaks: [{ minQty: 3, percent: 30 }] }] };
  const payload = payloadOf([], { modules: { margin: { enabled: true, global: { minMarginPercent: 0, maxDiscountPercent: 10 } }, tiers } });
  const plan = planCart(cartOf([pl(1, 100_00, 2)]), payload);
  assert.ok(texts(plan, "cs").includes("info: Přidej 1 ks a dostaneš nižší cenu."), JSON.stringify(texts(plan, "cs")));
});

test("checkout preview: the gift line takes exactly one item's price off (1 item → 100 %, 3 items → one item), the shipping reward is emitted", () => {
  const payload = rewardsPayload({ gifts: [GIFT_1], freeShipping: { threshold: { CZK: 1000_00 } } });
  const one = checkoutPreview(planCart(cartOf([pl(1, 2000_00), giftLine(2, "gift-1")]), payload));
  assert.deepEqual(one.lines.find((l) => l.lineId === lineId(2)), { lineId: lineId(2), planned: 300_00, applied: 300_00 });
  const three = checkoutPreview(planCart(cartOf([pl(1, 2000_00), giftLine(2, "gift-1", GIFT_VARIANT, 333_33, 3)]), payload));
  assert.deepEqual(three.lines.find((l) => l.lineId === lineId(2)), { lineId: lineId(2), planned: 333_33, applied: 333_33 });
  assert.equal(three.degraded, false);
});
