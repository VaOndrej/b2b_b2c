// The discount function's output mapping (function-output.ts): the one TS
// implementation the Rust function (src/output.rs) is held to by the parity
// fixtures, and what the admin "Vyzkoušet košík" shows as "what the checkout
// will actually apply" (checkoutPreview).

import assert from "node:assert/strict";
import { test } from "node:test";

import { emitForNode } from "../../src/discounts/emit.ts";
import {
  checkoutPreview,
  mapToFunctionOutput,
  OUTPUT_BUDGET_BYTES,
  outputBudget,
  outputBytes,
  roundingTiePossible,
} from "../../src/discounts/function-output.ts";
import { planCart, type CartPlan } from "../../src/discounts/plan.ts";
import { cartOf, code, fixed, freeShip, line, orderPct, payloadOf, pct } from "./engine-fixtures.ts";

const AUTO = { kind: "automatic" } as const;
const ALL = ["PRODUCT", "ORDER", "SHIPPING"];

function autoOutput(plan: CartPlan, extra: { classes?: string[]; deliveryGroupIds?: string[] } = {}) {
  return mapToFunctionOutput(emitForNode(plan, AUTO, null), {
    plan,
    classes: extra.classes ?? ALL,
    lineCount: plan.lines.length,
    deliveryGroupIds: extra.deliveryGroupIds ?? [],
  });
}

const cl = (id: string) => ({ cartLine: { id } });
const percent = (value: number) => ({ percentage: { value } });
const perItem = (amount: string) => ({ fixedAmount: { amount, appliesToEachItem: true } });
const lineTotal = (amount: string) => ({ fixedAmount: { amount, appliesToEachItem: false } });

test("candidates with the same message and value share one candidate; a free item is 100 %", () => {
  const plan = planCart(
    cartOf([line("L1", 100_00, 1, ["A"]), line("L2", 249_90, 3, ["A"]), line("L3", 30_00, 2, ["F"]), line("L4", 80_00, 1, ["F"])]),
    payloadOf([pct("A", 10, { name: "Letní" }), fixed("F", { CZK: 50_00 }, { name: "50 Kč" })]),
  );
  const out = autoOutput(plan);
  assert.deepEqual(out.lines, {
    operations: [
      {
        productDiscountsAdd: {
          candidates: [
            { message: "Letní", targets: [cl("L1"), cl("L2")], value: percent(10) },
            { message: "50 Kč", targets: [cl("L3")], value: percent(100) },
            { message: "50 Kč", targets: [cl("L4")], value: perItem("50.00") },
          ],
          selectionStrategy: "ALL",
        },
      },
    ],
  });
  assert.equal(out.degraded, false);
  assert.deepEqual(out.droppedCandidates, []);
  assert.deepEqual(out.degradedStacks, []);
});

test("roundingTiePossible: a percent that lands on half a minor unit (in decimal) is a tie", () => {
  assert.equal(roundingTiePossible(1005, 10), true); // 100.5
  assert.equal(roundingTiePossible(1004, 10), false); // 100.4
  assert.equal(roundingTiePossible(500, 12.1), true); // 60.5
  // Half-way in decimal (what Shopify computes), not exactly in binary floating point:
  assert.equal(roundingTiePossible(2750, 1.4), true); // 38.49999999999999 (Math.round → 38; decimal 38.5)
  assert.equal(roundingTiePossible(2750, 2.2), true); // 60.50000000000001
  assert.equal(roundingTiePossible(1225, 10), true); // 122.5
  assert.equal(roundingTiePossible(9990, 15), true); // 1498.5
  assert.equal(roundingTiePossible(10000, 33.333), false);
  assert.equal(roundingTiePossible(0, 50), false);
});

test("a single percent on a half-way line is emitted as its exact amount (Shopify may round the tie the other way)", () => {
  const plan = planCart(
    cartOf([line("L1", 10_05, 1, ["A"]), line("L2", 10_04, 1, ["A"]), line("L3", 4_09, 3, ["A"]), line("L4", 5_00, 1, ["B"])]),
    payloadOf([pct("A", 10, { name: "Deset" }), pct("B", 12.1, { name: "Dvanáct" })]),
  );
  // L1: 100.5 → 101 planned; L3: 3 × 4.09 = 12.27 × 10 % = 122.7 → no tie; L4: 5.00 × 12.1 % = 60.5 → 61.
  assert.deepEqual(autoOutput(plan).lines.operations[0], {
    productDiscountsAdd: {
      candidates: [
        { message: "Deset", targets: [cl("L1")], value: perItem("1.01") },
        { message: "Deset", targets: [cl("L2"), cl("L3")], value: percent(10) },
        { message: "Dvanáct", targets: [cl("L4")], value: perItem("0.61") },
      ],
      selectionStrategy: "ALL",
    },
  });
  // A tie on a line of several items whose amount does not divide: once, on that line only.
  const odd = planCart(cartOf([line("L1", 3_35, 3, ["A"])]), payloadOf([pct("A", 10, { name: "Deset" })]));
  // 3 × 3.35 = 10.05 → 100.5 → 101, not divisible by 3.
  assert.deepEqual(autoOutput(odd).lines.operations[0], {
    productDiscountsAdd: { candidates: [{ message: "Deset", targets: [cl("L1")], value: lineTotal("1.01") }], selectionStrategy: "ALL" },
  });
});

test("a Pro stack of whole percents whose sum is a half-way tie is not emitted as the summed percent", () => {
  const rules = [pct("a", 10, { name: "A", combinesWith: { ruleIds: ["b"] } }), pct("b", 5, { name: "B" })];
  // 3 × 33.30 = 99.90: 10 % = 999, 5 % = 499.5 → 500; T = 1499 = round(1498.5), a tie.
  const tie = planCart(cartOf([line("L1", 33_30, 3, ["a", "b"])]), payloadOf(rules));
  assert.equal(tie.lines[0].product?.amount, 14_99);
  assert.deepEqual(autoOutput(tie).lines.operations[0], {
    productDiscountsAdd: { candidates: [{ message: "A + B", targets: [cl("L1")], value: lineTotal("14.99") }], selectionStrategy: "ALL" },
  });
  // No tie: the summed percent (groupable).
  const clean = planCart(cartOf([line("L1", 100_00, 1, ["a", "b"]), line("L2", 40_00, 1, ["a", "b"])]), payloadOf(rules));
  assert.deepEqual(autoOutput(clean).lines.operations[0], {
    productDiscountsAdd: { candidates: [{ message: "A + B", targets: [cl("L1"), cl("L2")], value: percent(15) }], selectionStrategy: "ALL" },
  });
});

test("an order percent on a half-way base is emitted as its exact amount", () => {
  const rules = [orderPct("O", 10, { name: "Objednávka" })];
  const tie = planCart(cartOf([line("L1", 10_05)]), payloadOf(rules));
  assert.deepEqual(autoOutput(tie).lines.operations, [
    {
      orderDiscountsAdd: {
        candidates: [{ message: "Objednávka", targets: [{ orderSubtotal: { excludedCartLineIds: [] } }], value: { fixedAmount: { amount: "1.01" } } }],
        selectionStrategy: "FIRST",
      },
    },
  ]);
  const clean = planCart(cartOf([line("L1", 10_00)]), payloadOf(rules));
  const op = autoOutput(clean).lines.operations[0] as { orderDiscountsAdd: { candidates: { value: unknown }[] } };
  assert.deepEqual(op.orderDiscountsAdd.candidates[0].value, percent(10));
});

test("delivery: a percent applies to every delivery group, a fixed amount to the first one only (the plan counts it once)", () => {
  const groups = ["gid://shopify/CartDeliveryGroup/1", "gid://shopify/CartDeliveryGroup/2"];
  const free = planCart(cartOf([line("L1", 100_00)]), payloadOf([freeShip("S", { name: "Zdarma" })]));
  assert.deepEqual(autoOutput(free, { deliveryGroupIds: groups }).delivery, {
    operations: [
      {
        deliveryDiscountsAdd: {
          candidates: [{ message: "Zdarma", targets: groups.map((id) => ({ deliveryGroup: { id } })), value: percent(100) }],
          selectionStrategy: "ALL",
        },
      },
    ],
  });
  const flat = planCart(
    cartOf([line("L1", 100_00)]),
    payloadOf([fixed("S", { CZK: 50_00 }, { name: "50 Kč z dopravy", target: { kind: "shipping" } })]),
  );
  assert.deepEqual(autoOutput(flat, { deliveryGroupIds: groups }).delivery, {
    operations: [
      {
        deliveryDiscountsAdd: {
          candidates: [{ message: "50 Kč z dopravy", targets: [{ deliveryGroup: { id: groups[0] } }], value: { fixedAmount: { amount: "50.00" } } }],
          selectionStrategy: "ALL",
        },
      },
    ],
  });
  assert.deepEqual(autoOutput(flat, { deliveryGroupIds: [] }).delivery, { operations: [] });
  assert.deepEqual(autoOutput(flat, { deliveryGroupIds: groups, classes: ["PRODUCT"] }).delivery, { operations: [] });
});

test("the planner never ranks shipping by a delivery cost the function does not know (TS-only input removed)", () => {
  const rules = [
    fixed("F", { CZK: 999_00 }, { name: "Fixní", target: { kind: "shipping" } }),
    pct("P", 50, { name: "Půl", target: { kind: "shipping" } }),
  ];
  const input = { ...cartOf([line("L1", 100_00)]), shippingAmount: 100_00 } as Parameters<typeof planCart>[0];
  const plan = planCart(input, payloadOf(rules));
  assert.equal(plan.shipping?.ruleId, "P", "percent ranks above a fixed amount, as in the function");
  assert.equal(plan.shipping?.amount, null);
});

test("classes: a node emits only the classes it was created with", () => {
  const plan = planCart(cartOf([line("L1", 100_00, 1, ["A"])]), payloadOf([pct("A", 10, { name: "A" }), orderPct("O", 5, { name: "O" })]));
  assert.deepEqual(
    autoOutput(plan, { classes: ["PRODUCT"] }).lines.operations.map((op) => Object.keys(op)[0]),
    ["productDiscountsAdd"],
  );
  assert.deepEqual(
    autoOutput(plan, { classes: ["ORDER"] }).lines.operations.map((op) => Object.keys(op)[0]),
    ["orderDiscountsAdd"],
  );
  assert.deepEqual(mapToFunctionOutput(emitForNode(plan, AUTO, null), { plan: null, classes: ALL, lineCount: 1 }).lines, {
    operations: [],
  });
});

test("the budget scales with the line count above 200, like Shopify's limit", () => {
  assert.equal(outputBudget(10), OUTPUT_BUDGET_BYTES);
  assert.equal(outputBudget(200), OUTPUT_BUDGET_BYTES);
  assert.equal(outputBudget(260), Math.floor((OUTPUT_BUDGET_BYTES * 260) / 200));
});

/** 200 lines, each with a different Pro stack amount (fixed per item + 10 %): over the budget exactly. */
function degradedPlan(): CartPlan {
  const lines = Array.from({ length: 200 }, (_, i) => line(`L${i + 1}`, 50_00 + (i + 1) * 101, 1, ["fix", "ten"]));
  return planCart(
    cartOf(lines),
    payloadOf([fixed("fix", { CZK: 9_99 }, { name: "9,99 Kč z kusu", combinesWith: { ruleIds: ["ten"] } }), pct("ten", 10, { name: "Deset procent" })]),
  );
}

test("over the budget: Pro stacks drop to their top rule, and the output says so", () => {
  const plan = degradedPlan();
  const out = autoOutput(plan);
  assert.equal(out.degraded, true);
  assert.ok(out.exactBytes > out.budget, `${out.exactBytes} > ${out.budget}`);
  assert.ok(out.bytes <= out.budget);
  assert.equal(out.bytes, outputBytes(out.lines));
  assert.equal(out.degradedStacks.length, 200);
  const first = out.degradedStacks[0];
  assert.equal(first.lineId, "L1");
  assert.ok(first.emitted < first.planned);
  assert.deepEqual(out.droppedCandidates, []);
});

test("last resort: the candidates that save the least are dropped until the output fits, and are listed", () => {
  const name = (id: string) => `${id} ${"Velmi dlouhý název slevy ".repeat(10)}`.slice(0, 200);
  const ids = Array.from({ length: 24 }, (_, k) => `t${k + 1}`);
  const lines = Array.from({ length: 200 }, (_, j) => {
    const i = j + 1;
    const cheap = Math.floor(i / 24) % 2 === 0;
    return line(`L${i}`, cheap ? (10 + (i % 17)) * 100 + 50 : (100 + (i % 23)) * 100, 1, [ids[i % 24]]);
  });
  const plan = planCart(cartOf(lines), payloadOf(ids.map((id) => fixed(id, { CZK: 30_00 }, { name: name(id) }))));
  const out = autoOutput(plan);
  assert.equal(out.degraded, true);
  assert.ok(out.droppedCandidates.length > 0);
  assert.ok(out.bytes <= out.budget);
  const kept = (out.lines.operations[0] as { productDiscountsAdd: { candidates: unknown[] } }).productDiscountsAdd.candidates.length;
  assert.ok(kept > 0);
  for (const dropped of out.droppedCandidates) assert.ok(dropped.lineIds.length > 0 && dropped.amount > 0);
});

test("checkoutPreview: per line what the checkout applies, every node included, and the shortfall when degraded", () => {
  const rules = [pct("A", 10, { name: "A" }), pct("C", 20, { ...code(["KOD"]), name: "Kód" }), orderPct("O", 5, { name: "O" })];
  const plan = planCart(
    cartOf([line("L1", 100_00, 1, ["A", "C"]), line("L2", 10_05, 1, ["A"])], { enteredCodes: ["kod"] }),
    payloadOf(rules),
  );
  const preview = checkoutPreview(plan);
  assert.deepEqual(
    preview.nodes.map((n) => [n.role.kind, n.triggeringCode]),
    [
      ["automatic", null],
      ["code", "KOD"],
    ],
  );
  assert.deepEqual(preview.lines, [
    { lineId: "L1", planned: 20_00, applied: 20_00 },
    { lineId: "L2", planned: 1_01, applied: 1_01 },
  ]);
  assert.deepEqual(preview.order, { planned: plan.order!.amount, applied: plan.order!.amount });
  assert.equal(preview.degraded, false);
  assert.equal(preview.shortfall, 0);

  const degraded = checkoutPreview(degradedPlan());
  assert.equal(degraded.degraded, true);
  assert.ok(degraded.shortfall > 0);
  const planned = degraded.lines.reduce((s, l) => s + l.planned, 0);
  const applied = degraded.lines.reduce((s, l) => s + l.applied, 0);
  assert.equal(degraded.shortfall, planned - applied);
});
