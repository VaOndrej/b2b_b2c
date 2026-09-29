import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";

import type { PrismaClient } from "../../../app/generated/prisma/client.ts";
import type { AdminClient } from "../../../app/lib/admin-client.server.ts";
import { MAX_COLLECTION_PRODUCTS } from "../../../app/lib/sync/products.ts";
import { forgetShopifyState, loadShopSyncFacts, markTargetingStale } from "../../../app/lib/sync/sync-state.server.ts";
import { createSync, isSyncRunning, syncIdle } from "../../../app/lib/sync/sync.server.ts";
import { productionSyncDeps } from "../../../app/lib/sync/wiring.server.ts";
import { AUTO_NODE_TITLE } from "../../../app/lib/sync/nodes.ts";
import { createTestDatabase, type TestDatabase } from "../test-db.ts";
import { FakeShopify, WON_FUNCTION_ID } from "./fake-shopify.ts";
import { autoRule, codeRule, configWith, makeDeps, NOW } from "./helpers.ts";

// F2 (MVP 1 audit fixes) in the sync layer:
//   item 1  BILL-1: the sync gates the config for the shop's plan BEFORE the
//           function payload, the nodes and the product index;
//   item 3  a failed SET that REMOVES a ref holds the shop config (P2-1);
//   item 6  after an install / reinstall (shop config missing in Shopify) the
//           index is checked and rewritten when it lies (P2-4);
//   item 7  products that only GAIN refs are written after the config (the
//           admin: in the background, superseded by a newer sync); a collection
//           over the per-sync cap is refused honestly;
//   item 11 the automatic node is adopted by this app's function, never by
//           title, and never created twice;
//   item 12 the zone the sync used is recorded; item 2: products-only refresh.

let db: TestDatabase;
let seq = 0;
let shop: string;
before(() => {
  db = createTestDatabase("f2-sync");
});
after(async () => {
  await db.drop();
});
beforeEach(() => {
  seq += 1;
  shop = `f2-sync-${seq}.myshopify.com`;
});

const quiet = { info: () => {}, warn: () => {}, error: () => {} };
const productSets = (fake: FakeShopify) =>
  fake
    .callsOf("WonSyncMetafieldsSet")
    .map((call) => (call.variables as { metafields: { key: string; ownerId: string }[] }).metafields)
    .filter((mfs) => mfs[0]!.key === "product");

// --- item 1: BILL-1 ------------------------------------------------------------------------------

const campaign = {
  id: "bf",
  name: "Black Friday",
  window: { start: "2026-09-28T00:00:00", end: "2026-09-29T00:00:00" },
  overrides: [{ ruleId: "a", patch: { target: { kind: "products", productIds: ["gid://shopify/Product/9"], variantIds: [] } } }],
  killed: false,
};

function proConfig() {
  return configWith(
    [
      autoRule("a", { combinesWith: { ruleIds: ["b"] } }),
      autoRule("b"),
      autoRule("m", { targeting: { markets: ["sk"] } }),
      codeRule("c", { targeting: { markets: ["sk"] } }),
    ],
    { markets: [{ handle: "sk", currency: "EUR", enabled: true }], campaigns: [campaign] },
  );
}

test("BILL-1: on Free the payload, the nodes and the product index are built from the GATED config", async () => {
  const fake = new FakeShopify();
  fake.addProduct(9);
  const deps = makeDeps(fake, db.prisma, { plan: async () => "free" });
  const result = await createSync(deps).syncShop(shop, proConfig());
  assert.equal(result.ok, true, JSON.stringify(result.errors));

  const shipped = deps.log.shopConfigs.at(-1)!;
  assert.equal(shipped.modules.codes.rules.find((r) => r.id === "a")!.combinesWith, undefined, "no per-rule combinations");
  assert.equal(shipped.modules.codes.rules.find((r) => r.id === "m")!.enabled, false, "a market-targeted rule is off (never widened)");
  assert.equal(shipped.modules.codes.rules.find((r) => r.id === "m")!.targeting, undefined);
  assert.deepEqual(shipped.campaigns, [], "no campaigns");
  // The market-targeted code rule is off → its node is never created.
  assert.equal(fake.wonNodes().filter((n) => n.kind === "code").length, 0);
  // The campaign's re-target never reaches the product index (no ref for product 9).
  assert.equal(fake.productMetafield("gid://shopify/Product/9"), undefined);
  assert.ok(result.steps.some((s) => s.step === "plan" && s.ok && /free: \d+ Pro setting/.test(s.detail)), JSON.stringify(result.steps));
});

test("BILL-1: on Pro the config ships as stored (nothing gated, no plan step)", async () => {
  const fake = new FakeShopify();
  fake.addProduct(9);
  const deps = makeDeps(fake, db.prisma, { plan: async () => "pro" });
  const result = await createSync(deps).syncShop(shop, proConfig());
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  const shipped = deps.log.shopConfigs.at(-1)!;
  assert.deepEqual(shipped.modules.codes.rules.find((r) => r.id === "a")!.combinesWith, { ruleIds: ["b"] });
  assert.equal(shipped.campaigns.length, 1);
  assert.ok(!result.steps.some((s) => s.step === "plan"));
});

test("BILL-1 with the REAL builders: a Free shop's function config carries no combinations, no market rule, no campaign", async () => {
  const fake = new FakeShopify();
  const sync = createSync({ ...productionSyncDeps(fake, db.prisma, quiet), now: () => NOW, sleep: async () => {}, plan: async () => "free" });
  const result = await sync.syncShop(shop, proConfig());
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  const json = fake.shopMetafieldValue("function_config")!;
  assert.doesNotMatch(json, /combinesWith/);
  assert.doesNotMatch(json, /"bf"/);
  const rules = JSON.parse(json).modules.codes.rules as { id: string; enabled?: boolean }[];
  assert.ok(!rules.some((r) => r.id === "m" && r.enabled !== false), JSON.stringify(rules));
});

// --- item 3: a failed SET that REMOVES a ref holds the config ---------------------------------------

function failProductSets(fake: FakeShopify, ownerIds: readonly string[]) {
  const original = fake.graphql.bind(fake);
  fake.graphql = async (query, variables) => {
    const metafields = (variables as { metafields?: { key: string; ownerId: string }[] } | undefined)?.metafields ?? [];
    if (query.includes("WonSyncMetafieldsSet") && metafields[0]?.key === "product" && metafields.some((m) => ownerIds.includes(m.ownerId))) {
      return { data: { metafieldsSet: { metafields: [], userErrors: [{ field: ["metafields", "0", "value"], message: "boom" }] } } };
    }
    return original(query, variables);
  };
  return () => {
    fake.graphql = original;
  };
}

test("P2-1: a product that only DROPPED a rule and whose SET failed holds the new shop config (it would get the rule's new value)", async () => {
  const fake = new FakeShopify();
  const b = fake.addProduct(2);
  const deps = makeDeps(fake, db.prisma);
  const sync = createSync(deps);
  const before = configWith([
    autoRule("r", { value: { kind: "percentage", percent: 20 }, target: { kind: "products", productIds: [b.id], variantIds: [] } }),
    autoRule("s", { value: { kind: "percentage", percent: 5 }, target: { kind: "products", productIds: [b.id], variantIds: [] } }),
  ]);
  assert.equal((await sync.syncShop(shop, before)).ok, true);
  const previous = fake.shopMetafieldValue("function_config");

  // B leaves R, and R goes up to 30 % (a new rule U changes the payload too): B's value becomes {ruleIds: [s]} — the write fails.
  const restore = failProductSets(fake, [b.id]);
  const after = configWith([
    autoRule("r", { value: { kind: "percentage", percent: 30 }, target: { kind: "products", productIds: [], variantIds: ["gid://shopify/ProductVariant/1"] } }),
    autoRule("s", { value: { kind: "percentage", percent: 5 }, target: { kind: "products", productIds: [b.id], variantIds: [] } }),
    autoRule("u"),
  ]);
  const result = await sync.syncShop(shop, after);
  assert.equal(result.ok, false);
  assert.ok(result.steps.some((s) => s.step === "products.set" && !s.ok && /should lose/.test(s.detail)), JSON.stringify(result.steps));
  assert.ok(result.steps.some((s) => s.step === "shop_config.write" && !s.ok && /held/.test(s.detail)));
  assert.equal(fake.shopMetafieldValue("function_config"), previous, "B never gets R's new 30 % through its stale ref");
  assert.ok(result.pending.includes("stale_product_refs"));

  restore();
  const retry = await sync.syncShop(shop, after);
  assert.equal(retry.ok, true, JSON.stringify(retry.errors));
  assert.deepEqual(fake.productMetafield(b.id), { ruleIds: ["s"], variantRuleIds: {} });
});

test("P2-1: a failed SET that only ADDS refs to a product that carries Won refs does not hold the config", async () => {
  const fake = new FakeShopify();
  const b = fake.addProduct(2);
  const deps = makeDeps(fake, db.prisma);
  const sync = createSync(deps);
  await sync.syncShop(shop, configWith([autoRule("s", { target: { kind: "products", productIds: [b.id], variantIds: [] } })]));
  const restore = failProductSets(fake, [b.id]);
  const result = await sync.syncShop(
    shop,
    configWith([
      autoRule("s", { target: { kind: "products", productIds: [b.id], variantIds: [] } }),
      autoRule("t", { target: { kind: "products", productIds: [b.id], variantIds: [] } }),
    ]),
  );
  restore();
  assert.equal(result.ok, false);
  assert.ok(result.steps.some((s) => s.step === "products.set" && !s.ok && /lack the new rules/.test(s.detail)));
  assert.ok(result.steps.some((s) => s.step === "shop_config.write" && s.ok), "not held: B only lacks the new rule t");
  assert.deepEqual(result.pending, ["failed_steps"]);
});

// --- item 7: two lanes, background, supersede, cap ----------------------------------------------

test("item 7: products that carry Won refs change BEFORE the config, products that only gain refs AFTER it", async () => {
  const fake = new FakeShopify();
  const [a, b] = [fake.addProduct(1), fake.addProduct(2)];
  const deps = makeDeps(fake, db.prisma);
  const sync = createSync(deps);
  await sync.syncShop(shop, configWith([autoRule("r", { target: { kind: "products", productIds: [a.id], variantIds: [] } })]));
  fake.calls = [];
  // A leaves R (clear, before), B joins R (addition, after), a new rule S changes the shop payload.
  const result = await sync.syncShop(
    shop,
    configWith([autoRule("r", { value: { kind: "percentage", percent: 40 }, target: { kind: "products", productIds: [b.id], variantIds: [] } }), autoRule("s")]),
  );
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  const ops = fake.mutations().map((call) => {
    if (call.op !== "WonSyncMetafieldsSet") return call.op;
    return `set:${(call.variables as { metafields: { key: string }[] }).metafields[0]!.key}`;
  });
  for (const op of ["WonSyncMetafieldsDelete", "set:function_config", "set:product"]) assert.ok(ops.includes(op), ops.join(", "));
  assert.ok(ops.indexOf("WonSyncMetafieldsDelete") < ops.indexOf("set:function_config"), ops.join(", "));
  assert.ok(ops.indexOf("set:function_config") < ops.indexOf("set:product"), ops.join(", "));
  assert.deepEqual(fake.productMetafield(b.id), { ruleIds: ["r"], variantRuleIds: {} });
  assert.equal(fake.productMetafield(a.id), undefined);
});

test("item 7: productWrites 'background' returns after the shop config; the products follow in this process's queue", async () => {
  const fake = new FakeShopify();
  const products = Array.from({ length: 60 }, (_, i) => fake.addProduct(100 + i).id);
  const collection = fake.addCollection(5, products);
  const deps = makeDeps(fake, db.prisma);
  const config = configWith([autoRule("coll", { target: { kind: "collections", ids: [collection] } })]);
  const result = await createSync(deps).syncShop(shop, config, { productWrites: "background", configVersionId: "v1" });
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.deepEqual(result.background, { products: 60 });
  assert.deepEqual(result.pending, ["products_in_progress"]);
  assert.ok(fake.shopMetafieldValue("function_config"), "the config is in place when the save returns");
  assert.ok(isSyncRunning(shop), "the lane is queued");

  await syncIdle(shop);
  for (const id of products) assert.deepEqual(fake.productMetafield(id), { ruleIds: ["coll"], variantRuleIds: {} });
  const runs = await db.prisma.syncRun.findMany({ where: { shop }, orderBy: [{ startedAt: "asc" }, { id: "asc" }] });
  assert.equal(runs.length, 2, "the lane records its own run");
  const lane = runs.at(-1)!;
  assert.equal(lane.ok, true);
  assert.equal(lane.pending, null);
  assert.equal(lane.configVersionId, "v1");
  assert.match(lane.steps, /products\.add/);
  assert.ok((await loadShopSyncFacts(db.prisma, shop)).productsSyncedAt, "the targeting is fresh once the lane finished");
});

test("item 7: a newer sync supersedes a queued lane — it never writes refs of the older config", async () => {
  const fake = new FakeShopify();
  const a = fake.addProduct(1);
  const deps = makeDeps(fake, db.prisma);
  const sync = createSync(deps);
  const first = sync.syncShop(shop, configWith([autoRule("r", { target: { kind: "products", productIds: [a.id], variantIds: [] } })]), {
    productWrites: "background",
  });
  // Queued right behind the first run, before its lane: A is no longer targeted.
  const second = sync.syncShop(shop, configWith([autoRule("r", { target: { kind: "order" } })]));
  await first;
  await second;
  await syncIdle(shop);
  assert.equal(fake.productMetafield(a.id), undefined, "the superseded lane wrote nothing");
  assert.equal(productSets(fake).length, 0);
});

test(`item 7: a collection with more than ${MAX_COLLECTION_PRODUCTS} products is refused with a reason (nothing written, config held when refs exist)`, async () => {
  const fake = new FakeShopify();
  const indexedProduct = fake.addProduct(1);
  const deps = makeDeps(fake, db.prisma);
  const sync = createSync(deps);
  await sync.syncShop(shop, configWith([autoRule("r", { target: { kind: "products", productIds: [indexedProduct.id], variantIds: [] } })]));
  const huge = fake.addCollection(
    8,
    Array.from({ length: MAX_COLLECTION_PRODUCTS + 1 }, (_, i) => `gid://shopify/Product/${10_000 + i}`),
  );
  const result = await sync.syncShop(shop, configWith([autoRule("r", { target: { kind: "collections", ids: [huge] } })]));
  assert.equal(result.ok, false);
  assert.ok(result.steps.some((s) => s.step === "products" && !s.ok && /more than 25000 products/.test(s.detail)), JSON.stringify(result.steps));
  assert.ok(result.steps.some((s) => s.step === "shop_config.write" && /held/.test(s.detail)), "the product that may carry a stale ref holds the config");
  assert.ok(fake.callsOf("WonSyncCollectionProducts").length <= MAX_COLLECTION_PRODUCTS / 250 + 1, "the read stops at the cap");
});

// --- item 6: index trust after an install / reinstall ------------------------------------------------

test("P2-4: shop config missing in Shopify + an index that lies → the index is checked and every product rewritten", async () => {
  const fake = new FakeShopify();
  const products = [fake.addProduct(1), fake.addProduct(2)];
  const deps = makeDeps(fake, db.prisma);
  const sync = createSync(deps);
  const config = configWith([autoRule("r", { target: { kind: "products", productIds: products.map((p) => p.id), variantIds: [] } })]);
  await sync.syncShop(shop, config);

  // Uninstall + reinstall where the uninstall webhook never ran: Shopify removed the app-owned metafields.
  fake.shopMetafields.clear();
  for (const p of products) p.metafields.clear();
  const result = await sync.syncShop(shop, config);
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.ok(result.steps.some((s) => s.step === "products.index" && /does not match Shopify/.test(s.detail)), JSON.stringify(result.steps));
  for (const p of products) assert.deepEqual(fake.productMetafield(p.id), { ruleIds: ["r"], variantRuleIds: {} });
});

test("P2-4: app/uninstalled forgets WonNode rows and index hashes; the next sync adopts the nodes and rewrites the products", async () => {
  const fake = new FakeShopify();
  const p = fake.addProduct(1);
  const deps = makeDeps(fake, db.prisma);
  const sync = createSync(deps);
  const config = configWith([autoRule("r", { target: { kind: "products", productIds: [p.id], variantIds: [] } }), codeRule("c")]);
  await sync.syncShop(shop, config);
  const nodesBefore = fake.wonNodes().map((n) => n.id).sort();

  await forgetShopifyState(db.prisma, shop);
  assert.equal(await db.prisma.wonNode.count({ where: { shop } }), 0);
  assert.deepEqual((await db.prisma.productTargetIndex.findMany({ where: { shop } })).map((r) => r.payloadHash), [null]);
  // Shopify removed the product metafield with the app.
  p.metafields.clear();

  const result = await sync.syncShop(shop, config);
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.deepEqual(fake.wonNodes().map((n) => n.id).sort(), nodesBefore, "adopted, not duplicated");
  assert.deepEqual(fake.productMetafield(p.id), { ruleIds: ["r"], variantRuleIds: {} });
});

// --- item 11: automatic node adoption ------------------------------------------------------------

test("P3-5: an untracked automatic node the merchant renamed is adopted by this app's function (no second one)", async () => {
  const fake = new FakeShopify();
  const deps = makeDeps(fake, db.prisma);
  const sync = createSync(deps);
  await sync.syncShop(shop, configWith([autoRule("a")]));
  const auto = fake.wonNodes().find((n) => n.kind === "automatic")!;
  auto.title = "Moje slevy (přejmenováno)";
  await db.prisma.wonNode.deleteMany({ where: { shop } });

  const result = await sync.syncShop(shop, configWith([autoRule("a")]));
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  const autos = fake.wonNodes().filter((n) => n.kind === "automatic");
  assert.equal(autos.length, 1, "never a second automatic node");
  assert.equal(autos[0]!.id, auto.id);
  assert.ok(result.steps.some((s) => s.step === "node.adopt:auto" && s.ok));
  assert.equal(autos[0]!.title, AUTO_NODE_TITLE, "then reconciled back to its title");
});

test("P3-5: when this app's function cannot be identified, no automatic node is created (the next sync retries)", async () => {
  const fake = new FakeShopify();
  fake.fail("WonSyncFunctions", { graphqlError: "Internal error" }, 5);
  const deps = makeDeps(fake, db.prisma);
  const result = await createSync(deps).syncShop(shop, configWith([autoRule("a")]));
  assert.equal(result.ok, false);
  assert.equal(fake.callsOf("WonSyncAutomaticCreate").length, 0);
  assert.ok(result.steps.some((s) => s.step === "node.create:auto" && !s.ok && /twice/.test(s.detail)), JSON.stringify(result.steps));
  assert.equal(fake.wonNodes().filter((n) => n.functionId === WON_FUNCTION_ID).length, 0);
});

// --- item 12 + item 2: bookkeeping and the products-only refresh ------------------------------------

test("item 12: the sync records the shop zone it built the payload with", async () => {
  const fake = new FakeShopify();
  fake.ianaTimezone = "America/Santiago";
  await createSync(makeDeps(fake, db.prisma)).syncShop(shop, configWith([autoRule("a")]));
  assert.equal((await loadShopSyncFacts(db.prisma, shop)).timezone, "America/Santiago");
});

test("item 2: refreshProducts re-reads collection members, rewrites refs, never touches the shop config, clears the stale mark", async () => {
  const fake = new FakeShopify();
  const [a, b] = [fake.addProduct(1), fake.addProduct(2)];
  const collection = fake.addCollection(7, [a.id]);
  const deps = makeDeps(fake, db.prisma);
  const sync = createSync(deps);
  const config = configWith([autoRule("coll", { target: { kind: "collections", ids: [collection] } })]);
  await sync.syncShop(shop, config);
  assert.deepEqual(fake.productMetafield(a.id), { ruleIds: ["coll"], variantRuleIds: {} });

  // In Shopify: A leaves the collection, B joins it; a webhook marked the targeting stale.
  fake.collections.set(collection, [b.id]);
  await markTargetingStale(db.prisma, shop, "collections/update", new Date(NOW.getTime() - 1000));
  fake.calls = [];
  const result = await sync.refreshProducts(shop, config, { configVersionId: "v9" });
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.equal(fake.productMetafield(a.id), undefined, "A no longer gets the discount");
  assert.deepEqual(fake.productMetafield(b.id), { ruleIds: ["coll"], variantRuleIds: {} });
  assert.equal(fake.callsOf("WonSyncShop").length, 0, "no shop read, no shop config write");
  assert.ok(!productSets(fake).flat().some((m) => m.key === "function_config"));
  const facts = await loadShopSyncFacts(db.prisma, shop);
  assert.equal(facts.targetingStaleAt, null, "the refresh started after the mark: cleared");
  assert.ok(facts.productsSyncedAt);
});

test("item 2: a stale mark newer than the refresh's start stays (that change may not have been read)", async () => {
  const fake = new FakeShopify();
  const a = fake.addProduct(1);
  const collection = fake.addCollection(7, [a.id]);
  let clock = NOW.getTime();
  const deps = makeDeps(fake, db.prisma, { now: () => new Date(clock) });
  const config = configWith([autoRule("coll", { target: { kind: "collections", ids: [collection] } })]);
  await markTargetingStale(db.prisma, shop, "products/update", new Date(clock + 60_000));
  clock += 1;
  await createSync(deps).refreshProducts(shop, config);
  assert.ok((await loadShopSyncFacts(db.prisma, shop)).targetingStaleAt, "still stale");
});

test("SyncDeps.plan is required in production wiring and resolves Free outside a dev environment", async () => {
  const deps = productionSyncDeps({} as AdminClient, {} as PrismaClient, quiet);
  const env = process.env.NODE_ENV;
  const devPlan = process.env.WON_DEV_PLAN;
  try {
    process.env.NODE_ENV = "production";
    process.env.WON_DEV_PLAN = "pro";
    assert.equal(await deps.plan("x.myshopify.com"), "free", "WON_DEV_PLAN is ignored in production");
    process.env.NODE_ENV = "development";
    assert.equal(await deps.plan("x.myshopify.com"), "pro", "the dev-only override");
    delete process.env.WON_DEV_PLAN;
    assert.equal(await deps.plan("x.myshopify.com"), "free");
  } finally {
    if (env === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = env;
    if (devPlan === undefined) delete process.env.WON_DEV_PLAN;
    else process.env.WON_DEV_PLAN = devPlan;
  }
});
