import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { after, before, beforeEach, test } from "node:test";

import { createTestDatabase, type TestDatabase } from "./lib/test-db.ts";

// Margin protection (MVP 2): the REAL webhook routes that keep the cost
// mirror fresh, driven with HMAC-signed requests against a throwaway SQLite.
//   - /webhooks/costs (inventory_items/update): while protection is on, the
//     inventory item is queued for ONE debounced per-shop mirror (the answer
//     never waits for Shopify); off → nothing; a repeated delivery changes
//     nothing more (WBH-2); an unknown or malformed item is answered 200 and
//     ignored; a bad HMAC is refused (WBH-1).
//   - /webhooks/targeting also gets products/create (new topic, MVP 1 targeting
//     too) and products/update → the product's variants are queued for the
//     mirror; products/delete drops the product's VariantCost rows.
//   - app/uninstalled and shop/redact delete the shop's VariantCost rows.

const SECRET = "won-discounts-test-secret";
const SHOP = "cost-hooks.myshopify.com";
const COLLECTION = "gid://shopify/Collection/77";

type Action = (args: { request: Request; params: object; context: object }) => Promise<Response>;

let db: TestDatabase;
let costs: Action;
let targeting: Action;
let uninstalled: Action;
let costRefresher: { scheduled(shop: string): boolean; pending(shop: string): { inventoryItemIds: string[]; productIds: string[] }; cancelAll(): void };
let targetingRefresher: { scheduled(shop: string): boolean; cancelAll(): void };

before(async () => {
  db = createTestDatabase("webhooks-costs");
  process.env.DATABASE_URL = db.url;
  process.env.SHOPIFY_API_KEY = "test-api-key";
  process.env.SHOPIFY_API_SECRET = SECRET;
  process.env.SHOPIFY_APP_URL = "https://won-discounts.test";
  process.env.SCOPES = "read_products";
  costs = (await import("../app/routes/webhooks.costs.tsx")).action as unknown as Action;
  targeting = (await import("../app/routes/webhooks.targeting.tsx")).action as unknown as Action;
  uninstalled = (await import("../app/routes/webhooks.app.uninstalled.tsx")).action as unknown as Action;
  const appDb = (await import("../app/db.server.ts")).default;
  costRefresher = (await import("../app/lib/integration/costs.server.ts")).appCostRefresher(appDb);
  targetingRefresher = (await import("../app/lib/integration/targeting.server.ts")).appTargetingRefresher(appDb);
});

after(async () => {
  costRefresher.cancelAll();
  targetingRefresher.cancelAll();
  await (globalThis as { prismaGlobal?: { $disconnect(): Promise<void> } }).prismaGlobal?.$disconnect();
  await db.drop();
});

beforeEach(async () => {
  costRefresher.cancelAll();
  targetingRefresher.cancelAll();
  await db.prisma.shopSyncState.deleteMany({});
  await db.prisma.shopConfig.deleteMany({});
  await db.prisma.variantCost.deleteMany({});
});

function signed(uri: string, topic: string, body: object, id: string, secret = SECRET) {
  const raw = JSON.stringify(body);
  return new Request(`https://won-discounts.test${uri}`, {
    method: "POST",
    body: raw,
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Hmac-Sha256": createHmac("sha256", secret).update(raw).digest("base64"),
      "X-Shopify-Topic": topic,
      "X-Shopify-API-Version": "2026-10",
      "X-Shopify-Shop-Domain": SHOP,
      "X-Shopify-Webhook-Id": id,
    },
  });
}

async function seedMargin(enabled: boolean, rules: unknown[] = []) {
  const { saveConfig } = await import("../app/lib/config.server.ts");
  const saved = await saveConfig(db.prisma, SHOP, {
    modules: { codes: { rules }, margin: { enabled, global: { minMarginPercent: 20, maxDiscountPercent: 50 }, perCollection: [] } },
  });
  assert.equal(saved.ok, true);
}

async function seedRow(variant: number, product: number, cost: string | null) {
  await db.prisma.variantCost.create({
    data: {
      shop: SHOP,
      variantId: `gid://shopify/ProductVariant/${variant}`,
      productId: `gid://shopify/Product/${product}`,
      inventoryItemId: `gid://shopify/InventoryItem/${variant}`,
      price: "10.00",
      cost,
      currency: cost ? "USD" : null,
      metafieldValue: cost ? `{"cost":${Number(cost)},"cur":"USD"}` : null,
    },
  });
}

const item = (id: number) => ({ id, admin_graphql_api_id: `gid://shopify/InventoryItem/${id}`, cost: "6.50", updated_at: "2026-09-29T12:00:00Z" });
const callCosts = (request: Request) => costs({ request, params: {}, context: {} });
const callTargeting = (request: Request) => targeting({ request, params: {}, context: {} });

test("inventory_items/update while protection is on: queued for one debounced mirror, answered 200 at once", async () => {
  await seedMargin(true);
  const started = Date.now();
  const res = await callCosts(signed("/webhooks/costs", "inventory_items/update", item(501), "wh-i-1"));
  assert.equal(res.status, 200);
  assert.ok(Date.now() - started < 2_000, "no Shopify call before the answer");
  assert.equal(costRefresher.scheduled(SHOP), true);
  assert.deepEqual(costRefresher.pending(SHOP).inventoryItemIds, ["gid://shopify/InventoryItem/501"]);
});

test("a repeated delivery is idempotent (WBH-2): the item is queued once, one mirror scheduled", async () => {
  await seedMargin(true);
  await callCosts(signed("/webhooks/costs", "inventory_items/update", item(502), "wh-dup"));
  await callCosts(signed("/webhooks/costs", "inventory_items/update", item(502), "wh-dup"));
  assert.deepEqual(costRefresher.pending(SHOP).inventoryItemIds, ["gid://shopify/InventoryItem/502"]);
  assert.equal(costRefresher.scheduled(SHOP), true);
});

test("protection off (or no config): nothing is queued — no mirror while off", async () => {
  let res = await callCosts(signed("/webhooks/costs", "inventory_items/update", item(503), "wh-i-2"));
  assert.equal(res.status, 200);
  assert.equal(costRefresher.scheduled(SHOP), false, "no config");
  await seedMargin(false);
  res = await callCosts(signed("/webhooks/costs", "inventory_items/update", item(503), "wh-i-3"));
  assert.equal(res.status, 200);
  assert.equal(costRefresher.scheduled(SHOP), false);
});

test("an unknown inventory item is queued like any other (the mirror looks its variant up); a payload without an id is ignored", async () => {
  await seedMargin(true);
  const res = await callCosts(signed("/webhooks/costs", "inventory_items/update", item(999999), "wh-i-4"));
  assert.equal(res.status, 200);
  assert.deepEqual(costRefresher.pending(SHOP).inventoryItemIds, ["gid://shopify/InventoryItem/999999"]);
  costRefresher.cancelAll();
  const junk = await callCosts(signed("/webhooks/costs", "inventory_items/update", { cost: "1.00" }, "wh-i-5"));
  assert.equal(junk.status, 200);
  assert.equal(costRefresher.scheduled(SHOP), false);
});

test("a bad HMAC is refused and queues nothing (WBH-1)", async () => {
  await seedMargin(true);
  let status = 0;
  try {
    status = (await callCosts(signed("/webhooks/costs", "inventory_items/update", item(504), "wh-bad", "wrong-secret"))).status;
  } catch (error) {
    status = error instanceof Response ? error.status : -1;
  }
  assert.equal(status, 401);
  assert.equal(costRefresher.scheduled(SHOP), false);
});

test("products/create (new topic): targeting stale when a rule targets a collection, and the product queued for the cost mirror", async () => {
  await seedMargin(true, [
    { id: "r", enabled: true, name: "Kolekce", method: "automatic", value: { kind: "percentage", percent: 10 }, target: { kind: "collections", ids: [COLLECTION] } },
  ]);
  const res = await callTargeting(signed("/webhooks/targeting", "products/create", { id: 12, admin_graphql_api_id: "gid://shopify/Product/12", updated_at: "x" }, "wh-pc-1"));
  assert.equal(res.status, 200);
  assert.ok((await db.prisma.shopSyncState.findUnique({ where: { shop: SHOP } }))?.targetingStaleAt, "targeting marked stale");
  assert.equal(targetingRefresher.scheduled(SHOP), true);
  assert.deepEqual(costRefresher.pending(SHOP).productIds, ["gid://shopify/Product/12"]);
});

test("products/update while protection is on queues the product's variants; off queues nothing", async () => {
  await seedMargin(true);
  await callTargeting(signed("/webhooks/targeting", "products/update", { id: 13, admin_graphql_api_id: "gid://shopify/Product/13" }, "wh-pu-1"));
  assert.deepEqual(costRefresher.pending(SHOP).productIds, ["gid://shopify/Product/13"]);
  costRefresher.cancelAll();
  await seedMargin(false);
  await callTargeting(signed("/webhooks/targeting", "products/update", { id: 13, admin_graphql_api_id: "gid://shopify/Product/13" }, "wh-pu-2"));
  assert.equal(costRefresher.scheduled(SHOP), false);
});

test("products/delete drops the product's VariantCost rows (its variant metafields are gone with it)", async () => {
  await seedRow(1201, 12, "5.00");
  await seedRow(1202, 12, null);
  await seedRow(1301, 13, "5.00");
  const res = await callTargeting(signed("/webhooks/targeting", "products/delete", { id: 12 }, "wh-pd-1"));
  assert.equal(res.status, 200);
  assert.deepEqual((await db.prisma.variantCost.findMany({ where: { shop: SHOP } })).map((r) => r.variantId), ["gid://shopify/ProductVariant/1301"]);
});

test("app/uninstalled deletes the shop's VariantCost rows and its cost-pass bookkeeping (Shopify removed the metafields)", async () => {
  await seedMargin(true);
  await seedRow(1401, 14, "5.00");
  await db.prisma.shopSyncState.create({ data: { shop: SHOP, costsScannedAt: new Date(), costsCursor: "abc", costsPending: '{"token":"t","since":"x","done":1,"total":2}' } });
  const res = await uninstalled({ request: signed("/webhooks/app/uninstalled", "app/uninstalled", { id: 1 }, "wh-u-1"), params: {}, context: {} });
  assert.equal(res.status, 200);
  assert.equal(await db.prisma.variantCost.count({ where: { shop: SHOP } }), 0);
  const state = await db.prisma.shopSyncState.findUnique({ where: { shop: SHOP } });
  assert.deepEqual([state?.costsScannedAt, state?.costsCursor, state?.costsPending], [null, null, null]);
  assert.equal(await db.prisma.shopConfig.count({ where: { shop: SHOP } }), 1, "the config stays until shop/redact");
});

test("shop/redact (deleteShopData) erases the VariantCost rows too", async () => {
  await seedRow(1501, 15, "5.00");
  const { deleteShopData } = await import("../app/lib/config.server.ts");
  await deleteShopData(db.prisma, SHOP);
  assert.equal(await db.prisma.variantCost.count({ where: { shop: SHOP } }), 0);
});
