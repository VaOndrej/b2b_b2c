import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";

import type { AdminClient } from "../../app/lib/admin-client.server.ts";
import {
  ENTITLEMENT_STALE_MS,
  PRO_PLAN,
  cancelProSubscription,
  planFromSubscriptionUpdate,
  reconcilePlan,
  recordSubscriptionUpdate,
  requestProSubscription,
  storedPlan,
} from "../../app/lib/billing.server.ts";
import { createTestDatabase, type TestDatabase } from "./test-db.ts";

// MVP 7 contract M1 (plan docs/plans/2026-10-04-won-discounts-mvp7.md): Pro is $29 a month with a 14-day trial,
// bought through Shopify Billing (appSubscriptionCreate). The plan in force is what Shopify says about the shop's
// active subscriptions, kept in ShopEntitlement; Pro only for an ACTIVE subscription of OUR plan checked recently —
// anything else (no row, another status, a stale check, a failed read with no earlier Pro) is Free (BILL-1).

let db: TestDatabase;
let seq = 0;
let shop: string;
before(() => {
  db = createTestDatabase("billing");
});
after(async () => {
  await db.drop();
});
beforeEach(() => {
  seq += 1;
  shop = `billing-${seq}.myshopify.com`;
});

const NOW = new Date("2026-10-04T10:00:00Z");

type Sub = { id: string; name: string; status: string; trialDays?: number; createdAt?: string; test?: boolean };

/** A fake Admin client answering the billing operations; `calls` keeps every request. */
function fakeAdmin(state: { subs?: Sub[]; fail?: boolean; createErrors?: string[]; cancelErrors?: string[] }) {
  const calls: { query: string; variables?: Record<string, unknown> }[] = [];
  const client: AdminClient = {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async graphql(query: string, variables?: Record<string, unknown>): Promise<any> {
      calls.push({ query, ...(variables ? { variables } : {}) });
      if (state.fail) throw new Error("network down");
      if (query.includes("appSubscriptionCreate")) {
        const errors = state.createErrors ?? [];
        return { data: { appSubscriptionCreate: { confirmationUrl: errors.length ? null : "https://admin.shopify.com/charges/confirm/1", userErrors: errors.map((message) => ({ message })) } } };
      }
      if (query.includes("appSubscriptionCancel")) {
        const errors = state.cancelErrors ?? [];
        if (!errors.length) state.subs = (state.subs ?? []).filter((s) => s.id !== variables?.id);
        return { data: { appSubscriptionCancel: { userErrors: errors.map((message) => ({ message })) } } };
      }
      return { data: { currentAppInstallation: { activeSubscriptions: state.subs ?? [] } } };
    },
  };
  return { client, calls };
}

const PRO_SUB: Sub = { id: "gid://shopify/AppSubscription/1", name: PRO_PLAN.name, status: "ACTIVE", trialDays: 14, createdAt: "2026-10-01T00:00:00Z", test: true };

test("the plan on offer: $29 a month in USD with a 14-day trial (A9)", () => {
  assert.deepEqual(PRO_PLAN, { name: "Won Discounts Pro", amount: "29.00", currency: "USD", interval: "EVERY_30_DAYS", trialDays: 14 });
});

test("no row = Free; an ACTIVE subscription of our plan reconciles to Pro with its trial end; the change is reported once", async () => {
  assert.equal(await storedPlan(db.prisma, shop, NOW), "free");
  const { client } = fakeAdmin({ subs: [PRO_SUB] });
  const first = await reconcilePlan(db.prisma, client, shop, NOW);
  assert.deepEqual(first, { plan: "pro", changed: true, known: true });
  assert.equal(await storedPlan(db.prisma, shop, NOW), "pro");
  const row = await db.prisma.shopEntitlement.findUnique({ where: { shop } });
  assert.equal(row?.subscriptionId, PRO_SUB.id);
  assert.equal(row?.status, "ACTIVE");
  assert.equal(row?.trialEndsAt?.toISOString(), "2026-10-15T00:00:00.000Z", "created + 14 days");
  assert.deepEqual(await reconcilePlan(db.prisma, client, shop, NOW), { plan: "pro", changed: false, known: true });
});

test("another app plan's name, a status that is not ACTIVE, or no subscription = Free", async () => {
  for (const subs of [[], [{ ...PRO_SUB, name: "Something else" }], [{ ...PRO_SUB, status: "FROZEN" }], [{ ...PRO_SUB, status: "CANCELLED" }]]) {
    const { client } = fakeAdmin({ subs });
    assert.equal((await reconcilePlan(db.prisma, client, shop, NOW)).plan, "free", JSON.stringify(subs));
    assert.equal(await storedPlan(db.prisma, shop, NOW), "free");
  }
});

test("a subscription that ends reconciles Pro → Free (changed)", async () => {
  const state = { subs: [PRO_SUB] };
  const { client } = fakeAdmin(state);
  await reconcilePlan(db.prisma, client, shop, NOW);
  state.subs = [];
  assert.deepEqual(await reconcilePlan(db.prisma, client, shop, NOW), { plan: "free", changed: true, known: true });
  assert.equal(await storedPlan(db.prisma, shop, NOW), "free");
});

test("a failed read changes nothing (a paying shop is not thrown to Free by a hiccup) — but Pro expires once the last good check is too old", async () => {
  const state: { subs: Sub[]; fail?: boolean } = { subs: [PRO_SUB] };
  const { client } = fakeAdmin(state);
  await reconcilePlan(db.prisma, client, shop, NOW);
  state.fail = true;
  const later = new Date(NOW.getTime() + 60_000);
  assert.deepEqual(await reconcilePlan(db.prisma, client, shop, later), { plan: "pro", changed: false, known: false });
  assert.equal(await storedPlan(db.prisma, shop, later), "pro");
  const stale = new Date(NOW.getTime() + ENTITLEMENT_STALE_MS + 1);
  assert.equal(await storedPlan(db.prisma, shop, stale), "free", "Free on uncertainty (BILL-1)");
  // A shop that was never Pro stays Free through a failed read.
  const other = `${shop}.other`;
  assert.deepEqual(await reconcilePlan(db.prisma, client, other, NOW), { plan: "free", changed: false, known: false });
});

test("subscribe: appSubscriptionCreate with the plan, the trial, a test charge outside production and the return URL; its confirmation URL comes back", async () => {
  const { client, calls } = fakeAdmin({});
  const r = await requestProSubscription(client, "https://app.example/app/plan?billing=return", { test: true });
  assert.deepEqual(r, { ok: true, confirmationUrl: "https://admin.shopify.com/charges/confirm/1" });
  assert.deepEqual(calls[0]!.variables, {
    name: "Won Discounts Pro",
    returnUrl: "https://app.example/app/plan?billing=return",
    test: true,
    trialDays: 14,
    amount: "29.00",
    currency: "USD",
  });
  assert.match(calls[0]!.query, /appRecurringPricingDetails/);
  assert.match(calls[0]!.query, /EVERY_30_DAYS/);
  const refused = await requestProSubscription(fakeAdmin({ createErrors: ["Shop cannot accept charges"] }).client, "https://x/app/plan", { test: false });
  assert.deepEqual(refused, { ok: false, detail: "Shop cannot accept charges" });
  assert.deepEqual(await requestProSubscription(fakeAdmin({ fail: true }).client, "https://x/app/plan", { test: false }), { ok: false, detail: "network down" });
});

test("cancel: every active subscription of our plan is cancelled, others are left alone; a refusal is reported", async () => {
  const state = { subs: [PRO_SUB, { ...PRO_SUB, id: "gid://shopify/AppSubscription/2", name: "Something else" }] };
  const { client, calls } = fakeAdmin(state);
  assert.deepEqual(await cancelProSubscription(client), { ok: true, cancelled: 1 });
  assert.deepEqual(calls.filter((c) => c.query.includes("appSubscriptionCancel")).map((c) => c.variables?.id), [PRO_SUB.id]);
  assert.deepEqual(state.subs.map((s) => s.name), ["Something else"]);
  assert.deepEqual(await cancelProSubscription(fakeAdmin({ subs: [PRO_SUB], cancelErrors: ["nope"] }).client), { ok: false, detail: "nope" });
  assert.deepEqual(await cancelProSubscription(fakeAdmin({ subs: [] }).client), { ok: true, cancelled: 0 });
});

test("webhook app_subscriptions/update: our plan ACTIVE = Pro, any other status = Free, another plan = ignored", async () => {
  const payload = (name: string, status: string) => ({ app_subscription: { admin_graphql_api_id: PRO_SUB.id, name, status } });
  assert.equal(planFromSubscriptionUpdate(payload(PRO_PLAN.name, "ACTIVE")), "pro");
  for (const status of ["CANCELLED", "EXPIRED", "FROZEN", "DECLINED", "PENDING"]) assert.equal(planFromSubscriptionUpdate(payload(PRO_PLAN.name, status)), "free", status);
  assert.equal(planFromSubscriptionUpdate(payload("Other", "ACTIVE")), null);
  for (const junk of [null, 7, {}, { app_subscription: null }]) assert.equal(planFromSubscriptionUpdate(junk), null);

  assert.deepEqual(await recordSubscriptionUpdate(db.prisma, shop, payload(PRO_PLAN.name, "ACTIVE"), NOW), { plan: "pro", changed: true });
  assert.equal(await storedPlan(db.prisma, shop, NOW), "pro");
  assert.deepEqual(await recordSubscriptionUpdate(db.prisma, shop, payload(PRO_PLAN.name, "ACTIVE"), NOW), { plan: "pro", changed: false }, "a redelivery changes nothing");
  assert.deepEqual(await recordSubscriptionUpdate(db.prisma, shop, payload("Other", "ACTIVE"), NOW), null);
  assert.deepEqual(await recordSubscriptionUpdate(db.prisma, shop, payload(PRO_PLAN.name, "CANCELLED"), NOW), { plan: "free", changed: true });
  assert.equal(await storedPlan(db.prisma, shop, NOW), "free");
});

test("SEC-2: one shop's subscription never makes another shop Pro", async () => {
  await reconcilePlan(db.prisma, fakeAdmin({ subs: [PRO_SUB] }).client, shop, NOW);
  assert.equal(await storedPlan(db.prisma, `other-${shop}`, NOW), "free");
});
