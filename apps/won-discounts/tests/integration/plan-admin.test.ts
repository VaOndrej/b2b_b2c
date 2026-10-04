import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";

import type { AdminClient } from "../../app/lib/admin-client.server.ts";
import { PRO_PLAN, storedPlan } from "../../app/lib/billing.server.ts";
import type { ShopCtx } from "../../app/lib/integration/context.server.ts";
import { loadPlanScreen, PLAN_INTENT, planAction } from "../../app/lib/integration/plan-admin.server.ts";
import { loadShopSyncFacts } from "../../app/lib/sync/sync-state.server.ts";
import { createSync } from "../../app/lib/sync/sync.server.ts";
import { productionSyncDeps } from "../../app/lib/sync/wiring.server.ts";
import { FakeShopify } from "../lib/sync/fake-shopify.ts";
import { createTestDatabase, type TestDatabase } from "../lib/test-db.ts";
import { APP_KEY, formOf, quiet } from "./helpers.ts";

// MVP 7 contracts M1–M3: Tarif. Every load reconciles the plan with Shopify; subscribing returns Shopify's
// confirmation page; a cancel makes the shop Free at once AND resyncs (checkout stops running Pro data, running
// campaigns finish — A6); "Připravit na odinstalaci" reports what it did.

let db: TestDatabase;
let seq = 0;
let shop: string;
before(() => {
  db = createTestDatabase("plan-admin");
});
after(async () => {
  await db.drop();
});
beforeEach(() => {
  seq += 1;
  shop = `plan-admin-${seq}.myshopify.com`;
});

const NOW = new Date("2026-10-04T10:00:00Z");
const ENV = { NODE_ENV: "test" };
type Sub = { id: string; name: string; status: string; trialDays: number; createdAt: string; test: boolean };
const PRO_SUB: Sub = { id: "gid://shopify/AppSubscription/1", name: PRO_PLAN.name, status: "ACTIVE", trialDays: 14, createdAt: "2026-10-01T00:00:00Z", test: true };

/** FakeShopify + the billing operations (the fake knows nothing about subscriptions). */
function setup(subs: Sub[]) {
  const fake = new FakeShopify();
  const state = { subs, creates: [] as Record<string, unknown>[] };
  const client: AdminClient = {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async graphql(query: string, variables?: Record<string, unknown>): Promise<any> {
      if (query.includes("WonBillingActiveSubscriptions")) return { data: { currentAppInstallation: { activeSubscriptions: state.subs } } };
      if (query.includes("appSubscriptionCreate")) {
        state.creates.push(variables ?? {});
        return { data: { appSubscriptionCreate: { confirmationUrl: "https://admin.shopify.com/confirm/1", userErrors: [] } } };
      }
      if (query.includes("appSubscriptionCancel")) {
        state.subs = state.subs.filter((s) => s.id !== variables?.id);
        return { data: { appSubscriptionCancel: { userErrors: [] } } };
      }
      return fake.graphql(query, variables);
    },
  };
  const ctx: ShopCtx = {
    shop,
    db: db.prisma,
    client,
    locale: "cs",
    apiKey: APP_KEY,
    logger: quiet,
    now: () => NOW,
    // The sync gates for the STORED plan, as production does (plan.server.ts → billing.server.ts storedPlan).
    createSync: (c, prisma) => createSync({ ...productionSyncDeps(c, prisma, quiet), sleep: async () => {}, now: () => NOW, plan: (s) => storedPlan(prisma, s, NOW) }),
  };
  return { ctx, state, fake };
}

const BF = { id: "bf", name: "Black Friday", window: { start: "2026-10-01T00:00:00", end: "2026-10-30T00:00:00" }, overrides: [{ ruleId: "a", patch: { value: { kind: "percentage", percent: 30 } } }], killed: false };
async function seedConfig(ctx: ShopCtx) {
  const { saveAndSync } = await import("../../app/lib/sync/save-and-sync.server.ts");
  const saved = await saveAndSync({
    client: ctx.client,
    db: ctx.db,
    shop,
    createSync: ctx.createSync,
    now: () => NOW,
    input: { modules: { codes: { rules: [{ id: "a", name: "Podzim", method: "automatic", value: { kind: "percentage", percent: 10 }, target: { kind: "order" } }] } }, campaigns: [BF] },
  });
  assert.ok(saved.save.ok, JSON.stringify(saved.save));
}

test("load: no subscription = Free with the offer; an active subscription = Pro on trial with its end; the row is written", async () => {
  const free = setup([]);
  const screen = await loadPlanScreen(free.ctx, { env: ENV });
  assert.deepEqual(
    { plan: screen.plan, subscribed: screen.subscribed, dev: screen.devOverride, known: screen.billingKnown, trial: screen.trialEndsText, price: screen.price },
    { plan: "free", subscribed: false, dev: false, known: true, trial: null, price: { amount: "29", currency: "USD", trialDays: 14 } },
  );
  shop = `${shop}.pro`;
  const pro = setup([PRO_SUB]);
  const proScreen = await loadPlanScreen(pro.ctx, { env: ENV });
  assert.equal(proScreen.plan, "pro");
  assert.equal(proScreen.subscribed, true);
  assert.match(proScreen.trialEndsText ?? "", /15\. 10\. 2026/);
  assert.equal(await storedPlan(db.prisma, shop, NOW), "pro");
});

test("subscribe: returns Shopify's confirmation page for a test charge with the return URL into Tarif; nothing is Pro before the merchant accepts", async () => {
  const { ctx, state } = setup([]);
  const result = await planAction(ctx, formOf([["intent", PLAN_INTENT.subscribe]]), { env: ENV });
  assert.deepEqual(result, { ok: true, kind: "subscribe", confirmationUrl: "https://admin.shopify.com/confirm/1" });
  // The return lands in the embedded admin (the app's own URL has no session outside it: live finding 2026-10-04).
  const returnUrl = `https://admin.shopify.com/store/${shop.replace(".myshopify.com", "")}/apps/${ctx.apiKey}/app/plan?billing=return`;
  assert.ok(ctx.apiKey, "the fixture has a client id");
  assert.deepEqual(state.creates, [{ name: "Won Discounts Pro", returnUrl, test: true, trialDays: 14, amount: "29.00", currency: "USD" }]);
  assert.equal(await storedPlan(db.prisma, shop, NOW), "free");
  assert.deepEqual(await planAction({ ...ctx, apiKey: "" }, formOf([["intent", PLAN_INTENT.subscribe]]), { env: ENV }), { ok: false, kind: "subscribe", detail: "the app's client id is not configured" });
  assert.equal(state.creates.length, 1);
});

test("the plan follows Shopify: accepted → Pro and the live config is built for Pro; cancel → Free at once, resynced, the running campaign finishes (A6)", async () => {
  const { ctx, state, fake } = setup([]);
  await seedConfig(ctx);
  assert.equal((await loadShopSyncFacts(db.prisma, shop)).appliedPlan, "free");
  const live = () => JSON.parse(fake.shopMetafieldValue("function_config")!) as { campaignId: string | null };
  assert.equal(live().campaignId, null, "Free: the campaign is gated out");

  state.subs = [PRO_SUB]; // the merchant accepted on Shopify's page and came back
  const screen = await loadPlanScreen(ctx, { env: ENV });
  assert.equal(screen.plan, "pro");
  assert.deepEqual(screen.finishing, { campaigns: ["Black Friday"], outlets: 0 });
  assert.equal((await loadShopSyncFacts(db.prisma, shop)).appliedPlan, "pro", "the load resynced for the new plan");
  assert.equal(live().campaignId, "bf");

  const cancelled = await planAction(ctx, formOf([["intent", PLAN_INTENT.cancel]]), { env: ENV });
  assert.deepEqual(cancelled, { ok: true, kind: "cancel", synced: true });
  assert.equal(await storedPlan(db.prisma, shop, NOW), "free");
  assert.equal((await loadShopSyncFacts(db.prisma, shop)).appliedPlan, "free");
  assert.equal(live().campaignId, "bf", "A6: the campaign that was running at the downgrade finishes");
  assert.deepEqual((await loadShopSyncFacts(db.prisma, shop)).campaignsFinishing, ["bf"]);
});

test("uninstall prep through the action: nothing to do is a clean result; an unknown intent is refused", async () => {
  const { ctx } = setup([]);
  assert.deepEqual(await planAction(ctx, formOf([["intent", PLAN_INTENT.uninstallPrep]]), { env: ENV }), { ok: true, kind: "uninstall_prep", ended: 0, restored: 0, failed: [] });
  assert.deepEqual(await planAction(ctx, formOf([["intent", "nope"]]), { env: ENV }), { ok: false, kind: "unknown", detail: "bad request" });
});
