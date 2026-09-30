// The Pro stack cap ([spec], MVP 2 audit round 3): a stack is searched only
// among the MAX_STACK_CANDIDATES (6) best-ranked candidates of its target (rank
// = amount desc, priority desc, id asc). A candidate ranked lower is never part
// of a stack — even when it combines with every member — and counts as
// "outranked". The output changes only on targets with more than 6 positive
// candidates AND combinesWith links among them; margin protection caps what the
// search picked, as before. Amounts are minor units (haléře).

import assert from "node:assert/strict";
import { test } from "node:test";

import { MAX_STACK_CANDIDATES, planCart } from "../../src/discounts/plan.ts";
import { cartOf, costLine, line, lineOf, marginPayloadOf, orderPct, outcome, payloadOf, pct, type RawRule } from "./engine-fixtures.ts";

/** Rules A, B, … with these percents, every one combining with every other (a full Pro mesh). */
function mesh(percents: number[], extra: (k: number) => RawRule = () => ({}), make = pct): RawRule[] {
  const ids = percents.map((_, k) => String.fromCharCode(65 + k));
  return percents.map((p, k) => make(ids[k], p, { combinesWith: { ruleIds: ids.slice(k + 1) }, ...extra(k) }));
}
const components = (plan: ReturnType<typeof planCart>, lineId: string) =>
  lineOf(plan, lineId).product?.components.map((c) => [c.ruleId, c.amount]);

test("the stack cap is 6", () => {
  assert.equal(MAX_STACK_CANDIDATES, 6);
});

test("a full mesh of 8 rules on a line stacks only the 6 best-ranked; the 7th and 8th are outranked by the stack's owner", () => {
  const plan = planCart(cartOf([line("L1", 1000_00, 1, ["A", "B", "C", "D", "E", "F", "G", "H"])]), payloadOf(mesh([10, 9, 8, 7, 6, 5, 4, 3])));
  assert.deepEqual(components(plan, "L1"), [["A", 100_00], ["B", 90_00], ["C", 80_00], ["D", 70_00], ["E", 60_00], ["F", 50_00]]);
  assert.equal(lineOf(plan, "L1").product?.amount, 450_00);
  assert.equal(lineOf(plan, "L1").product?.ownerRuleId, "A");
  for (const id of ["G", "H"]) {
    assert.equal(outcome(plan, id).state, "outranked");
    assert.deepEqual(outcome(plan, id).betterRuleIds, ["A"]);
  }
  for (const id of ["B", "C", "D", "E", "F"]) assert.equal(outcome(plan, id).state, "combined");
});

test("exactly 6 candidates in a mesh all stack (the cap is inclusive)", () => {
  const plan = planCart(cartOf([line("L1", 1000_00, 1, ["A", "B", "C", "D", "E", "F"])]), payloadOf(mesh([10, 9, 8, 7, 6, 5])));
  assert.equal(lineOf(plan, "L1").product?.components.length, 6);
  assert.equal(lineOf(plan, "L1").product?.amount, 450_00);
});

test("the cap decides by rank, not by partners: a partner ranked 7th cannot join, the single best wins", () => {
  // A…F give 10–5 % and combine with nothing but G (4 %), which A lists.
  const rules = [
    pct("A", 10, { combinesWith: { ruleIds: ["G"] } }),
    pct("B", 9),
    pct("C", 8),
    pct("D", 7),
    pct("E", 6),
    pct("F", 5),
    pct("G", 4),
  ];
  const capped = planCart(cartOf([line("L1", 1000_00, 1, ["A", "B", "C", "D", "E", "F", "G"])]), payloadOf(rules));
  assert.deepEqual(components(capped, "L1"), [["A", 100_00]]);
  assert.deepEqual(lineOf(capped, "L1").product?.value, { percent: 10 });
  assert.equal(outcome(capped, "G").state, "outranked");
  assert.deepEqual(outcome(capped, "G").betterRuleIds, ["A"]);
  // The same pair with fewer candidates on the line: A + G stack as before.
  const pair = planCart(cartOf([line("L1", 1000_00, 1, ["A", "B", "G"])]), payloadOf(rules));
  assert.deepEqual(components(pair, "L1"), [["A", 100_00], ["G", 40_00]]);
});

test("the 6 best are ranked by amount, then priority desc, then id asc — on each line by its own amounts", () => {
  // Seven equal 5 % rules: the 7th by id (G) is left out; with priority 1, G is in and F (the last by id) out.
  const tie = mesh([5, 5, 5, 5, 5, 5, 5]);
  const byId = planCart(cartOf([line("L1", 1000_00, 1, ["G", "F", "E", "D", "C", "B", "A"])]), payloadOf(tie));
  assert.deepEqual(lineOf(byId, "L1").product?.components.map((c) => c.ruleId), ["A", "B", "C", "D", "E", "F"]);
  const withPriority = planCart(
    cartOf([line("L1", 1000_00, 1, ["A", "B", "C", "D", "E", "F", "G"])]),
    payloadOf(mesh([5, 5, 5, 5, 5, 5, 5], (k) => (k === 6 ? { priority: 1 } : {}))),
  );
  assert.deepEqual(lineOf(withPriority, "L1").product?.components.map((c) => c.ruleId), ["G", "A", "B", "C", "D", "E"]);
  assert.equal(outcome(withPriority, "F").state, "outranked");
  // A fixed 30 Kč per item ranks by money: 1st on a 100 Kč item, 7th (out) on a 1 000 Kč item.
  const withFixed = [
    ...mesh([10, 9, 8, 7, 6, 5]),
    { id: "X", name: "Rule X", method: "automatic", value: { kind: "fixed", amount: { CZK: 30_00 } }, target: { kind: "products", productIds: [], variantIds: [] }, combinesWith: { ruleIds: ["A", "B", "C", "D", "E", "F"] } },
  ];
  const refs = ["A", "B", "C", "D", "E", "F", "X"];
  const plan = planCart(cartOf([line("cheap", 100_00, 1, refs), line("dear", 1000_00, 1, refs)]), payloadOf(withFixed));
  assert.equal(lineOf(plan, "cheap").product?.components[0].ruleId, "X");
  assert.equal(lineOf(plan, "cheap").product?.components.some((c) => c.ruleId === "F"), false);
  assert.equal(lineOf(plan, "dear").product?.components.some((c) => c.ruleId === "X"), false);
});

test("the order stack is capped the same way: 7 order rules in a mesh stack the 6 best", () => {
  const plan = planCart(cartOf([line("L1", 1000_00)]), payloadOf(mesh([7, 6, 5, 4, 3, 2, 1], () => ({}), orderPct)));
  assert.deepEqual(plan.order?.components.map((c) => [c.ruleId, c.amount]), [["A", 70_00], ["B", 60_00], ["C", 50_00], ["D", 40_00], ["E", 30_00], ["F", 20_00]]);
  assert.equal(plan.order?.amount, 270_00);
  assert.deepEqual(plan.order?.value, { fixedTotal: 270_00 });
  assert.equal(outcome(plan, "G").state, "outranked");
});

test("margin protection caps the capped stack in rank order, as any stack", () => {
  // 1 000 Kč, cost 700 Kč, minimum margin 10 % → floor 777,78 Kč: headroom 222,22 Kč of the 450 Kč stack.
  const plan = planCart(
    cartOf([costLine("L1", 1000_00, 700, 1, ["A", "B", "C", "D", "E", "F", "G", "H"])]),
    marginPayloadOf(mesh([10, 9, 8, 7, 6, 5, 4, 3]), { global: { minMarginPercent: 10, maxDiscountPercent: 100 } }),
  );
  assert.deepEqual(components(plan, "L1"), [["A", 100_00], ["B", 90_00], ["C", 32_22]]);
  assert.deepEqual(lineOf(plan, "L1").marginCapped, {
    before: 450_00,
    after: 222_22,
    floorUnit: 777_78,
    basis: "cost",
    minMarginPercent: 10,
    source: "global",
  });
  for (const id of ["D", "E", "F"]) assert.equal(outcome(plan, id).state, "margin_floor");
  for (const id of ["G", "H"]) assert.equal(outcome(plan, id).state, "outranked");
});

/** mulberry32 */
function prng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

test("property: a line's stack is exactly the stack of its 6 best-ranked candidates alone (4 000 random lines)", () => {
  const rnd = prng(20260930);
  const int = (n: number) => Math.floor(rnd() * n);
  let pastCap = 0;
  let stacked = 0;
  for (let n = 0; n < 4000; n += 1) {
    const count = 2 + int(14);
    const ids = Array.from({ length: count }, (_, k) => `r${k}`);
    const density = [0.1, 0.3, 0.6, 1][int(4)];
    const rules: RawRule[] = ids.map((id, k) => {
      const partners = ids.slice(k + 1).filter(() => rnd() < density);
      const extra: RawRule = { priority: int(3), ...(partners.length > 0 ? { combinesWith: { ruleIds: partners } } : {}) };
      return rnd() < 0.3
        ? { id, name: `Rule ${id}`, method: "automatic", value: { kind: "fixed", amount: { CZK: 100 * (1 + int(40)) } }, target: { kind: "products", productIds: [], variantIds: [] }, ...extra }
        : pct(id, [1, 2, 5, 5, 10, 12.5, 20][int(7)], extra);
    });
    const refs = ids.filter(() => rnd() < 0.8);
    if (refs.length === 0) continue;
    const price = 100 * (50 + int(2000));
    const payload = payloadOf(rules);
    const plan = planCart(cartOf([line("L1", price, 1 + int(3), refs)]), payload);
    const stack = lineOf(plan, "L1").product;
    if (!stack) continue;
    // The 6 best-ranked candidates, from the plan's own outcomes: rank the line's
    // positive candidates as byRank does, keep 6, plan the line with only those.
    const amounts = new Map<string, number>();
    for (const id of refs) {
      const alone = planCart(cartOf([line("L1", price, lineOf(plan, "L1").quantity, [id])]), payload);
      const amount = lineOf(alone, "L1").product?.amount ?? 0;
      if (amount > 0) amounts.set(id, amount);
    }
    const priority = new Map(rules.map((r) => [r.id as string, r.priority as number]));
    const ranked = [...amounts.keys()].sort(
      (a, b) => (amounts.get(b) as number) - (amounts.get(a) as number) || (priority.get(b) as number) - (priority.get(a) as number) || (a < b ? -1 : a > b ? 1 : 0),
    );
    const best = ranked.slice(0, MAX_STACK_CANDIDATES);
    const alone = planCart(cartOf([line("L1", price, lineOf(plan, "L1").quantity, best)]), payload);
    assert.deepEqual(stack, lineOf(alone, "L1").product, `case ${n}`);
    for (const c of stack.components) assert.ok(best.includes(c.ruleId), `case ${n}: ${c.ruleId} is not among the 6 best`);
    if (stack.components.length > 1) stacked += 1;
    if (ranked.length > MAX_STACK_CANDIDATES && stack.components.length > 1) pastCap += 1;
  }
  assert.ok(stacked > 800 && pastCap > 300, `stacks ${stacked}, past the cap ${pastCap}`);
});
