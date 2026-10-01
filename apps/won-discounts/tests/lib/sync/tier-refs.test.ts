import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";

import { buildNodeVars, buildShopFunctionConfig, verifyShopFunctionConfig } from "@won/core/discounts/function-payload";
import { planCart, type PlanConfig } from "@won/core/discounts/plan";
import { productRuleIndex } from "@won/core/discounts/targeting";

import { hasProductTargets, isEmptyEntry, targetScopes } from "../../../app/lib/sync/products.ts";
import { createSync, syncIdle } from "../../../app/lib/sync/sync.server.ts";
import { createTestDatabase, type TestDatabase } from "../test-db.ts";
import { FakeShopify } from "./fake-shopify.ts";
import { autoRule, configWith, makeDeps } from "./helpers.ts";

// Quantity tiers in the product targeting (MVP 3, contracts K1/K3, controller
// ruling for T3 + audit P2-2): the collections and products of Pro (scoped)
// tier sets are read like rule targets, the engine's `tierRef` goes into the
// product metafield, and EVERY tierRef change — gained, changed or dropped —
// passes through the SENTINEL `"~"` (names no set: no tier, fail closed): the
// BEFORE lane writes it (with the product's rule / margin changes), the final
// value follows AFTER the shop config flip. So while the sync runs no product
// gets more than both the old and the new config would give it. A failed
// sentinel write holds the new config (`tier_refs`).

let db: TestDatabase;
let seq = 0;
let shop: string;
before(() => {
  db = createTestDatabase("sync-tier-refs");
});
after(async () => {
  await db.drop();
});
beforeEach(() => {
  seq += 1;
  shop = `tier-refs-${seq}.myshopify.com`;
});

const globalSet = { id: "g", scope: "global", countAcross: "product", breaks: [{ minQty: 3, percent: 10 }] };
const scopedSet = (id: string, scope: { productIds?: string[]; collectionIds?: string[] }, countAcross = "product") => ({
  id,
  scope,
  countAcross,
  breaks: [{ minQty: 2, percent: 5 }],
});

function tierConfig(rules: unknown[], sets: unknown[]) {
  return configWith(rules, { modules: { codes: { rules }, tiers: { sets } } });
}

function realDeps(fake: FakeShopify, plan: "free" | "pro" = "pro") {
  return makeDeps(fake, db.prisma, { plan: async () => plan, productRuleIndex: (config, products) => productRuleIndex(config, products) });
}

/** Every Shopify write in order, as "set:<key>:<owner>" / "delete:<key>:<owner>" with the value set. */
function writes(fake: FakeShopify): { op: string; owner: string; key: string; value?: unknown }[] {
  const out: { op: string; owner: string; key: string; value?: unknown }[] = [];
  for (const call of fake.mutations()) {
    const mfs = (call.variables as { metafields?: { ownerId: string; key: string; value?: string }[] }).metafields ?? [];
    for (const mf of mfs) {
      if (call.op === "WonSyncMetafieldsSet") out.push({ op: "set", owner: mf.ownerId, key: mf.key, value: JSON.parse(mf.value!) });
      else if (call.op === "WonSyncMetafieldsDelete") out.push({ op: "delete", owner: mf.ownerId, key: mf.key });
    }
  }
  return out;
}

const configIndex = (w: ReturnType<typeof writes>) => w.findIndex((x) => x.op === "set" && x.key === "function_config");

test("targetScopes: Pro tier sets' products and collections are read (the global set and sets listing nothing are not)", () => {
  const config = tierConfig(
    [],
    [globalSet, scopedSet("t1", { productIds: ["gid://shopify/Product/1"], collectionIds: ["gid://shopify/Collection/7"] }), scopedSet("t2", {})],
  );
  const scopes = targetScopes(config);
  assert.deepEqual([...scopes.productIds], ["gid://shopify/Product/1"]);
  assert.deepEqual([...scopes.collectionIds], ["gid://shopify/Collection/7"]);
  assert.equal(hasProductTargets(config), true, "a scoped set is a product target (webhook refresh, 24 h refresh)");
  assert.equal(hasProductTargets(tierConfig([], [globalSet])), false, "the global set needs no product refs");
});

test("P3-6: a set WITHOUT tiers is read only while a global set WITH tiers exists (else it changes nothing and would use the read limit)", () => {
  const inert = { id: "t0", scope: { collectionIds: ["gid://shopify/Collection/8"] }, countAcross: "product", breaks: [] };
  const withTiers = scopedSet("t1", { collectionIds: ["gid://shopify/Collection/7"] });
  const emptyGlobal = { id: "g0", scope: "global", countAcross: "product", breaks: [] };
  assert.deepEqual([...targetScopes(tierConfig([], [withTiers, inert])).collectionIds], ["gid://shopify/Collection/7"], "no global set");
  assert.deepEqual([...targetScopes(tierConfig([], [emptyGlobal, withTiers, inert])).collectionIds], ["gid://shopify/Collection/7"], "a global set without tiers");
  assert.deepEqual(
    [...targetScopes(tierConfig([], [globalSet, withTiers, inert])).collectionIds].sort(),
    ["gid://shopify/Collection/7", "gid://shopify/Collection/8"],
    "a global set with tiers: the inert set keeps its products out of it",
  );
});

test("isEmptyEntry: a product whose only ref is its tier set still carries the metafield", () => {
  assert.equal(isEmptyEntry({ ruleIds: [], variantRuleIds: {}, tierRef: "t1" }), false);
  assert.equal(isEmptyEntry({ ruleIds: [], variantRuleIds: {} }), true);
});

test("Pro: products listed by a set or in its collection get tierRef (K1, first set in config order wins); others none", async () => {
  const fake = new FakeShopify();
  const listed = fake.addProduct(1);
  const inCollection = fake.addProduct(2);
  const both = fake.addProduct(3);
  const outside = fake.addProduct(4);
  const collection = fake.addCollection(7, [inCollection.id, both.id]);
  const config = tierConfig(
    [autoRule("r", { target: { kind: "products", productIds: [outside.id], variantIds: [] } })],
    [globalSet, scopedSet("t1", { collectionIds: [collection] }), scopedSet("t2", { productIds: [listed.id, both.id] })],
  );
  const result = await createSync(realDeps(fake)).syncShop(shop, config);
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.deepEqual(fake.productMetafield(listed.id), { ruleIds: [], variantRuleIds: {}, tierRef: "t2" });
  assert.deepEqual(fake.productMetafield(inCollection.id), { ruleIds: [], variantRuleIds: {}, tierRef: "t1" });
  // Listed by product (K1 step 1) beats the earlier set's collection (step 2).
  assert.deepEqual(fake.productMetafield(both.id), { ruleIds: [], variantRuleIds: {}, tierRef: "t2" });
  assert.deepEqual(fake.productMetafield(outside.id), { ruleIds: ["r"], variantRuleIds: {} }, "the global set applies: no tierRef");
  const row = await db.prisma.productTargetIndex.findUnique({ where: { shop_productId: { shop, productId: listed.id } } });
  assert.deepEqual(JSON.parse(row!.value!), { ruleIds: [], variantRuleIds: {}, tierRef: "t2" }, "the index keeps the value (admin counts)");
});

test("Free: a Pro set is inert but still claims its products (they carry tierRef, so they never fall into the global set)", async () => {
  const fake = new FakeShopify();
  const listed = fake.addProduct(1);
  const config = tierConfig([], [globalSet, scopedSet("t1", { productIds: [listed.id] })]);
  const result = await createSync(realDeps(fake, "free")).syncShop(shop, config);
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.deepEqual(fake.productMetafield(listed.id), { ruleIds: [], variantRuleIds: {}, tierRef: "t1" });
});

test("P2-2: a product that only gains a tierRef gets the sentinel before the flip (no tier), its set after it", async () => {
  const fake = new FakeShopify();
  const p = fake.addProduct(1);
  const deps = realDeps(fake);
  const sync = createSync(deps);
  const rule = autoRule("a", { target: { kind: "products", productIds: [p.id], variantIds: [] } });
  assert.equal((await sync.syncShop(shop, tierConfig([rule], [globalSet]))).ok, true);
  fake.calls = [];
  const result = await sync.syncShop(shop, tierConfig([rule, autoRule("s")], [globalSet, scopedSet("t1", { productIds: [p.id] })]));
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  const w = writes(fake).filter((x) => x.key === "product" || x.key === "function_config");
  const at = configIndex(w);
  assert.ok(at !== -1, JSON.stringify(w));
  assert.deepEqual(
    w.filter((x) => x.owner === p.id).map((x) => ({ after: w.indexOf(x) > at, value: x.value })),
    [
      { after: false, value: { ruleIds: ["a"], variantRuleIds: {}, tierRef: "~" } },
      { after: true, value: { ruleIds: ["a"], variantRuleIds: {}, tierRef: "t1" } },
    ],
  );
});

test("P2-2: a product without Won refs that gains a tierRef gets a sentinel-only value before the flip (its rule gains still follow after it)", async () => {
  const fake = new FakeShopify();
  const p = fake.addProduct(1);
  const sync = createSync(realDeps(fake));
  assert.equal((await sync.syncShop(shop, tierConfig([], [globalSet]))).ok, true);
  assert.equal(fake.productMetafield(p.id), undefined);
  fake.calls = [];
  const rule = autoRule("a", { target: { kind: "products", productIds: [p.id], variantIds: [] } });
  const result = await sync.syncShop(shop, tierConfig([rule, autoRule("s")], [globalSet, scopedSet("t1", { productIds: [p.id] })]));
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  const w = writes(fake).filter((x) => x.key === "product" || x.key === "function_config");
  const at = configIndex(w);
  assert.deepEqual(
    w.filter((x) => x.owner === p.id).map((x) => ({ after: w.indexOf(x) > at, value: x.value })),
    [
      { after: false, value: { ruleIds: [], variantRuleIds: {}, tierRef: "~" } },
      { after: true, value: { ruleIds: ["a"], variantRuleIds: {}, tierRef: "t1" } },
    ],
  );
});

test("a product whose rule refs change before the flip carries the sentinel there; the new tierRef follows after the flip", async () => {
  const fake = new FakeShopify();
  const p = fake.addProduct(1);
  const sync = createSync(realDeps(fake));
  const target = { kind: "products", productIds: [p.id], variantIds: [] };
  assert.equal((await sync.syncShop(shop, tierConfig([autoRule("a", { target })], [globalSet, scopedSet("t1", { productIds: [p.id] })]))).ok, true);
  assert.deepEqual(fake.productMetafield(p.id), { ruleIds: ["a"], variantRuleIds: {}, tierRef: "t1" });
  fake.calls = [];
  // a leaves the product (a rule ref that must go BEFORE the flip), b joins, and the product moves to set t2.
  const result = await sync.syncShop(
    shop,
    tierConfig([autoRule("a"), autoRule("b", { target })], [globalSet, scopedSet("t2", { productIds: [p.id] }), scopedSet("t1", { productIds: [p.id] })]),
  );
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  const w = writes(fake).filter((x) => x.key === "product" || x.key === "function_config");
  const at = configIndex(w);
  const mine = w.filter((x) => x.owner === p.id).map((x) => ({ after: w.indexOf(x) > at, value: x.value }));
  assert.deepEqual(mine, [
    { after: false, value: { ruleIds: ["b"], variantRuleIds: {}, tierRef: "~" } },
    { after: true, value: { ruleIds: ["b"], variantRuleIds: {}, tierRef: "t2" } },
  ]);
  assert.deepEqual(fake.productMetafield(p.id), { ruleIds: ["b"], variantRuleIds: {}, tierRef: "t2" });
});

test("a product that leaves every target carries only the sentinel until the flip (rule refs cleared before), then the metafield goes", async () => {
  const fake = new FakeShopify();
  const p = fake.addProduct(1);
  const sync = createSync(realDeps(fake));
  const target = { kind: "products", productIds: [p.id], variantIds: [] };
  assert.equal((await sync.syncShop(shop, tierConfig([autoRule("a", { target })], [globalSet, scopedSet("t1", { productIds: [p.id] })]))).ok, true);
  fake.calls = [];
  const result = await sync.syncShop(shop, tierConfig([autoRule("a"), autoRule("s")], [globalSet]));
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  const w = writes(fake).filter((x) => x.key === "product" || x.key === "function_config");
  const at = configIndex(w);
  const mine = w.filter((x) => x.owner === p.id).map((x) => ({ op: x.op, after: w.indexOf(x) > at, value: x.value }));
  assert.deepEqual(mine, [
    { op: "set", after: false, value: { ruleIds: [], variantRuleIds: {}, tierRef: "~" } },
    { op: "delete", after: true, value: undefined },
  ]);
  assert.equal(fake.productMetafield(p.id), undefined);
  assert.equal(await db.prisma.productTargetIndex.count({ where: { shop, productId: p.id } }), 0);
});

test("a failed tierRef write after the flip holds nothing: the product keeps the sentinel (no tier), the step says so, the next sync retries", async () => {
  const fake = new FakeShopify();
  const p = fake.addProduct(1);
  const sync = createSync(realDeps(fake));
  const rule = autoRule("a", { target: { kind: "products", productIds: [p.id], variantIds: [] } });
  assert.equal((await sync.syncShop(shop, tierConfig([rule], [globalSet]))).ok, true);
  // Shopify refuses the FINAL value only (the sentinel before the flip goes through).
  const real = fake.graphql.bind(fake);
  fake.graphql = async (query, variables) =>
    /WonSyncMetafieldsSet/.test(query) && JSON.stringify(variables).includes('\\"tierRef\\":\\"t1\\"')
      ? { data: { metafieldsSet: { metafields: [], userErrors: [{ message: "Value is invalid" }] } } }
      : real(query, variables);
  const result = await sync.syncShop(shop, tierConfig([rule, autoRule("s")], [globalSet, scopedSet("t1", { productIds: [p.id] })]));
  assert.equal(result.ok, false);
  assert.ok(result.steps.some((s) => s.step === "shop_config.write" && s.ok), "the new config is in place");
  const tiers = result.steps.find((s) => s.step === "products.tiers");
  assert.equal(tiers?.ok, false, JSON.stringify(result.steps));
  assert.deepEqual(result.pending, ["failed_steps"]);
  assert.deepEqual(fake.productMetafield(p.id), { ruleIds: ["a"], variantRuleIds: {}, tierRef: "~" }, "no tier until retried (fail closed)");
  fake.graphql = real;
  const retry = await sync.syncShop(shop, tierConfig([rule, autoRule("s")], [globalSet, scopedSet("t1", { productIds: [p.id] })]));
  assert.equal(retry.ok, true, JSON.stringify(retry.errors));
  assert.deepEqual(fake.productMetafield(p.id), { ruleIds: ["a"], variantRuleIds: {}, tierRef: "t1" });
});

test("background lane: tierRef writes follow the flip in this process's queue", async () => {
  const fake = new FakeShopify();
  const p = fake.addProduct(1);
  const sync = createSync(realDeps(fake));
  const rule = autoRule("a", { target: { kind: "products", productIds: [p.id], variantIds: [] } });
  assert.equal((await sync.syncShop(shop, tierConfig([rule], [globalSet]))).ok, true);
  const result = await sync.syncShop(shop, tierConfig([rule, autoRule("s")], [globalSet, scopedSet("t1", { productIds: [p.id] })]), {
    productWrites: "background",
  });
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.deepEqual(result.pending, ["products_in_progress"]);
  await syncIdle(shop);
  assert.deepEqual(fake.productMetafield(p.id), { ruleIds: ["a"], variantRuleIds: {}, tierRef: "t1" });
});

test("products-only refresh: a product that joined a tier set's collection gets its tierRef (webhook-driven refresh)", async () => {
  const fake = new FakeShopify();
  const p1 = fake.addProduct(1);
  const p2 = fake.addProduct(2);
  const collection = fake.addCollection(7, [p1.id]);
  const sync = createSync(realDeps(fake));
  const config = tierConfig([], [globalSet, scopedSet("t1", { collectionIds: [collection] })]);
  assert.equal((await sync.syncShop(shop, config)).ok, true);
  assert.equal(fake.productMetafield(p2.id), undefined);
  fake.collections.get(collection)!.push(p2.id);
  const result = await sync.refreshProducts(shop, config);
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.deepEqual(fake.productMetafield(p2.id), { ruleIds: [], variantRuleIds: {}, tierRef: "t1" });
});

test("P2-3: a tier set's collection over the read limit is not read; products that carry its set KEEP it (never widened to the global set)", async () => {
  const fake = new FakeShopify();
  const p = fake.addProduct(1);
  const huge = fake.addCollection(7, [p.id]);
  const sync = createSync(realDeps(fake));
  const rule = autoRule("r", { target: { kind: "products", productIds: [p.id], variantIds: [] } });
  const sets = [globalSet, scopedSet("t1", { collectionIds: [huge] })];
  // While the collection fits, its product carries the set.
  assert.equal((await sync.syncShop(shop, tierConfig([rule], sets))).ok, true);
  assert.deepEqual(fake.productMetafield(p.id), { ruleIds: ["r"], variantRuleIds: {}, tierRef: "t1" });
  fake.collectionCounts.set(huge, 20_000);
  fake.collectionTitles.set(huge, "Vše");
  fake.calls = [];
  const result = await sync.syncShop(shop, tierConfig([rule, autoRule("s")], sets));
  const step = result.steps.find((s) => s.step === "tiers.too_large:t1");
  assert.ok(step && !step.ok, JSON.stringify(result.steps));
  assert.deepEqual(step.params, { collection: "Vše", count: 1 });
  assert.doesNotMatch(step.detail, /gid:\/\//, "titles, never GIDs");
  assert.equal(fake.callsOf("WonSyncCollectionProducts").length, 0, "the too-large collection is not paged");
  assert.ok(result.steps.some((s) => s.step === "shop_config.write" && s.ok), "everything else is synced");
  // Its membership is unknown now: the stricter, known state stays (no write at all for it).
  assert.deepEqual(fake.productMetafield(p.id), { ruleIds: ["r"], variantRuleIds: {}, tierRef: "t1" });
  assert.equal(
    writes(fake).filter((x) => x.owner === p.id).length,
    0,
    "nothing written for it (no sentinel either: its tierRef does not change)",
  );
  // A product listed by another set by id is still moved (that membership is known).
  const q = fake.addProduct(2);
  fake.collections.get(huge)!.push(q.id);
  const moved = await sync.syncShop(shop, tierConfig([rule, autoRule("s")], [globalSet, scopedSet("t2", { productIds: [p.id] }), scopedSet("t1", { collectionIds: [huge] })]));
  assert.ok(moved.steps.some((s) => s.step === "shop_config.write" && s.ok));
  assert.deepEqual(fake.productMetafield(p.id), { ruleIds: ["r"], variantRuleIds: {}, tierRef: "t2" });
  assert.equal(fake.productMetafield(q.id), undefined, "a product not read yet gets nothing (the global set)");
});

test("steady state: an unchanged tier targeting writes nothing on the next sync", async () => {
  const fake = new FakeShopify();
  const p = fake.addProduct(1);
  const sync = createSync(realDeps(fake));
  const config = tierConfig([], [globalSet, scopedSet("t1", { productIds: [p.id] })]);
  assert.equal((await sync.syncShop(shop, config)).ok, true);
  const before = writes(fake).filter((x) => x.key === "product").length;
  assert.equal((await sync.syncShop(shop, config)).ok, true);
  assert.equal(writes(fake).filter((x) => x.key === "product").length, before);
});

test("across a margin flip (bridge): the BEFORE write carries the bridge AND the sentinel; the tier write follows after", async () => {
  const fake = new FakeShopify();
  const p = fake.addProduct(1);
  const margin5 = fake.addCollection(5, [p.id]);
  const deps = makeDeps(fake, db.prisma, {
    plan: async () => "pro",
    productRuleIndex: (config, products) => productRuleIndex(config, products),
    buildShopFunctionConfig: (config, options) => buildShopFunctionConfig(config, options),
    buildNodeVars: (role, config, now) => buildNodeVars(role, config, now),
    verifyShopFunctionConfig: (json) => verifyShopFunctionConfig(json),
  });
  const sync = createSync(deps);
  const withMargin = (min: number, sets: unknown[]) =>
    configWith([], {
      modules: {
        codes: { rules: [] },
        tiers: { sets },
        margin: { enabled: true, global: { minMarginPercent: 10, maxDiscountPercent: 40 }, perCollection: [{ collectionId: margin5, minMarginPercent: min }] },
      },
    });
  assert.equal((await sync.syncShop(shop, withMargin(30, [globalSet]))).ok, true);
  assert.deepEqual(fake.productMetafield(p.id), { ruleIds: [], variantRuleIds: {}, marginRefs: ["5"] });
  fake.calls = [];
  const result = await sync.syncShop(shop, withMargin(40, [globalSet, scopedSet("t1", { productIds: [p.id] })]));
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  const w = writes(fake).filter((x) => x.key === "product" || x.key === "function_config");
  const at = configIndex(w);
  assert.ok(at !== -1);
  assert.deepEqual(
    w.filter((x) => x.owner === p.id).map((x) => ({ after: w.indexOf(x) > at, value: x.value })),
    [
      { after: false, value: { ruleIds: [], variantRuleIds: {}, marginRefs: ["5"], tierRef: "~" } },
      { after: true, value: { ruleIds: [], variantRuleIds: {}, marginRefs: ["5"], tierRef: "t1" } },
    ],
    "its bridge equals what it carries; the sentinel before the flip, the tierRef after it",
  );
});

test("P2-2: a refused sentinel write holds the new config (tier_refs): no product runs the new set values on its old tierRef", async () => {
  const fake = new FakeShopify();
  const p = fake.addProduct(1);
  const sync = createSync(realDeps(fake));
  const rule = autoRule("a", { target: { kind: "products", productIds: [p.id], variantIds: [] } });
  assert.equal((await sync.syncShop(shop, tierConfig([rule], [globalSet, scopedSet("t1", { productIds: [p.id] })]))).ok, true);
  fake.refusedOwners.add(p.id);
  const result = await sync.syncShop(shop, tierConfig([rule, autoRule("s")], [globalSet]));
  assert.ok(result.pending.includes("stale_product_refs"), JSON.stringify(result.steps));
  const held = result.steps.find((s) => s.step === "shop_config.write");
  assert.deepEqual([held?.ok, held?.params], [false, { held: "tier_refs" }]);
  assert.deepEqual(fake.productMetafield(p.id), { ruleIds: ["a"], variantRuleIds: {}, tierRef: "t1" }, "still the old config and the old ref");
});

test("P2-2 window: while a save changes set values AND moves products between sets, no product gets more than max(old config, new config)", async () => {
  const fake = new FakeShopify();
  const deps = makeDeps(fake, db.prisma, {
    plan: async () => "pro",
    productRuleIndex: (config, products) => productRuleIndex(config, products),
    buildShopFunctionConfig: (config, options) => buildShopFunctionConfig(config, options),
    buildNodeVars: (role, config, now) => buildNodeVars(role, config, now),
    verifyShopFunctionConfig: (json) => verifyShopFunctionConfig(json),
  });
  const a = fake.addProduct(1); // in X, no Won refs: gains the low set L
  const b = fake.addProduct(2); // in X, already indexed (a disabled rule): gains L
  const c = fake.addProduct(3); // leaves S, whose values rise
  const d = fake.addProduct(4); // stays in S
  const x = fake.addCollection(9, [a.id, b.id]);
  const products = [a, b, c, d];
  const disabled = autoRule("r", { enabled: false, target: { kind: "products", productIds: [b.id], variantIds: [] } });
  const set = (id: string, scope: unknown, percent: number) => ({ id, scope, countAcross: "product", breaks: [{ minQty: 2, percent }] });
  const oldConfig = tierConfig([disabled], [set("g", "global", 10), set("S", { productIds: [c.id, d.id] }, 5)]);
  const newConfig = tierConfig([disabled, autoRule("s", { enabled: false })], [set("g", "global", 20), set("S", { productIds: [d.id] }, 30), set("L", { collectionIds: [x] }, 5)]);
  const sync = createSync(deps);
  assert.equal((await sync.syncShop(shop, oldConfig)).ok, true);

  const discount = (configJson: string, productId: string, value: string | undefined): number => {
    const mf = value ? (JSON.parse(value) as { ruleIds?: string[]; variantRuleIds?: Record<string, string[]>; tierRef?: string }) : {};
    const variantId = fake.products.get(productId)!.variantIds[0]!;
    const plan = planCart(
      {
        currency: "CZK",
        enteredCodes: [],
        lines: [{ id: "l1", variantId, productId, quantity: 3, unitPrice: 1000, ruleIds: mf.ruleIds ?? [], variantRuleIds: mf.variantRuleIds ?? {}, ...(mf.tierRef !== undefined ? { tierRef: mf.tierRef } : {}) }],
      },
      JSON.parse(configJson) as PlanConfig,
    );
    return plan.totals.productDiscount;
  };
  const state = () => ({
    config: fake.shopMetafieldValue("function_config")!,
    values: new Map(products.map((p) => [p.id, fake.products.get(p.id)!.metafields.get("$app:won_discounts/product")?.value])),
  });
  const old = state();
  const snapshots: ReturnType<typeof state>[] = [];
  const real = fake.graphql.bind(fake);
  fake.graphql = async (query, variables) => {
    const answer = await real(query, variables);
    if (/^\s*mutation/.test(query)) snapshots.push(state());
    return answer;
  };
  const result = await sync.syncShop(shop, newConfig);
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  fake.graphql = real;
  const final = state();
  const worst: string[] = [];
  for (const p of products) {
    const bound = Math.max(discount(old.config, p.id, old.values.get(p.id)), discount(final.config, p.id, final.values.get(p.id)));
    for (const [i, snap] of snapshots.entries()) {
      const got = discount(snap.config, p.id, snap.values.get(p.id));
      if (got > bound) worst.push(`${p.id} at mutation ${i}: ${got} > ${bound}`);
    }
  }
  assert.deepEqual(worst, []);
  // The intent of the scenario holds at the end: A and B on L (5 %), C on the new global (20 %), D on the new S (30 %).
  assert.deepEqual(products.map((p) => discount(final.config, p.id, final.values.get(p.id))), [150, 150, 600, 900]);
  assert.deepEqual(products.map((p) => discount(old.config, p.id, old.values.get(p.id))), [300, 300, 150, 150]);
});

test("tier cap: a stored config whose tiers are over their 550 B cap is refused like an over-budget one — nothing is written, the step says why", async () => {
  const fake = new FakeShopify();
  const products = Array.from({ length: 10 }, (_, i) => fake.addProduct(i + 1));
  const deps = makeDeps(fake, db.prisma, {
    plan: async () => "pro",
    productRuleIndex: (config, list) => productRuleIndex(config, list),
    buildShopFunctionConfig: (config, options) => buildShopFunctionConfig(config, options),
    buildNodeVars: (role, config, now) => buildNodeVars(role, config, now),
    verifyShopFunctionConfig: (json) => verifyShopFunctionConfig(json),
  });
  // 10 sets × 5 amount breaks in CZK + EUR (the admin refuses saving this since the cap; an older stored config may hold it).
  const sets = products.map((p, i) => ({
    id: `set_${String(i).padStart(18, "0")}`,
    scope: { productIds: [p.id] },
    countAcross: "product",
    breaks: [2, 3, 4, 5, 6].map((minQty) => ({ minQty, amountOff: { CZK: 1000 * minQty, EUR: 40 * minQty } })),
  }));
  const result = await createSync(deps).syncShop(shop, tierConfig([autoRule("a")], [globalSet, ...sets]));
  assert.equal(result.ok, false);
  const step = result.steps.find((s) => s.step === "shop_config.build");
  assert.equal(step?.ok, false, JSON.stringify(result.steps));
  // The admin's naming contract (sync-copy.ts): tiersBytes / tiersBudget, only when the tier part is over its cap.
  assert.equal(step?.params?.tiersBudget, 550);
  assert.ok(typeof step?.params?.tiersBytes === "number" && step.params.tiersBytes > 550, JSON.stringify(step?.params));
  assert.ok(typeof step?.params?.bytes === "number" && step.params.bytes <= 9000, "the whole payload fits: only the tiers are over");
  assert.match(step!.detail, /quantity tiers/);
  assert.deepEqual(fake.mutations(), [], "nothing reached Shopify");
});

test("over the 9 000 B budget with tiers that fit: no tier figures in the step (the admin words the plain budget case)", async () => {
  const fake = new FakeShopify();
  const deps = makeDeps(fake, db.prisma, {
    plan: async () => "pro",
    productRuleIndex: (config, list) => productRuleIndex(config, list),
    buildShopFunctionConfig: () => ({ json: "{}", bytes: 9500, fits: false, tiers: { bytes: 40, budget: 550, fits: true } }),
  });
  const result = await createSync(deps).syncShop(shop, tierConfig([autoRule("a")], [globalSet]));
  const step = result.steps.find((s) => s.step === "shop_config.build");
  assert.deepEqual(step?.params, { bytes: 9500, budget: 9000 });
  assert.match(step!.detail, /9500 B, over the 9000 B budget/);
  assert.deepEqual(fake.mutations(), []);
});
