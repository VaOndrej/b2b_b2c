import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { after, before, test } from "node:test";

import { createTestDatabase, type TestDatabase } from "./lib/test-db.ts";

// Audit P2-4 (PRIV-2, A7): the REAL webhook routes, driven with HMAC-signed
// requests against a throwaway SQLite file.
//   - app/uninstalled only clears sessions. App data must survive it: a delayed
//     or repeated uninstall webhook after a quick reinstall would otherwise wipe
//     the NEW config, and MVP 1 stores native-discount backups there that undo
//     needs after a reinstall.
//   - shop/redact (~48 h after uninstall) erases the shop's data, and a failing
//     deletion answers non-2xx so Shopify retries instead of forgetting it.

const SECRET = "won-discounts-test-secret";
const SHOP = "lifecycle.myshopify.com";

type Action = (args: { request: Request; params: object; context: object }) => Promise<Response>;

let db: TestDatabase;
let uninstalled: Action;
let shopRedact: Action;

before(async () => {
  db = createTestDatabase("webhooks");
  // app/db.server.ts builds its PrismaClient from DATABASE_URL at import time, and
  // app/shopify.server.ts reads the app credentials at import time: set both first.
  process.env.DATABASE_URL = db.url;
  process.env.SHOPIFY_API_KEY = "test-api-key";
  process.env.SHOPIFY_API_SECRET = SECRET;
  process.env.SHOPIFY_APP_URL = "https://won-discounts.test";
  process.env.SCOPES = "read_products";
  uninstalled = (await import("../app/routes/webhooks.app.uninstalled.tsx")).action as unknown as Action;
  shopRedact = (await import("../app/routes/webhooks.shop.redact.tsx")).action as unknown as Action;
});

after(async () => {
  await (globalThis as { prismaGlobal?: { $disconnect(): Promise<void> } }).prismaGlobal?.$disconnect();
  await db.drop();
});

function webhook(topic: string, body: object, id: string) {
  const raw = JSON.stringify(body);
  return new Request(`https://won-discounts.test/webhooks/${topic}`, {
    method: "POST",
    body: raw,
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Hmac-Sha256": createHmac("sha256", SECRET).update(raw).digest("base64"),
      "X-Shopify-Topic": topic,
      "X-Shopify-API-Version": "2026-04",
      "X-Shopify-Shop-Domain": SHOP,
      "X-Shopify-Webhook-Id": id,
    },
  });
}

async function seedShop() {
  await db.prisma.shopConfig.upsert({
    where: { shop: SHOP },
    create: { shop: SHOP, schemaVersion: 1, data: "{}" },
    update: {},
  });
  await db.prisma.configVersion.create({ data: { shop: SHOP, schemaVersion: 1, data: "{}" } });
  await db.prisma.session.upsert({
    where: { id: `offline_${SHOP}` },
    create: { id: `offline_${SHOP}`, shop: SHOP, state: "", isOnline: false, accessToken: "test-token" },
    update: {},
  });
}

async function counts() {
  return {
    shopConfig: await db.prisma.shopConfig.count({ where: { shop: SHOP } }),
    configVersion: await db.prisma.configVersion.count({ where: { shop: SHOP } }),
    sessions: await db.prisma.session.count({ where: { shop: SHOP } }),
  };
}

test("app/uninstalled clears sessions but keeps ShopConfig + ConfigVersion", async () => {
  await seedShop();
  const res = await uninstalled({ request: webhook("app/uninstalled", { id: 1 }, "wh-uninstall-1"), params: {}, context: {} });
  assert.equal(res.status, 200);
  assert.deepEqual(await counts(), { shopConfig: 1, configVersion: 1, sessions: 0 });
});

test("shop/redact erases ShopConfig + ConfigVersion + sessions", async () => {
  await seedShop();
  const res = await shopRedact({
    request: webhook("shop/redact", { shop_id: 1, shop_domain: SHOP }, "wh-redact-1"),
    params: {},
    context: {},
  });
  assert.equal(res.status, 200);
  assert.deepEqual(await counts(), { shopConfig: 0, configVersion: 0, sessions: 0 });
});

test("shop/redact answers non-2xx when the deletion fails, so Shopify retries (nothing silently kept)", async () => {
  await seedShop();
  // Make the real deletion fail: the ConfigVersion table is gone.
  await db.prisma.$executeRawUnsafe('DROP TABLE "ConfigVersion"');
  const res = await shopRedact({
    request: webhook("shop/redact", { shop_id: 1, shop_domain: SHOP }, "wh-redact-2"),
    params: {},
    context: {},
  });
  assert.ok(res.status >= 500, `expected a retryable 5xx, got ${res.status}`);
  assert.equal(await db.prisma.shopConfig.count({ where: { shop: SHOP } }), 1, "transaction rolled back, data still there");
});
