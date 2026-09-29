// Margin-capped values in the function output (function-output.ts): a value the
// margin floor lowered is emitted as its exact amount, and the over-budget
// relaxation may only DROP it — never turn it back into a percent or its top
// rule's own value (Shopify would then take more than the floor allows).

import assert from "node:assert/strict";
import { test } from "node:test";

import { emitForNode } from "../../src/discounts/emit.ts";
import { checkoutPreview, mapToFunctionOutput } from "../../src/discounts/function-output.ts";
import { planCart, type CartPlan } from "../../src/discounts/plan.ts";
import { cartOf, fixed, line, lineOf, marginPayloadOf, orderPct, pct } from "./engine-fixtures.ts";

const ALL = ["PRODUCT", "ORDER", "SHIPPING"];

function autoOutput(plan: CartPlan) {
  return mapToFunctionOutput(emitForNode(plan, { kind: "automatic" }, null), { plan, classes: ALL, lineCount: plan.lines.length });
}

type ProductOp = { productDiscountsAdd: { candidates: { message: string; targets: { cartLine: { id: string } }[]; value: Record<string, unknown> }[] } };

function valueOn(out: ReturnType<typeof autoOutput>, lineId: string) {
  const op = out.lines.operations.find((o) => "productDiscountsAdd" in o) as ProductOp | undefined;
  return op?.productDiscountsAdd.candidates.find((c) => c.targets.some((t) => t.cartLine.id === lineId))?.value;
}

test("exact output: a capped stack whose total happens to equal its summed percent stays an exact amount", () => {
  // 10,05 Kč, A 10 % + B 10 % = 1,01 + 1,01; max 20 % → floor 8,04 → headroom 2,01 = round(10,05 × 20 %).
  const payload = marginPayloadOf(
    [pct("A", 10, { combinesWith: { ruleIds: ["B"] } }), pct("B", 10)],
    { global: { maxDiscountPercent: 20 } },
  );
  const plan = planCart(cartOf([line("L1", 10_05, 1, ["A", "B"])]), payload);
  assert.equal(lineOf(plan, "L1").product?.amount, 2_01);
  assert.ok(lineOf(plan, "L1").marginCapped);
  const out = autoOutput(plan);
  assert.equal(out.degraded, false);
  assert.deepEqual(valueOn(out, "L1"), { fixedAmount: { amount: "2.01", appliesToEachItem: true } });
});

test("over the output budget: capped lines keep their exact value (never degraded to the top rule), others degrade", () => {
  // degradedPlan of function-output.test.ts, with a 20 % ceiling that caps the cheaper lines.
  const lines = Array.from({ length: 200 }, (_, i) => line(`L${i + 1}`, 50_00 + (i + 1) * 101, 1, ["fix", "ten"]));
  const payload = marginPayloadOf(
    [fixed("fix", { CZK: 9_99 }, { name: "9,99 Kč z kusu", combinesWith: { ruleIds: ["ten"] } }), pct("ten", 10, { name: "Deset procent" })],
    { global: { maxDiscountPercent: 20 } },
  );
  const plan = planCart(cartOf(lines), payload);
  const capped = plan.lines.filter((l) => l.marginCapped);
  assert.ok(capped.length > 20 && capped.length < 200, `${capped.length} capped lines`);
  const out = autoOutput(plan);
  assert.equal(out.degraded, true);
  assert.ok(out.bytes <= out.budget);
  const cappedIds = new Set(capped.map((l) => l.lineId));
  assert.ok(out.degradedStacks.length > 0);
  assert.ok(out.degradedStacks.every((s) => !cappedIds.has(s.lineId)), "a capped line is never relaxed to its top rule");
  const dropped = new Set(out.droppedCandidates.flatMap((c) => c.lineIds));
  for (const l of capped) {
    if (dropped.has(l.lineId)) continue;
    const value = valueOn(out, l.lineId) as { fixedAmount?: { amount: string } } | undefined;
    assert.ok(value?.fixedAmount, `${l.lineId}: ${JSON.stringify(value)}`);
  }
  // What the checkout applies on a capped line is never more than the capped plan.
  const preview = checkoutPreview(plan);
  for (const l of preview.lines) if (cappedIds.has(l.lineId)) assert.ok(l.applied <= l.planned, `${l.lineId}: ${l.applied} > ${l.planned}`);
});

test("order: with margin on, every order discount is emitted as its exact amount (a lowered one, and a percent kept by leaving lines out)", () => {
  const lowered = planCart(cartOf([line("L1", 1000_00)]), marginPayloadOf([orderPct("O", 30)], { global: { maxDiscountPercent: 20 } }));
  const op = autoOutput(lowered).lines.operations.find((o) => "orderDiscountsAdd" in o) as {
    orderDiscountsAdd: { candidates: { value: unknown; targets: { orderSubtotal: { excludedCartLineIds: string[] } }[] }[] };
  };
  assert.deepEqual(op.orderDiscountsAdd.candidates[0].value, { fixedAmount: { amount: "199.99" } });
  const kept = planCart(
    cartOf([line("L1", 1000_00), line("L2", 1000_00, 1, [], { unitCost: 1000, unitCostCurrency: "CZK" })]),
    marginPayloadOf([orderPct("O", 10)], { global: { maxDiscountPercent: 50 } }),
  );
  // The plan keeps the natural percent (over fewer lines); with margin on the output is its exact amount.
  assert.deepEqual(kept.order?.value, { percent: 10 });
  const keptOp = autoOutput(kept).lines.operations.find((o) => "orderDiscountsAdd" in o) as typeof op;
  assert.deepEqual(keptOp.orderDiscountsAdd.candidates[0].value, { fixedAmount: { amount: "100.00" } });
  assert.deepEqual(keptOp.orderDiscountsAdd.candidates[0].targets, [{ orderSubtotal: { excludedCartLineIds: ["L2"] } }]);
  // The preview's order base is the lines the discount applies to.
  assert.deepEqual(checkoutPreview(kept).order, { planned: 100_00, applied: 100_00, base: 1000_00 });
});

test("over the budget: an UNCAPPED percent line sitting exactly at its floor is never relaxed to a percent (tie)", () => {
  // 1,4 % of 2 750 = 38,5 in decimal but 38.49999999999999 in floats: the plan takes 38, Shopify may take 39.
  // Even lines sit exactly at their floor (cost = price − discount), odd lines have room to spare.
  const name = `Jedna celá čtyři ${"Velmi dlouhý název slevy ".repeat(10)}`.slice(0, 200);
  const lines = Array.from({ length: 200 }, (_, i) => {
    const price = 250 + 500 * i; // every one a decimal tie at 1,4 %
    if (i % 2 === 1) return line(`L${i}`, price, 1, ["A"]);
    const discount = Math.round((price * 1.4) / 100);
    return line(`L${i}`, price, 1, ["A"], { unitCost: (price - discount) / 100, unitCostCurrency: "CZK" });
  });
  const plan = planCart(cartOf(lines), marginPayloadOf([pct("A", 1.4, { name })], { global: { maxDiscountPercent: 50 } }));
  const atFloor = plan.lines.filter((l) => l.marginTight);
  assert.equal(atFloor.length, 100);
  assert.ok(atFloor.every((l) => !l.marginCapped && l.product?.value.percent === 1.4), "uncapped percent lines");
  const out = autoOutput(plan);
  assert.equal(out.degraded, true);
  const floorIds = new Set(atFloor.map((l) => l.lineId));
  assert.ok(out.relaxedTies.length > 0, "the lines with room are relaxed");
  assert.ok(out.relaxedTies.every((t) => !floorIds.has(t.lineId)), "a line at its floor is never relaxed to its percent");
  for (const l of atFloor) {
    const value = valueOn(out, l.lineId);
    if (value) assert.ok(!("percentage" in value), `${l.lineId}: ${JSON.stringify(value)}`);
  }
});

test("over the budget with margin on: the degraded node emits its order discount as the exact amount", () => {
  // degradedPlan-style product output (over the budget) + a 10 % order discount on the same automatic node.
  const lines = Array.from({ length: 200 }, (_, i) => line(`L${i + 1}`, 50_00 + (i + 1) * 101, 1, ["fix", "ten"]));
  const rules = [
    fixed("fix", { CZK: 9_99 }, { name: "9,99 Kč z kusu", combinesWith: { ruleIds: ["ten"] } }),
    pct("ten", 10, { name: "Deset procent" }),
    orderPct("O", 10),
  ];
  const plan = planCart(cartOf(lines), marginPayloadOf(rules, { global: { maxDiscountPercent: 80 } }));
  assert.equal(plan.order?.marginProtected, true);
  assert.deepEqual(plan.order?.value, { percent: 10 });
  const out = autoOutput(plan);
  assert.equal(out.degraded, true);
  const op = out.lines.operations.find((o) => "orderDiscountsAdd" in o) as { orderDiscountsAdd: { candidates: { value: unknown }[] } };
  assert.deepEqual(op.orderDiscountsAdd.candidates[0].value, { fixedAmount: { amount: (plan.order!.amount / 100).toFixed(2) } });
  // The checkout never takes more order discount than planned, however much product discount it lost.
  const preview = checkoutPreview(plan);
  assert.ok(preview.order.applied <= preview.order.planned, `${preview.order.applied} > ${preview.order.planned}`);
});

test("margin on: a CODE-owned percent order next to an over-budget automatic product output is its exact amount — safe on both allocation bases", () => {
  // 199 filler lines with Pro stacks under long names push the automatic node over its output budget
  // (their stacks drop to the top rule → less product discount → a larger order base). The victim line V
  // has a 50 % product discount and a cost sized so that its share of the order discount, allocated on
  // PRE-discount prices, uses its whole headroom. A percent of the larger base would take V below its floor.
  const long = (id: string) => `${id} ${"Velmi dlouhý název slevy ".repeat(10)}`.slice(0, 200);
  const rules = [
    fixed("fix", { CZK: 9_99 }, { name: long("fix"), combinesWith: { ruleIds: ["ten"] } }),
    pct("ten", 10, { name: long("ten") }),
    pct("H", 50, { name: "Polovina" }),
    orderPct("O", 10, { method: "code", codes: ["OBJ"] }),
  ];
  const filler = Array.from({ length: 199 }, (_, i) => line(`L${i + 1}`, 50_00 + (i + 1) * 101, 1, ["fix", "ten"]));
  const victimPrice = 1000_00;
  const cart = (unitCost?: number) =>
    cartOf([...filler, line("V", victimPrice, 1, ["H"], unitCost ? { unitCost, unitCostCurrency: "CZK" } : {})], { enteredCodes: ["OBJ"] });
  const payload = marginPayloadOf(rules, { global: { maxDiscountPercent: 80 } });
  // Size V's floor from the plan without a cost: h_V = ceil(wanted × s_V / S0), floor = a_V − h_V − 1.
  const probe = planCart(cart(), payload);
  const base = probe.order!.base;
  const baseBefore = probe.lines.reduce((sum, l) => sum + l.subtotal, 0);
  const wanted = Math.round((base * 10) / 100);
  const afterV = victimPrice - lineOf(probe, "V").product!.amount;
  const floorV = afterV - Math.ceil((wanted * victimPrice) / baseBefore) - 1;
  const plan = planCart(cart(floorV / 100), payload);
  assert.equal(plan.order?.amount, wanted, "the full percent still fits the plan");
  assert.equal(plan.order?.ownerMethod, "code");
  const preview = checkoutPreview(plan);
  assert.equal(preview.nodes[0].output.degraded, true, "the automatic node is over its budget");
  const codeNode = preview.nodes.find((n) => n.role.kind === "code")!;
  const op = codeNode.output.lines.operations.find((o) => "orderDiscountsAdd" in o) as {
    orderDiscountsAdd: { candidates: { value: { fixedAmount?: { amount: string }; percentage?: unknown } }[] };
  };
  assert.deepEqual(op.orderDiscountsAdd.candidates[0].value, { fixedAmount: { amount: (wanted / 100).toFixed(2) } });
  // V on both bases, with what the checkout really applies as product discounts.
  const applied = new Map(preview.lines.map((l) => [l.lineId, l.applied]));
  const after = (id: string, subtotal: number) => subtotal - (applied.get(id) ?? 0);
  const realBase = plan.lines.reduce((sum, l) => sum + after(l.lineId, l.subtotal), 0);
  const d = Math.min(wanted, realBase);
  const aV = after("V", victimPrice);
  assert.ok(aV - Math.ceil((d * aV) / realBase) >= floorV, "after-product allocation");
  assert.ok(aV - Math.ceil((d * victimPrice) / baseBefore) >= floorV, "before-product allocation");
  // What the old percent would have taken on the larger base breaks the before-product allocation.
  const percentOfRealBase = Math.round((realBase * 10) / 100);
  assert.ok(aV - Math.ceil((percentOfRealBase * victimPrice) / baseBefore) < floorV, "the gap this closes");
});
