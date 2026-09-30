import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";

import { buildNodeVars, buildShopFunctionConfig, verifyShopFunctionConfig } from "@won/core/discounts/function-payload";
import { productRuleIndex } from "@won/core/discounts/targeting";

import { hasProductTargets, isEmptyEntry, targetScopes } from "../../../app/lib/sync/products.ts";
import { createSync, syncIdle } from "../../../app/lib/sync/sync.server.ts";
import { createTestDatabase, type TestDatabase } from "../test-db.ts";
import { FakeShopify } from "./fake-shopify.ts";
import { autoRule, configWith, makeDeps } from "./helpers.ts";

// Quantity tiers in the product targeting (MVP 3, contracts K1/K3, controller
// ruling for T3): the collections and products of Pro (scoped) tier sets are
// read like rule targets, the engine's `tierRef` goes into the product
// metafield, and EVERY tierRef change — gained, changed or dropped — is
// written AFTER the shop config flip: during the sync a product keeps its OLD
// tiers (the BEFORE lane writes rule / margin changes with the tierRef the
// product carries now), and a stale ref to a set the new payload lacks gives
// no tier (engine K1, fail closed).

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

test("AFTER lane: a product that only gains a tierRef is written after the shop config (it keeps its old tiers during the sync)", async () => {
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
    [{ after: true, value: { ruleIds: ["a"], variantRuleIds: {}, tierRef: "t1" } }],
  );
});

test("a product whose rule refs change before the flip keeps its CURRENT tierRef there; the new tierRef follows after the flip", async () => {
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
    { after: false, value: { ruleIds: ["b"], variantRuleIds: {}, tierRef: "t1" } },
    { after: true, value: { ruleIds: ["b"], variantRuleIds: {}, tierRef: "t2" } },
  ]);
  assert.deepEqual(fake.productMetafield(p.id), { ruleIds: ["b"], variantRuleIds: {}, tierRef: "t2" });
});

test("a product that leaves every target keeps its tierRef until the flip (rule refs cleared before), then the metafield goes", async () => {
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
    { op: "set", after: false, value: { ruleIds: [], variantRuleIds: {}, tierRef: "t1" } },
    { op: "delete", after: true, value: undefined },
  ]);
  assert.equal(fake.productMetafield(p.id), undefined);
  assert.equal(await db.prisma.productTargetIndex.count({ where: { shop, productId: p.id } }), 0);
});

test("a failed tierRef write after the flip holds nothing: the config is applied, the step says so, the next sync retries", async () => {
  const fake = new FakeShopify();
  const p = fake.addProduct(1);
  const sync = createSync(realDeps(fake));
  const rule = autoRule("a", { target: { kind: "products", productIds: [p.id], variantIds: [] } });
  assert.equal((await sync.syncShop(shop, tierConfig([rule], [globalSet]))).ok, true);
  fake.refusedOwners.add(p.id);
  const result = await sync.syncShop(shop, tierConfig([rule, autoRule("s")], [globalSet, scopedSet("t1", { productIds: [p.id] })]));
  assert.equal(result.ok, false);
  assert.ok(result.steps.some((s) => s.step === "shop_config.write" && s.ok), "the new config is in place");
  const tiers = result.steps.find((s) => s.step === "products.tiers");
  assert.equal(tiers?.ok, false, JSON.stringify(result.steps));
  assert.deepEqual(result.pending, ["failed_steps"]);
  assert.deepEqual(fake.productMetafield(p.id), { ruleIds: ["a"], variantRuleIds: {} }, "it keeps the old value (the global set) until retried");
  fake.refusedOwners.clear();
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

test("a tier set's collection over the read limit is not read; the step names the set (its products keep the store-wide set)", async () => {
  const fake = new FakeShopify();
  const p = fake.addProduct(1);
  const huge = fake.addCollection(7, [p.id]);
  fake.collectionCounts.set(huge, 20_000);
  fake.collectionTitles.set(huge, "Vše");
  const result = await createSync(realDeps(fake)).syncShop(shop, tierConfig([autoRule("s")], [globalSet, scopedSet("t1", { collectionIds: [huge] })]));
  const step = result.steps.find((s) => s.step === "tiers.too_large:t1");
  assert.ok(step && !step.ok, JSON.stringify(result.steps));
  assert.deepEqual(step.params, { collection: "Vše", count: 1 });
  assert.equal(fake.callsOf("WonSyncCollectionProducts").length, 0, "the too-large collection is not paged");
  assert.ok(result.steps.some((s) => s.step === "shop_config.write" && s.ok), "everything else is synced");
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

test("across a margin flip (bridge): the BEFORE write carries the bridge AND the current tierRef; the tier write follows after", async () => {
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
    [{ after: true, value: { ruleIds: [], variantRuleIds: {}, marginRefs: ["5"], tierRef: "t1" } }],
    "its bridge equals what it carries: nothing before the flip, the tierRef after it",
  );
});
