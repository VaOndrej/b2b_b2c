import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { after, before, beforeEach, test } from "node:test";

import { createTestDatabase, type TestDatabase } from "./lib/test-db.ts";

// F2 item 2 + item 6 (audit P1-2, P2-4): the REAL webhook routes, driven with
// HMAC-signed requests against a throwaway SQLite file.
//   - /webhooks/targeting (products/update, products/delete, collections/update,
//     collections/delete): a relevant delivery marks the shop's targeting stale
//     and schedules ONE debounced refresh; an irrelevant one changes nothing;
//     products/delete drops the product's index row; a repeated delivery is
//     idempotent; a bad HMAC is refused.
//   - app/uninstalled: sessions go, and so do the WonNode rows and the index
//     hashes (Shopify removes app discounts and app-owned metafields); the
//     config itself stays until shop/redact.

const SECRET = "won-discounts-test-secret";
const SHOP = "targeting-hooks.myshopify.com";
const COLLECTION = "gid://shopify/Collection/77";

type Action = (args: { request: Request; params: object; context: object }) => Promise<Response>;

let db: TestDatabase;
let targeting: Action;
let uninstalled: Action;
let refresher: { scheduled(shop: string): boolean; cancelAll(): void };

before(async () => {
  db = createTestDatabase("webhooks-targeting");
  process.env.DATABASE_URL = db.url;
  process.env.SHOPIFY_API_KEY = "test-api-key";
  process.env.SHOPIFY_API_SECRET = SECRET;
  process.env.SHOPIFY_APP_URL = "https://won-discounts.test";
  process.env.SCOPES = "read_products";
  targeting = (await import("../app/routes/webhooks.targeting.tsx")).action as unknown as Action;
  uninstalled = (await import("../app/routes/webhooks.app.uninstalled.tsx")).action as unknown as Action;
  const appDb = (await import("../app/db.server.ts")).default;
  refresher = (await import("../app/lib/integration/targeting.server.ts")).appTargetingRefresher(appDb);
});

after(async () => {
  refresher.cancelAll();
  await (globalThis as { prismaGlobal?: { $disconnect(): Promise<void> } }).prismaGlobal?.$disconnect();
  await db.drop();
});

beforeEach(async () => {
  refresher.cancelAll();
  await db.prisma.shopSyncState.deleteMany({});
  await db.prisma.shopConfig.deleteMany({});
  await db.prisma.productTargetIndex.deleteMany({});
});

function webhook(topic: string, body: object, id: string, secret = SECRET) {
  const raw = JSON.stringify(body);
  return new Request(`https://won-discounts.test/webhooks/targeting`, {
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

async function seedConfig(target: object) {
  const { saveConfig } = await import("../app/lib/config.server.ts");
  const saved = await saveConfig(db.prisma, SHOP, {
    modules: { codes: { rules: [{ id: "r", enabled: true, name: "Kolekce", method: "automatic", value: { kind: "percentage", percent: 10 }, target }] } },
  });
  assert.equal(saved.ok, true);
}

const stale = async () => (await db.prisma.shopSyncState.findUnique({ where: { shop: SHOP } }))?.targetingStaleAt ?? null;
const call = (request: Request) => targeting({ request, params: {}, context: {} });

test("products/update while a rule targets a collection: stale + one refresh scheduled, answered 200 at once", async () => {
  await seedConfig({ kind: "collections", ids: [COLLECTION] });
  const res = await call(webhook("products/update", { id: 12, admin_graphql_api_id: "gid://shopify/Product/12", updated_at: "x" }, "wh-p-1"));
  assert.equal(res.status, 200);
  assert.ok(await stale(), "marked stale");
  assert.equal(refresher.scheduled(SHOP), true);
});

test("products/update with no collection target (smart membership cannot matter): nothing marked", async () => {
  await seedConfig({ kind: "products", productIds: ["gid://shopify/Product/12"], variantIds: [] });
  const res = await call(webhook("products/update", { id: 12, admin_graphql_api_id: "gid://shopify/Product/12" }, "wh-p-2"));
  assert.equal(res.status, 200);
  assert.equal(await stale(), null);
  assert.equal(refresher.scheduled(SHOP), false);
});

test("collections/update: only a TARGETED collection marks the targeting stale; collections/delete too", async () => {
  await seedConfig({ kind: "collections", ids: [COLLECTION] });
  await call(webhook("collections/update", { id: 99, admin_graphql_api_id: "gid://shopify/Collection/99" }, "wh-c-1"));
  assert.equal(await stale(), null, "another collection");
  await call(webhook("collections/delete", { id: 77 }, "wh-c-2"));
  assert.ok(await stale(), "the targeted one (payload with the numeric id only)");
});

test("a repeated delivery is idempotent: still one stale mark (at the latest change, M-2), one refresh scheduled", async () => {
  await seedConfig({ kind: "collections", ids: [COLLECTION] });
  await call(webhook("collections/update", { id: 77, admin_graphql_api_id: COLLECTION }, "wh-dup"));
  const first = await stale();
  await new Promise((resolve) => setTimeout(resolve, 5));
  await call(webhook("collections/update", { id: 77, admin_graphql_api_id: COLLECTION }, "wh-dup"));
  const second = await stale();
  assert.ok(first && second && second.getTime() >= first.getTime(), "never moves back");
  assert.equal(await db.prisma.shopSyncState.count({ where: { shop: SHOP } }), 1);
  assert.equal(refresher.scheduled(SHOP), true);
});

test("products/delete drops the product's index row (its metafield is gone with it)", async () => {
  await db.prisma.productTargetIndex.create({ data: { shop: SHOP, productId: "gid://shopify/Product/12", payloadHash: "h" } });
  const res = await call(webhook("products/delete", { id: 12 }, "wh-d-1"));
  assert.equal(res.status, 200);
  assert.equal(await db.prisma.productTargetIndex.count({ where: { shop: SHOP } }), 0);
});

test("a bad HMAC is refused and changes nothing (WBH-1)", async () => {
  await seedConfig({ kind: "collections", ids: [COLLECTION] });
  let status = 0;
  try {
    status = (await call(webhook("collections/update", { id: 77 }, "wh-bad", "wrong-secret"))).status;
  } catch (error) {
    status = error instanceof Response ? error.status : -1;
  }
  assert.equal(status, 401);
  assert.equal(await stale(), null);
});

test("app/uninstalled: sessions, WonNode rows and index hashes go; the config and its history stay", async () => {
  await seedConfig({ kind: "collections", ids: [COLLECTION] });
  await db.prisma.wonNode.create({ data: { shop: SHOP, key: "auto", role: "automatic", discountNodeId: "gid://shopify/DiscountAutomaticNode/1" } });
  await db.prisma.productTargetIndex.create({ data: { shop: SHOP, productId: "gid://shopify/Product/1", payloadHash: "h" } });
  await db.prisma.session.upsert({
    where: { id: `offline_${SHOP}` },
    create: { id: `offline_${SHOP}`, shop: SHOP, state: "", isOnline: false, accessToken: "test-token" },
    update: {},
  });
  const raw = JSON.stringify({ id: 1 });
  const res = await uninstalled({
    request: new Request("https://won-discounts.test/webhooks/app/uninstalled", {
      method: "POST",
      body: raw,
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Hmac-Sha256": createHmac("sha256", SECRET).update(raw).digest("base64"),
        "X-Shopify-Topic": "app/uninstalled",
        "X-Shopify-API-Version": "2026-10",
        "X-Shopify-Shop-Domain": SHOP,
        "X-Shopify-Webhook-Id": "wh-u-1",
      },
    }),
    params: {},
    context: {},
  });
  assert.equal(res.status, 200);
  assert.equal(await db.prisma.session.count({ where: { shop: SHOP } }), 0);
  assert.equal(await db.prisma.wonNode.count({ where: { shop: SHOP } }), 0);
  assert.deepEqual((await db.prisma.productTargetIndex.findMany({ where: { shop: SHOP } })).map((r) => r.payloadHash), [null]);
  assert.equal(await db.prisma.shopConfig.count({ where: { shop: SHOP } }), 1);
});
