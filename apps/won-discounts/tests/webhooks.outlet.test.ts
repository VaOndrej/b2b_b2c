import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { after, before, beforeEach, test } from "node:test";

import { createTestDatabase, type TestDatabase } from "./lib/test-db.ts";

// Výprodej (MVP 5, contract O7): the REAL /webhooks/outlet route, driven with HMAC-signed requests against a
// throwaway SQLite — a bad HMAC is refused (WBH-1); an order line of a running sale is counted once, however
// often Shopify delivers it (WBH-2); a cancellation gives the pieces back; nothing else is stored (PRIV-1).

const SECRET = "won-discounts-test-secret";
const SHOP = "outlet-hooks.myshopify.com";
const VARIANT = "gid://shopify/ProductVariant/48468679000305";

type Action = (args: { request: Request; params: object; context: object }) => Promise<Response>;

let db: TestDatabase;
let outlet: Action;

before(async () => {
  db = createTestDatabase("webhooks-outlet");
  process.env.DATABASE_URL = db.url;
  process.env.SHOPIFY_API_KEY = "test-api-key";
  process.env.SHOPIFY_API_SECRET = SECRET;
  process.env.SHOPIFY_APP_URL = "https://won-discounts.test";
  process.env.SCOPES = "read_products";
  outlet = (await import("../app/routes/webhooks.outlet.tsx")).action as unknown as Action;
});

after(async () => {
  await (globalThis as { prismaGlobal?: { $disconnect(): Promise<void> } }).prismaGlobal?.$disconnect();
  await db.drop();
});

beforeEach(async () => {
  await db.prisma.outletEvent.deleteMany({});
  await db.prisma.outletRun.deleteMany({});
});

function signed(topic: string, body: object, id: string, secret = SECRET) {
  const raw = JSON.stringify(body);
  return new Request("https://won-discounts.test/webhooks/outlet", {
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

const call = (request: Request) => outlet({ request, params: {}, context: {} });
const running = () =>
  db.prisma.outletRun.create({
    data: { shop: SHOP, productId: "gid://shopify/Product/1", variantId: VARIANT, quota: 10, percent: 30, status: "active", startedAt: new Date("2026-10-01T00:00:00Z") },
  });
const ORDER = {
  id: 5001,
  created_at: "2026-10-02T10:00:00Z",
  email: "zakaznik@example.com",
  customer: { first_name: "Jana", last_name: "Nováková" },
  line_items: [{ id: 6001, variant_id: 48468679000305, quantity: 2 }],
};

test("a bad HMAC is refused and nothing is recorded", async () => {
  await running();
  const response = await call(signed("orders/create", ORDER, "wh-bad", "wrong-secret")).catch((e: unknown) => e as Response);
  assert.equal((response as Response).status, 401);
  assert.equal(await db.prisma.outletEvent.count(), 0);
});

test("orders/create counts the sale's pieces once; a repeated delivery changes nothing; no customer data is stored", async () => {
  const run = await running();
  assert.equal((await call(signed("orders/create", ORDER, "wh-1"))).status, 200);
  assert.equal((await call(signed("orders/create", ORDER, "wh-1-again"))).status, 200);
  const row = (await db.prisma.outletRun.findUnique({ where: { id: run.id } }))!;
  assert.equal(row.sold, 2);
  const stored = JSON.stringify(await db.prisma.outletEvent.findMany({}));
  assert.ok(!stored.includes("Nováková") && !stored.includes("example.com"), "PRIV-1");
});

test("orders/cancelled gives the pieces back to the quota", async () => {
  const run = await running();
  await call(signed("orders/create", ORDER, "wh-2"));
  assert.equal((await call(signed("orders/cancelled", { id: 5001, line_items: ORDER.line_items }, "wh-3"))).status, 200);
  const row = (await db.prisma.outletRun.findUnique({ where: { id: run.id } }))!;
  assert.equal(row.returned, 2);
});
