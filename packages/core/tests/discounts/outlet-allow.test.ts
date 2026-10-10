// A sale that takes only SOME of the other discounts (feedback 10 Oct 2026, 6th round): the variant flag is a
// number, the sum of what is allowed (cart.ts OUTLET_ALLOW: 1 quantity tiers, 2 product discounts and codes,
// 4 the order discount). `true` stays "no other discount"; no flag (or 7) is an ordinary line.
// Amounts are minor units (haléře): 1000_00 = 1 000 Kč.

import assert from "node:assert/strict";
import { test } from "node:test";

import type { CartLineInput } from "../../src/discounts/cart.ts";
import { NEVER_DISCOUNTED_FLAG, OUTLET_ALLOW } from "../../src/discounts/cart.ts";
import { planCart } from "../../src/discounts/plan.ts";
import { cartOf, line, lineOf, orderPct, outcome, payloadOf, pct, winners } from "./engine-fixtures.ts";

const P = (n: number) => `gid://shopify/Product/${n}`;
const TIERS = { modules: { tiers: { sets: [{ id: "g", scope: "global", countAcross: "line", breaks: [{ minQty: 3, percent: 10 }] }] } } };
const pline = (id: string, quantity: number, extra: Partial<CartLineInput> = {}): CartLineInput => ({ id, variantId: `gid://shopify/ProductVariant/${id}`, productId: P(1), quantity, unitPrice: 100_00, ruleIds: [], ...extra });

test("tiers only (1): the sale line gets its quantity tier, no product discount, and stays out of the order discount", () => {
  const plan = planCart(
    cartOf([pline("S", 3, { ruleIds: ["A"], outlet: OUTLET_ALLOW.tiers }), pline("N", 1, { ruleIds: ["A"] })]),
    payloadOf([pct("A", 20), orderPct("O", 10)], TIERS),
  );
  const sale = lineOf(plan, "S");
  assert.equal(sale.excluded, null);
  assert.deepEqual(sale.product?.components.map((c) => c.ruleId), ["tier:g"]);
  assert.equal(sale.product?.amount, 30_00);
  assert.deepEqual(winners(plan, "N"), ["A"]);
  // The order discount: 10 % of the ordinary line after its product discount (100 − 20 = 80 Kč), the sale line left out.
  assert.equal(plan.order?.base, 80_00);
  assert.equal(plan.order?.amount, 8_00);
  assert.deepEqual(plan.order?.excludedLineIds, ["S"]);
});

test("product discounts only (2): the product discount applies, the tier does not, the order discount leaves the line out", () => {
  const plan = planCart(cartOf([pline("S", 3, { ruleIds: ["A"], outlet: OUTLET_ALLOW.product })]), payloadOf([pct("A", 20), orderPct("O", 10)], TIERS));
  assert.deepEqual(winners(plan, "S"), ["A"]);
  assert.equal(lineOf(plan, "S").product?.amount, 60_00);
  assert.equal(plan.order, null);
});

test("order discount only (4): no product discount and no tier; the order discount counts the line at its full price", () => {
  const plan = planCart(cartOf([pline("S", 3, { ruleIds: ["A"], outlet: OUTLET_ALLOW.order })]), payloadOf([pct("A", 20), orderPct("O", 10)], TIERS));
  assert.equal(lineOf(plan, "S").product, null);
  assert.equal(outcome(plan, "A").state, "outlet_only");
  assert.equal(plan.order?.base, 300_00);
  assert.equal(plan.order?.amount, 30_00);
  assert.deepEqual(plan.order?.excludedLineIds, []);
});

test("tiers + order (5): the order discount is taken after the line's tier", () => {
  const plan = planCart(cartOf([pline("S", 3, { outlet: OUTLET_ALLOW.tiers | OUTLET_ALLOW.order })]), payloadOf([orderPct("O", 10)], TIERS));
  assert.equal(lineOf(plan, "S").product?.amount, 30_00);
  assert.equal(plan.order?.base, 270_00);
});

test("`true` is unchanged, 7 and junk are ordinary lines, and a gift line ignores the flag", () => {
  const rules = payloadOf([pct("A", 20)]);
  assert.equal(lineOf(planCart(cartOf([line("L", 1000_00, 1, ["A"], { outlet: true })]), rules), "L").excluded, "outlet");
  for (const flag of [7, 8, 1.5, -1]) {
    const plan = planCart(cartOf([line("L", 1000_00, 1, ["A"], { outlet: flag })]), rules);
    assert.equal(lineOf(plan, "L").excluded, null, `flag ${flag}`);
    assert.deepEqual(winners(plan, "L"), ["A"], `flag ${flag}`);
  }
  assert.equal(lineOf(planCart(cartOf([line("G", 300_00, 1, [], { giftTierId: "g", outlet: 1 })]), rules), "G").excluded, "gift");
});

test("outletWithAnything lifts the limits of a partly combining sale too", () => {
  const plan = planCart(
    cartOf([pline("S", 3, { ruleIds: ["A"], outlet: OUTLET_ALLOW.tiers })]),
    payloadOf([pct("A", 20), orderPct("O", 10)], { ...TIERS, engine: { combination: { outletWithAnything: true } } }),
  );
  assert.deepEqual(winners(plan, "S"), ["A"]);
  assert.deepEqual(plan.order?.excludedLineIds, []);
});

// --- Gift cards (decided 10 Oct 2026): a 1 000 Kč card bought for 700 Kč and spent as 1 000 Kč is money given away.

test("a gift card (the flag 0) takes no discount at all: no product discount, no code, no quantity tier, and it is out of the order discount", () => {
  assert.equal(NEVER_DISCOUNTED_FLAG, 0);
  const plan = planCart(
    cartOf([pline("G", 3, { ruleIds: ["A"], outlet: NEVER_DISCOUNTED_FLAG }), pline("N", 1, { ruleIds: ["A"] })]),
    payloadOf([pct("A", 20), orderPct("O", 10)], TIERS),
  );
  assert.equal(lineOf(plan, "G").product, null);
  assert.deepEqual(winners(plan, "N"), ["A"]);
  // The order discount counts the ordinary line alone (100 − 20 = 80 Kč); the gift card is left out by name.
  assert.equal(plan.order?.base, 80_00);
  assert.deepEqual(plan.order?.excludedLineIds, ["G"]);
  // A cart of gift cards alone: nothing to discount, nothing given.
  const alone = planCart(cartOf([pline("G", 3, { ruleIds: ["A"], outlet: NEVER_DISCOUNTED_FLAG })]), payloadOf([pct("A", 20), orderPct("O", 10)], TIERS));
  assert.equal(lineOf(alone, "G").product, null);
  assert.equal(alone.order, null);
});

test("a gift card stays out even when the shop lets sales combine with anything — that switch is about sales", () => {
  const plan = planCart(
    cartOf([pline("G", 3, { ruleIds: ["A"], outlet: NEVER_DISCOUNTED_FLAG }), pline("S", 3, { ruleIds: ["A"], outlet: true })]),
    payloadOf([pct("A", 20), orderPct("O", 10)], { ...TIERS, engine: { combination: { outletWithAnything: true } } }),
  );
  assert.equal(lineOf(plan, "G").product, null);
  assert.deepEqual(plan.order?.excludedLineIds, ["G"]);
  // The sale line next to it does combine, as the switch says.
  assert.deepEqual(winners(plan, "S"), ["A"]);
});
