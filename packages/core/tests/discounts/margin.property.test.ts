// Property test with margin protection ON (fixed seed): for random carts ×
// random configs × random margin settings, costs, currencies and rates,
//   - what all Won nodes emit together is exactly the plan;
//   - no line ends below its floor (floorUnit × quantity): after its product
//     discount, and after its share of the order discount under EITHER
//     proportional allocation (after or before product discounts, each share
//     rounded up);
//   - the function output applies exactly the plan whenever it is not degraded;
// plus the performance budget with margin and an order discount.

import assert from "node:assert/strict";
import { test } from "node:test";

import type { CartLineInput, CartPlanInput } from "../../src/discounts/cart.ts";
import { emitForNode, type NodeEmission } from "../../src/discounts/emit.ts";
import { explainPlan } from "../../src/discounts/explain.ts";
import { type CandidateValue, checkoutPreview } from "../../src/discounts/function-output.ts";
import { costMinorUnits, marginFloorUnit, readMarginPayload, resolveMargin } from "../../src/discounts/margin.ts";
import { toMinorUnits } from "../../src/discounts/money.ts";
import { planCart, type PlanLine } from "../../src/discounts/plan.ts";
import { payloadOf, type RawRule } from "./engine-fixtures.ts";

/** mulberry32: tiny deterministic PRNG, so a failure always reproduces. */
function rng(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (min: number, max: number) => min + Math.floor(next() * (max - min + 1));
  const pick = <T>(xs: readonly T[]): T => xs[int(0, xs.length - 1)];
  const chance = (p: number) => next() < p;
  return { next, int, pick, chance };
}

type Rng = ReturnType<typeof rng>;
const SHOP_CURRENCY = "CZK";
const CART_CURRENCIES = ["CZK", "CZK", "EUR", "JPY", "KWD"] as const;
const COLLECTIONS = ["11", "22", "33", "44"];

function pctRule(id: string, percent: number, extra: RawRule = {}): RawRule {
  return { id, name: id, method: "automatic", value: { kind: "percentage", percent }, target: { kind: "collections", ids: [] }, ...extra };
}

function randomRule(r: Rng, i: number, ids: string[]): RawRule {
  const id = `r${i}`;
  const valueKind = r.pick(["percentage", "percentage", "percentage", "fixed", "freeShipping"] as const);
  const amount = () => ({ CZK: r.int(1, 500) * 100, EUR: r.int(1, 50) * 100, JPY: r.int(1, 5000), KWD: r.int(1, 50) * 1000 });
  const value =
    valueKind === "percentage"
      ? { kind: "percentage", percent: r.pick([5, 10, 12.5, 20, 33, 50, 75, 100]) }
      : valueKind === "fixed"
        ? { kind: "fixed", amount: amount() }
        : { kind: "freeShipping" };
  const target =
    valueKind === "freeShipping"
      ? { kind: "shipping" }
      : r.pick([{ kind: "order" }, { kind: "order" }, { kind: "products", productIds: [], variantIds: [] }, { kind: "collections", ids: [] }]);
  const rule: RawRule = { id, name: `R${i}`, enabled: r.chance(0.95), method: r.chance(0.3) ? "code" : "automatic", value, target };
  if (rule.method === "code") rule.codes = [`C${i}A`, `C${i}B`];
  if (r.chance(0.3)) rule.priority = r.int(0, 3);
  if (r.chance(0.25)) rule.combinesWith = { ruleIds: ids.filter(() => r.chance(0.5)) };
  return rule;
}

function randomMargin(r: Rng) {
  const perCollection = COLLECTIONS.filter(() => r.chance(0.4)).map((id) => ({
    collectionId: `gid://shopify/Collection/${id}`,
    ...(r.chance(0.6) ? { minMarginPercent: r.pick([0, 5, 20, 40, 60, 95]) } : {}),
    ...(r.chance(0.6) ? { maxDiscountPercent: r.pick([0, 10, 25, 50, 90, 100]) } : {}),
  }));
  return {
    enabled: true,
    global: {
      ...(r.chance(0.7) ? { minMarginPercent: r.pick([0, 10, 25, 50, 80]) } : {}),
      maxDiscountPercent: r.pick([0, 10, 20, 35, 50, 70, 100]),
    },
    perCollection,
  };
}

function randomCase(r: Rng) {
  const ruleCount = r.int(1, 10);
  const ids = Array.from({ length: ruleCount }, (_, i) => `r${i}`);
  const rules = ids.map((_, i) => randomRule(r, i, ids));
  const currency = r.pick(CART_CURRENCIES);
  const scale = currency === "JPY" ? 1 : currency === "KWD" ? 1000 : 100;
  const lines: CartLineInput[] = Array.from({ length: r.int(1, 8) }, (_, i) => {
    const unitPrice = r.int(1, 3000) * r.pick([1, 10, 100]);
    const costKind = r.pick(["none", "below", "near", "above", "foreign"] as const);
    // Costs in major shop-currency units, roughly around the price (rate ~1 for the mix).
    const major = unitPrice / scale;
    const unitCost =
      costKind === "below" ? major * r.pick([0.1, 0.3, 0.5]) : costKind === "near" ? major * r.pick([0.8, 0.9, 0.99]) : major * 1.2;
    return {
      id: `gid://shopify/CartLine/${i}`,
      variantId: `gid://shopify/ProductVariant/${i}`,
      productId: `gid://shopify/Product/${i}`,
      quantity: r.int(1, 5),
      unitPrice,
      ruleIds: ids.filter(() => r.chance(0.5)),
      ...(costKind === "none" ? {} : { unitCost, unitCostCurrency: costKind === "foreign" ? "EUR" : SHOP_CURRENCY }),
      ...(r.chance(0.5) ? { marginRefs: COLLECTIONS.filter(() => r.chance(0.4)) } : {}),
      ...(r.chance(0.08) ? { outlet: true } : {}),
      ...(r.chance(0.05) ? { giftTierId: "gift" } : {}),
    };
  });
  const enteredCodes = rules.filter((rule) => rule.method === "code" && r.chance(0.7)).map((rule) => (rule.codes as string[])[0]);
  const engine = {
    outletWithAnything: r.chance(0.1),
    productWithOrder: r.chance(0.7),
    productWithShipping: r.chance(0.8),
    orderWithShipping: r.chance(0.8),
  };
  const rate = currency === SHOP_CURRENCY ? (r.chance(0.5) ? 1 : undefined) : r.chance(0.8) ? r.pick([0.9, 1, 1.1, 1.37]) : undefined;
  const input: CartPlanInput = { currency, lines, enteredCodes, today: "2026-10-01", ...(rate !== undefined ? { shopToCartRate: rate } : {}) };
  return { input, rules, engine, margin: randomMargin(r) };
}

test("property: with margin ON, emissions sum to the plan and no line ends below its floor (200 carts, seed 20260929)", () => {
  const r = rng(20260929);
  const seen = { cappedLines: 0, zeroedLines: 0, orders: 0, cappedOrders: 0, excludedLines: 0, marginFloor: 0, costBasis: 0, collection: 0 };
  for (let n = 0; n < 200; n++) {
    const { input, rules, engine, margin } = randomCase(r);
    const payload = payloadOf(rules, { engine: { combination: engine }, modules: { margin } }, { shopCurrency: SHOP_CURRENCY });
    const plan = planCart(input, payload);
    const where = `case ${n}`;
    assert.equal(plan.reason, undefined, `${where}: ${plan.error}`);

    const emissions: NodeEmission[] = [emitForNode(plan, { kind: "automatic" }, null)];
    for (const rule of plan.rules) {
      if (rule.method !== "code" || rule.enteredCodes.length === 0) continue;
      emissions.push(emitForNode(plan, { kind: "code", ruleId: rule.ruleId }, rule.enteredCodes[0]));
    }

    // The floor of every line, recomputed from the inputs with the exported helpers.
    const settingsPayload = readMarginPayload(payload.modules.margin);
    const floorOf = new Map<string, number>();
    for (const l of input.lines) {
      const settings = resolveMargin(settingsPayload, l.marginRefs ?? [])!;
      const costMinor = costMinorUnits(l.unitCost, l.unitCostCurrency, input.shopToCartRate, input.currency, SHOP_CURRENCY);
      const floor = marginFloorUnit({ unitPrice: l.unitPrice, costMinor, ...settings });
      floorOf.set(l.id, floor.floorUnit * l.quantity);
      if (floor.basis === "cost") seen.costBasis++;
      if (settings.source === "collection") seen.collection++;
    }

    for (const planLine of plan.lines) {
      const emitted = emissions.flatMap((e) => e.productCandidates.filter((c) => c.lineId === planLine.lineId));
      assert.ok(emitted.length <= 1, `${where}: ${emitted.length} product allocations on ${planLine.lineId}`);
      assert.equal(emitted[0]?.amount ?? 0, planLine.product?.amount ?? 0, `${where}: line ${planLine.lineId}`);
      const c = emitted[0];
      if (c?.percent !== undefined) assert.equal(c.amount, Math.round((planLine.subtotal * c.percent) / 100), where);
      if (c?.fixedPerItem !== undefined) assert.equal(c.amount, c.fixedPerItem * planLine.quantity, where);
      if (c?.fixedTotal !== undefined) assert.equal(c.amount, c.fixedTotal, where);
      if (planLine.excluded) {
        assert.equal(planLine.product, null, `${where}: excluded line discounted`);
        continue;
      }
      const after = planLine.subtotal - (planLine.product?.amount ?? 0);
      if (planLine.product) assert.ok(after >= floorOf.get(planLine.lineId)!, `${where}: ${planLine.lineId} below its floor after the product discount`);
      if (planLine.marginCapped) {
        seen.cappedLines++;
        if (planLine.marginCapped.after === 0) seen.zeroedLines++;
        assert.ok(planLine.marginCapped.after < planLine.marginCapped.before, where);
        assert.equal(planLine.product?.amount ?? 0, planLine.marginCapped.after, where);
        assert.equal(planLine.marginCapped.floorUnit * planLine.quantity, floorOf.get(planLine.lineId), `${where}: floor`);
        if (planLine.product) assert.deepEqual(planLine.product.value, { fixedTotal: planLine.marginCapped.after }, where);
      }
    }

    const orders = emissions.flatMap((e) => e.orderCandidates);
    assert.ok(orders.length <= 1, `${where}: ${orders.length} order candidates`);
    assert.equal(orders[0]?.amount ?? 0, plan.order?.amount ?? 0, `${where}: order`);
    if (plan.order) {
      seen.orders++;
      const order = plan.order;
      if (order.marginCapped) seen.cappedOrders++;
      seen.excludedLines += order.marginExcludedLineIds.length;
      assert.deepEqual(orders[0].excludedLineIds, order.excludedLineIds, where);
      for (const id of order.marginExcludedLineIds) assert.ok(order.excludedLineIds.includes(id), where);
      // The lines the order discount is taken from, and both allocation bases.
      const inBase = plan.lines.filter((l) => !order.excludedLineIds.includes(l.lineId));
      const afterOf = (l: (typeof plan.lines)[number]) => l.subtotal - (l.product?.amount ?? 0);
      const baseAfter = inBase.reduce((s, l) => s + afterOf(l), 0);
      assert.equal(order.base, baseAfter, `${where}: order base`);
      assert.ok(order.amount > 0 && order.amount <= order.base, where);
      const carrying = inBase.filter((l) => afterOf(l) > 0);
      const baseBefore = carrying.reduce((s, l) => s + l.subtotal, 0);
      for (const l of carrying) {
        const a = afterOf(l);
        const floor = floorOf.get(l.lineId)!;
        const shareAfter = Math.ceil((order.amount * a) / baseAfter);
        const shareBefore = Math.ceil((order.amount * l.subtotal) / baseBefore);
        assert.ok(a - shareAfter >= floor, `${where}: ${l.lineId} below its floor (after-product allocation)`);
        assert.ok(a - shareBefore >= floor, `${where}: ${l.lineId} below its floor (before-product allocation)`);
      }
    }
    seen.marginFloor += plan.rules.filter((rule) => rule.state === "margin_floor").length;

    // Every emitted value belongs to a rule whose own state says it applied.
    for (const c of [...emissions.flatMap((e) => e.productCandidates), ...orders]) {
      assert.equal(plan.rules.find((x) => x.ruleId === c.ruleId)?.state, "applied", `${where}: emitter ${c.ruleId}`);
    }

    // The function output applies exactly the plan (no percent re-rounding a capped value).
    const preview = checkoutPreview(plan);
    if (!preview.degraded) {
      for (const l of preview.lines) assert.equal(l.applied, l.planned, `${where}: output on ${l.lineId}`);
      assert.equal(preview.order.applied, preview.order.planned, `${where}: order output`);
    }

    for (const locale of ["cs", "en"] as const) {
      for (const audience of ["admin", "shopper"] as const) {
        for (const item of explainPlan(plan, locale, { audience })) {
          assert.doesNotMatch(item.text, /\b[a-z]+_[a-z_]+\b|\b[a-z]+[A-Z]\w*\b|undefined|NaN|null|\[object/, `${where}: ${item.text}`);
        }
      }
    }
  }
  // Every margin branch must actually be exercised, or the property is vacuous.
  assert.ok(seen.cappedLines > 40, `capped lines: ${seen.cappedLines}`);
  assert.ok(seen.zeroedLines > 10, `lines capped to 0: ${seen.zeroedLines}`);
  assert.ok(seen.orders > 30, `order discounts: ${seen.orders}`);
  assert.ok(seen.cappedOrders > 10, `margin-lowered order discounts: ${seen.cappedOrders}`);
  assert.ok(seen.excludedLines > 10, `lines left out of the order discount: ${seen.excludedLines}`);
  assert.ok(seen.marginFloor > 10, `margin_floor rules: ${seen.marginFloor}`);
  assert.ok(seen.costBasis > 100, `floors from a cost: ${seen.costBasis}`);
  assert.ok(seen.collection > 50, `collection settings: ${seen.collection}`);
});

// --- degraded output (over the output budget) ------------------------------------------------------

/** Minor units of a percent of `base`, rounded half UP in decimal: the most Shopify can take (percents ≤ 2 decimals). */
function worstPercent(base: number, percent: number): number {
  return Math.floor((base * Math.round(percent * 100) + 5000) / 10000);
}

/** What one output value can take off a plan line at most (a decimal tie rounded up). */
function worstOnLine(value: CandidateValue, line: PlanLine): number {
  if ("percentage" in value) return worstPercent(line.subtotal, value.percentage.value);
  const amount = toMinorUnits(value.fixedAmount.amount, "CZK") ?? 0;
  return value.fixedAmount.appliesToEachItem ? Math.min(amount, line.unitPrice) * line.quantity : Math.min(amount, line.subtotal);
}

test("property: DEGRADED outputs never take a line below its floor — any tie rounding, BOTH order allocations, code-owned orders included (16 carts × 200 lines, seed 20260930)", () => {
  const r = rng(20260930);
  const seen = { degraded: 0, relaxedTies: 0, relaxedStacks: 0, dropped: 0, tight: 0, orders: 0, fixedOrders: 0, codeOrders: 0 };
  const longName = (id: string) => `${id} ${"Velmi dlouhý název slevy ".repeat(10)}`.slice(0, r.int(120, 200));
  for (let n = 0; n < 16; n++) {
    const orderCode = r.chance(0.3);
    const rules: RawRule[] = [
      pctRule("A", r.pick([1.4, 10, 12.5]), { name: longName("A"), combinesWith: { ruleIds: ["B"] } }),
      { id: "B", name: longName("B"), method: "automatic", value: { kind: "fixed", amount: { CZK: r.int(1, 30) * 33 } }, target: { kind: "collections", ids: [] } },
      pctRule("C", r.pick([1.4, 15, 20]), { name: longName("C") }),
      {
        id: "O",
        name: "Objednávka",
        method: orderCode ? "code" : "automatic",
        ...(orderCode ? { codes: ["OBJ"] } : {}),
        value: { kind: "percentage", percent: r.pick([5, 10]) },
        target: { kind: "order" },
      },
    ];
    const baseLines: CartLineInput[] = Array.from({ length: 200 }, (_, i) => ({
      id: `L${i}`,
      variantId: `gid://shopify/ProductVariant/${i}`,
      productId: `gid://shopify/Product/${i}`,
      quantity: r.chance(0.7) ? 1 : r.int(2, 3),
      unitPrice: r.chance(0.5) ? 250 + 500 * r.int(0, 300) : r.int(10, 3000) * r.pick([10, 100]),
      ruleIds: r.chance(0.6) ? ["A", "B"] : r.chance(0.5) ? ["C"] : ["A"],
    }));
    const enteredCodes = orderCode ? ["OBJ"] : [];
    // Margin OFF first, to learn each line's product discount; then put ~30 % of the lines exactly at
    // their floor (cost = what the discount leaves) and give others a cost below or near the price.
    const off = planCart({ currency: "CZK", lines: baseLines, enteredCodes, today: "2026-10-01" }, payloadOf(rules));
    const lines = baseLines.map((l, i): CartLineInput => {
      const amount = off.lines[i].product?.amount ?? 0;
      if (l.quantity === 1 && amount > 0 && r.chance(0.3)) return { ...l, unitCost: (l.unitPrice - amount) / 100, unitCostCurrency: "CZK" };
      if (r.chance(0.3)) return { ...l, unitCost: (l.unitPrice / 100) * r.pick([0.5, 0.8, 0.95]), unitCostCurrency: "CZK" };
      return l;
    });
    const margin = { enabled: true, global: { maxDiscountPercent: r.pick([20, 50, 90]) }, perCollection: [] };
    const payload = payloadOf(rules, { modules: { margin } }, { shopCurrency: "CZK" });
    const plan = planCart({ currency: "CZK", lines, enteredCodes, today: "2026-10-01" }, payload);
    const where = `case ${n}`;
    assert.equal(plan.reason, undefined, where);
    const preview = checkoutPreview(plan);
    if (!preview.degraded) continue;
    seen.degraded++;
    seen.relaxedTies += preview.relaxedTies.length;
    seen.relaxedStacks += preview.degradedStacks.length;
    seen.dropped += preview.droppedCandidates.length;
    seen.tight += plan.lines.filter((l) => l.marginTight).length;
    const tight = new Set(plan.lines.filter((l) => l.marginTight).map((l) => l.lineId));
    assert.ok(preview.relaxedTies.every((t) => !tight.has(t.lineId)), `${where}: a tight line was relaxed to its percent`);

    const settings = readMarginPayload(payload.modules.margin);
    const floorOf = (l: PlanLine) => {
      const input = lines.find((x) => x.id === l.lineId)!;
      const s = resolveMargin(settings, input.marginRefs ?? [])!;
      const costMinor = costMinorUnits(input.unitCost, input.unitCostCurrency, undefined, "CZK", "CZK");
      return marginFloorUnit({ unitPrice: l.unitPrice, costMinor, ...s }).floorUnit * l.quantity;
    };
    // The most the output can take off each line as a product discount (every node).
    const product = new Map<string, number>();
    const orderCandidates: { value: CandidateValue; excluded: string[] }[] = [];
    for (const node of preview.nodes) {
      for (const op of node.output.lines.operations) {
        if ("productDiscountsAdd" in op) {
          for (const c of op.productDiscountsAdd.candidates) {
            for (const t of c.targets) {
              const pl = plan.lines.find((l) => l.lineId === t.cartLine.id)!;
              product.set(pl.lineId, (product.get(pl.lineId) ?? 0) + worstOnLine(c.value, pl));
            }
          }
        } else {
          for (const c of op.orderDiscountsAdd.candidates) orderCandidates.push({ value: c.value, excluded: c.targets[0].orderSubtotal.excludedCartLineIds });
        }
      }
    }
    for (const l of plan.lines) {
      if (l.excluded) continue;
      assert.ok(l.subtotal - (product.get(l.lineId) ?? 0) >= floorOf(l), `${where}: ${l.lineId} below its floor after the product output`);
    }
    // The order discount on what the lines really are after the (worst) product output.
    for (const c of orderCandidates) {
      seen.orders++;
      const inBase = plan.lines.filter((l) => !l.excluded && !c.excluded.includes(l.lineId));
      const after = (l: PlanLine) => l.subtotal - (product.get(l.lineId) ?? 0);
      const base = inBase.reduce((sum, l) => sum + after(l), 0);
      const carrying = inBase.filter((l) => after(l) > 0);
      const baseBefore = carrying.reduce((sum, l) => sum + l.subtotal, 0);
      // Margin on: every node emits its order discount as the plan's exact amount, never a percent.
      assert.ok("fixedAmount" in c.value, `${where}: an order percent with margin on`);
      const d = Math.min(toMinorUnits((c.value as { fixedAmount: { amount: string } }).fixedAmount.amount, "CZK") ?? 0, base);
      seen.fixedOrders++;
      if (orderCode) seen.codeOrders++;
      for (const l of carrying) {
        const a = after(l);
        assert.ok(a - Math.ceil((d * a) / base) >= floorOf(l), `${where}: ${l.lineId} below its floor (after-product allocation)`);
        assert.ok(a - Math.ceil((d * l.subtotal) / baseBefore) >= floorOf(l), `${where}: ${l.lineId} below its floor (before-product allocation)`);
      }
    }
  }
  assert.ok(seen.degraded >= 10, `degraded outputs: ${JSON.stringify(seen)}`);
  assert.ok(seen.relaxedTies > 0 && seen.relaxedStacks > 0 && seen.dropped > 0, JSON.stringify(seen));
  assert.ok(seen.tight > 100, JSON.stringify(seen));
  assert.ok(seen.fixedOrders > 10 && seen.codeOrders > 2, JSON.stringify(seen));
});

// --- performance -------------------------------------------------------------------------------

test("performance: 200 lines × 50 rules with margin protection and an order discount plans in well under 50 ms", () => {
  const rules: RawRule[] = Array.from({ length: 50 }, (_, i) => ({
    id: `r${i}`,
    name: `Rule ${i}`,
    method: i % 5 === 0 ? "code" : "automatic",
    ...(i % 5 === 0 ? { codes: [`CODE${i}`] } : {}),
    value: i % 3 === 0 ? { kind: "fixed", amount: { CZK: (i + 1) * 100 } } : { kind: "percentage", percent: (i % 40) + 1 },
    target: i % 10 === 9 ? { kind: "order" } : { kind: "collections", ids: [] },
    ...(i % 4 === 0 ? { combinesWith: { ruleIds: [`r${(i + 1) % 50}`, `r${(i + 7) % 50}`, `r${(i + 9) % 50}`] } } : {}),
    priority: i % 3,
  }));
  const margin = {
    enabled: true,
    global: { minMarginPercent: 15, maxDiscountPercent: 30 },
    perCollection: COLLECTIONS.map((id, k) => ({ collectionId: `gid://shopify/Collection/${id}`, minMarginPercent: 10 + k * 5 })),
  };
  const payload = payloadOf(rules, { modules: { margin } }, { shopCurrency: SHOP_CURRENCY });
  const input: CartPlanInput = {
    currency: "CZK",
    today: "2026-10-01",
    enteredCodes: ["CODE0", "CODE10", "CODE25"],
    shopToCartRate: 1,
    lines: Array.from({ length: 200 }, (_, i) => ({
      id: `gid://shopify/CartLine/${i}`,
      variantId: `gid://shopify/ProductVariant/${i}`,
      productId: `gid://shopify/Product/${i}`,
      quantity: (i % 4) + 1,
      unitPrice: 100_00 + i * 7,
      ruleIds: rules.filter((_, j) => (i + j) % 3 === 0).map((rule) => rule.id as string),
      ...(i % 3 === 0 ? {} : { unitCost: 40 + (i % 50), unitCostCurrency: SHOP_CURRENCY }),
      marginRefs: COLLECTIONS.filter((_, k) => (i + k) % 3 === 0),
    })),
  };
  const sample = planCart(input, payload);
  assert.ok(sample.order, "the order stage runs");
  assert.ok(sample.lines.some((l) => l.marginCapped), "margin caps lines");
  for (let i = 0; i < 5; i++) planCart(input, payload);
  const runs: number[] = [];
  for (let i = 0; i < 15; i++) {
    const start = performance.now();
    const plan = planCart(input, payload);
    emitForNode(plan, { kind: "automatic" }, null);
    runs.push(performance.now() - start);
  }
  runs.sort((a, b) => a - b);
  const median = runs[Math.floor(runs.length / 2)];
  assert.ok(median < 50, `planCart+emit 200×50 with margin: median ${median.toFixed(2)} ms, max ${runs[runs.length - 1].toFixed(2)} ms`);
});
