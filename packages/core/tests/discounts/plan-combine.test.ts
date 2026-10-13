// Combining by type in planCart (docs/won-discounts/navrh-kombinace-2026-10-13.md; combine.ts is the rule,
// plan.ts each stage): two discounts add up only when EACH one's list has the other's type, or names it as an
// exception. Amounts are minor units (haléře): 1000_00 = 1 000 Kč.

import assert from "node:assert/strict";
import { test } from "node:test";

import type { CartLineInput } from "../../src/discounts/cart.ts";
import { explainPlan } from "../../src/discounts/explain.ts";
import { planCart } from "../../src/discounts/plan.ts";
import { cartOf, code, freeShip, line, lineOf, orderPct, outcome, payloadOf, pct, type RawRule, winners } from "./engine-fixtures.ts";

const V = (n: number) => `gid://shopify/ProductVariant/${n}`;
const adds = (...types: string[]) => ({ combine: { types } });
const except = (types: string[], ...rules: string[]) => ({ combine: { types, rules } });
const TIER_SET = { id: "g", scope: "global", countAcross: "line", breaks: [{ minQty: 3, percent: 10 }] };
const tiers = (...types: string[]) => ({ sets: [TIER_SET], combine: { types } });
const pline = (id: string, quantity: number, ruleIds: string[] = [], extra: Partial<CartLineInput> = {}): CartLineInput => ({ id, variantId: V(Number(id.slice(1)) || 1), productId: `gid://shopify/Product/${id}`, quantity, unitPrice: 100_00, ruleIds, ...extra });
const GIFT = { id: "gift-1", threshold: { CZK: 500_00 }, choices: [V(9001)] };
const giftLine: CartLineInput = { id: "G", variantId: V(9001), productId: "gid://shopify/Product/900", quantity: 1, unitPrice: 300_00, ruleIds: [], giftTierId: "gift-1" };

// --- on one line ------------------------------------------------------------------------------------

test("two discounts on a line add up only when both allow the other; one side alone is not enough", () => {
  const cart = cartOf([line("L1", 1000_00, 1, ["A", "C"])], { enteredCodes: ["KOD"] });
  const both = planCart(cart, payloadOf([pct("A", 10, adds("code")), pct("C", 20, { ...code(["KOD"]), ...adds("automatic") })]));
  assert.deepEqual(winners(both, "L1"), ["C", "A"]);
  assert.equal(lineOf(both, "L1").product?.amount, 300_00);
  // A allows codes, the code does not allow automatic discounts: the better one wins.
  const oneSide = planCart(cart, payloadOf([pct("A", 10, adds("code")), pct("C", 20, { ...code(["KOD"]), ...adds() })]));
  assert.deepEqual(winners(oneSide, "L1"), ["C"]);
  assert.equal(outcome(oneSide, "A").state, "outranked");
  // No list at all (a rule stored without one) adds up with nothing.
  const none = planCart(cart, payloadOf([pct("A", 10), pct("C", 20, code(["KOD"]))], { schemaVersion: 2 }));
  assert.deepEqual(winners(none, "L1"), ["C"]);
});

test("a type covers every discount of that type; an exception allows one discount of a type that is not in the list", () => {
  const rules = (b: RawRule) => [pct("A", 10, except([], "B")), pct("B", 5, b), pct("D", 4, except([], "A"))];
  const cart = cartOf([line("L1", 1000_00, 1, ["A", "B", "D"])]);
  // A names B and B names A: they add up. D names A, A does not name D: they do not.
  const pair = planCart(cart, payloadOf(rules(except([], "A"))));
  assert.deepEqual(winners(pair, "L1"), ["A", "B"]);
  assert.equal(outcome(pair, "D").state, "outranked");
  // B allows the whole type instead of naming A: the same.
  assert.deepEqual(winners(planCart(cart, payloadOf(rules(adds("automatic")))), "L1"), ["A", "B"]);
  // The exception is one-sided: nothing adds up.
  assert.deepEqual(winners(planCart(cart, payloadOf(rules(adds()))), "L1"), ["A"]);
});

test("a quantity tier adds up with a product discount when the tiers' list and the rule's list name each other (it never did before)", () => {
  const cart = cartOf([pline("L1", 3, ["A"])]);
  const sum = planCart(cart, payloadOf([pct("A", 20, adds("tiers"))], { modules: { tiers: tiers("automatic") } }));
  assert.deepEqual(winners(sum, "L1"), ["A", "tier:g"]);
  assert.equal(lineOf(sum, "L1").product?.amount, 90_00);
  assert.deepEqual(lineOf(sum, "L1").product?.value, { fixedTotal: 90_00 });
  assert.equal(lineOf(sum, "L1").product?.ownerRuleId, "A");
  assert.equal(sum.tiers[0].state, "applied");
  // One side only: the better one wins, as before.
  const best = planCart(cart, payloadOf([pct("A", 20, adds("tiers"))], { modules: { tiers: tiers("code") } }));
  assert.deepEqual(winners(best, "L1"), ["A"]);
  assert.equal(best.tiers[0].state, "outranked");
});

// --- products and the order discount ----------------------------------------------------------------

test("an order discount goes next to the product discounts only when it adds up with every one the cart got", () => {
  const cart = cartOf([line("L1", 1000_00, 1, ["A"]), line("L2", 1000_00, 1, ["B"])]);
  // O adds up with A and with B: 10 % + 20 % on the lines, then 10 % of what is left.
  const all = planCart(cart, payloadOf([pct("A", 10, adds("automatic")), pct("B", 20, adds("automatic")), orderPct("O", 10, adds("automatic"))]));
  assert.equal(all.totals.productDiscount, 300_00);
  assert.equal(all.order?.amount, 170_00);
});

test("when it does not add up with one of them, the better of two plans wins: products first, or the order discount first with the product discounts that go with it", () => {
  const cart = cartOf([line("L1", 1000_00, 1, ["A"]), line("L2", 1000_00, 1, ["B"])]);
  // B (a code) does not add up with O; A does.
  const rules = (o: number) => [pct("A", 10, adds("automatic")), pct("B", 20, { ...code(["KOD"]), ...adds() }), orderPct("O", o, adds("automatic"))];
  const entered = { enteredCodes: ["KOD"] };
  // Order first: A stays (it adds up with O), B goes; 100 + 30 % of 1 900 = 670 beats products first (100 + 200 = 300).
  const orderFirst = planCart({ ...cart, ...entered }, payloadOf(rules(30)));
  assert.deepEqual(winners(orderFirst, "L1"), ["A"]);
  assert.deepEqual(winners(orderFirst, "L2"), []);
  assert.equal(orderFirst.order?.amount, 570_00);
  assert.equal(outcome(orderFirst, "B").state, "not_combinable");
  assert.equal(outcome(orderFirst, "A").state, "applied");
  // Products first: with a 1 % order discount, keeping B (200) beats the order discount with A alone (100 + 19).
  const productsFirst = planCart({ ...cart, ...entered }, payloadOf(rules(1)));
  assert.deepEqual(winners(productsFirst, "L2"), ["B"]);
  assert.equal(productsFirst.order, null);
  assert.equal(outcome(productsFirst, "O").state, "not_combinable");
  // A tie keeps the product discounts.
  const tie = planCart(cartOf([line("L1", 1000_00, 1, ["B"])], entered), payloadOf([pct("B", 20, { ...code(["KOD"]), ...adds() }), orderPct("O", 20, adds("automatic"))]));
  assert.deepEqual(winners(tie, "L1"), ["B"]);
  assert.equal(tie.order, null);
  // The explanation names it in words, never a state key.
  const text = JSON.stringify(explainPlan(orderFirst, "cs"));
  assert.ok(!text.includes("not_combinable"), text);
});

test("two order discounts add up like two discounts on a line; two order discounts of Milníky never do", () => {
  const cart = cartOf([line("L1", 1000_00)]);
  const stack = planCart(cart, payloadOf([orderPct("O1", 10, adds("automatic")), orderPct("O2", 5, adds("automatic"))]));
  assert.deepEqual(stack.order?.components.map((c) => [c.ruleId, c.amount]), [["O1", 100_00], ["O2", 50_00]]);
  const step = (id: string, percent: number, from: number) => orderPct(id, percent, { name: "", minimum: { subtotal: { CZK: from }, scope: "cart" } });
  const ladder = planCart(cart, payloadOf([step("ms-1", 5, 500_00), step("ms-2", 8, 900_00)], { modules: { rewards: { gifts: [], combine: { types: ["automatic", "code", "shipping", "tiers", "rewards"] } } } }));
  assert.deepEqual(ladder.order?.components.map((c) => c.ruleId), ["ms-2"]);
  assert.equal(outcome(ladder, "ms-1").state, "outranked");
});

test("an order discount of Milníky follows the Milníky list, whatever a stored rule says", () => {
  const cart = cartOf([line("L1", 1000_00, 1, ["A"])]);
  const step = orderPct("ms-1", 5, { name: "", minimum: { subtotal: { CZK: 500_00 }, scope: "cart" }, combine: { types: [] } });
  const rewards = (...types: string[]) => ({ modules: { rewards: { gifts: [], combine: { types } } } });
  const on = planCart(cart, payloadOf([pct("A", 10, adds("rewards")), step], rewards("automatic")));
  assert.equal(on.totals.productDiscount, 100_00);
  assert.equal(on.order?.amount, 45_00);
  const off = planCart(cart, payloadOf([pct("A", 10, adds("rewards")), step], rewards("code")));
  assert.equal(off.order, null);
  assert.equal(outcome(off, "ms-1").state, "not_combinable");
});

// --- shipping and the gift ---------------------------------------------------------------------------

test("a shipping discount applies only when it adds up with everything the cart got; another one that does takes its place", () => {
  const cart = cartOf([line("L1", 1000_00, 1, ["A"])]);
  const plan = planCart(cart, payloadOf([pct("A", 10, adds("shipping")), freeShip("S1", { priority: 5, ...adds("code") }), freeShip("S2", adds("automatic"))]));
  assert.equal(plan.shipping?.ruleId, "S2");
  assert.equal(outcome(plan, "S1").state, "not_combinable");
  // Without the product discount in the cart nothing stands in S1's way: it wins on priority.
  const empty = planCart(cartOf([line("L1", 1000_00)]), payloadOf([pct("A", 10, adds("shipping")), freeShip("S1", { priority: 5, ...adds("code") }), freeShip("S2", adds("automatic"))]));
  assert.equal(empty.shipping?.ruleId, "S1");
  assert.equal(outcome(empty, "S2").state, "outranked");
});

test("the free shipping of Milníky is of the type shipping and follows the Milníky list", () => {
  const cart = cartOf([line("L1", 1000_00, 1, ["A"])]);
  const rewards = (...types: string[]) => ({ modules: { rewards: { freeShipping: { threshold: { CZK: 500_00 } }, gifts: [], combine: { types } } } });
  assert.equal(planCart(cart, payloadOf([pct("A", 10, adds("shipping"))], rewards("automatic"))).shipping?.ruleId, "reward:shipping");
  const blocked = planCart(cart, payloadOf([pct("A", 10, adds("shipping"))], rewards("code")));
  assert.equal(blocked.shipping, null);
  assert.deepEqual(blocked.warnings, [{ code: "reward_not_combinable", ruleId: "reward:shipping" }]);
  // The rule's side counts too: A must allow shipping.
  assert.equal(planCart(cart, payloadOf([pct("A", 10, adds("rewards"))], rewards("automatic"))).shipping, null);
});

test("the gift is free only when it adds up with everything the cart got; otherwise its line stays paid and the plan says why", () => {
  const cart = cartOf([line("L1", 1000_00, 1, ["A"]), giftLine]);
  const rewards = (...types: string[]) => ({ modules: { rewards: { gifts: [GIFT], combine: { types } } } });
  const free = planCart(cart, payloadOf([pct("A", 10, adds("rewards"))], rewards("automatic")));
  assert.deepEqual(free.gifts, [{ tierId: "gift-1", lineId: "G", state: "earned" }]);
  assert.equal(lineOf(free, "G").product?.amount, 300_00);
  const paid = planCart(cart, payloadOf([pct("A", 10, adds())], rewards("automatic")));
  assert.deepEqual(paid.gifts, [{ tierId: "gift-1", lineId: "G", state: "not_combinable" }]);
  assert.equal(lineOf(paid, "G").product, null);
  assert.ok(paid.warnings.some((w) => w.code === "gift_not_combinable" && w.ruleId === "gift:gift-1"));
  // A cart with no other discount: nothing to add up with.
  assert.equal(planCart(cartOf([line("L1", 1000_00), giftLine]), payloadOf([pct("A", 10, adds())], rewards())).gifts[0].state, "earned");
});

test("the rewards of Milníky add up with each other when the Milníky list has its own type, whatever else it has", () => {
  const cart = cartOf([line("L1", 1000_00), giftLine]);
  const step = orderPct("ms-1", 5, { name: "", minimum: { subtotal: { CZK: 500_00 }, scope: "cart" } });
  const rewards = (...types: string[]) => ({ modules: { rewards: { freeShipping: { threshold: { CZK: 500_00 } }, gifts: [GIFT], combine: { types } } } });
  const together = planCart(cart, payloadOf([step], rewards("rewards")));
  assert.equal(together.order?.amount, 50_00);
  assert.equal(together.shipping?.ruleId, "reward:shipping");
  assert.equal(together.gifts[0].state, "earned");
  // Without it: the order discount of the step, and neither the shipping nor the gift next to it.
  const apart = planCart(cart, payloadOf([step], rewards("automatic", "code", "shipping", "tiers")));
  assert.equal(apart.order?.amount, 50_00);
  assert.equal(apart.shipping, null);
  assert.equal(apart.gifts[0].state, "not_combinable");
});

// --- a line on sale -----------------------------------------------------------------------------------

test("a line on sale under the shop's rule takes exactly the discounts that add up with the sale", () => {
  const outlet = (...types: string[]) => ({ modules: { outlet: { combine: { types } }, tiers: tiers("outlet") } });
  const rules = [pct("A", 20, adds("outlet")), pct("C", 30, { ...code(["KOD"]), ...adds("outlet") })];
  const cart = cartOf([pline("S1", 3, ["A", "C"], { outlet: true })], { enteredCodes: ["KOD"] });
  // Nothing in the sale's list: the line is out of everything, as before.
  const closed = planCart(cart, payloadOf(rules, outlet()));
  assert.equal(lineOf(closed, "S1").excluded, "outlet");
  assert.equal(outcome(closed, "A").state, "outlet_only");
  // Automatic only: the code does not reach the line, the tier neither.
  const auto = planCart(cart, payloadOf(rules, outlet("automatic")));
  assert.equal(lineOf(auto, "S1").excluded, null);
  assert.deepEqual(winners(auto, "S1"), ["A"]);
  assert.equal(outcome(auto, "C").state, "outlet_only");
  // Tiers only.
  assert.deepEqual(winners(planCart(cart, payloadOf(rules, outlet("tiers"))), "S1"), ["tier:g"]);
  // The rule's side counts: a rule that does not allow sales stays out.
  const refused = planCart(cart, payloadOf([pct("A", 20, adds())], outlet("automatic")));
  assert.equal(lineOf(refused, "S1").product, null);
});

test("the order discount counts a sale line only when it adds up with the sale — whichever of the two bases saves more", () => {
  const outlet = { modules: { outlet: { combine: { types: ["code"] } } } };
  const rules = [orderPct("O", 10, adds("code")), orderPct("K", 10, { ...code(["KOD"]), ...adds("automatic", "outlet") })];
  const cart = (codes: string[]) => cartOf([pline("S1", 1, [], { outlet: true }), pline("N2", 1)], { enteredCodes: codes });
  // The automatic one alone: the sale line is out of its base.
  const auto = planCart(cart([]), payloadOf(rules, outlet));
  assert.equal(auto.order?.base, 100_00);
  assert.deepEqual(auto.order?.excludedLineIds, ["S1"]);
  // With the code: O + K on the ordinary line (20) ties with K alone on both lines (20) — the tie keeps the sale line out.
  const tie = planCart(cart(["KOD"]), payloadOf(rules, outlet));
  assert.equal(tie.order?.amount, 20_00);
  assert.deepEqual(tie.order?.excludedLineIds, ["S1"]);
  // A bigger code: 30 % of both lines (60) beats 10 % + 30 % of one (40).
  const wide = planCart(cart(["KOD"]), payloadOf([rules[0], orderPct("K", 30, { ...code(["KOD"]), ...adds("automatic", "outlet") })], outlet));
  assert.equal(wide.order?.amount, 60_00);
  assert.deepEqual(wide.order?.excludedLineIds, []);
  assert.deepEqual(wide.order?.components.map((c) => c.ruleId), ["K"]);
  assert.equal(outcome(wide, "O").state, "not_combinable");
});

test("shipping and the gift are not discounts of a sale line's price: a sale never stands in their way", () => {
  const cart = cartOf([pline("S1", 6, [], { outlet: true }), giftLine]);
  const plan = planCart(cart, payloadOf([freeShip("S", adds())], { modules: { rewards: { gifts: [GIFT], combine: { types: [] } } } }));
  assert.equal(plan.shipping?.ruleId, "S");
  // (The gift and the shipping rule themselves do not add up here: the gift stays paid for THAT reason.)
  assert.equal(plan.gifts[0].state, "not_combinable");
  const alone = planCart(cart, payloadOf([], { schemaVersion: 2, modules: { rewards: { gifts: [GIFT], combine: { types: [] } } } }));
  assert.equal(alone.gifts[0].state, "earned");
});

// --- the payload --------------------------------------------------------------------------------------

test("the payload carries every list in one text, `engine.cx`: the modules' masks, then each rule's mask and exceptions by position", () => {
  const payload = payloadOf([pct("A", 10, except(["code", "outlet"], "B")), pct("B", 5), orderPct("ms-1", 5, { name: "", minimum: { subtotal: { CZK: 1_00 } } }), pct("D", 4, adds("automatic"))], {
    modules: { tiers: { sets: [], combine: { types: ["automatic"] } }, rewards: { gifts: [], combine: { types: ["rewards"] } }, outlet: { combine: { types: [] } } },
  });
  // tiers 1, rewards 16, outlet 0 | A: code + outlet (34), names B (position 1) ; B nothing ; the Milníky discount nothing of its own ; D automatic (1).
  assert.deepEqual(payload.engine, { cx: "1.16.0|34:1;;;1" });
  for (const rule of payload.modules.codes.rules) assert.equal("c" in rule || "x" in rule, false, "no list on a rule: the function pays for every key it reads");
  // Empty entries at the end are left out; nothing anywhere: no key at all.
  assert.deepEqual(payloadOf([pct("A", 10, adds("code")), pct("B", 5)], { schemaVersion: 2, modules: { tiers: { sets: [], combine: { types: [] } }, rewards: { gifts: [], combine: { types: [] } } } }).engine, { cx: "0.0.0|2" });
  assert.deepEqual(payloadOf([pct("A", 10)], { schemaVersion: 2, modules: { tiers: { sets: [], combine: { types: [] } }, rewards: { gifts: [], combine: { types: [] } } } }).engine, {});
  const json = JSON.stringify(payload);
  assert.ok(!json.includes("combination") && !json.includes("combinesWith") && !json.includes("combineDefault"), json);
});

test("`engine.cx` is read tolerantly, and with it a rule's own `c` / `x` and `engine.mc` are not read at all", () => {
  const rule = (id: string, percent: number, more: Record<string, unknown> = {}) => ({ id, enabled: true, name: id, method: "automatic", value: { kind: "percentage", percent }, target: { kind: "products" }, ...more });
  const plan = (cx: unknown, rules: unknown[] = [rule("A", 10), rule("B", 5), rule("C", 4)], tiers?: unknown) =>
    planCart(cartOf([pline("L1", 3, ["A", "B", "C"])]), { engine: { cx, mc: [63, 63, 63] }, modules: { codes: { rules }, ...(tiers ? { tiers } : {}) } } as never);
  // A and B name each other's type; C has no entry (past the last one).
  assert.deepEqual(winners(plan("0.0.0|1;1"), "L1"), ["A", "B"]);
  // By exception, both sides; a one-sided one adds nothing up.
  assert.deepEqual(winners(plan("0.0.0|:1,2;:0,2;:0,1"), "L1"), ["A", "B", "C"]);
  assert.deepEqual(winners(plan("0.0.0|:1;;"), "L1"), ["A"]);
  // Junk parts are 0 or name nothing: a sign, a space, a letter, 3 digits of a mask, 6 of a position.
  assert.deepEqual(winners(plan("x.-1. 3|+1;1 ;001:1;"), "L1"), ["A"]);
  // (65 is no mask: B's list is empty; it still names A, and A names B's type → they add up.)
  assert.deepEqual(winners(plan("0.0.0|1:x,,123456;65:0"), "L1"), ["A", "B"]);
  assert.deepEqual(winners(plan("0.0.0|64;1"), "L1"), ["A"]);
  // No "|": no rule has a list. Not a text: the rules' own keys and `engine.mc` are read instead.
  assert.deepEqual(winners(plan("63.63.63"), "L1"), ["A"]);
  assert.deepEqual(winners(plan(undefined, [rule("A", 10, { c: 1 }), rule("B", 5, { c: 1 }), rule("C", 4)]), "L1"), ["A", "B"]);
  // With a text, a rule's own keys are not read.
  assert.deepEqual(winners(plan("0.0.0|", [rule("A", 10, { c: 1 }), rule("B", 5, { c: 1 })]), "L1"), ["A"]);
  // The modules' masks come from the text too: here the tiers (first) name automatic rules and A names tiers (8).
  const tiers = { global: "g", sets: [["g", "line", [], [[3, 10]]]] };
  assert.deepEqual(winners(plan("1.0.0|8", [rule("A", 20)], tiers), "L1"), ["A", "tier:g"]);
  assert.deepEqual(winners(plan("0.0.0|8", [rule("A", 20)], tiers), "L1"), ["A"]);
});

test("an exception is read by position or by id; a position that holds no rule, a fraction or a negative number names nothing", () => {
  const rule = (id: string, percent: number, x: unknown) => ({ id, enabled: true, name: id, method: "automatic", value: { kind: "percentage", percent }, target: { kind: "products" }, x });
  const plan = (rules: unknown[]) => planCart(cartOf([line("L1", 1000_00, 1, ["A", "B", "C"])]), { modules: { codes: { rules } } } as never);
  // By position (what the app ships) and by id (a payload made by hand), mixed.
  assert.deepEqual(winners(plan([rule("A", 10, [1]), rule("B", 5, ["A"]), rule("C", 4, [])]), "L1"), ["A", "B"]);
  // Positions count the payload's entries as they are: junk and a repeated id take a position and name nothing.
  assert.deepEqual(winners(plan([null, rule("A", 10, [3]), rule("A", 50, [3]), rule("B", 5, [1]), rule("C", 4, [2])]), "L1"), ["A", "B"]);
  assert.deepEqual(winners(plan([rule("A", 10, [1.5, -1, 9, "1", null, {}]), rule("B", 5, [0])]), "L1"), ["A"]);
  // As one text, what the app ships: positions joined by commas; any other part names nothing.
  assert.deepEqual(winners(plan([rule("A", 10, "1,2"), rule("B", 5, "0,2"), rule("C", 4, "0,1")]), "L1"), ["A", "B", "C"]);
  assert.deepEqual(winners(plan([rule("A", 10, " 1,+1,1.0,x,,123456,-1"), rule("B", 5, "0")]), "L1"), ["A"]);
  assert.deepEqual(winners(plan([rule("A", 10, "x,01,"), rule("B", 5, "0")]), "L1"), ["A", "B"]);
});

test("a payload written before the change (switches, combinesWith) reads as: nothing adds up", () => {
  const old = {
    schemaVersion: 1,
    campaignId: null,
    campaignVarsVersion: null,
    engine: { combination: { outletWithAnything: true, productWithProduct: "best", productWithOrder: true, productWithShipping: true, orderWithShipping: true } },
    marketCountries: {},
    modules: {
      codes: {
        rules: [
          { id: "A", enabled: true, name: "A", method: "automatic", value: { kind: "percentage", percent: 10 }, target: { kind: "products" }, combinesWith: { ruleIds: ["B"] } },
          { id: "B", enabled: true, name: "B", method: "automatic", value: { kind: "percentage", percent: 5 }, target: { kind: "products" } },
          { id: "O", enabled: true, name: "O", method: "automatic", value: { kind: "percentage", percent: 5 }, target: { kind: "order" } },
        ],
      },
      tiers: {},
      rewards: {},
      margin: { enabled: false },
    },
    campaigns: [],
  };
  const plan = planCart(cartOf([line("L1", 1000_00, 1, ["A", "B"]), line("L2", 1000_00, 1, [], { outlet: true })]), old as never);
  assert.deepEqual(winners(plan, "L1"), ["A"]);
  assert.equal(plan.order, null);
  assert.equal(lineOf(plan, "L2").excluded, "outlet");
  assert.equal(plan.totals.total, 1900_00);
});

test("a campaign's patched list replaces the rule's own while the campaign runs", async () => {
  const { buildNodeVars, campaignInputFromVars } = await import("../../src/discounts/function-payload.ts");
  const { configOf, FIXTURE_TZ } = await import("./engine-fixtures.ts");
  const config = configOf([pct("A", 10, except([], "B")), pct("B", 5, except([], "A"))], {
    campaigns: [{ id: "bf", name: "BF", window: { start: "2026-11-27T00:00:00", end: "2026-11-30T00:00:00" }, overrides: [{ ruleId: "A", patch: { combine: { types: [] } } }], killed: false }],
  });
  const { buildShopFunctionConfig } = await import("../../src/discounts/function-payload.ts");
  const now = "2026-11-28T10:00:00";
  const payload = buildShopFunctionConfig(config, { now, shopTimezone: FIXTURE_TZ }).payload;
  assert.deepEqual(payload.campaigns[0].overrides[0].patch, { c: 0, x: "" });
  const campaign = campaignInputFromVars(buildNodeVars({ kind: "automatic" }, config, now), now);
  const cart = [line("L1", 1000_00, 1, ["A", "B"])];
  assert.deepEqual(winners(planCart(cartOf(cart, { today: "2026-11-28", campaign }), payload), "L1"), ["A"]);
  assert.deepEqual(winners(planCart(cartOf(cart, { today: "2026-11-28" }), payload), "L1"), ["A", "B"]);
});

test("explain says in words why the gift is paid and why the milestone shipping is missing", () => {
  const cart = cartOf([line("L1", 1000_00, 1, ["A"]), giftLine]);
  const plan = planCart(cart, payloadOf([pct("A", 10, adds())], { modules: { rewards: { freeShipping: { threshold: { CZK: 500_00 } }, gifts: [GIFT], combine: { types: ["automatic"] } } } }));
  const cs = explainPlan(plan, "cs").map((i) => i.text);
  assert.ok(cs.includes("Dárek v košíku se zaplatí: nesčítá se se slevou v košíku (seznam „Sčítá se s“ v Milnících a u té slevy)."), cs.join("\n"));
  assert.ok(cs.includes("Doprava zdarma se nesčítá se slevou v košíku (seznam „Sčítá se s“ v Milnících a u té slevy)."), cs.join("\n"));
});
