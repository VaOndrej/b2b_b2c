import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { after, before, test } from "node:test";

import { createTestDatabase, type TestDatabase } from "./lib/test-db.ts";

// MVP 7 (contracts M1, M4): the REAL routes with HMAC-signed requests against a throwaway SQLite.
//   /webhooks/app_subscriptions/update  the plan row follows Shopify at once; a bad HMAC is refused (WBH-1), a
//                                       redelivery changes nothing (WBH-2), another plan's update is ignored;
//   /webhooks/outlet (orders/create)    also keeps one order fact for the reports, without personal data;
//   the plan resolver                   Pro only through the database handed to it (setPlanDatabase), per shop;
//   shop/redact                         erases the plan row and the order facts.

const SECRET = "won-discounts-test-secret";
const SHOP = "billing-hooks.myshopify.com";
type Action = (args: { request: Request; params: object; context: object }) => Promise<Response>;

let db: TestDatabase;
let subscription: Action;
let orders: Action;

before(async () => {
  db = createTestDatabase("webhooks-billing");
  process.env.DATABASE_URL = db.url;
  process.env.SHOPIFY_API_KEY = "test-api-key";
  process.env.SHOPIFY_API_SECRET = SECRET;
  process.env.SHOPIFY_APP_URL = "https://won-discounts.test";
  process.env.SCOPES = "read_products";
  subscription = (await import("../app/routes/webhooks.app_subscriptions.update.tsx")).action as unknown as Action;
  orders = (await import("../app/routes/webhooks.outlet.tsx")).action as unknown as Action;
});

after(async () => {
  await (globalThis as { prismaGlobal?: { $disconnect(): Promise<void> } }).prismaGlobal?.$disconnect();
  await db.drop();
});

function signed(path: string, topic: string, body: object, id: string, secret = SECRET) {
  const raw = JSON.stringify(body);
  return new Request(`https://won-discounts.test${path}`, {
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
const update = (name: string, status: string, id: string, secret?: string) =>
  subscription({ request: signed("/webhooks/app_subscriptions/update", "app_subscriptions/update", { app_subscription: { admin_graphql_api_id: "gid://shopify/AppSubscription/1", name, status } }, id, secret), params: {}, context: {} });
const row = () => db.prisma.shopEntitlement.findUnique({ where: { shop: SHOP } });

test("subscription update: a bad HMAC is refused; ACTIVE makes the shop Pro, a redelivery changes nothing, CANCELLED makes it Free; another plan is ignored", async () => {
  const refused = await update("Won Discounts Pro", "ACTIVE", "w1", "wrong-secret").catch((r: unknown) => r as Response);
  assert.equal(refused.status, 401);
  assert.equal(await row(), null);

  assert.equal((await update("Won Discounts Pro", "ACTIVE", "w2")).status, 200);
  assert.deepEqual({ plan: (await row())?.plan, status: (await row())?.status }, { plan: "pro", status: "ACTIVE" });
  const checkedAt = (await row())!.checkedAt;
  assert.equal((await update("Something else", "CANCELLED", "w3")).status, 200);
  assert.equal((await row())?.plan, "pro", "another plan's update is not ours");
  assert.equal((await update("Won Discounts Pro", "CANCELLED", "w4")).status, 200);
  assert.deepEqual({ plan: (await row())?.plan, status: (await row())?.status }, { plan: "free", status: "CANCELLED" });
  assert.ok((await row())!.checkedAt.getTime() >= checkedAt.getTime());
});

test("the plan resolver reads the shop's row only through the database it was given; the dev override still wins; production ignores the override", async () => {
  const { resolvePlan, setPlanDatabase } = await import("../app/lib/plan.server.ts");
  await db.prisma.shopEntitlement.upsert({ where: { shop: SHOP }, create: { shop: SHOP, plan: "pro", status: "ACTIVE", checkedAt: new Date() }, update: { plan: "pro", status: "ACTIVE", checkedAt: new Date() } });
  const prod = { NODE_ENV: "production" };
  assert.deepEqual(await resolvePlan(SHOP, prod, null), { plan: "free", pro: false }, "no database: nothing to verify");
  assert.deepEqual(await resolvePlan(SHOP, prod, db.prisma), { plan: "pro", pro: true });
  assert.deepEqual(await resolvePlan("other.myshopify.com", prod, db.prisma), { plan: "free", pro: false }, "SEC-2");
  assert.deepEqual(await resolvePlan(undefined, prod, db.prisma), { plan: "free", pro: false });
  setPlanDatabase(db.prisma);
  try {
    assert.deepEqual(await resolvePlan(SHOP, prod), { plan: "pro", pro: true }, "the database handed in on boot");
  } finally {
    setPlanDatabase(null);
  }
  await db.prisma.shopEntitlement.update({ where: { shop: SHOP }, data: { plan: "free", status: "CANCELLED" } });
  assert.deepEqual(await resolvePlan(SHOP, prod, db.prisma), { plan: "free", pro: false });
  assert.deepEqual(await resolvePlan(SHOP, { NODE_ENV: "development", WON_DEV_PLAN: "pro" }, db.prisma), { plan: "pro", pro: true });
  assert.deepEqual(await resolvePlan(SHOP, { NODE_ENV: "production", WON_DEV_PLAN: "pro" }, db.prisma), { plan: "free", pro: false });
});

test("orders/create also keeps one order fact (once), orders/cancelled takes it out; nothing of the customer is stored", async () => {
  const ORDER = {
    id: 7001,
    created_at: "2026-10-04T08:00:00Z",
    currency: "CZK",
    subtotal_price: "900.00",
    email: "zakaznik@example.com",
    customer: { first_name: "Jana", last_name: "Nováková" },
    discount_applications: [{ type: "automatic", title: "Od 3 ks −10 %" }],
    line_items: [{ id: 1, variant_id: 11, quantity: 3, discount_allocations: [{ amount: "100.00", discount_application_index: 0 }] }],
  };
  const call = (topic: string, body: object, id: string) => orders({ request: signed("/webhooks/outlet", topic, body, id), params: {}, context: {} });
  assert.equal((await call("orders/create", ORDER, "o1")).status, 200);
  assert.equal((await call("orders/create", ORDER, "o2")).status, 200);
  const facts = await db.prisma.orderDiscountFact.findMany({ where: { shop: SHOP } });
  assert.equal(facts.length, 1);
  assert.deepEqual({ orderId: facts[0]!.orderId, discountMinor: facts[0]!.discountMinor, parts: JSON.parse(facts[0]!.parts) }, { orderId: "7001", discountMinor: 10000, parts: [{ key: "tiers", kind: "tier", amountMinor: 10000 }] });
  assert.doesNotMatch(JSON.stringify(facts), /zakaznik|Jana|Nováková/);
  assert.equal((await call("orders/cancelled", { id: 7001 }, "o3")).status, 200);
  assert.ok((await db.prisma.orderDiscountFact.findFirst({ where: { shop: SHOP } }))?.cancelledAt);
});

test("shop/redact erases the plan row and the order facts of that shop only", async () => {
  const { deleteShopData } = await import("../app/lib/config.server.ts");
  const other = "keep.myshopify.com";
  await db.prisma.shopEntitlement.create({ data: { shop: other, plan: "pro", status: "ACTIVE", checkedAt: new Date() } });
  await db.prisma.orderDiscountFact.create({ data: { shop: other, orderId: "1", createdAt: new Date(), currency: "CZK", subtotalMinor: 1, discountMinor: 0 } });
  await deleteShopData(db.prisma, SHOP);
  assert.equal(await db.prisma.shopEntitlement.count({ where: { shop: SHOP } }), 0);
  assert.equal(await db.prisma.orderDiscountFact.count({ where: { shop: SHOP } }), 0);
  assert.equal(await db.prisma.shopEntitlement.count({ where: { shop: other } }), 1);
  assert.equal(await db.prisma.orderDiscountFact.count({ where: { shop: other } }), 1);
});
