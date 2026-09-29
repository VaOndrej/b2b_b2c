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

test("order: a margin-lowered order discount is a fixed amount; a percent kept by leaving lines out stays a percent", () => {
  const lowered = planCart(cartOf([line("L1", 1000_00)]), marginPayloadOf([orderPct("O", 30)], { global: { maxDiscountPercent: 20 } }));
  const op = autoOutput(lowered).lines.operations.find((o) => "orderDiscountsAdd" in o) as {
    orderDiscountsAdd: { candidates: { value: unknown; targets: { orderSubtotal: { excludedCartLineIds: string[] } }[] }[] };
  };
  assert.deepEqual(op.orderDiscountsAdd.candidates[0].value, { fixedAmount: { amount: "199.99" } });
  const kept = planCart(
    cartOf([line("L1", 1000_00), line("L2", 1000_00, 1, [], { unitCost: 1000, unitCostCurrency: "CZK" })]),
    marginPayloadOf([orderPct("O", 10)], { global: { maxDiscountPercent: 50 } }),
  );
  const keptOp = autoOutput(kept).lines.operations.find((o) => "orderDiscountsAdd" in o) as typeof op;
  assert.deepEqual(keptOp.orderDiscountsAdd.candidates[0].value, { percentage: { value: 10 } });
  assert.deepEqual(keptOp.orderDiscountsAdd.candidates[0].targets, [{ orderSubtotal: { excludedCartLineIds: ["L2"] } }]);
  // The preview's order base is the lines the discount applies to.
  assert.deepEqual(checkoutPreview(kept).order, { planned: 100_00, applied: 100_00, base: 1000_00 });
});
