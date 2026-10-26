import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import type { AdminClient } from "../../app/lib/admin-client.server.ts";
import { confirmSubscriptionUpdate, ENTITLEMENT_STALE_MS, PRO_PLAN, recordSubscriptionUpdate, storedPlan } from "../../app/lib/billing.server.ts";
import { appTasks, BILLING_RECONCILE_BATCH, runBillingReconcileOnce, runDueTasks } from "../../app/lib/jobs/scheduler.server.ts";
import { createTestDatabase, type TestDatabase } from "./test-db.ts";

// Audit 2026-10-26 — billing robustness (the plan in force must follow Shopify, BILL-1, also when webhooks arrive
// late or out of order — Shopify does not guarantee delivery order and retries a failed delivery for up to 48 h —
// and also when many shops pay). Found as `todo` tests, fixed and guarded since (BILL-01, BILL-02).

const H = 3_600_000;
const T0 = new Date("2026-10-26T08:00:00Z");
const SUB_A = "gid://shopify/AppSubscription/100";
const SUB_B = "gid://shopify/AppSubscription/200";

const update = (id: string, status: string, updatedAt: string) => ({
  app_subscription: { admin_graphql_api_id: id, name: PRO_PLAN.name, status, created_at: updatedAt, updated_at: updatedAt },
});

/** An Admin client whose currentAppInstallation lists `subs(shop)`. */
const clientWith = (subs: { id: string; status: string }[]): AdminClient => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  graphql: async (): Promise<any> => ({ data: { currentAppInstallation: { activeSubscriptions: subs.map((s) => ({ ...s, name: PRO_PLAN.name })) } } }),
});

let db: TestDatabase;
before(() => {
  db = createTestDatabase("billing-audit");
});
after(async () => {
  await db.drop();
});

test("control: in-order deliveries — cancel A, then a new subscription B — end on Pro", async () => {
  const shop = "in-order.myshopify.com";
  await recordSubscriptionUpdate(db.prisma, shop, update(SUB_A, "ACTIVE", "2026-10-20T10:00:00Z"), T0);
  await recordSubscriptionUpdate(db.prisma, shop, update(SUB_A, "CANCELLED", "2026-10-26T07:00:00Z"), T0);
  await recordSubscriptionUpdate(db.prisma, shop, update(SUB_B, "ACTIVE", "2026-10-26T07:05:00Z"), T0);
  assert.equal(await storedPlan(db.prisma, shop, T0), "pro");
});

test("BILL-01: a late CANCELLED of the OLD subscription after the new one's ACTIVE keeps the paying shop on Pro", async () => {
  const shop = "late-cancel.myshopify.com";
  await recordSubscriptionUpdate(db.prisma, shop, update(SUB_B, "ACTIVE", "2026-10-26T07:05:00Z"), T0);
  // A's CANCELLED (07:00) failed once and is retried after B's ACTIVE (07:05).
  await recordSubscriptionUpdate(db.prisma, shop, update(SUB_A, "CANCELLED", "2026-10-26T07:00:00Z"), new Date(T0.getTime() + H));
  assert.equal(await storedPlan(db.prisma, shop, new Date(T0.getTime() + H)), "pro", "the shop pays for B");
});

test("BILL-01: a retried ACTIVE delivered after the same subscription's CANCELLED does not turn Pro back on", async () => {
  const shop = "late-active.myshopify.com";
  await recordSubscriptionUpdate(db.prisma, shop, update(SUB_A, "CANCELLED", "2026-10-26T07:00:00Z"), T0);
  await recordSubscriptionUpdate(db.prisma, shop, update(SUB_A, "ACTIVE", "2026-10-20T10:00:00Z"), new Date(T0.getTime() + H));
  assert.equal(await storedPlan(db.prisma, shop, new Date(T0.getTime() + H)), "free", "nobody pays any more");
});

test("BILL-01: the webhook's follow-up asks Shopify — an event the guard let through (no updated_at) is undone at once, with one resync", async () => {
  const shop = "confirmed.myshopify.com";
  const outcome = await recordSubscriptionUpdate(db.prisma, shop, { app_subscription: { admin_graphql_api_id: SUB_A, name: PRO_PLAN.name, status: "ACTIVE" } }, T0);
  assert.equal(outcome?.changed, true, "the event alone made the shop Pro");
  let resyncs = 0;
  await confirmSubscriptionUpdate(db.prisma, clientWith([]), shop, outcome.changed, async () => void (resyncs += 1), T0);
  assert.equal(await storedPlan(db.prisma, shop, T0), "free", "Shopify lists no active subscription");
  assert.equal(resyncs, 1);
});

test("BILL-01: a confirmed event resyncs once; an unchanged, confirmed one does not resync", async () => {
  const shop = "confirmed-pro.myshopify.com";
  const first = await recordSubscriptionUpdate(db.prisma, shop, update(SUB_A, "ACTIVE", "2026-10-26T07:00:00Z"), T0);
  let resyncs = 0;
  const resync = async () => void (resyncs += 1);
  await confirmSubscriptionUpdate(db.prisma, clientWith([{ id: SUB_A, status: "ACTIVE" }]), shop, first?.changed === true, resync, T0);
  const again = await recordSubscriptionUpdate(db.prisma, shop, update(SUB_A, "ACTIVE", "2026-10-26T07:00:00Z"), T0);
  await confirmSubscriptionUpdate(db.prisma, clientWith([{ id: SUB_A, status: "ACTIVE" }]), shop, again?.changed === true, resync, T0);
  assert.equal(await storedPlan(db.prisma, shop, T0), "pro");
  assert.equal(resyncs, 1, "the redelivery changed nothing");
});

test("BILL-01: the daily reconcile also repairs a paying shop whose row wrongly says Free", async () => {
  const shop = "wrongly-free.myshopify.com";
  await db.prisma.shopEntitlement.create({ data: { shop, plan: "free", status: "CANCELLED", subscriptionId: SUB_A, checkedAt: T0 } });
  const now = new Date(T0.getTime() + 24 * H);
  await runBillingReconcileOnce({ db: db.prisma, now: () => now, clientFor: async () => clientWith([{ id: SUB_B, status: "ACTIVE" }]), resync: async () => undefined });
  assert.equal(await storedPlan(db.prisma, shop, now), "pro", "Shopify says B is ACTIVE");
});

test(`BILL-02: with more than 3 × ${BILLING_RECONCILE_BATCH} paying shops, none of them reads Free between reconciles, and Shopify is asked about once a day per shop`, async () => {
  const shops = Array.from({ length: 4 * BILLING_RECONCILE_BATCH }, (_, i) => `paying-${i}.myshopify.com`);
  await db.prisma.shopEntitlement.createMany({ data: shops.map((shop) => ({ shop, plan: "pro", status: "ACTIVE", subscriptionId: SUB_A, checkedAt: T0 })) });
  let calls = 0;
  const client = clientWith([{ id: SUB_A, status: "ACTIVE" }]);
  const counting: AdminClient = { graphql: async (...args) => ((calls += 1), client.graphql(...args)) };
  // The real task as the scheduler runs it: a tick every hour, the task decides itself whether it is due.
  const tasks = appTasks({ db: db.prisma, clientFor: async () => counting }).filter((task) => task.name === "billing.reconcile");
  let freeSeen = 0;
  const days = 5;
  for (let hour = 1; hour <= days * 24; hour += 1) {
    const now = new Date(T0.getTime() + hour * H);
    await runDueTasks(db.prisma, tasks, now);
    if (hour === Math.ceil(ENTITLEMENT_STALE_MS / H) + 1 || hour === days * 24) {
      for (const shop of shops) if ((await storedPlan(db.prisma, shop, now)) === "free") freeSeen += 1;
    }
  }
  assert.equal(freeSeen, 0, "every shop keeps paying and Shopify says ACTIVE every time it is asked");
  // The other tests' rows with a subscription are checked too (a handful); without a minimum age the hourly task
  // would ask 50 shops every hour (6 000 calls).
  assert.ok(calls <= (shops.length + 10) * (days + 1), `${calls} Shopify reads in ${days} days`);
});
