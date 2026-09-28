// A1 combination boundaries (spec §3 "Deterministické pořadí"): every pair of
// discount categories, tie-breaks, caps, exclusions and the per-category engine
// switches. Amounts are minor units (haléře): 1000_00 = 1 000 Kč.

import assert from "node:assert/strict";
import { test } from "node:test";

import { planCart } from "../../src/discounts/plan.ts";
import {
  cartOf,
  code,
  fixed,
  freeShip,
  line,
  lineOf,
  orderFixed,
  orderPct,
  outcome,
  payloadOf,
  pct,
  winners,
} from "./engine-fixtures.ts";

// --- product vs product --------------------------------------------------------------

test("product vs product on one line: the better one for the customer wins, they never add up", () => {
  const plan = planCart(cartOf([line("L1", 1000_00, 1, ["A", "B"])]), payloadOf([pct("A", 10), pct("B", 15)]));
  assert.deepEqual(winners(plan, "L1"), ["B"]);
  assert.equal(lineOf(plan, "L1").product?.amount, 150_00);
  assert.equal(outcome(plan, "A").state, "outranked");
  assert.deepEqual(outcome(plan, "A").betterRuleIds, ["B"]);
});

test("product vs product compares money, not kinds: a fixed amount beats a smaller percentage", () => {
  const plan = planCart(
    cartOf([line("L1", 500_00, 1, ["P", "F"])]),
    payloadOf([pct("P", 10), fixed("F", { CZK: 100_00 })]),
  );
  assert.deepEqual(winners(plan, "L1"), ["F"]);
  assert.equal(lineOf(plan, "L1").product?.amount, 100_00);
});

test("a tie is broken by priority desc, then id asc — never by config order", () => {
  const tie = planCart(cartOf([line("L1", 1000_00, 1, ["b", "a"])]), payloadOf([pct("b", 10), pct("a", 10)]));
  assert.deepEqual(winners(tie, "L1"), ["a"]);

  const prioritized = planCart(
    cartOf([line("L1", 1000_00, 1, ["a", "b"])]),
    payloadOf([pct("a", 10), pct("b", 10, { priority: 5 })]),
  );
  assert.deepEqual(winners(prioritized, "L1"), ["b"]);
});

test("each line picks its own winner", () => {
  const plan = planCart(
    cartOf([line("L1", 1000_00, 1, ["A", "B"]), line("L2", 1000_00, 1, ["B"])]),
    payloadOf([pct("A", 20), pct("B", 10)]),
  );
  assert.deepEqual(winners(plan, "L1"), ["A"]);
  assert.deepEqual(winners(plan, "L2"), ["B"]);
  assert.equal(outcome(plan, "B").state, "applied");
  assert.deepEqual(outcome(plan, "B").lineIds, ["L2"]);
});

// --- product + order + shipping --------------------------------------------------------

test("product + order stack; the order discount is computed on the subtotal AFTER product discounts [spec]", () => {
  const plan = planCart(cartOf([line("L1", 1000_00, 1, ["A"])]), payloadOf([pct("A", 10), orderPct("O", 10)]));
  assert.equal(lineOf(plan, "L1").product?.amount, 100_00);
  assert.equal(plan.order?.base, 900_00);
  assert.equal(plan.order?.amount, 90_00);
  assert.deepEqual(plan.totals, { subtotal: 1000_00, productDiscount: 100_00, orderDiscount: 90_00, total: 810_00 });
});

test("order vs order: the better one wins [spec]; a tie goes to priority desc, id asc", () => {
  const better = planCart(
    cartOf([line("L1", 1000_00)]),
    payloadOf([orderPct("o1", 10), orderFixed("o2", { CZK: 150_00 })]),
  );
  assert.deepEqual(better.order?.components.map((c) => c.ruleId), ["o2"]);
  assert.equal(outcome(better, "o1").state, "outranked");

  const tie = planCart(
    cartOf([line("L1", 1000_00)]),
    payloadOf([orderFixed("o2", { CZK: 100_00 }), orderPct("o1", 10)]),
  );
  assert.deepEqual(tie.order?.components.map((c) => c.ruleId), ["o1"]);
});

test("product + order + shipping all stack by default (A1)", () => {
  const plan = planCart(
    cartOf([line("L1", 1000_00, 1, ["A"])]),
    payloadOf([pct("A", 10), orderPct("O", 10), freeShip("S")]),
  );
  assert.equal(lineOf(plan, "L1").product?.amount, 100_00);
  assert.equal(plan.order?.amount, 90_00);
  assert.equal(plan.shipping?.ruleId, "S");
  assert.deepEqual(plan.shipping?.value, { percent: 100 });
});

// --- outlet and gift lines ---------------------------------------------------------------

test("outlet lines are excluded from product AND order discounts (A1.1) and listed as excluded for the order", () => {
  const plan = planCart(
    cartOf([line("L1", 1000_00, 1, ["A"], { outlet: true }), line("L2", 500_00, 1, ["A"])]),
    payloadOf([pct("A", 10), orderPct("O", 10)]),
  );
  assert.equal(lineOf(plan, "L1").excluded, "outlet");
  assert.equal(lineOf(plan, "L1").product, null);
  assert.equal(lineOf(plan, "L2").product?.amount, 50_00);
  assert.equal(plan.order?.base, 450_00);
  assert.equal(plan.order?.amount, 45_00);
  assert.deepEqual(plan.order?.excludedLineIds, ["L1"]);
});

test("engine.combination.outletWithAnything=true lets outlet lines take discounts", () => {
  const plan = planCart(
    cartOf([line("L1", 1000_00, 1, ["A"], { outlet: true })]),
    payloadOf([pct("A", 10)], { engine: { combination: { outletWithAnything: true } } }),
  );
  assert.equal(lineOf(plan, "L1").excluded, null);
  assert.equal(lineOf(plan, "L1").product?.amount, 100_00);
});

test("a rule whose only lines are on outlet is out of play, with its own reason", () => {
  const plan = planCart(cartOf([line("L1", 1000_00, 1, ["A"], { outlet: true })]), payloadOf([pct("A", 10)]));
  assert.equal(outcome(plan, "A").state, "outlet_only");
});

test("gift lines are outside every discount and every minimum (A1.2)", () => {
  const plan = planCart(
    cartOf([
      line("L1", 1000_00, 1, ["A"]),
      line("G", 300_00, 1, ["A"], { giftTierId: "gift-1" }),
      line("L2", 500_00),
    ]),
    payloadOf([pct("A", 10), orderPct("O", 10, { minimum: { subtotal: { CZK: 1600_00 } } })]),
  );
  assert.equal(lineOf(plan, "G").excluded, "gift");
  assert.equal(lineOf(plan, "G").product, null);
  assert.equal(outcome(plan, "O").state, "below_minimum");
  assert.equal(outcome(plan, "O").missing?.subtotal, 100_00);
});

test("a gift line wins over an outlet flag (excluded as gift)", () => {
  const plan = planCart(cartOf([line("G", 300_00, 1, [], { giftTierId: "g", outlet: true })]), payloadOf([]));
  assert.equal(lineOf(plan, "G").excluded, "gift");
});

// --- caps ---------------------------------------------------------------------------------

test("a fixed product amount never exceeds the line: per item capped at the unit price", () => {
  const plan = planCart(cartOf([line("L1", 300_00, 2, ["F"])]), payloadOf([fixed("F", { CZK: 1000_00 })]));
  const stack = lineOf(plan, "L1").product;
  assert.equal(stack?.amount, 600_00);
  assert.deepEqual(stack?.value, { fixedPerItem: 300_00 });
});

test("a fixed product amount applies to each item", () => {
  const plan = planCart(cartOf([line("L1", 300_00, 3, ["F"])]), payloadOf([fixed("F", { CZK: 50_00 })]));
  assert.equal(lineOf(plan, "L1").product?.amount, 150_00);
  assert.deepEqual(lineOf(plan, "L1").product?.value, { fixedPerItem: 50_00 });
});

test("a fixed order amount never exceeds the subtotal", () => {
  const plan = planCart(cartOf([line("L1", 1200_00)]), payloadOf([orderFixed("O", { CZK: 5000_00 })]));
  assert.equal(plan.order?.amount, 1200_00);
  assert.deepEqual(plan.order?.value, { fixedTotal: 1200_00 });
  assert.equal(plan.totals.total, 0);
});

test("a percentage is clamped to 0-100 even when a hand-built payload says otherwise", () => {
  const payload = payloadOf([pct("A", 10)]);
  (payload.modules.codes.rules[0].value as { percent: number }).percent = 150;
  const plan = planCart(cartOf([line("L1", 1000_00, 1, ["A"])]), payload);
  assert.equal(lineOf(plan, "L1").product?.amount, 1000_00);
  assert.deepEqual(lineOf(plan, "L1").product?.value, { percent: 100 });
});

test("a percentage amount is rounded half up to the minor unit [spec]", () => {
  const plan = planCart(cartOf([line("L1", 10_05, 1, ["A"])]), payloadOf([pct("A", 10)]));
  assert.equal(lineOf(plan, "L1").product?.amount, 1_01);
});

test("a 0 % rule saves nothing and says so", () => {
  const plan = planCart(cartOf([line("L1", 1000_00, 1, ["A"])]), payloadOf([pct("A", 0)]));
  assert.equal(lineOf(plan, "L1").product, null);
  assert.equal(outcome(plan, "A").state, "zero_value");
});

// --- per-category engine switches (Free) -----------------------------------------------

test("productWithOrder=false: product and order are exclusive, the better scenario for the customer wins", () => {
  const engine = { combination: { productWithOrder: false } };
  const orderWins = planCart(
    cartOf([line("L1", 1000_00, 1, ["A"])]),
    payloadOf([pct("A", 10), orderPct("O", 15)], { engine }),
  );
  assert.equal(lineOf(orderWins, "L1").product, null);
  assert.equal(orderWins.order?.amount, 150_00);
  assert.equal(orderWins.order?.base, 1000_00);
  assert.equal(outcome(orderWins, "A").state, "not_combinable");

  const productWins = planCart(
    cartOf([line("L1", 1000_00, 1, ["A"])]),
    payloadOf([pct("A", 20), orderPct("O", 15)], { engine }),
  );
  assert.equal(lineOf(productWins, "L1").product?.amount, 200_00);
  assert.equal(productWins.order, null);
  assert.equal(outcome(productWins, "O").state, "not_combinable");
});

test("productWithShipping=false: shipping is dropped while a product discount applies [spec]", () => {
  const engine = { combination: { productWithShipping: false } };
  const withProduct = planCart(
    cartOf([line("L1", 1000_00, 1, ["A"])]),
    payloadOf([pct("A", 10), freeShip("S")], { engine }),
  );
  assert.equal(withProduct.shipping, null);
  assert.equal(outcome(withProduct, "S").state, "not_combinable");

  const withoutProduct = planCart(cartOf([line("L1", 1000_00)]), payloadOf([pct("A", 10), freeShip("S")], { engine }));
  assert.equal(withoutProduct.shipping?.ruleId, "S");
});

test("orderWithShipping=false: shipping is dropped while an order discount applies [spec]", () => {
  const plan = planCart(
    cartOf([line("L1", 1000_00)]),
    payloadOf([orderPct("O", 10), freeShip("S")], { engine: { combination: { orderWithShipping: false } } }),
  );
  assert.equal(plan.order?.amount, 100_00);
  assert.equal(plan.shipping, null);
});

// --- Pro: per-rule combinesWith ------------------------------------------------------------

test("Pro combinesWith: two product rules stack on a line as ONE summed value, owned by the higher priority", () => {
  const plan = planCart(
    cartOf([line("L1", 1000_00, 1, ["A", "B"])]),
    payloadOf([pct("A", 10, { priority: 1, combinesWith: { ruleIds: ["B"] } }), pct("B", 5)]),
  );
  const stack = lineOf(plan, "L1").product;
  assert.deepEqual(stack?.components.map((c) => [c.ruleId, c.amount]), [["A", 100_00], ["B", 50_00]]);
  assert.equal(stack?.amount, 150_00);
  assert.equal(stack?.ownerRuleId, "A");
  assert.deepEqual(stack?.value, { fixedTotal: 150_00 });
  assert.equal(outcome(plan, "B").state, "combined");
  assert.equal(outcome(plan, "B").combinedInto, "A");
});

test("Pro combinesWith: the owner is the highest PRIORITY component, not the biggest amount", () => {
  const plan = planCart(
    cartOf([line("L1", 1000_00, 1, ["A", "B"])]),
    payloadOf([pct("A", 10, { combinesWith: { ruleIds: ["B"] } }), pct("B", 5, { priority: 5 })]),
  );
  assert.equal(lineOf(plan, "L1").product?.ownerRuleId, "B");
});

test("Pro combinesWith: a combinable pair beats a better single rule when the sum is better for the customer", () => {
  const plan = planCart(
    cartOf([line("L1", 1000_00, 1, ["A", "B", "C"])]),
    payloadOf([pct("A", 30), pct("B", 20, { combinesWith: { ruleIds: ["C"] } }), pct("C", 20)]),
  );
  assert.deepEqual(winners(plan, "L1"), ["B", "C"]);
  assert.equal(lineOf(plan, "L1").product?.amount, 400_00);
  assert.equal(outcome(plan, "A").state, "outranked");
});

test("Pro combinesWith: a stack never exceeds the line", () => {
  const plan = planCart(
    cartOf([line("L1", 1000_00, 1, ["A", "B"])]),
    payloadOf([pct("A", 60, { combinesWith: { ruleIds: ["B"] } }), pct("B", 60)]),
  );
  assert.deepEqual(lineOf(plan, "L1").product?.components.map((c) => [c.ruleId, c.amount]), [["A", 600_00], ["B", 400_00]]);
  assert.equal(lineOf(plan, "L1").product?.amount, 1000_00);
});

test("Pro combinesWith: order rules can stack too, capped at the base", () => {
  const plan = planCart(
    cartOf([line("L1", 1000_00)]),
    payloadOf([orderPct("O1", 10, { combinesWith: { ruleIds: ["O2"] } }), orderFixed("O2", { CZK: 50_00 })]),
  );
  assert.equal(plan.order?.amount, 150_00);
  assert.deepEqual(plan.order?.value, { fixedTotal: 150_00 });
});

test("a code rule competes with automatic rules on equal terms once its code is entered", () => {
  const rules = [pct("A", 10), pct("C", 20, code(["LETO20"]))];
  const without = planCart(cartOf([line("L1", 1000_00, 1, ["A", "C"])]), payloadOf(rules));
  assert.deepEqual(winners(without, "L1"), ["A"]);
  assert.equal(outcome(without, "C").state, "code_not_entered");

  const withCode = planCart(cartOf([line("L1", 1000_00, 1, ["A", "C"])], { enteredCodes: ["leto20"] }), payloadOf(rules));
  assert.deepEqual(winners(withCode, "L1"), ["C"]);
});
