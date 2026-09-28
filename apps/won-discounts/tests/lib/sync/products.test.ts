import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";

import { createSync } from "../../../app/lib/sync/sync.server.ts";
import { encodeProductIndex, parseProductIndex } from "../../../app/lib/sync/products.ts";
import { createTestDatabase, type TestDatabase } from "../test-db.ts";
import { FakeShopify } from "./fake-shopify.ts";
import { autoRule, configWith, makeDeps } from "./helpers.ts";

// Product targeting (spec §1 C3): productRuleIndex → `$app:won_discounts`/
// `product` = {"ruleIds", "variantRuleIds"} on targeted products; only changed products
// are written (≤ 25 per metafieldsSet); products that dropped out are cleared,
// found through the app-owned shop `product_index` (write-ahead).

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
});

/** Numeric product ids in the stored index (its on-store format). */
const indexOf = (fake: FakeShopify): string[] => (JSON.parse(fake.shopMetafieldValue("product_index") ?? '{"products":[]}').products as string[]).sort();
const setKeys = (fake: FakeShopify) =>
  fake.callsOf("WonSyncMetafieldsSet").map((call) => (call.variables as { metafields: { key: string }[] }).metafields.map((m) => m.key));

test("targeted products (product ids + paged collections) get their rule entry; writes are batched ≤ 25", async () => {
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

  const productBatches = setKeys(fake).filter((keys) => keys[0] === "product");
  assert.deepEqual(productBatches.map((keys) => keys.length), [25, 6]);
  // The index is written BEFORE the first product write (write-ahead) and tracks all 31.
  const keys = setKeys(fake).map((k) => k[0]);
  assert.ok(keys.indexOf("product_index") < keys.indexOf("product"), keys.join(", "));
  assert.equal(indexOf(fake).length, 31);
  // productRuleIndex got the collection membership.
  const inputs = deps.log.indexInputs.at(-1)!;
  assert.deepEqual(inputs.find((p) => p.productId === members[0])!.collectionIds, [collection]);
});

test("only changed products are written; a product that drops out is cleared and untracked", async () => {
  const fake = new FakeShopify();
  const [a, b, c] = [fake.addProduct(1), fake.addProduct(2), fake.addProduct(3)];
  const deps = makeDeps(fake, db.prisma);
  const sync = createSync(deps);
  await sync.syncShop(shop, configWith([autoRule("r", { target: { kind: "products", productIds: [a.id, b.id, c.id], variantIds: [] } })]));
  assert.deepEqual(indexOf(fake), ["1", "2", "3"]);

  fake.calls = [];
  const result = await sync.syncShop(
    shop,
    configWith([
      autoRule("r", { target: { kind: "products", productIds: [a.id, b.id], variantIds: [] } }),
      autoRule("s", { target: { kind: "products", productIds: [b.id], variantIds: [] } }),
    ]),
  );
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  const productSets = fake
    .callsOf("WonSyncMetafieldsSet")
    .flatMap((call) => (call.variables as { metafields: { key: string; ownerId: string }[] }).metafields)
    .filter((m) => m.key === "product")
    .map((m) => m.ownerId);
  assert.deepEqual(productSets, [b.id], "a is unchanged: no write");
  assert.deepEqual(fake.productMetafield(b.id), { ruleIds: ["r", "s"], variantRuleIds: {} });
  assert.deepEqual(
    fake.callsOf("WonSyncMetafieldsDelete").map((call) => call.variables),
    [{ metafields: [{ ownerId: c.id, namespace: "$app:won_discounts", key: "product" }] }],
  );
  assert.equal(fake.productMetafield(c.id), undefined);
  assert.deepEqual(indexOf(fake), ["1", "2"]);
});

test("variant targets: productRuleIndex gets the product's full variant list (paged)", async () => {
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
  assert.deepEqual(fake.productMetafield(product.id), { ruleIds: [], variantRuleIds: { [variant]: ["v"] } });
});

test("a failed product batch stays tracked and is retried on the next sync", async () => {
  const fake = new FakeShopify();
  const p = fake.addProduct(1);
  const deps = makeDeps(fake, db.prisma);
  const sync = createSync(deps);
  const config = configWith([autoRule("r", { target: { kind: "products", productIds: [p.id], variantIds: [] } })]);
  // 1st metafieldsSet = the write-ahead index, 2nd = the product batch.
  const original = fake.graphql.bind(fake);
  let sets = 0;
  fake.graphql = async (query, variables) => {
    if (query.includes("WonSyncMetafieldsSet") && ++sets === 2) {
      return { data: { metafieldsSet: { metafields: [], userErrors: [{ field: ["metafields", "0", "value"], message: "boom" }] } } };
    }
    return original(query, variables);
  };
  const first = await sync.syncShop(shop, config);
  assert.equal(first.ok, false);
  assert.ok(first.steps.some((step) => step.step === "products.set" && !step.ok && /boom/.test(step.detail)));
  assert.deepEqual(indexOf(fake), ["1"], "still tracked");
  assert.equal(fake.productMetafield(p.id), undefined);

  fake.graphql = original;
  const second = await sync.syncShop(shop, config);
  assert.equal(second.ok, true, JSON.stringify(second.errors));
  assert.deepEqual(fake.productMetafield(p.id), { ruleIds: ["r"], variantRuleIds: {} });
});

test("a deleted product or an unreadable index never breaks the sync", async () => {
  const fake = new FakeShopify();
  const kept = fake.addProduct(1);
  fake.shopMetafields.set("$app:won_discounts/product_index", {
    id: "m",
    namespace: "$app:won_discounts",
    key: "product_index",
    type: "json",
    value: encodeProductIndex(["gid://shopify/Product/77", kept.id]), // 77 no longer exists
  });
  const deps = makeDeps(fake, db.prisma);
  const result = await createSync(deps).syncShop(
    shop,
    configWith([autoRule("r", { target: { kind: "products", productIds: [kept.id], variantIds: [] } })]),
  );
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.deepEqual(indexOf(fake), ["1"]);

  // An unreadable index is flagged (stale refs outside today's targets cannot be found) and rebuilt.
  fake.shopMetafields.get("$app:won_discounts/product_index")!.value = "not json";
  const flagged = await createSync(deps).syncShop(shop, configWith([]));
  assert.equal(flagged.ok, false);
  assert.ok(flagged.steps.some((step) => step.step === "products.index" && !step.ok && /unreadable/.test(step.detail)));
  assert.equal(flagged.steps.filter((step) => !step.ok).length, 1, "nothing else failed");
  assert.deepEqual(indexOf(fake), []);
  const repaired = await createSync(deps).syncShop(shop, configWith([]));
  assert.equal(repaired.ok, true, JSON.stringify(repaired.errors));
});

test("parse/encode product index round trip", () => {
  const json = encodeProductIndex(["gid://shopify/Product/2", "gid://shopify/Product/10", "gid://shopify/Product/2"]);
  assert.equal(json, '{"v":1,"products":["10","2"]}');
  assert.deepEqual(parseProductIndex(json), { products: ["gid://shopify/Product/10", "gid://shopify/Product/2"], readable: true });
  assert.deepEqual(parseProductIndex(null), { products: [], readable: true });
  assert.deepEqual(parseProductIndex("{"), { products: [], readable: false });
});
