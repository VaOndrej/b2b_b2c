// Emission per node (spec §3 "Emise per uzel", verdicts C1/C2): every node runs
// the same plan and emits only its own part; one product allocation per line.

import assert from "node:assert/strict";
import { test } from "node:test";

import { emitForNode } from "../../src/discounts/emit.ts";
import { planCart } from "../../src/discounts/plan.ts";
import { cartOf, code, fixed, freeShip, line, orderPct, payloadOf, pct } from "./engine-fixtures.ts";

const AUTO = { kind: "automatic" } as const;
const codeNode = (ruleId: string) => ({ kind: "code", ruleId }) as const;

test("the automatic node emits only automatic winners; a code node only its own rule's", () => {
  const plan = planCart(
    cartOf([line("L1", 1000_00, 1, ["A"]), line("L2", 1000_00, 1, ["C"])], { enteredCodes: ["KOD"] }),
    payloadOf([pct("A", 10), pct("C", 20, code(["KOD"]))]),
  );
  const auto = emitForNode(plan, AUTO, null);
  assert.deepEqual(auto.productCandidates.map((c) => [c.lineId, c.ruleId]), [["L1", "A"]]);
  const node = emitForNode(plan, codeNode("C"), "KOD");
  assert.deepEqual(node.productCandidates.map((c) => [c.lineId, c.ruleId]), [["L2", "C"]]);
});

test("a code node emits only when the triggering code belongs to its rule (case-insensitive)", () => {
  const plan = planCart(
    cartOf([line("L1", 1000_00, 1, ["C"])], { enteredCodes: ["kod"] }),
    payloadOf([pct("C", 20, code(["KOD"]))]),
  );
  assert.equal(emitForNode(plan, codeNode("C"), "Kod").productCandidates.length, 1);
  assert.equal(emitForNode(plan, codeNode("C"), null).productCandidates.length, 0);
  assert.equal(emitForNode(plan, codeNode("C"), "OTHER").productCandidates.length, 0);
  assert.equal(emitForNode(plan, codeNode("X"), "KOD").productCandidates.length, 0);
});

test("a code that wins nothing: its node emits nothing (Shopify shows applicable:false)", () => {
  const plan = planCart(
    cartOf([line("L1", 1000_00, 1, ["A", "C"])], { enteredCodes: ["KOD"] }),
    payloadOf([pct("A", 30), pct("C", 10, code(["KOD"]))]),
  );
  const node = emitForNode(plan, codeNode("C"), "KOD");
  assert.deepEqual(node, { productCandidates: [], orderCandidates: [], deliveryCandidates: [] });
  assert.equal(plan.codes[0].state, "outranked");
});

test("candidate values map 1:1 to the function output: percent, fixed per item, summed total", () => {
  const plan = planCart(
    cartOf([line("P", 1000_00, 1, ["A"]), line("F", 200_00, 2, ["F"]), line("S", 1000_00, 1, ["X", "Y"])]),
    payloadOf([pct("A", 10), fixed("F", { CZK: 30_00 }), pct("X", 10, { combinesWith: { ruleIds: ["Y"] } }), pct("Y", 5)]),
  );
  const out = emitForNode(plan, AUTO, null).productCandidates;
  const byLine = Object.fromEntries(out.map((c) => [c.lineId, c]));
  assert.equal(byLine.P.percent, 10);
  assert.equal(byLine.P.amount, 100_00);
  assert.equal(byLine.F.fixedPerItem, 30_00);
  assert.equal(byLine.F.amount, 60_00);
  assert.equal(byLine.S.fixedTotal, 150_00);
  assert.equal(byLine.S.ruleId, "X");
  assert.equal(byLine.S.message, "Rule X + Rule Y");
  assert.equal(byLine.P.message, "Rule A");
});

test("the order candidate excludes outlet and gift lines", () => {
  const plan = planCart(
    cartOf([line("L1", 1000_00), line("O", 500_00, 1, [], { outlet: true }), line("G", 100_00, 1, [], { giftTierId: "g" })]),
    payloadOf([orderPct("R", 10)]),
  );
  const [candidate] = emitForNode(plan, AUTO, null).orderCandidates;
  assert.deepEqual(candidate.excludedLineIds, ["O", "G"]);
  assert.equal(candidate.percent, 10);
  assert.equal(candidate.amount, 100_00);
});

test("free shipping is a delivery candidate of 100 %", () => {
  const plan = planCart(cartOf([line("L1", 100_00)]), payloadOf([freeShip("S")]));
  const [candidate] = emitForNode(plan, AUTO, null).deliveryCandidates;
  assert.equal(candidate.percent, 100);
  assert.equal(candidate.ruleId, "S");
});

test("a stack of an automatic and a code rule is emitted once, by the node of the higher priority", () => {
  const rules = [pct("A", 10, { combinesWith: { ruleIds: ["C"] } }), pct("C", 5, { ...code(["KOD"]), priority: 3 })];
  const plan = planCart(cartOf([line("L1", 1000_00, 1, ["A", "C"])], { enteredCodes: ["KOD"] }), payloadOf(rules));
  assert.equal(emitForNode(plan, AUTO, null).productCandidates.length, 0);
  const [candidate] = emitForNode(plan, codeNode("C"), "KOD").productCandidates;
  assert.equal(candidate.fixedTotal, 150_00);
});

test("a message falls back to a human description when the rule has no name", () => {
  const plan = planCart(cartOf([line("L1", 1000_00)]), payloadOf([orderPct("O", 10, { name: "" })]));
  assert.equal(emitForNode(plan, AUTO, null).orderCandidates[0].message, "10 % z objednávky");
  const en = planCart(cartOf([line("L1", 1000_00)], { locale: "en" }), payloadOf([orderPct("O", 10, { name: "" })]));
  assert.equal(emitForNode(en, AUTO, null).orderCandidates[0].message, "10% off the order");
});

test("a plan without a usable config emits nothing from any node", () => {
  const plan = planCart(cartOf([line("L1", 1000_00, 1, ["A"])], { enteredCodes: ["KOD"] }), null);
  assert.equal(plan.reason, "config_missing");
  const empty = { productCandidates: [], orderCandidates: [], deliveryCandidates: [] };
  assert.deepEqual(emitForNode(plan, AUTO, null), empty);
  assert.deepEqual(emitForNode(plan, codeNode("C"), "KOD"), empty);
});
