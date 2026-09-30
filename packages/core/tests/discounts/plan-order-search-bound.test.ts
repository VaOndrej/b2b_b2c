// The margin order search's bound on exact work ([spec], MVP 2 audit round 4):
// on each allocation base, a candidate set's limit D_max is evaluated line by
// line only while at most ORDER_SEARCH_EXACT_LINES (16) distinct lines have a
// rate within ORDER_SEARCH_NEAR (2⁻⁴⁸) of the set's smallest rate m; with more
// it is floor((total × m) × (1 − 2⁻⁴⁴)), which is never above the exact
// minimum (plan-margin.ts limitOnBase: fail closed, the order discount can only
// come out smaller, never below a line's floor). The Rust function does the
// same (order_search.rs), so its work per candidate set is bounded. Amounts are
// minor units (haléře).

import assert from "node:assert/strict";
import { test } from "node:test";

import { costMinorUnits, marginFloorUnit, readMarginPayload, resolveMargin } from "../../src/discounts/margin.ts";
import { planCart } from "../../src/discounts/plan.ts";
import {
  ORDER_SEARCH_EXACT_LINES,
  ORDER_SEARCH_NEAR,
  type OrderSetLine,
  type OrderSetResult,
  orderSetLimit,
  searchOrderSets,
} from "../../src/discounts/plan-margin.ts";
import { cartOf, costLine, line, marginPayloadOf, orderFixed, orderPct, pct } from "./engine-fixtures.ts";

const SAFE_BELOW = 1 - 2 ** -44;

/** mulberry32: a small seeded PRNG, so a failure always reproduces. */
function rng(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (n: number) => Math.floor(next() * n);
  return { int, pick: <T>(xs: readonly T[]): T => xs[int(xs.length)], chance: (p: number) => next() < p };
}
type Rng = ReturnType<typeof rng>;

const sums = (lines: readonly OrderSetLine[]): [number, number] => [lines.reduce((t, l) => t + l.after, 0), lines.reduce((t, l) => t + l.before, 0)];

/** The exact limit of a set: every line's value on both bases (the search before round 4). */
function exactLimit(lines: readonly OrderSetLine[], base: number, baseBefore: number): number {
  let limit = Number.POSITIVE_INFINITY;
  for (const l of lines) limit = Math.min(limit, Math.floor((l.headroom * base) / l.after), Math.floor((l.headroom * baseBefore) / l.before));
  return limit;
}

/** The search as it was before round 4 (every candidate set's limit exact): the reference for the unbounded cases. */
function exactSearch(lines: readonly OrderSetLine[], wantedAt: (base: number) => number): OrderSetResult {
  const bestOf = (keys: number[]): OrderSetResult => {
    const order = lines.map((_, i) => i).sort((x, y) => (keys[x] !== keys[y] ? keys[y] - keys[x] : x - y));
    let best: OrderSetResult = { members: [], amount: 0, base: 0, wanted: 0 };
    let [base, baseBefore] = [0, 0];
    for (let j = 0; j < order.length; j++) {
      base += lines[order[j]].after;
      baseBefore += lines[order[j]].before;
      if (j + 1 < order.length && keys[order[j + 1]] === keys[order[j]]) continue;
      const set = order.slice(0, j + 1);
      const wanted = wantedAt(base);
      const amount = Math.min(
        wanted,
        exactLimit(
          set.map((i) => lines[i]),
          base,
          baseBefore,
        ),
      );
      if (amount >= best.amount) best = { members: set, amount, base, wanted };
    }
    return { ...best, members: [...best.members].sort((x, y) => x - y) };
  };
  const byBefore = bestOf(lines.map((l) => l.headroom / l.before));
  const byAfter = bestOf(lines.map((l) => l.headroom / l.after));
  return byAfter.amount > byBefore.amount || (byAfter.amount === byBefore.amount && byAfter.members.length > byBefore.members.length) ? byAfter : byBefore;
}

/** k = 1..n: a = s = 100 k, h = 10 k — every rate exactly 0,1. */
const tied = (n: number): OrderSetLine[] => Array.from({ length: n }, (_, i) => ({ after: 100 * (i + 1), before: 100 * (i + 1), headroom: 10 * (i + 1) }));
const thirty = (base: number) => Math.min(Math.round((base * 30) / 100), base);

test("the constants: 16 exact lines, near = 2⁻⁴⁸", () => {
  assert.equal(ORDER_SEARCH_EXACT_LINES, 16);
  assert.equal(ORDER_SEARCH_NEAR, 2 ** -48);
});

test("16 distinct lines tied for the minimum: exact; 17: the bound, 1 haléř below; equal lines count once", () => {
  assert.deepEqual(orderSetLimit(tied(16), ...sums(tied(16))), { limit: 1_360, bounded: false });
  assert.deepEqual(orderSetLimit(tied(17), ...sums(tied(17))), { limit: 1_529, bounded: true });
  assert.equal(exactLimit(tied(17), ...sums(tied(17))), 1_530);
  assert.deepEqual(searchOrderSets(tied(17), thirty).best, { members: Array.from({ length: 17 }, (_, i) => i), amount: 1_529, base: 15_300, wanted: 4_590 });
  assert.equal(searchOrderSets(tied(17), thirty).bounded, true);
  // Two of 17 lines equal (the same h and price → the same value): 16 distinct, exact.
  const equal = [...tied(16), { after: 100, before: 100, headroom: 10 }];
  assert.deepEqual(orderSetLimit(equal, ...sums(equal)), { limit: 1_370, bounded: false });
  // Many copies of ONE line (the variants of a product at one price) never take the bound.
  const copies = Array.from({ length: 200 }, () => ({ after: 19_900, before: 19_900, headroom: 3_979 }));
  assert.deepEqual(orderSetLimit(copies, ...sums(copies)), { limit: 795_800, bounded: false });
  // A line whose rate is not within 2⁻⁴⁸ of the minimum is not near: 16 tied + one at 0,2 stays exact.
  const apart = [...tied(16), { after: 1_000, before: 1_000, headroom: 200 }];
  assert.deepEqual(orderSetLimit(apart, ...sums(apart)), { limit: 1_460, bounded: false });
  // Rates 1 ulp apart are near: 17 lines around 0,2 whose rates differ in the last bits.
  const ulps = Array.from({ length: 17 }, (_, i) => {
    const h = 2 ** 40 + 1_000_000_000 * i;
    return { after: 5 * h + 1, before: 5 * h + 1, headroom: h };
  });
  assert.ok(new Set(ulps.map((l) => l.headroom / l.after)).size > 1, "distinct rates");
  assert.equal(orderSetLimit(ulps, ...sums(ulps)).bounded, true);
});

test("property: the bound is never above any line's value — 1 000 000 sets from small, proportional, huge and near-0,2 lines", () => {
  const r = rng(20261001);
  const seen = { equal: 0, below: 0, wholeProducts: 0 };
  for (let c = 0; c < 1_000_000; c++) {
    const regime = r.int(5);
    const [h0, x0] = [1 + r.int(60), 61 + r.int(900)];
    const set: [number, number][] = Array.from({ length: 1 + r.int(5) }, () => {
      if (regime === 0) {
        const x = 1 + r.int(5_000);
        return [r.int(x + 1), x];
      }
      if (regime === 1) {
        const k = 1 + r.int(10_000);
        return [k * h0, k * x0];
      }
      if (regime === 2) {
        const x = 1 + r.int(2 ** 30) * 2 ** 16 + r.int(2 ** 16);
        return [Math.floor(x / (1 + r.int(20))), x];
      }
      if (regime === 3) {
        const h = 2 ** 40 + r.int(2 ** 31);
        return [h, 5 * h + 1 + r.int(3)];
      }
      // A price and the rounding reserve: h = a − floor − 1 with a percent floor.
      const a = 1 + r.int(10_000_000);
      return [Math.max(0, a - Math.ceil(a * r.pick([0.5, 0.8, 0.9, 0.95, 0.99])) - 1), a];
    });
    const largest = Math.max(...set.map(([, x]) => x));
    const total = regime === 1 ? x0 * (1 + r.int(2 ** 22)) : regime === 2 ? largest * (1 + r.int(64)) : largest + r.int(2 ** 36);
    let m = Number.POSITIVE_INFINITY;
    for (const [h, x] of set) m = Math.min(m, h / x);
    const bound = Math.floor(total * m * SAFE_BELOW);
    let exact = Number.POSITIVE_INFINITY;
    for (const [h, x] of set) exact = Math.min(exact, Math.floor((h * total) / x));
    assert.ok(bound <= exact, `${JSON.stringify(set)} × ${total}: bound ${bound} > exact ${exact}`);
    if (bound === exact) seen.equal++;
    else seen.below++;
    if (Number.isInteger(total * m)) seen.wholeProducts++;
  }
  assert.ok(seen.equal > 100_000 && seen.below > 100_000 && seen.wholeProducts > 100_000, JSON.stringify(seen));
});

/** Search lines with many tied or nearly tied rates (and ordinary ones, and copies). */
function clustered(r: Rng): { lines: OrderSetLine[]; percent: number } {
  // Half the sets: lines of one class and their copies only (a set whose X × m is whole).
  const onlyTied = r.chance(0.5);
  const n = 1 + r.int(60);
  const classes = Array.from({ length: onlyTied ? 1 : 1 + r.int(3) }, () => {
    const h0 = 1 + r.int(40);
    return { h0, x0: h0 + 1 + r.int(400), twice: r.chance(0.3) };
  });
  const lines: OrderSetLine[] = [];
  for (let i = 0; i < n; i++) {
    const roll = onlyTied ? r.int(10) % 7 : r.int(10);
    if (roll < 6) {
      const { h0, x0, twice } = r.pick(classes);
      const k = 1 + r.int(40);
      lines.push({ after: k * x0, before: twice ? 2 * k * x0 : k * x0, headroom: k * h0 });
    } else if (roll < 7) {
      const h = 2 ** 40 + r.int(2 ** 31);
      const a = 5 * h + 1 + r.int(2);
      lines.push({ after: a, before: a, headroom: h });
    } else if ((roll < 9 && !onlyTied) || lines.length === 0) {
      const a = 1 + r.int(200_000);
      lines.push({ after: a, before: a + r.int(a), headroom: r.int(a) });
    } else {
      lines.push({ ...r.pick(lines) });
    }
  }
  return { lines, percent: r.pick([5, 10, 30, 50, 90, 100]) };
}

test("property: without a bound the search is the exact one; with it, D never exceeds the exact D of its set or the exact search's (20 000 sets, seed 20261002)", () => {
  const r = rng(20261002);
  const seen = { bounded: 0, belowItsSet: 0, belowTheExactSearch: 0, exactSame: 0 };
  for (let c = 0; c < 20_000; c++) {
    const { lines, percent } = clustered(r);
    const wantedAt = (base: number) => Math.min(Math.round((base * percent) / 100), base);
    const search = searchOrderSets(lines, wantedAt);
    const exact = exactSearch(lines, wantedAt);
    const where = `case ${c}: ${JSON.stringify(lines)} ${percent} %`;
    if (!search.bounded) {
      assert.deepEqual(search.best, exact, where);
      seen.exactSame++;
      continue;
    }
    seen.bounded++;
    const best = search.best;
    assert.ok(best.amount <= exact.amount, where);
    if (best.members.length > 0) {
      const set = best.members.map((i) => lines[i]);
      const [base, baseBefore] = sums(set);
      assert.equal(best.base, base, where);
      const limit = exactLimit(set, base, baseBefore);
      assert.ok(best.amount <= limit, where);
      if (best.amount < limit && best.amount < best.wanted) seen.belowItsSet++;
    }
    if (best.amount < exact.amount) seen.belowTheExactSearch++;
  }
  assert.ok(seen.bounded > 1_000 && seen.belowItsSet > 100 && seen.belowTheExactSearch > 0 && seen.exactSame > 5_000, JSON.stringify(seen));
});

test("property: planCart over carts of 17–60 lines with proportional floors (the bound taken) never takes a line below its floor on either base (400 carts, seed 20261003)", () => {
  const r = rng(20261003);
  const seen = { orders: 0, lowered: 0, bounded: 0, excluded: 0 };
  const margin = { global: { minMarginPercent: 0, maxDiscountPercent: 100 } };
  for (let c = 0; c < 400; c++) {
    // Classes of lines: price k × P, cost floor k × (P − H) − 1 → h = k × H (after a product
    // percent p with P × p / 100 whole, h = k × (H − P × p / 100)): every rate of a class ties.
    const classes = Array.from({ length: 1 + r.int(2) }, () => {
      const P = 100 * (10 + r.int(90));
      return { P, H: Math.floor(P * r.pick([0.05, 0.1, 0.2, 0.3])), rule: r.pick([null, "p10", "p20"]) };
    });
    const lines = Array.from({ length: 17 + r.int(44) }, (_, i) => {
      if (r.chance(0.1)) return line(`L${i}`, 100 * (1 + r.int(5_000)), 1 + r.int(2), r.chance(0.5) ? ["p10"] : []);
      const { P, H, rule } = r.pick(classes);
      const k = 1 + r.int(40);
      return costLine(`L${i}`, k * P, (k * (P - H) - 1) / 100, 1, rule ? [rule] : []);
    });
    const rules = [pct("p10", 10), pct("p20", 20), r.chance(0.8) ? orderPct("O", r.pick([10, 20, 30, 50, 90])) : orderFixed("O", { CZK: 100 * (1_000 + r.int(100_000)) })];
    const payload = marginPayloadOf(rules, margin, {}, { shopCurrency: "CZK" });
    const input = cartOf(lines);
    const plan = planCart(input, payload);
    assert.equal(plan.reason, undefined, plan.error);
    const settings = readMarginPayload(payload.modules.margin);
    const floorOf = new Map(
      input.lines.map((l) => {
        const s = resolveMargin(settings, l.marginRefs ?? [])!;
        const costMinor = costMinorUnits(l.unitCost, l.unitCostCurrency, undefined, "CZK", "CZK");
        return [l.id, marginFloorUnit({ unitPrice: l.unitPrice, costMinor, ...s }).floorUnit * l.quantity];
      }),
    );
    const order = plan.order;
    if (!order) continue;
    seen.orders++;
    if (order.marginCapped) seen.lowered++;
    seen.excluded += order.marginExcludedLineIds.length;
    const inBase = plan.lines.filter((l) => !order.excludedLineIds.includes(l.lineId));
    const afterOf = (l: (typeof plan.lines)[number]) => l.subtotal - (l.product?.amount ?? 0);
    const baseAfter = inBase.reduce((s, l) => s + afterOf(l), 0);
    const carrying = inBase.filter((l) => afterOf(l) > 0);
    const baseBefore = carrying.reduce((s, l) => s + l.subtotal, 0);
    for (const l of carrying) {
      const a = afterOf(l);
      const floor = floorOf.get(l.lineId)!;
      assert.ok(a - Math.ceil((order.amount * a) / baseAfter) >= floor, `case ${c}: ${l.lineId} below its floor (after-product base)`);
      assert.ok(a - Math.ceil((order.amount * l.subtotal) / baseBefore) >= floor, `case ${c}: ${l.lineId} below its floor (before-product base)`);
    }
    // Was a bound taken? The search's own input, rebuilt from the plan.
    const searchLines = plan.lines
      .filter((l) => l.excluded === null && afterOf(l) > 0)
      .map((l) => ({ after: afterOf(l), before: l.subtotal, headroom: Math.max(0, afterOf(l) - floorOf.get(l.lineId)! - 1) }));
    const value = rules.find((x) => x.id === "O")!.value as { kind: "percentage"; percent: number } | { kind: "fixed"; amount: { CZK: number } };
    const wantedAt = (base: number) => Math.min(value.kind === "percentage" ? Math.round((base * value.percent) / 100) : Math.min(value.amount.CZK, base), base);
    if (searchOrderSets(searchLines, wantedAt).bounded) seen.bounded++;
  }
  assert.ok(seen.orders > 300 && seen.lowered > 100 && seen.bounded > 50, JSON.stringify(seen));
});
