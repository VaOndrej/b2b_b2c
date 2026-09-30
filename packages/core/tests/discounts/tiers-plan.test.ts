// MVP 3 contract K2: quantity tiers in planCart. The set of a line is its
// product metafield's `tierRef`, else the global set (K1). Count: `line` = the
// line's quantity, `product` = the lines of the same product, `cart` = every
// line of the same set — eligible lines only (no outlet, no gift). The tier is
// the highest OFFERED minQty ≤ count; the value per item is a percent or the
// amount in the cart currency (at most the item price). The candidate
// `tier:<setId>` (automatic, priority 0) competes with the product rules: the
// better one wins (ties: priority desc, id asc), never a sum; margin protection
// lowers it like any product discount; the automatic node emits it.
// Amounts are minor units (haléře): 100_00 = 100 Kč; costs are MAJOR units.

import assert from "node:assert/strict";
import { test } from "node:test";

import type { CartLineInput } from "../../src/discounts/cart.ts";
import { emitForNode } from "../../src/discounts/emit.ts";
import { explainPlan } from "../../src/discounts/explain.ts";
import { gateConfigForPlan } from "../../src/discounts/plan-gate.ts";
import { buildShopFunctionConfig } from "../../src/discounts/function-payload.ts";
import { planCart, type CartPlan, type TierOutcome } from "../../src/discounts/plan.ts";
import { cartOf, code, configOf, FIXTURE_NOW, FIXTURE_TZ, lineOf, orderPct, outcome, payloadOf, pct, winners } from "./engine-fixtures.ts";

const NBSP = " ";
const P = (n: number) => `gid://shopify/Product/${n}`;

const GLOBAL = { id: "g", scope: "global", countAcross: "line", breaks: [{ minQty: 3, percent: 10 }, { minQty: 4, percent: 15 }] };

function tiersPayload(sets: unknown[], rules: Record<string, unknown>[] = [], extra: Record<string, unknown> = {}) {
  const modules = (extra.modules as Record<string, unknown> | undefined) ?? {};
  return payloadOf(rules, { ...extra, modules: { ...modules, tiers: { sets } } });
}

/** A line of product `product` (numeric id), `quantity` items at `unitPrice`. */
function pline(id: string, product: number, unitPrice: number, quantity: number, extra: Partial<CartLineInput> = {}): CartLineInput {
  return { id, variantId: `gid://shopify/ProductVariant/${id}`, productId: P(product), quantity, unitPrice, ruleIds: [], ...extra };
}

function tier(plan: CartPlan, setId: string): TierOutcome {
  const found = plan.tiers.find((t) => t.setId === setId);
  if (!found) throw new Error(`no tier outcome for ${setId}`);
  return found;
}

// --- selection and boundaries ------------------------------------------------------------------

test("the tier is the highest minQty ≤ the count: 2 items → none, 3 → 10 %, 4 → 15 %", () => {
  const payload = tiersPayload([GLOBAL]);
  const at = (quantity: number) => planCart(cartOf([pline("L1", 1, 100_00, quantity)]), payload);

  const two = at(2);
  assert.equal(lineOf(two, "L1").product, null);
  assert.equal(tier(two, "g").state, "below_tier");
  assert.deepEqual(tier(two, "g").groups, [
    { lineIds: ["L1"], count: 2, reached: null, next: { minQty: 3, percent: 10, amount: null } },
  ]);

  const three = at(3);
  assert.deepEqual(lineOf(three, "L1").product, {
    components: [{ ruleId: "tier:g", method: "automatic", module: "tiers", amount: 30_00 }],
    amount: 30_00,
    ownerRuleId: "tier:g",
    ownerMethod: "automatic",
    value: { percent: 10 },
    message: `Od 3 ks −10${NBSP}%`,
  });
  assert.deepEqual(
    { ...tier(three, "g"), groups: undefined },
    { setId: "g", ruleId: "tier:g", count: "line", state: "applied", amount: 30_00, lineIds: ["L1"], groups: undefined },
  );

  const four = at(4);
  assert.equal(lineOf(four, "L1").product?.amount, 60_00);
  assert.deepEqual(lineOf(four, "L1").product?.value, { percent: 15 });
  assert.equal(four.totals.productDiscount, 60_00);
  assert.equal(planCart(cartOf([pline("L1", 1, 100_00, 4)], { locale: "en" }), payload).lines[0].product?.message, "From 4 items −15%");
});

// --- the three count modes ---------------------------------------------------------------------

test("count `line`: each line on its own, even two variants of one product", () => {
  const plan = planCart(cartOf([pline("A", 1, 100_00, 2), pline("B", 1, 100_00, 2)]), tiersPayload([GLOBAL]));
  assert.equal(plan.totals.productDiscount, 0);
  assert.deepEqual(tier(plan, "g").groups.map((g) => [g.lineIds, g.count]), [[["A"], 2], [["B"], 2]]);
});

test("count `product`: the variants of one product add up; another product counts apart", () => {
  const plan = planCart(
    cartOf([pline("A", 1, 100_00, 2), pline("C", 2, 80_00, 2), pline("B", 1, 120_00, 2)]),
    tiersPayload([{ ...GLOBAL, countAcross: "product" }]),
  );
  assert.equal(lineOf(plan, "A").product?.amount, 30_00); // 4 items of product 1 → 15 %
  assert.equal(lineOf(plan, "B").product?.amount, 36_00);
  assert.equal(lineOf(plan, "C").product, null); // 2 items of product 2
  assert.deepEqual(tier(plan, "g").groups.map((g) => [g.lineIds, g.count, g.reached?.minQty ?? null]), [
    [["A", "B"], 4, 4],
    [["C"], 2, null],
  ]);
});

test("count `cart`: every line of the SAME set counts together — a product of another set does not", () => {
  const sets = [
    GLOBAL,
    { id: "c", scope: { collectionIds: ["gid://shopify/Collection/1"] }, countAcross: "cart", breaks: [{ minQty: 3, percent: 20 }] },
  ];
  const plan = planCart(
    cartOf([
      pline("A", 1, 100_00, 2, { tierRef: "c" }),
      pline("B", 2, 50_00, 1, { tierRef: "c" }),
      pline("C", 3, 100_00, 2), // the global set: counts alone (2 < 3)
    ]),
    tiersPayload(sets),
  );
  assert.equal(lineOf(plan, "A").product?.amount, 40_00);
  assert.equal(lineOf(plan, "B").product?.amount, 10_00);
  assert.equal(lineOf(plan, "C").product, null);
  assert.deepEqual(tier(plan, "c").groups, [{ lineIds: ["A", "B"], count: 3, reached: { minQty: 3, percent: 20, amount: null }, next: null }]);
  assert.equal(tier(plan, "g").state, "below_tier");
});

test("outlet and gift lines neither count nor get a tier", () => {
  const product = tiersPayload([{ ...GLOBAL, countAcross: "product" }]);
  const plan = planCart(
    cartOf([pline("A", 1, 100_00, 2), pline("O", 1, 100_00, 5, { outlet: true }), pline("G", 1, 100_00, 5, { giftTierId: "gift" })]),
    product,
  );
  assert.equal(plan.totals.productDiscount, 0);
  assert.deepEqual(tier(plan, "g").groups.map((g) => [g.lineIds, g.count]), [[["A"], 2]]);
  const outletOnly = planCart(cartOf([pline("O", 1, 100_00, 5, { outlet: true })]), product);
  assert.equal(tier(outletOnly, "g").state, "outlet_only");
  assert.equal(tier(planCart(cartOf([pline("G", 1, 100_00, 5, { giftTierId: "gift" })]), product), "g").state, "no_target_lines");
});

// --- K1 on the line: tierRef, a missing set, Free ------------------------------------------------

test("a line whose tierRef names a set the payload does not have gets NO tier (never the global one)", () => {
  const plan = planCart(cartOf([pline("A", 1, 100_00, 5, { tierRef: "gone" }), pline("B", 2, 100_00, 5)]), tiersPayload([GLOBAL]));
  assert.equal(lineOf(plan, "A").product, null);
  assert.equal(lineOf(plan, "B").product?.amount, 75_00);
  assert.deepEqual(plan.tiers.map((t) => t.setId), ["g"]);
  assert.deepEqual(tier(plan, "g").lineIds, ["B"]);
});

test("Free: a product of a scoped set gets no tier (its set is inert), the rest the first global set counted per product", () => {
  const config = configOf([], {
    modules: {
      tiers: {
        sets: [
          { id: "pro", scope: { productIds: [P(1)] }, countAcross: "line", breaks: [{ minQty: 2, percent: 50 }] },
          { id: "g", scope: "global", countAcross: "cart", breaks: [{ minQty: 3, percent: 10 }] },
        ],
      },
    },
  });
  const free = buildShopFunctionConfig(gateConfigForPlan(config, "free").config, { now: FIXTURE_NOW, shopTimezone: FIXTURE_TZ }).payload;
  const plan = planCart(
    cartOf([pline("A", 1, 100_00, 4, { tierRef: "pro" }), pline("B", 2, 100_00, 2), pline("C", 3, 100_00, 2)]),
    free,
  );
  assert.equal(lineOf(plan, "A").product, null);
  assert.equal(tier(plan, "pro").state, "disabled");
  // Per product on Free: 2 + 2 items of two products never reach 3 (across the cart they would).
  assert.equal(plan.totals.productDiscount, 0);
  assert.equal(tier(plan, "g").count, "product");
});

// --- value: currencies and the item price ---------------------------------------------------------

const MIXED = {
  id: "m",
  scope: "global",
  countAcross: "line",
  breaks: [
    { minQty: 3, amountOff: { CZK: 20_00, EUR: 1_00 } },
    { minQty: 5, amountOff: { CZK: 50_00 } },
  ],
};

test("an amount break without a value in the cart currency is not offered there (MKT-1): the highest OFFERED one applies", () => {
  const payload = tiersPayload([MIXED]);
  const czk = planCart(cartOf([pline("L1", 1, 100_00, 5)]), payload);
  assert.equal(lineOf(czk, "L1").product?.amount, 250_00);
  assert.deepEqual(lineOf(czk, "L1").product?.value, { fixedPerItem: 50_00 });
  assert.equal(lineOf(czk, "L1").product?.message, `Od 5 ks −50${NBSP}Kč za kus`);
  const eur = planCart(cartOf([pline("L1", 1, 4_00, 5)], { currency: "EUR" }), payload);
  assert.equal(lineOf(eur, "L1").product?.amount, 5_00);
  assert.deepEqual(tier(eur, "m").groups[0].reached, { minQty: 3, percent: null, amount: 1_00 });
  assert.equal(tier(eur, "m").groups[0].next, null, "the 5-item break is not offered in EUR");
  const usd = planCart(cartOf([pline("L1", 1, 4_00, 5)], { currency: "USD" }), payload);
  assert.equal(usd.totals.productDiscount, 0);
  assert.equal(tier(usd, "m").state, "currency_missing");
});

test("an amount off each item is at most the item price", () => {
  const plan = planCart(
    cartOf([pline("L1", 1, 300_00, 2)]),
    tiersPayload([{ id: "g", scope: "global", countAcross: "line", breaks: [{ minQty: 2, amountOff: { CZK: 500_00 } }] }]),
  );
  assert.equal(lineOf(plan, "L1").product?.amount, 600_00);
  assert.deepEqual(lineOf(plan, "L1").product?.value, { fixedPerItem: 300_00 });
});

test("a break worth nothing (0 %) is reached but saves nothing: zero_value", () => {
  const plan = planCart(cartOf([pline("L1", 1, 100_00, 3)]), tiersPayload([{ ...GLOBAL, breaks: [{ minQty: 2, percent: 0 }] }]));
  assert.equal(lineOf(plan, "L1").product, null);
  assert.equal(tier(plan, "g").state, "zero_value");
});

test("a set no line uses: no_target_lines; a set without breaks: disabled", () => {
  const plan = planCart(
    cartOf([pline("L1", 1, 100_00, 3)]),
    tiersPayload([GLOBAL, { id: "s", scope: { productIds: [P(9)] }, countAcross: "line", breaks: [] }, { id: "t", scope: { productIds: [P(8)] }, countAcross: "line", breaks: [{ minQty: 2, percent: 5 }] }]),
  );
  assert.deepEqual(plan.tiers.map((t) => [t.setId, t.state]), [["g", "applied"], ["s", "disabled"], ["t", "no_target_lines"]]);
});

// --- tier vs product rules (A1) ------------------------------------------------------------------

test("tier vs a product rule on one line: the better one wins, never a sum", () => {
  const cart = cartOf([pline("L1", 1, 100_00, 3, { ruleIds: ["r"] })]);
  const ruleBetter = planCart(cart, tiersPayload([GLOBAL], [pct("r", 12)]));
  assert.deepEqual(winners(ruleBetter, "L1"), ["r"]);
  assert.equal(lineOf(ruleBetter, "L1").product?.amount, 36_00);
  assert.equal(tier(ruleBetter, "g").state, "outranked");
  assert.deepEqual(tier(ruleBetter, "g").betterRuleIds, ["r"]);
  const tierBetter = planCart(cart, tiersPayload([GLOBAL], [pct("r", 8)]));
  assert.deepEqual(winners(tierBetter, "L1"), ["tier:g"]);
  assert.equal(outcome(tierBetter, "r").state, "outranked");
  assert.deepEqual(outcome(tierBetter, "r").betterRuleIds, ["tier:g"]);
  // A Pro stack of rules competes as one discount: 5 % + 6 % beats the 10 % tier, 5 % + 5 % does not.
  const stack = (b: number) =>
    planCart(
      cartOf([pline("L1", 1, 100_00, 3, { ruleIds: ["a", "b"] })]),
      tiersPayload([GLOBAL], [pct("a", 5, { combinesWith: { ruleIds: ["b"] } }), pct("b", b)]),
    );
  assert.deepEqual(winners(stack(6), "L1"), ["b", "a"]);
  assert.deepEqual(winners(stack(5), "L1"), ["tier:g"]);
});

test("a tie between a tier and a rule is stable: priority desc, then id asc (`tier:<set>` sorts as a string)", () => {
  const at = (ruleId: string, priority?: number) =>
    winners(planCart(cartOf([pline("L1", 1, 100_00, 3, { ruleIds: [ruleId] })]), tiersPayload([GLOBAL], [pct(ruleId, 10, priority ? { priority } : {})])), "L1");
  assert.deepEqual(at("a"), ["a"], '"a" < "tier:g"');
  assert.deepEqual(at("z"), ["tier:g"], '"tier:g" < "z"');
  assert.deepEqual(at("z", 1), ["z"], "a higher priority wins the tie");
});

test("the automatic node emits a tier, a code node never does; a code rule it beats emits nothing", () => {
  const plan = planCart(
    cartOf([pline("L1", 1, 100_00, 4, { ruleIds: ["c"] })], { enteredCodes: ["SLEVA"] }),
    tiersPayload([GLOBAL], [pct("c", 5, code(["SLEVA"]))]),
  );
  assert.deepEqual(emitForNode(plan, { kind: "automatic" }, null).productCandidates, [
    { lineId: "L1", ruleId: "tier:g", message: `Od 4 ks −15${NBSP}%`, amount: 60_00, percent: 15 },
  ]);
  assert.deepEqual(emitForNode(plan, { kind: "code", ruleId: "c" }, "SLEVA").productCandidates, []);
  assert.equal(outcome(plan, "c").state, "outranked");
});

test("Free exclusive switch (product vs order): when the order discount wins, the tier is not combinable", () => {
  const plan = planCart(
    cartOf([pline("L1", 1, 100_00, 3)]),
    tiersPayload([GLOBAL], [orderPct("o", 20)], { engine: { combination: { productWithOrder: false } } }),
  );
  assert.equal(plan.order?.amount, 60_00);
  assert.equal(lineOf(plan, "L1").product, null);
  assert.equal(tier(plan, "g").state, "not_combinable");
});

test("a campaign never changes a tier (campaign overrides of tier sets come in MVP 6)", () => {
  const extra = {
    campaigns: [
      {
        id: "bf",
        name: "BF",
        window: { start: "2026-09-01T00:00:00", end: "2026-12-31T23:59:59" },
        overrides: [{ ruleId: "g", patch: { breaks: [{ minQty: 1, percent: 90 }] } }],
      },
    ],
  };
  const payload = tiersPayload([GLOBAL], [], extra);
  assert.equal(payload.campaignId, "bf");
  const plan = planCart(
    cartOf([pline("L1", 1, 100_00, 3)], { campaign: { id: "bf", active: true, varsVersion: payload.campaignVarsVersion } }),
    payload,
  );
  assert.equal(plan.campaignId, "bf");
  assert.equal(lineOf(plan, "L1").product?.amount, 30_00);
});

// --- margin protection ---------------------------------------------------------------------------

test("margin protection lowers a tier like any product discount (exact amount, same message)", () => {
  const margin = { enabled: true, global: { maxDiscountPercent: 50 }, perCollection: [] };
  const payload = tiersPayload([{ ...GLOBAL, breaks: [{ minQty: 3, percent: 20 }] }], [], { modules: { margin } });
  // Cost 85 Kč of 100 Kč, no minimum margin: at most 15 Kč off an item.
  const plan = planCart(cartOf([pline("L1", 1, 100_00, 3, { unitCost: 85, unitCostCurrency: "CZK" })]), payload);
  const l1 = lineOf(plan, "L1");
  assert.equal(l1.product?.amount, 45_00);
  assert.deepEqual(l1.product?.value, { fixedTotal: 45_00 });
  assert.equal(l1.product?.message, `Od 3 ks −20${NBSP}%`);
  assert.deepEqual(l1.product?.components, [{ ruleId: "tier:g", method: "automatic", module: "tiers", amount: 45_00 }]);
  assert.deepEqual([l1.marginCapped?.before, l1.marginCapped?.after], [60_00, 45_00]);
  assert.equal(tier(plan, "g").state, "applied");
  // At its floor: nothing left, margin_floor.
  const floored = planCart(cartOf([pline("L1", 1, 100_00, 3, { unitCost: 100, unitCostCurrency: "CZK" })]), payload);
  assert.equal(lineOf(floored, "L1").product, null);
  assert.equal(tier(floored, "g").state, "margin_floor");
});

// --- progress.tierHint (MVP 4 slot) --------------------------------------------------------------

test("progress.tierHint: the closest next break that would beat what the line already gets", () => {
  const payload = tiersPayload([GLOBAL]);
  assert.deepEqual(planCart(cartOf([pline("L1", 1, 100_00, 2)]), payload).progress.tierHint, {
    setId: "g",
    lineIds: ["L1"],
    count: 2,
    missing: 1,
    next: { minQty: 3, percent: 10, amount: null },
  });
  assert.equal(planCart(cartOf([pline("L1", 1, 100_00, 3)]), payload).progress.tierHint?.next.minQty, 4);
  assert.equal(planCart(cartOf([pline("L1", 1, 100_00, 4)]), payload).progress.tierHint, undefined, "no break above 4");
  // The closest wins (1 item missing on B, 2 on A).
  const two = planCart(cartOf([pline("A", 1, 100_00, 1), pline("B", 2, 100_00, 3)]), payload);
  assert.deepEqual([two.progress.tierHint?.lineIds, two.progress.tierHint?.missing], [["B"], 1]);
  // A rule already giving 20 % is not beaten by 10 % or 15 %: no hint.
  const rule = planCart(cartOf([pline("L1", 1, 100_00, 2, { ruleIds: ["r"] })]), tiersPayload([GLOBAL], [pct("r", 20)]));
  assert.equal(rule.progress.tierHint, undefined);
  // No tiers at all: the slot stays empty.
  assert.deepEqual(planCart(cartOf([pline("L1", 1, 100_00, 2)]), payloadOf([])).progress, {});
});

// --- explain --------------------------------------------------------------------------------------

test("explain: the tier in words (cs/en) — what it saves, what one more item gives, why it does not apply", () => {
  const payload = tiersPayload([GLOBAL]);
  const applied = planCart(cartOf([pline("L1", 1, 100_00, 3)]), payload);
  assert.deepEqual(explainPlan(applied, "cs"), [
    { tone: "success", text: `Množstevní sleva (od 3 ks −10${NBSP}%) ušetří 30${NBSP}Kč na 1 položce.`, tierSetId: "g", lineIds: ["L1"] },
    { tone: "info", text: `Přidej 1 ks a dostaneš −15${NBSP}%.`, tierSetId: "g", lineIds: ["L1"] },
  ]);
  assert.deepEqual(
    explainPlan(applied, "en").map((i) => i.text),
    ["The quantity discount (from 3 items −10%) saves CZK 30 on 1 item.", "Add 1 more item to get −15%."],
  );
  const outranked = planCart(cartOf([pline("L1", 1, 100_00, 4, { ruleIds: ["r"] })]), tiersPayload([GLOBAL], [pct("r", 20)]));
  assert.ok(explainPlan(outranked, "cs").some((i) => i.text === "Množstevní sleva se neuplatní: výhodnější je „Rule r“."));
  const beaten = planCart(cartOf([pline("L1", 1, 100_00, 4, { ruleIds: ["r"] })]), tiersPayload([GLOBAL], [pct("r", 5)]));
  assert.ok(explainPlan(beaten, "en").some((i) => i.text === "“Rule r” is not applied: “Quantity discount” is better."), JSON.stringify(explainPlan(beaten, "en")));
  const amount = planCart(cartOf([pline("L1", 1, 100_00, 3)]), tiersPayload([MIXED]));
  assert.ok(explainPlan(amount, "cs").some((i) => i.text === `Přidej 2 ks a dostaneš −50${NBSP}Kč za kus.`));
  assert.ok(explainPlan(amount, "en").some((i) => i.text === "Add 2 more items to get −CZK 50 per item."));
  const usd = planCart(cartOf([pline("L1", 1, 4_00, 5)], { currency: "USD" }), tiersPayload([MIXED]));
  assert.ok(explainPlan(usd, "cs").some((i) => i.text === "Množstevní sleva nemá hodnotu pro měnu USD, proto se tu nenabízí."));
  for (const plan of [applied, outranked, beaten, amount, usd]) {
    for (const locale of ["cs", "en"] as const) {
      for (const i of explainPlan(plan, locale)) assert.doesNotMatch(i.text, /tier:|_|undefined|null/, i.text);
    }
  }
});
