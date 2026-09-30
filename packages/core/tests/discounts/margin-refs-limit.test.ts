// A product listing more than MAX_MARGIN_REFS (4) marginRefs ([spec], MVP 2
// audit round 4b): the sync never writes more (≤ 2 decisive, ≤ 4 in its
// transition bridge), but legacy or hand-made metafields can. Such a product is
// not resolved ref by ref: it takes the payload's strictest setting — every
// collection folded into the global values, as Free's plan-gate.ts folds them —
// which is never looser than any collection it could be in (fail closed), and
// the function never reads more than 4 refs a line (its instruction limit).

import assert from "node:assert/strict";
import { test } from "node:test";

import { normalizeCart } from "../../src/discounts/cart.ts";
import {
  buildMarginPayload,
  type FunctionMarginPayload,
  MAX_MARGIN_REFS,
  marginImpact,
  resolveMargin,
  resolveProductMargin,
  strictestMargin,
} from "../../src/discounts/margin.ts";
import { planCart } from "../../src/discounts/plan.ts";
import { gateConfigForPlan } from "../../src/discounts/plan-gate.ts";
import { cartOf, configOf, costLine, line, lineOf, marginPayloadOf, pct } from "./engine-fixtures.ts";

/** Global minimum 10 %, at most 50 %; collection 1 minimum 20 %, 2 at most 30 %, 3 minimum 5 % and at most 80 % (looser). */
const MARGIN = {
  global: { minMarginPercent: 10, maxDiscountPercent: 50 },
  perCollection: [
    { collectionId: "gid://shopify/Collection/1", minMarginPercent: 20 },
    { collectionId: "gid://shopify/Collection/2", maxDiscountPercent: 30 },
    { collectionId: "gid://shopify/Collection/3", minMarginPercent: 5, maxDiscountPercent: 80 },
  ],
};

test("the limit is 4 refs; normalizeCart counts the metafield's entries, junk included", () => {
  assert.equal(MAX_MARGIN_REFS, 4);
  const counted = (marginRefs: unknown) => {
    const l = normalizeCart(cartOf([line("L", 100_00, 1, [], { marginRefs: marginRefs as string[] })])).lines[0];
    return [l.marginRefCount, l.marginRefs.length];
  };
  assert.deepEqual(counted(["1", "2", "3", 4]), [4, 3]);
  assert.deepEqual(counted(["1", "2", "3", "4", null]), [5, 4]);
  assert.deepEqual(counted("12345"), [0, 0]);
  assert.deepEqual(counted(undefined), [0, 0]);
});

test("strictestMargin is the Free fold: every collection folded into the global values", () => {
  const pro = configOf([pct("A", 10)], { modules: { margin: { enabled: true, ...MARGIN } } });
  const payload = buildMarginPayload({ ...pro.modules.margin }, "CZK");
  assert.deepEqual(strictestMargin(payload), { minMarginPercent: 20, maxDiscountPercent: 30, source: "collection" });
  const free = gateConfigForPlan(pro, "free").config;
  const folded = buildMarginPayload({ ...free.modules.margin }, "CZK");
  assert.ok(folded.enabled && !folded.col);
  assert.deepEqual([folded.min, folded.max], [20, 30]);
  // Every collection looser than the global values: the global setting, source "global".
  assert.deepEqual(strictestMargin({ enabled: true, min: 10, max: 50, col: { 3: [5, 80] } }), { minMarginPercent: 10, maxDiscountPercent: 50, source: "global" });
  assert.equal(strictestMargin({ enabled: false }), null);
});

test("property: the strictest setting is never looser than the product's own collections, whichever they are (5 000 payloads, seed 20261004)", () => {
  let a = 20261004;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (n: number) => Math.floor(next() * n);
  for (let c = 0; c < 5_000; c++) {
    const col: Record<string, [number | null, number | null]> = {};
    const keys = Array.from({ length: 1 + int(8) }, (_, k) => String(k + 1));
    for (const key of keys) col[key] = [next() < 0.3 ? null : int(96), next() < 0.3 ? null : int(101)];
    const payload: FunctionMarginPayload = { enabled: true, ...(next() < 0.8 ? { min: int(96) } : {}), max: int(101), col };
    const strictest = strictestMargin(payload)!;
    const refs = keys.filter(() => next() < 0.5).concat(next() < 0.2 ? ["999"] : []);
    const own = resolveMargin(payload, refs)!;
    assert.ok(strictest.minMarginPercent >= own.minMarginPercent && strictest.maxDiscountPercent <= own.maxDiscountPercent, `case ${c}`);
    // At most 4 refs: exactly resolveMargin; more: the strictest.
    const many = [...refs, "1", "1", "1", "1", "1"];
    assert.deepEqual(resolveProductMargin(payload, refs.slice(0, 4)), resolveMargin(payload, refs.slice(0, 4)));
    assert.deepEqual(resolveProductMargin(payload, many), strictest);
  }
});

test("planCart: a line whose product lists 5+ refs takes the strictest floor; 4 are still read; junk entries count", () => {
  const payload = marginPayloadOf([pct("A", 90)], MARGIN, {}, { shopCurrency: "CZK" });
  const plan = planCart(
    cartOf([
      line("one", 1000_00, 1, ["A"], { marginRefs: ["3"] }),
      line("four", 1000_00, 1, ["A"], { marginRefs: ["3", "3", "3", "3"] }),
      line("five", 1000_00, 1, ["A"], { marginRefs: ["3", "3", "3", "3", "3"] }),
      costLine("junk5", 1000_00, 400, 1, ["A"], { marginRefs: ["3", "x", 7, null, "3"] as unknown as string[] }),
      costLine("cost1", 1000_00, 400, 1, ["A"], { marginRefs: ["3"] }),
    ]),
    payload,
  );
  const amount = (id: string) => lineOf(plan, id).product?.amount;
  assert.deepEqual(
    ["one", "four", "five", "junk5", "cost1"].map(amount),
    [800_00, 800_00, 300_00, 500_00, 578_94],
  );
  assert.equal(lineOf(plan, "five").marginCapped?.source, "collection");
  // Without collection settings the refs change nothing, however many.
  const global = planCart(cartOf([line("six", 1000_00, 1, ["A"], { marginRefs: ["1", "2", "3", "4", "5", "6"] })]), marginPayloadOf([pct("A", 90)], { global: MARGIN.global }));
  assert.equal(lineOf(global, "six").product?.amount, 500_00);
});

test("marginImpact follows the same rule (a variant whose product lists 5+ refs)", () => {
  const config = configOf([pct("A", 90)], { modules: { margin: { enabled: true, ...MARGIN } } });
  const variant = (id: string, marginRefs: string[]) => ({ productId: `P${id}`, variantId: `V${id}`, title: id, price: 1000_00, cost: null, ruleRefs: ["A"], marginRefs });
  const impact = marginImpact(config, [variant("one", ["3"]), variant("five", ["3", "3", "3", "3", "3"])], "CZK");
  assert.deepEqual(
    impact.rules[0].capped.map((c) => [c.variantId, c.allowed]),
    [
      ["Vfive", 300_00],
      ["Vone", 800_00],
    ],
  );
});
