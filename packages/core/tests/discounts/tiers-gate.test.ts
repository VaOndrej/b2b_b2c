// MVP 3 contract K1 on Free (BILL-1, plan-gate.ts): exactly one set applies to
// a product — the first set listing the product, else the first listing one of
// its collections, else the first global set. Free keeps the first global set
// (counted per product at most) and keeps every scoped set INERT (`breaks: []`)
// instead of removing it, so a product of a scoped set never falls back to the
// global set: stripping Pro never widens a product's tiers.

import assert from "node:assert/strict";
import { test } from "node:test";

import { sanitizeConfig, type TierSet, type WonDiscountsConfig } from "../../src/discounts/config.ts";
import type { CartLineInput } from "../../src/discounts/cart.ts";
import { buildShopFunctionConfig } from "../../src/discounts/function-payload.ts";
import { planCart } from "../../src/discounts/plan.ts";
import { explainGate, gateConfigForPlan } from "../../src/discounts/plan-gate.ts";
import { productMetafieldValue, productRuleIndex, type ProductTargetingInput } from "../../src/discounts/targeting.ts";
import { readTiersPayload, type TierSetRead } from "../../src/discounts/tiers.ts";

const P = (n: number) => `gid://shopify/Product/${n}`;
const C = (n: number) => `gid://shopify/Collection/${n}`;
const OPTS = { now: "2026-10-01T12:00:00", shopTimezone: "Europe/Prague" };

function tiersConfig(sets: unknown[]): WonDiscountsConfig {
  const { config, issues } = sanitizeConfig({ modules: { tiers: { sets } } });
  assert.deepEqual(issues, []);
  return config;
}

const PRO_SETS = [
  { id: "kolekce", scope: { collectionIds: [C(1)] }, countAcross: "cart", breaks: [{ minQty: 2, percent: 5 }] },
  { id: "global", scope: "global", countAcross: "cart", breaks: [{ minQty: 3, percent: 10 }] },
  { id: "produkt", scope: { productIds: [P(7)] }, countAcross: "line", breaks: [{ minQty: 4, amountOff: { CZK: 20_00 } }] },
  { id: "global-2", scope: "global", countAcross: "line", breaks: [{ minQty: 5, percent: 15 }] },
  { id: "prazdna", scope: { productIds: [P(9)] }, countAcross: "line", breaks: [] },
];

test("Free: scoped sets stay INERT (breaks: [], counting mode as it was), extra global sets go, config order kept", () => {
  const { config: free, stripped } = gateConfigForPlan(tiersConfig(PRO_SETS), "free");
  assert.deepEqual(free.modules.tiers.sets, [
    { id: "kolekce", scope: { collectionIds: [C(1)] }, countAcross: "cart", breaks: [] },
    { id: "global", scope: "global", countAcross: "product", breaks: [{ minQty: 3, percent: 10 }] },
    { id: "produkt", scope: { productIds: [P(7)] }, countAcross: "line", breaks: [] },
    { id: "prazdna", scope: { productIds: [P(9)] }, countAcross: "line", breaks: [] },
  ]);
  // A scoped set that had no break was not in force: nothing new to report about it.
  assert.deepEqual(
    stripped.map((s) => [s.capability, s.reason, s.entityId ?? null, s.count ?? null, s.removedIds ?? null]),
    [
      ["tier_set_scope", "removed", null, 2, ["kolekce", "produkt"]],
      ["tier_sets_extra", "removed", null, 1, ["global-2"]],
      ["tier_count_across_cart", "reduced", "global", null, null],
    ],
  );
});

test("Free: a product of a scoped set keeps its tierRef to the inert set, so it gets NO tier (never the global one)", () => {
  const { config: free } = gateConfigForPlan(tiersConfig(PRO_SETS), "free");
  const products: ProductTargetingInput[] = [
    { productId: P(1), variantIds: [], collectionIds: [C(1)] },
    { productId: P(7), variantIds: [], collectionIds: [] },
    { productId: P(8), variantIds: [], collectionIds: [C(2)] },
  ];
  const index = productRuleIndex(free, products);
  assert.equal(index.get(P(1))?.tierRef, "kolekce");
  assert.equal(index.get(P(7))?.tierRef, "produkt");
  assert.equal(index.get(P(8))?.tierRef, undefined, "no scoped set: the global set applies");
  const tiers = readTiersPayload(buildShopFunctionConfig(free, OPTS).payload.modules.tiers, "CZK");
  assert.equal(tiers.global, "global");
  assert.deepEqual(tiers.sets.get("kolekce")?.breaks, []);
  assert.deepEqual(tiers.sets.get("produkt")?.breaks, []);
  assert.equal(tiers.sets.has("global-2"), false);
});

test("explainGate: the scoped-set sentence says its products get no quantity tier on Free", () => {
  const [one] = explainGate([{ capability: "tier_set_scope", reason: "removed", count: 1, removedIds: ["a"] }], "cs");
  assert.equal(
    one.text,
    "1 sada množstevních slev pro vybrané produkty nebo kolekce ve Free neplatí, je to funkce Pro. Produkty v ní ve Free nedostanou žádnou množstevní slevu.",
  );
  const [two] = explainGate([{ capability: "tier_set_scope", reason: "removed", count: 2, removedIds: ["a", "b"] }], "cs");
  assert.equal(
    two.text,
    "2 sady množstevních slev pro vybrané produkty nebo kolekce ve Free neplatí, je to funkce Pro. Produkty v nich ve Free nedostanou žádnou množstevní slevu.",
  );
  const [en] = explainGate([{ capability: "tier_set_scope", reason: "removed", count: 1, removedIds: ["a"] }], "en");
  assert.equal(
    en.text,
    "1 quantity tier set for selected products or collections does not apply on Free; that is a Pro feature. Its products get no quantity tier on Free.",
  );
  const [ens] = explainGate([{ capability: "tier_set_scope", reason: "removed", count: 3, removedIds: ["a", "b", "c"] }], "en");
  assert.ok(ens.text.endsWith("Products in them get no quantity tier on Free."), ens.text);
});

// --- property: K1 as the engine sees it, and Free never widens ------------------------------------

/** mulberry32 (fixed seed: a failure always reproduces). */
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
  const subset = <T>(xs: readonly T[], p: number) => xs.filter(() => chance(p));
  return { int, pick, chance, subset };
}

const PRODUCT_POOL = Array.from({ length: 8 }, (_, i) => P(i + 1));
const COLLECTION_POOL = Array.from({ length: 5 }, (_, i) => C(i + 1));
const COUNT_RANK = { line: 0, product: 1, cart: 2 } as const;

function randomSets(r: ReturnType<typeof rng>): unknown[] {
  return Array.from({ length: r.int(0, 6) }, (_, i) => ({
    id: `s${i}`,
    scope: r.chance(0.4)
      ? "global"
      : { productIds: r.subset(PRODUCT_POOL, 0.25), collectionIds: r.subset(COLLECTION_POOL, 0.25) },
    countAcross: r.pick(["line", "product", "cart"] as const),
    breaks: Array.from({ length: r.int(0, 4) }, () =>
      r.chance(0.6)
        ? { minQty: r.int(1, 12), percent: r.pick([0, 5, 10, 12.5, 20, 50]) }
        : { minQty: r.int(1, 12), amountOff: r.chance(0.7) ? { CZK: r.int(1, 90) * 100 } : { CZK: r.int(1, 90) * 100, EUR: r.int(1, 9) * 100 } },
    ),
  }));
}

/** K1 straight from the config (a reference implementation, independent of targeting.ts). */
function k1(sets: readonly TierSet[], product: ProductTargetingInput): TierSet | null {
  const scoped = sets.filter((s) => s.scope !== "global");
  const listed = (ids: readonly string[] | undefined, want: readonly string[]) => (ids ?? []).some((id) => want.includes(id));
  return (
    scoped.find((s) => s.scope !== "global" && listed(s.scope.productIds, [product.productId])) ??
    scoped.find((s) => s.scope !== "global" && listed(s.scope.collectionIds, product.collectionIds)) ??
    sets.find((s) => s.scope === "global") ??
    null
  );
}

/** The set a line of `product` gets, the way the engine reads it: its tierRef, else the payload's global set. */
function engineSet(config: WonDiscountsConfig, product: ProductTargetingInput, currency: string): TierSetRead | null {
  const entry = productRuleIndex(config, [product]).get(product.productId)!;
  const tiers = readTiersPayload(buildShopFunctionConfig(config, OPTS).payload.modules.tiers, currency);
  const id = entry.tierRef ?? tiers.global;
  return id === null ? null : (tiers.sets.get(id) ?? null);
}

/** Per-item discount (minor units) of the highest offered break at `count`, for a unit price. */
function perItem(set: TierSetRead | null, count: number, unitPrice: number): number {
  const reached = set?.breaks.filter((b) => b.offered && b.minQty <= count).at(-1);
  if (!reached) return 0;
  return reached.percent !== null ? Math.round((unitPrice * reached.percent) / 100) : Math.min(reached.amount ?? 0, unitPrice);
}

test("property: on Pro every product gets exactly its K1 set; on Free its set is that one (never wider) or none — for any count cf ≤ cp", () => {
  const r = rng(20260930);
  let compared = 0;
  let inert = 0;
  for (let round = 0; round < 300; round++) {
    const { config } = sanitizeConfig({ modules: { tiers: { sets: randomSets(r) } } });
    const free = gateConfigForPlan(config, "free").config;
    for (let k = 0; k < 6; k++) {
      const product = { productId: r.pick(PRODUCT_POOL), variantIds: [], collectionIds: r.subset(COLLECTION_POOL, 0.3) };
      const expected = k1(config.modules.tiers.sets, product);
      for (const currency of ["CZK", "EUR"]) {
        const pro = engineSet(config, product, currency);
        assert.equal(pro?.id ?? null, expected?.id ?? null, `pro set of ${product.productId} (round ${round})`);
        if (expected) assert.equal(pro?.breaks.length, expected.breaks.length);
        const onFree = engineSet(free, product, currency);
        if (!onFree || onFree.breaks.length === 0) {
          inert++;
          continue;
        }
        // Free kept the product's own set: same id, the same breaks, counting no wider.
        assert.equal(onFree.id, pro?.id, `free set of ${product.productId} (round ${round})`);
        assert.deepEqual(onFree.breaks, pro!.breaks);
        assert.ok(COUNT_RANK[onFree.count] <= COUNT_RANK[pro!.count]);
        // Free counts fewer items (per product instead of across the cart): cf ≤ cp. The sanitizer keeps a
        // set of one kind with values that never fall, so fewer items never reach more (review I1).
        for (let cp = 1; cp <= 14; cp++) {
          for (let cf = 1; cf <= cp; cf++) {
            for (const price of [1234, 2000_00]) {
              assert.ok(perItem(onFree, cf, price) <= perItem(pro, cp, price), `round ${round}, ${currency}: cf ${cf} > cp ${cp}`);
            }
          }
        }
        compared++;
      }
    }
  }
  assert.ok(compared > 100 && inert > 100, `compared ${compared}, inert or none ${inert}`);
});

// --- the gated PLAN never gives more than the Pro plan (review I1) ------------------------------------

test("review I1: “3 ks −10 %, 10 ks −50 Kč/ks” cannot give more on Free — the set keeps one kind", () => {
  const { config, issues } = sanitizeConfig({
    modules: {
      tiers: {
        sets: [{ id: "g", scope: "global", countAcross: "cart", breaks: [{ minQty: 3, percent: 10 }, { minQty: 10, amountOff: { CZK: 50_00 } }] }],
      },
    },
  });
  assert.deepEqual(issues.map((i) => [i.code, i.params]), [["tier_break_other_kind", { minQty: 10 }]]);
  const cart = {
    currency: "CZK",
    enteredCodes: [],
    today: "2026-10-01",
    lines: [
      { id: "A", variantId: "gid://shopify/ProductVariant/1", productId: P(1), quantity: 3, unitPrice: 2000_00, ruleIds: [] },
      { id: "B", variantId: "gid://shopify/ProductVariant/2", productId: P(2), quantity: 7, unitPrice: 2000_00, ruleIds: [] },
    ],
  };
  const pro = planCart(cart, buildShopFunctionConfig(config, OPTS).payload);
  const free = planCart(cart, buildShopFunctionConfig(gateConfigForPlan(config, "free").config, OPTS).payload);
  assert.deepEqual(pro.lines.map((l) => l.product?.amount ?? 0), [600_00, 1400_00]);
  assert.deepEqual(free.lines.map((l) => l.product?.amount ?? 0), [600_00, 1400_00]);
});

const MARKETS = [
  { handle: "cz", currency: "CZK", enabled: true, countries: ["CZ"] },
  { handle: "sk", currency: "EUR", enabled: true, countries: ["SK"] },
];

function randomProConfig(r: ReturnType<typeof rng>): WonDiscountsConfig {
  const ruleIds = Array.from({ length: r.int(0, 6) }, (_, i) => `r${i}`);
  const rules = ruleIds.map((id) => {
    const target = r.pick([
      { kind: "products", productIds: r.subset(PRODUCT_POOL, 0.3), variantIds: [] },
      { kind: "collections", ids: r.subset(COLLECTION_POOL, 0.4) },
      { kind: "order" },
    ]);
    return {
      id,
      name: id,
      method: "automatic",
      value: r.chance(0.7) ? { kind: "percentage", percent: r.pick([5, 10, 15, 30]) } : { kind: "fixed", amount: { CZK: r.int(1, 200) * 100 } },
      target,
      ...(r.chance(0.3) ? { combinesWith: { ruleIds: ruleIds.filter(() => r.chance(0.5)) } } : {}),
      ...(r.chance(0.2) ? { targeting: { markets: [r.pick(["cz", "sk"])] } } : {}),
    };
  });
  const margin = r.chance(0.4)
    ? {
        enabled: true,
        global: { minMarginPercent: r.pick([0, 10]), maxDiscountPercent: r.pick([30, 60]) },
        perCollection: r.subset(COLLECTION_POOL, 0.4).map((collectionId) => ({ collectionId, maxDiscountPercent: r.pick([10, 50, 90]) })),
      }
    : { enabled: false, global: { maxDiscountPercent: 50 }, perCollection: [] };
  const { config } = sanitizeConfig({
    markets: MARKETS,
    engine: { combination: { productWithOrder: r.chance(0.8) } },
    modules: { codes: { rules }, tiers: { sets: randomSets(r) }, margin },
  });
  return config;
}

/** The cart lines as the function reads them for `config` (the sync writes each plan's own product metafields). */
function linesFor(config: WonDiscountsConfig, cart: { product: ProductTargetingInput; quantity: number; unitPrice: number; cost?: number }[]): CartLineInput[] {
  const index = productRuleIndex(config, cart.map((c) => c.product));
  return cart.map((c, i) => {
    const value = productMetafieldValue(index.get(c.product.productId)!);
    return {
      id: `L${i}`,
      variantId: c.product.variantIds[0],
      productId: c.product.productId,
      quantity: c.quantity,
      unitPrice: c.unitPrice,
      ruleIds: value.ruleIds,
      variantRuleIds: value.variantRuleIds,
      ...(value.marginRefs ? { marginRefs: value.marginRefs } : {}),
      ...(value.tierRef ? { tierRef: value.tierRef } : {}),
      ...(c.cost !== undefined ? { unitCost: c.cost, unitCostCurrency: "CZK" } : {}),
    };
  });
}

test("property: the Free-gated plan never gives more than the Pro plan (random configs × carts; per line while product and order combine, in total always)", () => {
  const r = rng(20261002);
  let lessOnFree = 0;
  let tierLines = 0;
  for (let round = 0; round < 250; round++) {
    const config = randomProConfig(r);
    const free = gateConfigForPlan(config, "free").config;
    const products = PRODUCT_POOL.map((productId, k) => ({
      productId,
      variantIds: [`gid://shopify/ProductVariant/${k + 1}`],
      collectionIds: r.subset(COLLECTION_POOL, 0.35),
    }));
    const cart = Array.from({ length: r.int(1, 8) }, () => ({
      product: r.pick(products),
      quantity: r.int(1, 6),
      unitPrice: r.int(1, 300) * 100,
      ...(r.chance(0.5) ? { cost: r.int(1, 300) } : {}),
    }));
    const countryCode = r.pick(["CZ", "SK"]);
    const plan = (cfg: WonDiscountsConfig) =>
      planCart(
        { currency: "CZK", countryCode, lines: linesFor(cfg, cart), enteredCodes: [], today: "2026-10-01" },
        buildShopFunctionConfig(cfg, { ...OPTS, shopCurrency: "CZK" }).payload,
      );
    const onPro = plan(config);
    const onFree = plan(free);
    const where = `round ${round}`;
    const total = (p: typeof onPro) => p.totals.productDiscount + p.totals.orderDiscount;
    assert.ok(total(onFree) <= total(onPro), `${where}: free ${total(onFree)} > pro ${total(onPro)}`);
    if (config.engine.combination.productWithOrder) {
      onPro.lines.forEach((l, i) => {
        assert.ok((onFree.lines[i].product?.amount ?? 0) <= (l.product?.amount ?? 0), `${where}: line ${l.lineId}`);
      });
    }
    if (total(onFree) < total(onPro)) lessOnFree++;
    tierLines += onPro.lines.filter((l) => l.product?.components.some((c) => c.module === "tiers")).length;
  }
  assert.ok(lessOnFree > 30 && tierLines > 100, `less on Free ${lessOnFree}, tier lines on Pro ${tierLines}`);
});
