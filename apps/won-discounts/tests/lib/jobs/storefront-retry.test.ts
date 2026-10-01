import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";

import { gateConfigForPlan } from "@won/core/discounts/plan-gate";

import type { PrismaClient } from "../../../app/generated/prisma/client.ts";
import type { AdminClient } from "../../../app/lib/admin-client.server.ts";
import { loadConfig } from "../../../app/lib/config.server.ts";
import { withConfigLock } from "../../../app/lib/integration/lock.server.ts";
import { runCostReconcileOnce } from "../../../app/lib/jobs/cost-reconcile.server.ts";
import { costIdle } from "../../../app/lib/sync/cost-lane.server.ts";
import { loadCostState, pdpMarginKey } from "../../../app/lib/sync/costs.ts";
import { saveAndSync } from "../../../app/lib/sync/save-and-sync.server.ts";
import { createSync, syncIdle } from "../../../app/lib/sync/sync.server.ts";
import { productionSyncDeps } from "../../../app/lib/sync/wiring.server.ts";
import { FakeShopify } from "../sync/fake-shopify.ts";
import { createTestDatabase, type TestDatabase } from "../test-db.ts";

// MVP 3 audit P2-4: a storefront config whose write failed (and a pdp pass cut
// short) is retried WITHOUT an admin visit — by the hourly cost reconcile, with
// the shop's offline session (none → skipped quietly), under the config lock,
// throttled like the Přehled's retry (resyncIfPending's minimum interval).

let db: TestDatabase;
let seq = 0;
let shop: string;
before(() => {
  db = createTestDatabase("jobs-storefront-retry");
});
after(async () => {
  await db.drop();
});
beforeEach(() => {
  seq += 1;
  shop = `sf-retry-${seq}.myshopify.com`;
});

const quiet = { info() {}, warn() {}, error() {} };
const syncFor = (client: AdminClient, prisma: PrismaClient) =>
  createSync({ ...productionSyncDeps(client, prisma, quiet), sleep: async () => {}, plan: async () => "pro" });

const input = { modules: { codes: { rules: [] }, tiers: { sets: [{ id: "g", scope: "global", countAcross: "product", breaks: [{ minQty: 2, percent: 10 }] }] } } };

/** A shop whose last applying sync could not write the storefront config. */
async function failedStorefront(fake: FakeShopify) {
  fake.fail("WonSyncStorefrontConfigSet", { userErrors: [{ message: "Internal error" }] }, 1);
  const result = await saveAndSync({ client: fake, db: db.prisma, shop, input, createSync: syncFor, logger: quiet });
  await syncIdle(shop);
  assert.equal(result.sync?.ok, false);
  assert.equal(fake.storefrontConfig(), undefined);
}

const later = () => new Date(Date.now() + 10 * 60_000);

test("the hourly reconcile retries a failed storefront config without an admin visit (offline session)", async () => {
  const fake = new FakeShopify();
  await failedStorefront(fake);
  const result = await runCostReconcileOnce({ db: db.prisma, clientFor: async (s: string) => (s === shop ? fake : null), createSync: syncFor, now: later, logger: quiet });
  await syncIdle(shop);
  assert.deepEqual(
    result.storefront.filter((r) => r.shop === shop),
    [{ shop, outcome: "retry" }],
  );
  assert.ok(fake.storefrontConfig(), "written now");
});

test("throttled like the Přehled: within the retry interval nothing is resynced", async () => {
  const fake = new FakeShopify();
  await failedStorefront(fake);
  const calls = fake.calls.length;
  const result = await runCostReconcileOnce({ db: db.prisma, clientFor: async (s: string) => (s === shop ? fake : null), createSync: syncFor, logger: quiet });
  assert.deepEqual(result.storefront.filter((r) => r.shop === shop), [{ shop, outcome: "too_soon" }]);
  assert.equal(fake.calls.length, calls, "no Shopify call");
});

test("no offline session: skipped quietly (the next admin visit retries)", async () => {
  const fake = new FakeShopify();
  await failedStorefront(fake);
  const result = await runCostReconcileOnce({ db: db.prisma, clientFor: async () => null, createSync: syncFor, now: later, logger: quiet });
  assert.equal(result.storefront.filter((r) => r.shop === shop).length, 0);
  assert.ok(result.storefrontSkippedNoSession >= 1);
});

test("an admin write holding the config lock is never raced: the retry waits for the next run", async () => {
  const fake = new FakeShopify();
  await failedStorefront(fake);
  const result = await withConfigLock(shop, () => runCostReconcileOnce({ db: db.prisma, clientFor: async (s: string) => (s === shop ? fake : null), createSync: syncFor, now: later, logger: quiet }));
  assert.deepEqual(result.storefront.filter((r) => r.shop === shop), [{ shop, outcome: "locked" }]);
  assert.equal(fake.storefrontConfig(), undefined);
});

test("a pdp pass cut short is resumed by the reconcile under the same margin (no admin visit)", async () => {
  const fake = new FakeShopify();
  fake.pageSize = 1;
  for (let i = 1; i <= 3; i += 1) fake.setCost(fake.addProduct(i).variantIds[0]!, "6.00");
  const margin = { modules: { codes: { rules: [] }, margin: { enabled: true, global: { minMarginPercent: 25, maxDiscountPercent: 30 }, perCollection: [] } } };
  await saveAndSync({ client: fake, db: db.prisma, shop, input: margin, createSync: syncFor, logger: quiet });
  await syncIdle(shop);
  await costIdle(shop);
  // As if the process stopped mid-pass: a cursor after the first page, under the current margin.
  const key = pdpMarginKey(gateConfigForPlan((await loadConfig(db.prisma, shop)).config, "pro").config.modules.margin);
  const since = new Date().toISOString();
  await db.prisma.shopSyncState.update({
    where: { shop },
    data: { costsCursor: "1", costsPending: JSON.stringify({ token: "t-cut", since, done: 1, total: 3, margin: key }) },
  });
  fake.calls = [];
  const result = await runCostReconcileOnce({ db: db.prisma, clientFor: async (s: string) => (s === shop ? fake : null), createSync: syncFor, plan: async () => "pro", logger: quiet });
  assert.ok(result.started.some((s) => s.shop === shop && s.kind === "full"), JSON.stringify(result.started));
  await costIdle(shop);
  assert.equal(fake.callsOf("WonSyncCostVariantsCount").length, 0, "resumed (a fresh pass counts the variants first)");
  const state = await loadCostState(db.prisma, shop);
  assert.equal(state.cursor, null);
  assert.ok(state.scannedAt, "finished");
});
