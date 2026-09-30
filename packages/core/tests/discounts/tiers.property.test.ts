// Property tests for quantity tiers in planCart (MVP 3, K2), fixed seeds:
//   1. tiers alone: every line gets exactly what an independent model of K1 +
//      K2 says (set by tierRef / global, the three count modes, the highest
//      offered break, the item-price cap, rounding);
//   2. tiers + rules + margin + engine switches: what all Won nodes emit
//      together is the plan — at most one product allocation a line, a tier
//      only from the automatic node and never inside a stack, never below a
//      line's margin floor;
//   3. performance: 200 lines, every line in a set, each count mode.

import assert from "node:assert/strict";
import { test } from "node:test";

import type { CartLineInput, CartPlanInput } from "../../src/discounts/cart.ts";
import { sanitizeConfig, type TierSet } from "../../src/discounts/config.ts";
import { emitForNode, type NodeEmission } from "../../src/discounts/emit.ts";
import { explainPlan } from "../../src/discounts/explain.ts";
import { mapToFunctionOutput } from "../../src/discounts/function-output.ts";
import { marginFloorUnit } from "../../src/discounts/margin.ts";
import { planCart } from "../../src/discounts/plan.ts";
import { payloadOf, type RawRule } from "./engine-fixtures.ts";

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
  return { int, pick, chance };
}
type Rng = ReturnType<typeof rng>;

const P = (n: number) => `gid://shopify/Product/${n}`;

function randomSets(r: Rng): Record<string, unknown>[] {
  return Array.from({ length: r.int(1, 5) }, (_, i) => ({
    id: `s${i}`,
    scope: r.chance(0.35) ? "global" : { productIds: [P(100 + i)] },
    countAcross: r.pick(["line", "product", "cart"] as const),
    breaks: Array.from({ length: r.int(0, 4) }, () =>
      r.chance(0.55)
        ? { minQty: r.int(1, 8), percent: r.pick([0, 5, 10, 12.5, 15, 33, 50, 100]) }
        : { minQty: r.int(1, 8), amountOff: r.chance(0.6) ? { CZK: r.int(1, 400) * 100 } : { CZK: r.int(1, 400) * 100, EUR: r.int(1, 20) * 100 } },
    ),
  }));
}

function randomLines(r: Rng, sets: readonly TierSet[], n: number): CartLineInput[] {
  const scoped = sets.filter((s) => s.scope !== "global").map((s) => s.id);
  return Array.from({ length: n }, (_, i) => {
    const tierRef = scoped.length > 0 && r.chance(0.5) ? r.pick(scoped) : r.chance(0.05) ? "gone" : undefined;
    return {
      id: `L${i}`,
      variantId: `gid://shopify/ProductVariant/${i}`,
      productId: P(r.int(1, 4)),
      quantity: r.int(1, 5),
      unitPrice: r.int(1, 3000) * r.pick([1, 10, 100]),
      ruleIds: [],
      ...(tierRef ? { tierRef } : {}),
      ...(r.chance(0.08) ? { outlet: true } : {}),
      ...(r.chance(0.04) ? { giftTierId: "gift" } : {}),
    };
  });
}

/** K1 + K2 straight from the sanitized sets: what each line gets from its tier, alone. */
function model(sets: readonly TierSet[], lines: readonly CartLineInput[], currency: string): Map<string, number> {
  const global = sets.find((s) => s.scope === "global");
  const setOf = (l: CartLineInput) => {
    if (l.tierRef === undefined) return global;
    const set = sets.find((s) => s.id === l.tierRef);
    return set && set.scope !== "global" ? set : undefined;
  };
  const eligible = lines.filter((l) => !l.outlet && !l.giftTierId && setOf(l));
  const out = new Map<string, number>();
  for (const l of eligible) {
    const set = setOf(l)!;
    const counted = eligible.filter(
      (o) => setOf(o) === set && (set.countAcross === "cart" || (set.countAcross === "product" ? o.productId === l.productId : o === l)),
    );
    const count = counted.reduce((sum, o) => sum + o.quantity, 0);
    let reached: { percent?: number; amount?: number } | null = null;
    for (const b of set.breaks) {
      if (b.minQty > count) continue;
      if (b.percent !== undefined) reached = { percent: b.percent };
      else if (b.amountOff?.[currency] !== undefined) reached = { amount: b.amountOff[currency] };
    }
    const subtotal = l.quantity * l.unitPrice;
    const amount = !reached
      ? 0
      : reached.percent !== undefined
        ? Math.round((subtotal * reached.percent) / 100)
        : Math.min(reached.amount!, l.unitPrice) * l.quantity;
    out.set(l.id, amount);
  }
  return out;
}

test("property: tiers alone — every line gets exactly the independent K1/K2 model (500 carts, seed 20260930)", () => {
  const r = rng(20260930);
  let discounted = 0;
  const modes = new Set<string>();
  for (let n = 0; n < 500; n++) {
    const { config } = sanitizeConfig({ modules: { tiers: { sets: randomSets(r) } } });
    const sets = config.modules.tiers.sets;
    const currency = r.pick(["CZK", "EUR"]);
    const lines = randomLines(r, sets, r.int(1, 12));
    const plan = planCart({ currency, lines, enteredCodes: [], today: "2026-10-01" }, payloadOf([], { modules: { tiers: { sets } } }));
    const expected = model(sets, lines, currency);
    for (const l of plan.lines) {
      assert.equal(l.product?.amount ?? 0, expected.get(l.lineId) ?? 0, `case ${n}, line ${l.lineId}`);
      if (l.product) {
        discounted++;
        assert.equal(l.product.components.length, 1);
        assert.equal(l.product.components[0].module, "tiers");
      }
    }
    for (const t of plan.tiers) if (t.state === "applied") modes.add(t.count);
  }
  assert.ok(discounted > 300, `discounted lines: ${discounted}`);
  assert.equal(modes.size, 3, [...modes].join(","));
});

test("property: tiers + rules + margin + switches — all nodes' emissions are the plan, a tier only from the automatic node (300 carts)", (t) => {
  const r = rng(20261001);
  let tierLines = 0;
  let cappedTiers = 0;
  for (let n = 0; n < 300; n++) {
    const where = `case ${n}`;
    const { config } = sanitizeConfig({ modules: { tiers: { sets: randomSets(r) } } });
    const sets = config.modules.tiers.sets;
    const ruleIds = Array.from({ length: r.int(0, 6) }, (_, i) => `r${i}`);
    const rules: RawRule[] = ruleIds.map((id, i) => ({
      id,
      name: `R${i}`,
      method: r.chance(0.3) ? "code" : "automatic",
      ...(r.chance(0.3) ? { codes: [`C${i}`] } : {}),
      value: r.chance(0.7) ? { kind: "percentage", percent: r.pick([5, 10, 12.5, 20]) } : { kind: "fixed", amount: { CZK: r.int(1, 300) * 100 } },
      target: r.chance(0.85) ? { kind: "products", productIds: [], variantIds: [] } : { kind: "order" },
      ...(r.chance(0.2) ? { combinesWith: { ruleIds: ruleIds.filter(() => r.chance(0.5)) } } : {}),
      ...(r.chance(0.2) ? { priority: r.int(0, 2) } : {}),
    }));
    for (const rule of rules) if (rule.method === "code" && !rule.codes) rule.method = "automatic";
    const marginOn = r.chance(0.4);
    const lines = randomLines(r, sets, r.int(1, 12)).map((l) => ({
      ...l,
      ruleIds: ruleIds.filter(() => r.chance(0.3)),
      ...(marginOn && r.chance(0.7) ? { unitCost: Math.round((l.unitPrice / 100) * r.pick([0.3, 0.8, 0.95, 1.1]) * 100) / 100, unitCostCurrency: "CZK" } : {}),
    }));
    const input: CartPlanInput = {
      currency: "CZK",
      lines,
      enteredCodes: rules.filter((x) => x.method === "code" && r.chance(0.6)).map((x) => (x.codes as string[])[0]),
      today: "2026-10-01",
    };
    const payload = payloadOf(rules, {
      modules: {
        tiers: { sets },
        margin: marginOn ? { enabled: true, global: { minMarginPercent: r.pick([0, 10, 20]), maxDiscountPercent: 30 }, perCollection: [] } : { enabled: false, global: { maxDiscountPercent: 50 }, perCollection: [] },
      },
      engine: { combination: { productWithOrder: r.chance(0.8), outletWithAnything: false } },
    });
    const plan = planCart(input, payload);
    assert.equal(plan.reason, undefined, where);
    const emissions: NodeEmission[] = [emitForNode(plan, { kind: "automatic" }, null)];
    for (const rule of plan.rules) {
      if (rule.method === "code" && rule.enteredCodes.length > 0) emissions.push(emitForNode(plan, { kind: "code", ruleId: rule.ruleId }, rule.enteredCodes[0]));
    }
    for (const planLine of plan.lines) {
      const emitted = emissions.flatMap((e) => e.productCandidates.filter((c) => c.lineId === planLine.lineId));
      assert.ok(emitted.length <= 1, `${where}: ${emitted.length} product allocations on ${planLine.lineId}`);
      assert.equal(emitted[0]?.amount ?? 0, planLine.product?.amount ?? 0, `${where}: ${planLine.lineId}`);
      const stack = planLine.product;
      if (!stack) continue;
      const tierComponents = stack.components.filter((c) => c.module === "tiers");
      if (tierComponents.length > 0) {
        tierLines++;
        assert.equal(stack.components.length, 1, `${where}: a tier inside a stack`);
        assert.ok(emissions[0].productCandidates.some((c) => c.lineId === planLine.lineId), `${where}: tier not from the automatic node`);
        assert.equal(plan.tiers.find((t) => t.ruleId === stack.ownerRuleId)?.state, "applied", where);
        if (planLine.marginCapped) cappedTiers++;
      } else {
        assert.equal(plan.rules.find((x) => x.ruleId === stack.ownerRuleId)?.state, "applied", where);
      }
      const input = lines.find((l) => l.id === planLine.lineId)!;
      if (marginOn && input.unitCost !== undefined) {
        const { floorUnit } = marginFloorUnit({
          unitPrice: planLine.unitPrice,
          costMinor: Math.min(input.unitCost * 1 * 100, 1e12),
          minMarginPercent: (payload.modules.margin as { min?: number }).min ?? 0,
          maxDiscountPercent: 30,
        });
        assert.ok(planLine.subtotal - stack.amount >= Math.min(planLine.subtotal, floorUnit * planLine.quantity), `${where}: below the floor`);
      }
    }
    // The function output of every node maps the plan without error, and explanations never leak keys.
    for (const e of emissions) mapToFunctionOutput(e, { plan, classes: ["PRODUCT", "ORDER", "SHIPPING"], lineCount: plan.lines.length });
    for (const locale of ["cs", "en"] as const) {
      for (const item of explainPlan(plan, locale)) {
        assert.doesNotMatch(item.text, /\b[a-z]+_[a-z_]+\b|tier:|undefined|NaN|null|\[object/, `${where}: ${item.text}`);
      }
    }
  }
  assert.ok(tierLines > 150, `tier lines: ${tierLines}`);
  assert.ok(cappedTiers > 10, `margin-capped tiers: ${cappedTiers}`);
  t.diagnostic(`tier lines ${tierLines}, margin-capped tiers ${cappedTiers}`);
});

// --- performance -------------------------------------------------------------------------------------

function bigTierCase(count: "line" | "product" | "cart") {
  const sets = Array.from({ length: 10 }, (_, i) => ({
    id: `set-${i}`,
    scope: i === 0 ? "global" : { productIds: [P(i)] },
    countAcross: count,
    // One kind a set (config/tiers.ts): percent sets and amount sets alternate.
    breaks: [1, 2, 3, 5, 10].map((minQty, k) => (i % 2 === 0 ? { minQty, percent: 8 + k * 4 } : { minQty, amountOff: { CZK: (k + 1) * 12_00 } })),
  }));
  const rules: RawRule[] = Array.from({ length: 20 }, (_, i) => ({
    id: `r${i}`,
    name: `R${i}`,
    method: "automatic",
    value: { kind: "percentage", percent: (i % 12) + 1 },
    target: { kind: "collections", ids: [] },
  }));
  const lines: CartLineInput[] = Array.from({ length: 200 }, (_, i) => ({
    id: `gid://shopify/CartLine/${i}`,
    variantId: `gid://shopify/ProductVariant/${i}`,
    productId: P(i % 60),
    quantity: (i % 4) + 1,
    unitPrice: 100_00 + i * 7,
    ruleIds: rules.filter((_, j) => (i + j) % 4 === 0).map((rule) => rule.id as string),
    ...(i % 60 >= 1 && i % 60 <= 9 ? { tierRef: `set-${i % 60}` } : {}),
    unitCost: 50 + (i % 30),
    unitCostCurrency: "CZK",
  }));
  const payload = payloadOf(rules, {
    modules: { tiers: { sets }, margin: { enabled: true, global: { minMarginPercent: 10, maxDiscountPercent: 40 }, perCollection: [] } },
  });
  return { input: { currency: "CZK", lines, enteredCodes: [], today: "2026-10-01" } as CartPlanInput, payload };
}

for (const count of ["line", "product", "cart"] as const) {
  test(`performance: 200 lines, every line in a tier set (count "${count}"), 20 rules, margin on — the automatic node < 50 ms`, (t) => {
    const { input, payload } = bigTierCase(count);
    const node = () => {
      const plan = planCart(input, payload);
      const emission = emitForNode(plan, { kind: "automatic" }, null);
      mapToFunctionOutput(emission, { plan, classes: ["PRODUCT", "ORDER", "SHIPPING"], lineCount: 200 });
      return plan;
    };
    const plan = node();
    assert.ok(plan.lines.filter((l) => l.product?.components[0].module === "tiers").length > 20, "tiers win somewhere");
    for (let i = 0; i < 3; i++) node();
    const runs: number[] = [];
    for (let i = 0; i < 11; i++) {
      const start = performance.now();
      node();
      runs.push(performance.now() - start);
    }
    runs.sort((a, b) => a - b);
    const median = runs[5];
    assert.ok(median < 50, `planCart + emit + output, 200 lines, count ${count}: median ${median.toFixed(2)} ms`);
    t.diagnostic(`count ${count}: median ${median.toFixed(2)} ms, max ${runs[runs.length - 1].toFixed(2)} ms`);
  });
}
