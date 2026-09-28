// Property test (fixed seed): for random carts × random configs, what all Won
// nodes emit together is exactly the plan — never two product allocations on one
// line, never more than a line/subtotal — plus the performance budget.

import assert from "node:assert/strict";
import { test } from "node:test";

import type { CartLineInput, CartPlanInput } from "../../src/discounts/cart.ts";
import { emitForNode, type NodeEmission } from "../../src/discounts/emit.ts";
import { explainPlan } from "../../src/discounts/explain.ts";
import { planCart } from "../../src/discounts/plan.ts";
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
const CURRENCIES = ["CZK", "EUR"] as const;

function randomRule(r: Rng, i: number, ids: string[]): RawRule {
  const id = `r${i}`;
  const valueKind = r.pick(["percentage", "percentage", "fixed", "freeShipping"] as const);
  const value =
    valueKind === "percentage"
      ? { kind: "percentage", percent: r.pick([0, 5, 10, 12.5, 20, 33, 50, 100]) }
      : valueKind === "fixed"
        ? { kind: "fixed", amount: r.chance(0.8) ? { CZK: r.int(1, 500) * 100 } : { EUR: r.int(1, 50) * 100 } }
        : { kind: "freeShipping" };
  const target =
    valueKind === "freeShipping"
      ? { kind: "shipping" }
      : r.pick([{ kind: "order" }, { kind: "products", productIds: [], variantIds: [] }, { kind: "collections", ids: [] }, { kind: "shipping" }]);
  const rule: RawRule = {
    id,
    name: `R${i}`,
    enabled: r.chance(0.9),
    method: r.chance(0.35) ? "code" : "automatic",
    value,
    target,
  };
  if (rule.method === "code") rule.codes = [`C${i}A`, `C${i}B`];
  if (r.chance(0.3)) rule.priority = r.int(0, 3);
  if (r.chance(0.25)) {
    rule.minimum = r.chance(0.5) ? { subtotal: r.chance(0.8) ? { CZK: r.int(1, 30) * 100_00 } : { EUR: 10_00 } } : { quantity: r.int(1, 6) };
  }
  if (r.chance(0.15)) rule.combinesWith = { ruleIds: ids.filter(() => r.chance(0.4)) };
  if (r.chance(0.1)) rule.schedule = r.chance(0.5) ? { startsAt: "2026-12-01T00:00:00+01:00" } : { endsAt: "2026-09-01T00:00:00+01:00" };
  return rule;
}

function randomCase(r: Rng): { input: CartPlanInput; rules: RawRule[]; engine: Record<string, boolean> } {
  const ruleCount = r.int(1, 12);
  const ids = Array.from({ length: ruleCount }, (_, i) => `r${i}`);
  const rules = ids.map((_, i) => randomRule(r, i, ids));
  const lineCount = r.int(1, 10);
  const lines: CartLineInput[] = Array.from({ length: lineCount }, (_, i) => ({
    id: `gid://shopify/CartLine/${i}`,
    variantId: `gid://shopify/ProductVariant/${i}`,
    productId: `gid://shopify/Product/${i}`,
    quantity: r.int(1, 5),
    unitPrice: r.int(1, 3000) * r.pick([1, 10, 100]),
    ruleIds: ids.filter(() => r.chance(0.4)),
    ...(r.chance(0.1) ? { outlet: true } : {}),
    ...(r.chance(0.05) ? { giftTierId: "gift" } : {}),
  }));
  const enteredCodes = rules
    .filter((rule) => rule.method === "code" && r.chance(0.6))
    .flatMap((rule) => (r.chance(0.2) ? (rule.codes as string[]) : [(rule.codes as string[])[0]]));
  if (r.chance(0.2)) enteredCodes.push("FOREIGN");
  const engine = {
    outletWithAnything: r.chance(0.1),
    productWithOrder: r.chance(0.8),
    productWithShipping: r.chance(0.8),
    orderWithShipping: r.chance(0.8),
  };
  return {
    input: { currency: r.pick(CURRENCIES), lines, enteredCodes, today: "2026-10-01" },
    rules,
    engine,
  };
}

test("property: the sum of all nodes' emissions equals the plan (200 random carts, seed 20260928)", () => {
  const r = rng(20260928);
  let productAllocations = 0;
  let orderDiscounts = 0;
  let shippingDiscounts = 0;
  for (let n = 0; n < 200; n++) {
    const { input, rules, engine } = randomCase(r);
    const payload = payloadOf(rules, { engine: { combination: engine } });
    const plan = planCart(input, payload);
    const where = `case ${n}`;
    assert.equal(plan.reason, undefined, where);

    // Every node Shopify would run: the automatic one, plus each code rule's node
    // once per entered code of that rule (it runs with that triggering code).
    const emissions: NodeEmission[] = [emitForNode(plan, { kind: "automatic" }, null)];
    for (const rule of plan.rules) {
      if (rule.method !== "code") continue;
      const [first] = rule.enteredCodes;
      if (first) emissions.push(emitForNode(plan, { kind: "code", ruleId: rule.ruleId }, first));
    }

    for (const planLine of plan.lines) {
      const emitted = emissions.flatMap((e) => e.productCandidates.filter((c) => c.lineId === planLine.lineId));
      assert.ok(emitted.length <= 1, `${where}: ${emitted.length} product allocations on ${planLine.lineId}`);
      assert.equal(emitted[0]?.amount ?? 0, planLine.product?.amount ?? 0, `${where}: line ${planLine.lineId}`);
      assert.ok((planLine.product?.amount ?? 0) <= planLine.subtotal, `${where}: over the line`);
      if (planLine.excluded) assert.equal(planLine.product, null, `${where}: excluded line discounted`);
      const c = emitted[0];
      if (c?.percent !== undefined) assert.equal(c.amount, Math.round((planLine.subtotal * c.percent) / 100), where);
      if (c?.fixedPerItem !== undefined) assert.equal(c.amount, c.fixedPerItem * planLine.quantity, where);
      if (c?.fixedTotal !== undefined) assert.equal(c.amount, c.fixedTotal, where);
      if (c) assert.equal([c.percent, c.fixedPerItem, c.fixedTotal].filter((v) => v !== undefined).length, 1, where);
      if (planLine.product) productAllocations++;
    }

    const orders = emissions.flatMap((e) => e.orderCandidates);
    assert.ok(orders.length <= 1, `${where}: ${orders.length} order candidates`);
    assert.equal(orders[0]?.amount ?? 0, plan.order?.amount ?? 0, `${where}: order`);
    if (plan.order) {
      assert.ok(plan.order.amount <= plan.order.base, `${where}: order over the subtotal`);
      orderDiscounts++;
    }

    const deliveries = emissions.flatMap((e) => e.deliveryCandidates);
    assert.equal(deliveries.length, plan.shipping ? 1 : 0, `${where}: shipping`);
    if (plan.shipping) shippingDiscounts++;

    // Every emitted value belongs to a rule whose own state says it applied.
    const all = [...emissions.flatMap((e) => e.productCandidates), ...orders, ...deliveries];
    for (const c of all) {
      assert.equal(plan.rules.find((x) => x.ruleId === c.ruleId)?.state, "applied", `${where}: emitter ${c.ruleId}`);
    }

    // Explanations never leak internal keys (snake_case, camelCase, undefined/NaN).
    for (const locale of ["cs", "en"] as const) {
      for (const item of explainPlan(plan, locale)) {
        assert.doesNotMatch(item.text, /\b[a-z]+_[a-z_]+\b|\b[a-z]+[A-Z]\w*\b|undefined|NaN|null|\[object/, `${where}: ${item.text}`);
      }
    }
  }
  // The generator must actually exercise every category, or the property is vacuous.
  assert.ok(productAllocations > 100, `product allocations: ${productAllocations}`);
  assert.ok(orderDiscounts > 20, `order discounts: ${orderDiscounts}`);
  assert.ok(shippingDiscounts > 20, `shipping discounts: ${shippingDiscounts}`);
});

// --- performance -------------------------------------------------------------------------------

function bigCase() {
  const rules: RawRule[] = Array.from({ length: 50 }, (_, i) => ({
    id: `r${i}`,
    name: `Rule ${i}`,
    method: i % 5 === 0 ? "code" : "automatic",
    ...(i % 5 === 0 ? { codes: [`CODE${i}`] } : {}),
    value: i % 3 === 0 ? { kind: "fixed", amount: { CZK: (i + 1) * 100 } } : { kind: "percentage", percent: (i % 40) + 1 },
    target: i % 10 === 9 ? { kind: "order" } : { kind: "collections", ids: [] },
    ...(i % 4 === 0 ? { combinesWith: { ruleIds: [`r${(i + 1) % 50}`, `r${(i + 7) % 50}`] } } : {}),
    ...(i % 6 === 0 ? { minimum: { subtotal: { CZK: 100_00 } } } : {}),
    priority: i % 3,
  }));
  const lines: CartLineInput[] = Array.from({ length: 200 }, (_, i) => ({
    id: `gid://shopify/CartLine/${i}`,
    variantId: `gid://shopify/ProductVariant/${i}`,
    productId: `gid://shopify/Product/${i}`,
    quantity: (i % 4) + 1,
    unitPrice: 100_00 + i * 7,
    ruleIds: rules.filter((_, j) => (i + j) % 3 === 0).map((rule) => rule.id as string),
    ...(i % 17 === 0 ? { outlet: true } : {}),
  }));
  const input: CartPlanInput = {
    currency: "CZK",
    lines,
    enteredCodes: ["CODE0", "CODE10", "CODE25"],
    today: "2026-10-01",
  };
  return { input, payload: payloadOf(rules) };
}

test("performance: 200 lines × 50 rules plans in well under 50 ms", () => {
  const { input, payload } = bigCase();
  for (let i = 0; i < 5; i++) planCart(input, payload); // warm up the JIT
  const runs: number[] = [];
  for (let i = 0; i < 15; i++) {
    const start = performance.now();
    const plan = planCart(input, payload);
    emitForNode(plan, { kind: "automatic" }, null);
    runs.push(performance.now() - start);
  }
  runs.sort((a, b) => a - b);
  const median = runs[Math.floor(runs.length / 2)];
  // Printed so the report can quote real numbers.
  console.log(`planCart+emit 200×50: median ${median.toFixed(2)} ms, max ${runs[runs.length - 1].toFixed(2)} ms`);
  assert.ok(median < 50, `median ${median} ms`);
});

test("performance: the Pro worst case (50 rules all stacking, all on every one of 200 lines) stays under 50 ms", () => {
  const ids = Array.from({ length: 50 }, (_, i) => `r${i}`);
  const rules: RawRule[] = ids.map((id, i) => ({
    id,
    name: id,
    method: "automatic",
    value: { kind: "percentage", percent: (i % 30) + 1 },
    target: i % 10 === 9 ? { kind: "order" } : { kind: "collections", ids: [] },
    combinesWith: { ruleIds: ids },
  }));
  const payload = payloadOf(rules);
  const input: CartPlanInput = {
    currency: "CZK",
    today: "2026-10-01",
    enteredCodes: [],
    lines: Array.from({ length: 200 }, (_, i) => ({
      id: `L${i}`,
      variantId: `gid://shopify/ProductVariant/${i}`,
      productId: `gid://shopify/Product/${i}`,
      quantity: 2,
      unitPrice: 999_00 + i,
      ruleIds: ids,
    })),
  };
  for (let i = 0; i < 3; i++) planCart(input, payload);
  const runs: number[] = [];
  for (let i = 0; i < 9; i++) {
    const start = performance.now();
    planCart(input, payload);
    runs.push(performance.now() - start);
  }
  runs.sort((a, b) => a - b);
  const median = runs[4];
  console.log(`planCart Pro worst case 200×50 all stacking: median ${median.toFixed(2)} ms`);
  assert.ok(median < 50, `median ${median} ms`);
});
