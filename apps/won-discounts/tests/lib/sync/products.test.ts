import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";

import { createSync } from "../../../app/lib/sync/sync.server.ts";
import { createTestDatabase, type TestDatabase } from "../test-db.ts";
import { FakeShopify } from "./fake-shopify.ts";
import { autoRule, configWith, makeDeps, oversizedProducts } from "./helpers.ts";

// Product targeting (spec §1 C3): productRuleIndex → `$app:won_discounts`/
// `product` = productMetafieldValue(entry) on targeted products; only changed
// products are written (≤ 25 per metafieldsSet); products that dropped out are
// cleared. Which products carry the metafield is tracked in Prisma
// ProductTargetIndex (write-ahead, no cap, M10).

let db: TestDatabase;
let seq = 0;
let shop: string;
before(() => {
  db = createTestDatabase("sync-products");
});
after(async () => {
  await db.drop();
});
beforeEach(() => {
  seq += 1;
  shop = `products-${seq}.myshopify.com`;
  oversizedProducts.clear();
});

const indexed = async (): Promise<string[]> =>
  (await db.prisma.productTargetIndex.findMany({ where: { shop } })).map((row) => row.productId.split("/").pop()!).sort();
const productSetCalls = (fake: FakeShopify) =>
  fake
    .callsOf("WonSyncMetafieldsSet")
    .map((call) => (call.variables as { metafields: { key: string; ownerId: string }[] }).metafields)
    .filter((mfs) => mfs[0]!.key === "product");

test("targeted products (product ids + paged collections) get their value; writes are batched ≤ 25; tracked in the DB", async () => {
  const fake = new FakeShopify();
  fake.pageSize = 7; // collection pages of 7 → 5 pages for 30 products
  const direct = fake.addProduct(1);
  const members = Array.from({ length: 30 }, (_, i) => fake.addProduct(100 + i).id);
  const collection = fake.addCollection(5, members);
  fake.addProduct(999); // not targeted
  const deps = makeDeps(fake, db.prisma);
  const config = configWith([
    autoRule("direct", { target: { kind: "products", productIds: [direct.id], variantIds: [] } }),
    autoRule("coll", { target: { kind: "collections", ids: [collection] } }),
  ]);

  const result = await createSync(deps).syncShop(shop, config);
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.equal(fake.callsOf("WonSyncCollectionProducts").length, 5, "collection paged");
  assert.deepEqual(fake.productMetafield(direct.id), { ruleIds: ["direct"], variantRuleIds: {} });
  for (const id of members) assert.deepEqual(fake.productMetafield(id), { ruleIds: ["coll"], variantRuleIds: {} });
  assert.equal(fake.productMetafield("gid://shopify/Product/999"), undefined);
  assert.deepEqual(productSetCalls(fake).map((mfs) => mfs.length), [25, 6]);
  assert.equal((await indexed()).length, 31);
  const rows = await db.prisma.productTargetIndex.findMany({ where: { shop } });
  assert.ok(rows.every((row) => typeof row.payloadHash === "string"), "hash recorded after a successful write");
  assert.equal(fake.shopMetafieldValue("product_index"), undefined, "no bookkeeping in Shopify any more");
  const inputs = deps.log.indexInputs.at(-1)!;
  assert.deepEqual(inputs.find((p) => p.productId === members[0])!.collectionIds, [collection]);
});

test("only changed products are written (hash fast path: no read); a product that drops out is cleared and untracked", async () => {
  const fake = new FakeShopify();
  const [a, b, c] = [fake.addProduct(1), fake.addProduct(2), fake.addProduct(3)];
  const deps = makeDeps(fake, db.prisma);
  const sync = createSync(deps);
  await sync.syncShop(shop, configWith([autoRule("r", { target: { kind: "products", productIds: [a.id, b.id, c.id], variantIds: [] } })]));
  assert.deepEqual(await indexed(), ["1", "2", "3"]);

  fake.calls = [];
  const same = await sync.syncShop(shop, configWith([autoRule("r", { target: { kind: "products", productIds: [a.id, b.id, c.id], variantIds: [] } })]));
  assert.equal(same.ok, true);
  assert.equal(fake.callsOf("WonSyncProductMetafields").length, 0, "unchanged products are not even read");

  fake.calls = [];
  const result = await sync.syncShop(
    shop,
    configWith([
      autoRule("r", { target: { kind: "products", productIds: [a.id, b.id], variantIds: [] } }),
      autoRule("s", { target: { kind: "products", productIds: [b.id], variantIds: [] } }),
    ]),
  );
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.deepEqual(productSetCalls(fake).flat().map((m) => m.ownerId), [b.id], "a is unchanged: no write");
  assert.deepEqual(fake.productMetafield(b.id), { ruleIds: ["r", "s"], variantRuleIds: {} });
  assert.deepEqual(fake.callsOf("WonSyncMetafieldsDelete").map((call) => call.variables), [
    { metafields: [{ ownerId: c.id, namespace: "$app:won_discounts", key: "product" }] },
  ]);
  assert.equal(fake.productMetafield(c.id), undefined);
  assert.deepEqual(await indexed(), ["1", "2"]);
});

test("variant targets: the full variant list goes to productRuleIndex; variant keys are numeric ids", async () => {
  const fake = new FakeShopify();
  fake.pageSize = 2;
  const product = fake.addProduct(4, 5);
  const deps = makeDeps(fake, db.prisma);
  const variant = product.variantIds[1]!;
  const result = await createSync(deps).syncShop(
    shop,
    configWith([autoRule("v", { target: { kind: "products", productIds: [], variantIds: [variant] } })]),
  );
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  const input = deps.log.indexInputs.at(-1)!.find((p) => p.productId === product.id)!;
  assert.deepEqual([...input.variantIds], product.variantIds);
  assert.deepEqual(fake.productMetafield(product.id), { ruleIds: [], variantRuleIds: { [variant.split("/").pop()!]: ["v"] } });
});

test("a failed product SET stays tracked (hash null) and is retried; it does NOT hold the shop config", async () => {
  const fake = new FakeShopify();
  const p = fake.addProduct(1);
  const deps = makeDeps(fake, db.prisma);
  const sync = createSync(deps);
  const config = configWith([autoRule("r", { target: { kind: "products", productIds: [p.id], variantIds: [] } })]);
  const original = fake.graphql.bind(fake);
  fake.graphql = async (query, variables) => {
    const keys = (variables as { metafields?: { key: string }[] } | undefined)?.metafields?.map((m) => m.key) ?? [];
    if (query.includes("WonSyncMetafieldsSet") && keys[0] === "product") {
      return { data: { metafieldsSet: { metafields: [], userErrors: [{ field: ["metafields", "0", "value"], message: "boom" }] } } };
    }
    return original(query, variables);
  };
  const first = await sync.syncShop(shop, config);
  assert.equal(first.ok, false);
  assert.ok(first.steps.some((step) => step.step === "products.set" && !step.ok && /boom/.test(step.detail)));
  const row = await db.prisma.productTargetIndex.findFirst({ where: { shop } });
  assert.equal(row?.payloadHash, null, "write-ahead row, still tracked");
  assert.ok(fake.shopMetafieldValue("function_config"), "a missing NEW ref does not hold the config");

  fake.graphql = original;
  const second = await sync.syncShop(shop, config);
  assert.equal(second.ok, true, JSON.stringify(second.errors));
  assert.deepEqual(fake.productMetafield(p.id), { ruleIds: ["r"], variantRuleIds: {} });
});

test("M1: a product that left a rule but could not be cleared HOLDS the new shop config (previous one stays)", async () => {
  const fake = new FakeShopify();
  const [a, b] = [fake.addProduct(1), fake.addProduct(2)];
  const deps = makeDeps(fake, db.prisma);
  const sync = createSync(deps);
  await sync.syncShop(shop, configWith([autoRule("r", { target: { kind: "products", productIds: [a.id, b.id], variantIds: [] } })]));
  const previous = fake.shopMetafieldValue("function_config");

  fake.fail("WonSyncMetafieldsDelete", { userErrors: [{ message: "boom" }] }, 1);
  const result = await sync.syncShop(
    shop,
    configWith([autoRule("r", { value: { kind: "percentage", percent: 50 }, target: { kind: "products", productIds: [a.id], variantIds: [] } })]),
  );
  assert.equal(result.ok, false);
  assert.ok(result.steps.some((s) => s.step === "products.clear" && !s.ok));
  assert.ok(result.steps.some((s) => s.step === "shop_config.write" && !s.ok && /held/.test(s.detail)), JSON.stringify(result.steps));
  assert.equal(fake.shopMetafieldValue("function_config"), previous, "b never gets the rule's NEW 50 % through its stale ref");
  assert.ok(result.pending.includes("stale_product_refs"));
  assert.deepEqual(await indexed(), ["1", "2"], "b stays tracked for the retry");

  const retry = await sync.syncShop(
    shop,
    configWith([autoRule("r", { value: { kind: "percentage", percent: 50 }, target: { kind: "products", productIds: [a.id], variantIds: [] } })]),
  );
  assert.equal(retry.ok, true, JSON.stringify(retry.errors));
  assert.equal(fake.productMetafield(b.id), undefined, "b cleared on the retry");
  assert.ok(retry.steps.some((s) => s.step === "shop_config.write" && s.ok), "and the config is no longer held");
  assert.deepEqual(retry.pending, []);
});

test("the engine's `oversized` report is surfaced as a warning step (human detail); only productMetafieldValue is written", async () => {
  const fake = new FakeShopify();
  const p = fake.addProduct(7);
  oversizedProducts.set(p.id, { bytes: 12_345, collapsedRefs: ["wide"], droppedRefs: ["narrow"] });
  const deps = makeDeps(fake, db.prisma);
  const result = await createSync(deps).syncShop(
    shop,
    configWith([autoRule("wide", { target: { kind: "products", productIds: [p.id], variantIds: [] } })]),
  );
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  const step = result.steps.find((s) => s.step === "products.oversized");
  assert.ok(step?.warning, JSON.stringify(result.steps));
  assert.match(step!.detail, /12345 B/);
  assert.match(step!.detail, /narrow no longer apply/);
  assert.match(step!.detail, /wide now apply to all its variants/);
  assert.deepEqual(fake.productMetafield(p.id), { ruleIds: ["wide"], variantRuleIds: {} }, "the report itself is never written");
});

test("a product deleted in Shopify is dropped from the index; no cap on the number of products", async () => {
  const fake = new FakeShopify();
  const kept = fake.addProduct(1);
  await db.prisma.productTargetIndex.create({ data: { shop, productId: "gid://shopify/Product/77", payloadHash: "x" } });
  const many = Array.from({ length: 400 }, (_, i) => fake.addProduct(1000 + i).id);
  const deps = makeDeps(fake, db.prisma);
  const result = await createSync(deps).syncShop(
    shop,
    configWith([
      autoRule("r", { target: { kind: "products", productIds: [kept.id], variantIds: [] } }),
      autoRule("big", { target: { kind: "collections", ids: [fake.addCollection(9, many)] } }),
    ]),
  );
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  const ids = await indexed();
  assert.ok(!ids.includes("77"));
  assert.equal(ids.length, 401);
});
