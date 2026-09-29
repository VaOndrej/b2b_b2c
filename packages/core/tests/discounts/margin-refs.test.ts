// Decisive marginRefs (MVP 2 drift audit P1, controller ruling 1): a product's
// metafield carries at most 2 marginRefs — the collection with the strictest
// minimum margin and the one with the strictest maximum discount among the
// product's margin collections — and the engine's `resolveMargin` gives exactly
// the same settings on them as on all of the product's margin collections.
// A collection's empty field is the global value (resolveMargin), so
// "strictest" compares the values each collection EFFECTIVELY has.

import assert from "node:assert/strict";
import { test } from "node:test";

import type { WonDiscountsConfig } from "../../src/discounts/config.ts";
import { buildMarginPayload, readMarginPayload, resolveMargin, type FunctionMarginPayload } from "../../src/discounts/margin.ts";
import { productMetafieldValue, productRuleIndex } from "../../src/discounts/targeting.ts";
import { configOf } from "./engine-fixtures.ts";

const P = (n: number) => `gid://shopify/Product/${n}`;
const V = (n: number) => `gid://shopify/ProductVariant/${n}`;
const C = (n: number | string) => `gid://shopify/Collection/${n}`;

type Override = { collectionId: string; minMarginPercent?: number; maxDiscountPercent?: number };

function marginConfig(global: { minMarginPercent?: number; maxDiscountPercent: number }, perCollection: Override[]): WonDiscountsConfig {
  return configOf([], { modules: { margin: { enabled: true, global, perCollection } } });
}

function refsOf(config: WonDiscountsConfig, collectionIds: string[]): string[] {
  const entry = productRuleIndex(config, [{ productId: P(1), variantIds: [V(11)], collectionIds }]).get(P(1))!;
  return productMetafieldValue(entry).marginRefs ?? [];
}

test("decisive marginRefs: the collection with the highest minimum margin and the one with the lowest maximum discount", () => {
  const config = marginConfig({ minMarginPercent: 10, maxDiscountPercent: 50 }, [
    { collectionId: C(100), minMarginPercent: 30 },
    { collectionId: C(200), minMarginPercent: 20, maxDiscountPercent: 40 },
    { collectionId: C(300), maxDiscountPercent: 10 },
    { collectionId: C(400), minMarginPercent: 25, maxDiscountPercent: 30 },
  ]);
  assert.deepEqual(refsOf(config, [C(100), C(200), C(300), C(400)]), ["100", "300"]);
  assert.deepEqual(refsOf(config, [C(200), C(400)]), ["400"], "one collection strictest on both: one ref");
  assert.deepEqual(refsOf(config, [C(200)]), ["200"]);
});

test("decisive marginRefs: ties go to the smaller numeric id (not the smaller string)", () => {
  const config = marginConfig({ maxDiscountPercent: 50 }, [
    { collectionId: C(1000), minMarginPercent: 30 },
    { collectionId: C(999), minMarginPercent: 30 },
    { collectionId: C(20), maxDiscountPercent: 10 },
    { collectionId: C(3), maxDiscountPercent: 10 },
  ]);
  assert.deepEqual(refsOf(config, [C(1000), C(999), C(20), C(3)]), ["3", "999"]);
});

test("decisive marginRefs: a collection strictest on both wins a tie over two collections", () => {
  const config = marginConfig({ maxDiscountPercent: 50 }, [
    { collectionId: C(1), minMarginPercent: 30 },
    { collectionId: C(2), maxDiscountPercent: 10 },
    { collectionId: C(3), minMarginPercent: 30, maxDiscountPercent: 10 },
  ]);
  assert.deepEqual(refsOf(config, [C(1), C(2), C(3)]), ["3"]);
});

test("decisive marginRefs: an empty field is the global value, so a collection that leaves it empty can be the strictest", () => {
  // Global minimum 30 %: collection 5 sets only a maximum, so its minimum IS 30 % —
  // stricter than 100's own 10 % and 200's own 5 %.
  const config = marginConfig({ minMarginPercent: 30, maxDiscountPercent: 50 }, [
    { collectionId: C(100), minMarginPercent: 10 },
    { collectionId: C(200), minMarginPercent: 5, maxDiscountPercent: 20 },
    { collectionId: C(5), maxDiscountPercent: 40 },
  ]);
  const all = ["100", "200", "5"];
  const refs = refsOf(config, [C(100), C(200), C(5)]);
  assert.deepEqual(refs, ["200", "5"]);
  const payload = buildMarginPayload(config.modules.margin);
  assert.deepEqual(resolveMargin(payload, refs), resolveMargin(payload, all));
  assert.deepEqual(resolveMargin(payload, refs), { minMarginPercent: 30, maxDiscountPercent: 20, source: "collection" });
});

test("decisive marginRefs: collections without a value, other collections and protection off write nothing", () => {
  const perCollection = [{ collectionId: C(100) }, { collectionId: C(200), minMarginPercent: 20 }];
  const on = marginConfig({ maxDiscountPercent: 50 }, perCollection);
  assert.deepEqual(refsOf(on, [C(100), C(300)]), []);
  assert.deepEqual(refsOf(on, [C(100), C(200), C(300)]), ["200"]);
  const off = configOf([], { modules: { margin: { enabled: false, global: { maxDiscountPercent: 50 }, perCollection } } });
  assert.deepEqual(refsOf(off, [C(200)]), []);
});

test("decisive marginRefs: two overrides of one collection count as their merged (stricter) values, as the payload ships them", () => {
  const config = marginConfig({ maxDiscountPercent: 50 }, [
    { collectionId: C(7), minMarginPercent: 10 },
    { collectionId: C(8), minMarginPercent: 20 },
    { collectionId: C(7), minMarginPercent: 40 },
  ]);
  assert.deepEqual(refsOf(config, [C(7), C(8)]), ["7"]);
});

// --- Property: the decisive refs resolve exactly like all refs -----------------------------------

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
  return { int, pick, chance };
}
type Rng = ReturnType<typeof rng>;

// Few distinct values, so ties (between collections, and with the global values) are common.
const MINS = [undefined, 0, 10, 20.5, 30, 30, 95] as const;
const MAXES = [undefined, 0, 10, 25, 40, 40, 50, 100] as const;

function randomId(r: Rng): string {
  // 1–13 digits: numeric order differs from string order ("9" vs "10").
  const digits = r.pick([1, 2, 3, 13]);
  let id = String(r.int(1, 9));
  for (let i = 1; i < digits; i += 1) id += String(r.int(0, 9));
  return id;
}

function randomValues(r: Rng, ids: readonly string[]): Override[] {
  const perCollection: Override[] = [];
  for (const id of ids) {
    for (let copies = r.chance(0.15) ? 2 : 1; copies > 0; copies -= 1) {
      const m = r.chance(0.55) ? r.pick(MINS) : undefined;
      const p = r.chance(0.55) ? r.pick(MAXES) : undefined;
      perCollection.push({
        collectionId: C(id),
        ...(m === undefined ? {} : { minMarginPercent: m }),
        ...(p === undefined ? {} : { maxDiscountPercent: p }),
      });
    }
  }
  return perCollection;
}

function randomGlobal(r: Rng) {
  const min = r.pick(MINS);
  return { ...(min === undefined ? {} : { minMarginPercent: min }), maxDiscountPercent: r.pick(MAXES) ?? 50 };
}

function randomCase(r: Rng) {
  const ids = [...new Set(Array.from({ length: r.int(1, 9) }, () => randomId(r)))];
  const member = ids.filter(() => r.chance(0.7));
  const collectionIds = [...member.map((id) => C(id)), ...(r.chance(0.5) ? [C(randomId(r) + "0")] : [])];
  return { ids, config: marginConfig(randomGlobal(r), randomValues(r, ids)), collectionIds };
}

/** The ruling's literal reading: the highest SET minimum and the lowest SET maximum (smaller id on ties). */
function literalRefs(payload: FunctionMarginPayload, keys: readonly string[]): string[] {
  if (!payload.enabled || !payload.col) return [];
  const col = payload.col;
  const byId = (a: string, b: string) => a.length - b.length || (a < b ? -1 : a > b ? 1 : 0);
  const sorted = [...keys].sort(byId);
  const withMin = sorted.filter((k) => col[k][0] !== null);
  const withMax = sorted.filter((k) => col[k][1] !== null);
  const top = withMin.reduce<string | undefined>((best, k) => (best === undefined || col[k][0]! > col[best][0]! ? k : best), undefined);
  const low = withMax.reduce<string | undefined>((best, k) => (best === undefined || col[k][1]! < col[best][1]! ? k : best), undefined);
  return [...new Set([top, low].filter((k): k is string => k !== undefined))];
}

/**
 * resolveMargin's result with a zero's sign dropped. The sanitizer stores a
 * minimum margin of 0 as −0 (config/margin.ts rounds it "up": ceil(−1e-9) / 10),
 * and Math.max(−0, 0) depends on the order, so a SUBSET of the refs may come
 * out −0 where all of them give 0. The function never sees the sign (the
 * payload travels as JSON, where −0 is 0; compared strictly below), and no
 * floor depends on it (1 − (−0)/100 = 1).
 */
function settings(payload: FunctionMarginPayload, refs: readonly string[]) {
  const s = resolveMargin(payload, refs);
  return s && { ...s, minMarginPercent: s.minMarginPercent + 0, maxDiscountPercent: s.maxDiscountPercent + 0 };
}

/** Every margin collection of the product (what the metafield carried before the ruling). */
function allRefs(payload: FunctionMarginPayload, collectionIds: string[]): string[] {
  if (!payload.enabled || !payload.col) return [];
  const col = payload.col;
  return collectionIds.map((id) => id.slice(id.lastIndexOf("/") + 1)).filter((key) => Object.prototype.hasOwnProperty.call(col, key));
}

test("property: resolveMargin on the decisive marginRefs = on all of them, ≤ 2 refs (5 000 products, seed 20260929)", (t) => {
  const r = rng(20260929);
  let two = 0;
  let one = 0;
  let literalLooser = 0;
  for (let n = 0; n < 5000; n += 1) {
    const { config, collectionIds } = randomCase(r);
    const refs = refsOf(config, collectionIds);
    const built = buildMarginPayload(config.modules.margin, "CZK");
    // As the function reads it: the shop config's JSON through the tolerant reader.
    const read = readMarginPayload(JSON.parse(JSON.stringify(built)));
    const all = allRefs(built, collectionIds);
    const context = JSON.stringify({ margin: config.modules.margin, collectionIds, refs });
    assert.ok(refs.length <= 2, context);
    assert.ok(refs.every((ref) => all.includes(ref)), context);
    assert.equal(refs.length === 0, all.length === 0, context);
    assert.deepEqual(settings(built, refs), settings(built, all), context);
    assert.deepEqual(resolveMargin(read, refs), resolveMargin(read, all), context);
    if (refs.length === 2) two += 1;
    if (refs.length === 1) one += 1;
    // Where "the highest minimum among the collections that SET one" would be looser: a
    // collection that leaves the field empty carries a stricter global value.
    if (JSON.stringify(settings(built, literalRefs(built, all))) !== JSON.stringify(settings(built, all))) literalLooser += 1;
  }
  t.diagnostic(`coverage: two refs ${two}, one ref ${one}, the literal reading looser ${literalLooser}`);
  assert.ok(two >= 500 && one >= 500 && literalLooser >= 100, `coverage: two refs ${two}, one ref ${one}, the literal reading looser ${literalLooser}`);
});

test("property: the decisive refs stay exact when the payload folds stricter values into the globals and every collection's own values", () => {
  // The sync folds a margin collection it cannot read into the payload (app products.ts
  // foldMarginCollections): global and each collection's own values get max(·, m*) / min(·, p*).
  // That is monotone on every collection's effective value, so the strictest stay the strictest.
  const r = rng(20261001);
  for (let n = 0; n < 2000; n += 1) {
    const { config, collectionIds } = randomCase(r);
    const refs = refsOf(config, collectionIds);
    const foldMin = r.chance(0.5) ? r.pick([0, 15, 30, 60]) : undefined;
    const foldMax = r.chance(0.5) ? r.pick([5, 20, 45, 100]) : undefined;
    const margin = structuredClone(config.modules.margin) as { global: { minMarginPercent?: number; maxDiscountPercent: number }; perCollection: Override[] };
    if (foldMin !== undefined) margin.global.minMarginPercent = Math.max(margin.global.minMarginPercent ?? 0, foldMin);
    if (foldMax !== undefined) margin.global.maxDiscountPercent = Math.min(margin.global.maxDiscountPercent, foldMax);
    margin.perCollection = margin.perCollection.map((o) => ({
      ...o,
      ...(o.minMarginPercent !== undefined && foldMin !== undefined ? { minMarginPercent: Math.max(o.minMarginPercent, foldMin) } : {}),
      ...(o.maxDiscountPercent !== undefined && foldMax !== undefined ? { maxDiscountPercent: Math.min(o.maxDiscountPercent, foldMax) } : {}),
    }));
    const folded = buildMarginPayload({ ...config.modules.margin, ...margin });
    const context = JSON.stringify({ margin: config.modules.margin, foldMin, foldMax, collectionIds, refs });
    assert.deepEqual(settings(folded, refs), settings(folded, allRefs(folded, collectionIds)), context);
  }
});

test("property: during a change, the old and the new decisive refs together are exact under BOTH configs", () => {
  // What a product may carry while the shop config flips (old ∪ new): every set
  // between the decisive refs and all refs resolves like all refs.
  const r = rng(20261002);
  for (let n = 0; n < 2000; n += 1) {
    const before = randomCase(r);
    // Same product, same memberships; the global and collection values change.
    const after = { config: marginConfig(randomGlobal(r), randomValues(r, before.ids)) };
    const collectionIds = before.collectionIds;
    const oldRefs = refsOf(before.config, collectionIds);
    const newRefs = refsOf(after.config, collectionIds);
    const union = [...new Set([...oldRefs, ...newRefs])];
    for (const config of [before.config, after.config]) {
      const payload = buildMarginPayload(config.modules.margin);
      const context = JSON.stringify({ margin: config.modules.margin, collectionIds, union });
      assert.deepEqual(settings(payload, union), settings(payload, allRefs(payload, collectionIds)), context);
    }
  }
});
