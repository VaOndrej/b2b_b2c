// Margin protection in planCart (MVP 2, spec §3 bod 7, §4.5): the product stage
// caps each line's allocation at its headroom, the order stage lowers the order
// discount or leaves out the lines already at their floor — never blocking,
// only lowering. Off by default: then the plan is exactly MVP 1's.
// Amounts are minor units (haléře): 1000_00 = 1 000 Kč; costs are MAJOR units.

import assert from "node:assert/strict";
import { test } from "node:test";

import type { CartLineInput } from "../../src/discounts/cart.ts";
import { emitForNode } from "../../src/discounts/emit.ts";
import { planCart } from "../../src/discounts/plan.ts";
import {
  cartOf,
  code,
  configOf,
  costLine,
  fixed,
  freeShip,
  line,
  lineOf,
  marginPayloadOf,
  orderFixed,
  orderPct,
  outcome,
  payloadOf,
  pct,
  winners,
} from "./engine-fixtures.ts";

// --- off = MVP 1 --------------------------------------------------------------------------------

test("margin OFF: cost prices, collection refs and the rate change nothing — the plan is MVP 1's", () => {
  const rules = [pct("A", 60), orderPct("O", 30), freeShip("S")];
  const bare = [line("L1", 1000_00, 2, ["A"]), line("L2", 300_00, 1)];
  const withCosts: CartLineInput[] = bare.map((l) => ({ ...l, unitCost: 900, unitCostCurrency: "CZK", marginRefs: ["1"] }));
  const payload = payloadOf(rules);
  assert.deepEqual(payload.modules.margin, { enabled: false });
  const mvp1 = planCart(cartOf(bare), payload);
  assert.deepEqual(planCart(cartOf(withCosts, { shopToCartRate: 1 }), payload), mvp1);
  // A legacy payload that still carries the whole MVP 1 margin module plans the same (tolerant reader).
  const legacy = JSON.parse(JSON.stringify(payload));
  legacy.modules.margin = { global: { maxDiscountPercent: 10 }, perCollection: [] };
  assert.deepEqual(planCart(cartOf(withCosts), legacy), mvp1);
  // Settings saved while protection is off never reach the checkout.
  const off = payloadOf(rules, { modules: { margin: { enabled: false, global: { maxDiscountPercent: 1, minMarginPercent: 90 } } } });
  assert.deepEqual(off.modules.margin, { enabled: false });
  assert.deepEqual(planCart(cartOf(withCosts), off), mvp1);
  assert.equal(mvp1.order?.amount, Math.round((2 * 1000_00 * 0.4 + 300_00) * 0.3));
  assert.deepEqual(mvp1.order?.marginExcludedLineIds, []);
});

test("margin ON but nothing reaches a floor: the same plan as with protection off", () => {
  const rules = [pct("A", 10), orderPct("O", 5)];
  const lines = [costLine("L1", 1000_00, 100, 2, ["A"]), line("L2", 300_00, 1)];
  const off = planCart(cartOf(lines), payloadOf(rules));
  const on = planCart(cartOf(lines), marginPayloadOf(rules, { global: { minMarginPercent: 20, maxDiscountPercent: 50 } }));
  assert.deepEqual(on, off);
});

// --- product stage --------------------------------------------------------------------------------

test("product: the allocation is cut to the headroom above cost + minimum margin, emitted as a fixed total", () => {
  // Floor = 700 / (1 − 0.2) = 875 Kč → headroom 125 Kč; 30 % would be 300 Kč.
  const payload = marginPayloadOf([pct("A", 30)], { global: { minMarginPercent: 20, maxDiscountPercent: 50 } });
  const plan = planCart(cartOf([costLine("L1", 1000_00, 700, 1, ["A"])]), payload);
  const l1 = lineOf(plan, "L1");
  assert.equal(l1.product?.amount, 125_00);
  assert.deepEqual(l1.product?.value, { fixedTotal: 125_00 });
  assert.deepEqual(l1.product?.components, [{ ruleId: "A", method: "automatic", module: "codes", amount: 125_00 }]);
  assert.deepEqual(l1.marginCapped, {
    before: 300_00,
    after: 125_00,
    floorUnit: 875_00,
    basis: "cost",
    minMarginPercent: 20,
    source: "global",
  });
  assert.equal(outcome(plan, "A").state, "applied");
  assert.equal(outcome(plan, "A").amount, 125_00);
  assert.equal(plan.totals.productDiscount, 125_00);
  assert.equal(plan.totals.total, 875_00);
});

test("product: an allocation within the headroom is untouched (its percent stays a percent)", () => {
  const payload = marginPayloadOf([pct("A", 10)], { global: { minMarginPercent: 20, maxDiscountPercent: 50 } });
  const plan = planCart(cartOf([costLine("L1", 1000_00, 700, 1, ["A"])]), payload);
  assert.deepEqual(lineOf(plan, "L1").product?.value, { percent: 10 });
  assert.equal(lineOf(plan, "L1").marginCapped, undefined);
});

test("product without a cost price: the maximum discount % is the ceiling", () => {
  const payload = marginPayloadOf([pct("A", 30)], { global: { minMarginPercent: 20, maxDiscountPercent: 20 } });
  const plan = planCart(cartOf([line("L1", 1000_00, 1, ["A"])]), payload);
  assert.equal(lineOf(plan, "L1").product?.amount, 200_00);
  assert.deepEqual(lineOf(plan, "L1").marginCapped, {
    before: 300_00,
    after: 200_00,
    floorUnit: 800_00,
    basis: "max_percent",
    maxDiscountPercent: 20,
    source: "global",
  });
});

test("product: the floor counts per item — a fixed amount per item is capped on the whole line", () => {
  const payload = marginPayloadOf([fixed("F", { CZK: 300_00 })], { global: { maxDiscountPercent: 50 } });
  const plan = planCart(cartOf([line("L1", 500_00, 3, ["F"])]), payload);
  assert.equal(lineOf(plan, "L1").product?.amount, 750_00); // 1 500 − 3 × 250
  assert.deepEqual(lineOf(plan, "L1").product?.value, { fixedTotal: 750_00 });
});

test("product: no headroom → no product discount on the line; a rule that had nothing left anywhere is margin_floor", () => {
  const payload = marginPayloadOf([pct("A", 30), pct("C", 20, code(["KOD"]))], { global: { maxDiscountPercent: 50 } });
  const plan = planCart(
    cartOf([costLine("L1", 1000_00, 1000, 1, ["A"]), costLine("L2", 500_00, 600, 1, ["C"])], { enteredCodes: ["KOD"] }),
    payload,
  );
  assert.equal(lineOf(plan, "L1").product, null);
  assert.deepEqual(lineOf(plan, "L1").marginCapped, {
    before: 300_00,
    after: 0,
    floorUnit: 1000_00,
    basis: "cost",
    minMarginPercent: 0,
    source: "global",
  });
  assert.equal(outcome(plan, "A").state, "margin_floor");
  assert.equal(outcome(plan, "C").state, "margin_floor");
  assert.deepEqual(plan.codes, [{ code: "KOD", ruleId: "C", state: "margin_floor" }]);
  assert.deepEqual(emitForNode(plan, { kind: "code", ruleId: "C" }, "KOD").productCandidates, []);
});

test("product: a rule floored on one line but giving on another is applied", () => {
  const payload = marginPayloadOf([pct("A", 30)], { global: { maxDiscountPercent: 50 } });
  const plan = planCart(cartOf([costLine("L1", 1000_00, 1000, 1, ["A"]), line("L2", 1000_00, 1, ["A"])]), payload);
  assert.equal(outcome(plan, "A").state, "applied");
  assert.equal(outcome(plan, "A").amount, 300_00);
  assert.deepEqual(outcome(plan, "A").lineIds, ["L2"]);
});

test("product Pro stack: the cut is taken from the stack in rank order and the owner is recomputed", () => {
  const rules = [pct("A", 20, { combinesWith: { ruleIds: ["B"] } }), pct("B", 10, code(["KOD"]))];
  const cart = cartOf([line("L1", 1000_00, 1, ["A", "B"])], { enteredCodes: ["KOD"] });
  // Headroom 250 Kč: A keeps its 200, B gets the remaining 50; the code rule still owns the stack.
  const wide = planCart(cart, marginPayloadOf(rules, { global: { maxDiscountPercent: 25 } }));
  assert.deepEqual(
    lineOf(wide, "L1").product?.components.map((c) => [c.ruleId, c.amount]),
    [
      ["A", 200_00],
      ["B", 50_00],
    ],
  );
  assert.equal(lineOf(wide, "L1").product?.ownerRuleId, "B");
  assert.deepEqual(lineOf(wide, "L1").product?.value, { fixedTotal: 250_00 });
  // Headroom 150 Kč: A's 150 is all there is; B gives nothing → the automatic rule owns the line now.
  const tight = planCart(cart, marginPayloadOf(rules, { global: { maxDiscountPercent: 15 } }));
  const stack = lineOf(tight, "L1").product;
  assert.deepEqual(stack?.components.map((c) => [c.ruleId, c.amount]), [["A", 150_00]]);
  assert.equal(stack?.ownerRuleId, "A");
  assert.equal(stack?.ownerMethod, "automatic");
  assert.equal(stack?.message, "Rule A");
  assert.equal(outcome(tight, "A").state, "applied");
  assert.equal(outcome(tight, "B").state, "margin_floor");
  assert.equal(emitForNode(tight, { kind: "automatic" }, null).productCandidates[0]?.amount, 150_00);
  assert.deepEqual(emitForNode(tight, { kind: "code", ruleId: "B" }, "KOD").productCandidates, []);
});

test("product: collections with their own setting — the strictest applies, an empty field is the global value", () => {
  const payload = marginPayloadOf([pct("A", 30)], {
    global: { minMarginPercent: 10, maxDiscountPercent: 50 },
    perCollection: [
      { collectionId: "gid://shopify/Collection/1", minMarginPercent: 30 },
      { collectionId: "gid://shopify/Collection/2", maxDiscountPercent: 10 },
    ],
  });
  assert.deepEqual(payload.modules.margin, { enabled: true, min: 10, max: 50, cur: "CZK", col: { "1": [30, null], "2": [null, 10] } });
  const plan = planCart(
    cartOf([
      line("NOCOST", 1000_00, 1, ["A"], { marginRefs: ["1", "2"] }),
      costLine("COST", 1000_00, 700, 1, ["A"], { marginRefs: ["1"] }),
      costLine("GLOBAL", 1000_00, 700, 1, ["A"], { marginRefs: ["99"] }),
    ]),
    payload,
  );
  assert.equal(lineOf(plan, "NOCOST").product?.amount, 100_00); // p = min(50, 10)
  assert.equal(lineOf(plan, "NOCOST").marginCapped?.source, "collection");
  assert.equal(lineOf(plan, "COST").product, null); // 700 / 0.7 = 1 000 Kč floor → no headroom
  assert.equal(lineOf(plan, "COST").marginCapped?.minMarginPercent, 30);
  assert.equal(lineOf(plan, "GLOBAL").product?.amount, 222_22); // 700 / 0.9 = 777,78 → 777,78 Kč floor
  assert.equal(lineOf(plan, "GLOBAL").marginCapped?.source, "global");
});

test("product in another cart currency: the cost is converted with the shop → cart rate; without a rate it is unknown", () => {
  const payload = marginPayloadOf([pct("A", 60, { value: { kind: "percentage", percent: 60 } })], {
    global: { minMarginPercent: 10, maxDiscountPercent: 30 },
  });
  const eurLine = costLine("L1", 40_00, 500, 1, ["A"]); // cost 500 CZK
  // 500 CZK × 0.04 = 20 € → floor 20 / 0.9 = 22,23 € → headroom 17,77 €.
  const withRate = planCart(cartOf([eurLine], { currency: "EUR", shopToCartRate: 0.04 }), payload);
  assert.equal(lineOf(withRate, "L1").product?.amount, 17_77);
  assert.equal(lineOf(withRate, "L1").marginCapped?.basis, "cost");
  // No rate: the cost is unknown, the 30 % ceiling applies (floor 28 €).
  const noRate = planCart(cartOf([eurLine], { currency: "EUR" }), payload);
  assert.equal(lineOf(noRate, "L1").product?.amount, 12_00);
  assert.equal(lineOf(noRate, "L1").marginCapped?.basis, "max_percent");
  // A cost recorded in another currency than the shop's is unknown too.
  const foreignCost = planCart(cartOf([{ ...eurLine, unitCostCurrency: "EUR" }], { currency: "EUR", shopToCartRate: 0.04 }), payload);
  assert.equal(lineOf(foreignCost, "L1").marginCapped?.basis, "max_percent");
  // No shop currency in the payload: every cost is unknown.
  const noShopCurrency = JSON.parse(JSON.stringify(payload));
  delete noShopCurrency.modules.margin.cur;
  assert.equal(lineOf(planCart(cartOf([eurLine], { currency: "EUR", shopToCartRate: 0.04 }), noShopCurrency), "L1").marginCapped?.basis, "max_percent");
});

test("product: gift and outlet lines are outside margin protection (they get no discount at all)", () => {
  const payload = marginPayloadOf([pct("A", 50), orderPct("O", 10)], { global: { maxDiscountPercent: 5 } });
  const plan = planCart(
    cartOf([
      line("GIFT", 0, 1, ["A"], { giftTierId: "g1" }),
      line("OUT", 1000_00, 1, ["A"], { outlet: true }),
      line("L1", 1000_00, 1, ["A"]),
      line("L2", 1000_00),
    ]),
    payload,
  );
  assert.equal(lineOf(plan, "GIFT").marginCapped, undefined);
  assert.equal(lineOf(plan, "OUT").marginCapped, undefined);
  assert.equal(lineOf(plan, "L1").product?.amount, 50_00);
  // L1 is at its floor after the product discount: the order discount leaves it out, next to the gift and outlet lines.
  assert.equal(plan.order?.amount, 49_99);
  assert.deepEqual(plan.order?.excludedLineIds, ["GIFT", "OUT", "L1"]);
  assert.deepEqual(plan.order?.marginExcludedLineIds, ["L1"]);
});

// --- order stage ---------------------------------------------------------------------------------

test("order: lowered to what the lines can give, keeping 1 minor unit per line for rounding", () => {
  const payload = marginPayloadOf([orderPct("O", 30)], { global: { maxDiscountPercent: 20 } });
  const plan = planCart(cartOf([line("L1", 1000_00)]), payload);
  assert.equal(plan.order?.amount, 199_99);
  assert.deepEqual(plan.order?.value, { fixedTotal: 199_99 });
  assert.deepEqual(plan.order?.marginCapped, { before: 300_00, after: 199_99 });
  assert.deepEqual(plan.order?.marginExcludedLineIds, []);
  assert.equal(plan.order?.base, 1000_00);
  assert.equal(outcome(plan, "O").state, "applied");
});

test("order: a line already at its floor is left out; the rest keeps the full percent (still a percent)", () => {
  const payload = marginPayloadOf([orderPct("O", 10)], { global: { maxDiscountPercent: 50 } });
  const plan = planCart(cartOf([line("L1", 1000_00), costLine("L2", 1000_00, 1000), line("L3", 500_00)]), payload);
  assert.deepEqual(plan.order?.value, { percent: 10 });
  assert.equal(plan.order?.amount, 150_00);
  assert.equal(plan.order?.base, 1500_00);
  assert.deepEqual(plan.order?.marginExcludedLineIds, ["L2"]);
  assert.deepEqual(plan.order?.excludedLineIds, ["L2"]);
  assert.deepEqual(plan.order?.marginCapped, { before: 250_00, after: 150_00 });
  assert.deepEqual(emitForNode(plan, { kind: "automatic" }, null).orderCandidates[0]?.excludedLineIds, ["L2"]);
});

test("order: a fixed amount that the other lines can carry whole is unchanged, the floored line left out", () => {
  const payload = marginPayloadOf([orderFixed("O", { CZK: 100_00 })], { global: { maxDiscountPercent: 50 } });
  const plan = planCart(cartOf([line("L1", 1000_00), costLine("L2", 1000_00, 1000)]), payload);
  assert.deepEqual(plan.order?.value, { fixedTotal: 100_00 });
  assert.equal(plan.order?.amount, 100_00);
  assert.deepEqual(plan.order?.marginExcludedLineIds, ["L2"]);
  assert.deepEqual(plan.order?.excludedLineIds, ["L2"]);
  assert.equal(plan.order?.marginCapped, undefined);
});

test("order: safe for BOTH allocation bases (after and before product discounts)", () => {
  // L1: 1 000 Kč with 50 % product off → 500 after, floor 400 (max 60 %) → headroom 99,99.
  // L2: 500 Kč, floor 200 → headroom 299,99. Order 20 % of 1 000 = 200 Kč.
  // After-product base alone would allow 199,98 on L1's share; the before-product
  // base (L1 is 1 000 of 1 500) allows only 149,98.
  const payload = marginPayloadOf([pct("A", 50), orderPct("O", 20)], { global: { maxDiscountPercent: 60 } });
  const plan = planCart(cartOf([line("L1", 1000_00, 1, ["A"]), line("L2", 500_00)]), payload);
  assert.equal(lineOf(plan, "L1").product?.amount, 500_00);
  assert.equal(plan.order?.amount, 149_98);
  assert.deepEqual(plan.order?.value, { fixedTotal: 149_98 });
  assert.deepEqual(plan.order?.marginExcludedLineIds, []);
  // L1 keeps ≥ its floor under either allocation (rounded up per line).
  const d = plan.order!.amount;
  assert.ok(500_00 - Math.ceil((d * 500_00) / 1000_00) >= 400_00);
  assert.ok(500_00 - Math.ceil((d * 1000_00) / 1500_00) >= 400_00);
});

test("order: nothing left to give anywhere → no order discount, the rule is margin_floor (a code says so)", () => {
  const payload = marginPayloadOf([orderPct("O", 10, code(["LETO"])), freeShip("S")], { global: { maxDiscountPercent: 50 } });
  const plan = planCart(cartOf([costLine("L1", 1000_00, 1000)], { enteredCodes: ["LETO"] }), payload);
  assert.equal(plan.order, null);
  assert.equal(outcome(plan, "O").state, "margin_floor");
  assert.deepEqual(plan.codes, [{ code: "LETO", ruleId: "O", state: "margin_floor" }]);
  // Shipping is outside margin protection.
  assert.equal(plan.shipping?.ruleId, "S");
});

test("order Pro stack: lowered in rank order, the owner recomputed over what is left", () => {
  const rules = [orderPct("A", 20, { combinesWith: { ruleIds: ["B"] } }), orderPct("B", 5, code(["KOD"]))];
  const payload = marginPayloadOf(rules, { global: { maxDiscountPercent: 10 } });
  const plan = planCart(cartOf([line("L1", 1000_00)], { enteredCodes: ["KOD"] }), payload);
  assert.equal(plan.order?.amount, 99_99);
  assert.deepEqual(plan.order?.components.map((c) => [c.ruleId, c.amount]), [["A", 99_99]]);
  assert.equal(plan.order?.ownerRuleId, "A");
  assert.equal(outcome(plan, "B").state, "margin_floor");
  assert.deepEqual(emitForNode(plan, { kind: "code", ruleId: "B" }, "KOD").orderCandidates, []);
  assert.equal(emitForNode(plan, { kind: "automatic" }, null).orderCandidates[0]?.amount, 99_99);
});

test("exclusive (product-with-order off): the order-only scenario is protected the same way", () => {
  const payload = marginPayloadOf([pct("A", 5), orderPct("O", 30)], { global: { maxDiscountPercent: 10 } }, {
    engine: { combination: { productWithOrder: false } },
  });
  const plan = planCart(cartOf([line("L1", 1000_00, 1, ["A"]), costLine("L2", 1000_00, 1000)]), payload);
  // Order only: L2 is at its floor (left out), L1 can give 99,99 Kč > the product scenario's 50 Kč.
  assert.equal(plan.order?.amount, 99_99);
  assert.deepEqual(plan.order?.marginExcludedLineIds, ["L2"]);
  assert.deepEqual(winners(plan, "L1"), []);
  assert.equal(lineOf(plan, "L1").marginCapped, undefined);
  assert.equal(outcome(plan, "A").state, "not_combinable");
  // With more headroom on the product side the products win and the order is not combinable.
  const productsWin = planCart(
    cartOf([line("L1", 1000_00, 1, ["A"]), costLine("L2", 1000_00, 1000)]),
    marginPayloadOf([pct("A", 50), orderPct("O", 30)], { global: { maxDiscountPercent: 60 } }, { engine: { combination: { productWithOrder: false } } }),
  );
  assert.equal(productsWin.order, null);
  assert.equal(lineOf(productsWin, "L1").product?.amount, 500_00);
  assert.equal(outcome(productsWin, "O").state, "not_combinable");
});

test("campaign overrides apply first, margin protection still applies on top", () => {
  const campaign = {
    id: "bf",
    name: "Black Friday",
    window: { start: "2026-11-27T00:00:00", end: "2026-11-30T23:59:59" },
    overrides: [{ ruleId: "A", patch: { value: { kind: "percentage", percent: 70 } } }],
  };
  const payload = marginPayloadOf([pct("A", 10)], { global: { maxDiscountPercent: 40 } }, { campaigns: [campaign] });
  const matching = { id: payload.campaignId, active: true, varsVersion: payload.campaignVarsVersion };
  const plan = planCart(cartOf([line("L1", 1000_00, 1, ["A"])], { campaign: matching }), payload);
  assert.equal(plan.campaignId, "bf");
  assert.equal(lineOf(plan, "L1").marginCapped?.before, 700_00);
  assert.equal(lineOf(plan, "L1").product?.amount, 400_00);
});

test("the payload built from a config without `enabled` (MVP 1 stored config) plans with protection off", () => {
  const config = configOf([pct("A", 90)], { modules: { margin: { global: { maxDiscountPercent: 10 }, perCollection: [] } } });
  assert.equal(config.modules.margin.enabled, false);
  const plan = planCart(cartOf([line("L1", 1000_00, 1, ["A"])]), payloadOf([pct("A", 90)], { modules: { margin: config.modules.margin } }));
  assert.equal(lineOf(plan, "L1").product?.amount, 900_00);
});
