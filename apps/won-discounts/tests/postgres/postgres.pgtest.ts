// Run by scripts/test-postgres.mjs (NOT by the unit gate: the file name is not *.test.ts) against a throwaway
// schema of the local Postgres, with a Prisma client generated for Postgres (WON_PG_CLIENT). What the SQLite unit
// tests cannot show: the app's own code on the production database.
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { pathToFileURL } from "node:url";

import type { PrismaClient } from "../../app/generated/prisma/client.ts";
import { loadAnalytics, recordOrderFact } from "../../app/lib/analytics/analytics.server.ts";
import { reconcilePlan, storedPlan } from "../../app/lib/billing.server.ts";
import { loadConfig, saveConfig } from "../../app/lib/config.server.ts";

const { PrismaClient: PgClient } = (await import(pathToFileURL(process.env.WON_PG_CLIENT!).href)) as { PrismaClient: new () => PrismaClient };
const clients = Array.from({ length: 4 }, () => new PgClient());
const db = clients[0]!;
after(async () => {
  await Promise.all(clients.map((c) => c.$disconnect()));
});

test("the baseline migration created every table of the schema", async () => {
  const rows = await db.$queryRaw<{ table_name: string }[]>`SELECT table_name FROM information_schema.tables WHERE table_schema = current_schema()`;
  const names = rows.map((r) => r.table_name);
  for (const table of ["Session", "ShopConfig", "ConfigVersion", "WonNode", "NativeDiscountBackup", "SyncRun", "ShopSyncState", "ProductTargetIndex", "VariantCost", "OutletRun", "OutletEvent", "JobState", "ShopEntitlement", "OrderDiscountFact"]) {
    assert.ok(names.includes(table), `${table} missing: ${names.join(", ")}`);
  }
});

test("claim guard: the partial unique index lets one live claim per native discount through, any number of finished ones", async () => {
  const row = (status: string) => db.nativeDiscountBackup.create({ data: { shop: "pg.myshopify.com", nativeId: "gid://shopify/DiscountCodeNode/1", kind: "code_basic", title: "X", snapshot: "{}", status } });
  await row("moved");
  await row("restored");
  await row("moving");
  await assert.rejects(row("undoing"), (error: { code?: string }) => error.code === "P2002");
  await assert.rejects(row("moving"), (error: { code?: string }) => error.code === "P2002");
});

test("concurrent first saves of a new shop from four connections all succeed; one config row, every save in the history", async () => {
  for (let round = 0; round < 5; round += 1) {
    const shop = `pg-concurrent-${round}.myshopify.com`;
    const results = await Promise.all(clients.map((client, i) => saveConfig(client, shop, { locales: { cs: { marker: `instance-${i}` } } })));
    assert.deepEqual(results.map((r) => r.ok), clients.map(() => true), JSON.stringify(results.map((r) => (r.ok ? "ok" : r.reason))));
    assert.equal(await db.shopConfig.count({ where: { shop } }), 1);
    assert.equal(await db.configVersion.count({ where: { shop } }), clients.length);
    assert.match((await loadConfig(db, shop)).config.locales.cs!.marker!, /^instance-\d$/);
  }
});

test("billing and analytics rows behave as on SQLite: a reconcile upserts, an order is recorded once, sums add up", async () => {
  const shop = "pg-billing.myshopify.com";
  const admin = { graphql: async () => ({ data: { currentAppInstallation: { activeSubscriptions: [{ id: "gid://shopify/AppSubscription/1", name: "Won Discounts Pro", status: "ACTIVE", trialDays: 14, createdAt: "2026-10-01T00:00:00Z", test: true }] } } }) };
  const now = new Date("2026-10-04T10:00:00Z");
  assert.equal((await reconcilePlan(db, admin as never, shop, now)).plan, "pro");
  assert.equal(await storedPlan(db, shop, now), "pro");
  const { config } = await loadConfig(db, shop);
  const order = { id: 1, created_at: "2026-10-03T09:00:00Z", currency: "CZK", subtotal_price: "900.00", discount_applications: [{ type: "automatic", title: "X" }], line_items: [{ quantity: 1, discount_allocations: [{ amount: "100.00", discount_application_index: 0 }] }] };
  assert.deepEqual(await recordOrderFact(db, shop, order, config), { recorded: true });
  assert.deepEqual(await Promise.all([recordOrderFact(db, shop, { ...order, id: 2 }, config), recordOrderFact(db, shop, { ...order, id: 2 }, config)]).then((r) => r.filter((x) => x?.recorded).length), 1, "two deliveries at once: one row");
  const a = await loadAnalytics(db, shop, { now });
  assert.deepEqual({ orders: a.orders, cost: a.discountCost, revenue: a.revenue }, { orders: 2, cost: 20000, revenue: 180000 });
});

test("the raw queries the app runs are valid Postgres (quoted identifiers, DISTINCT count)", async () => {
  const rows = await db.$queryRaw<{ n: number | bigint }[]>`SELECT COUNT(DISTINCT "productId") AS n FROM "VariantCost" WHERE "shop" = ${"pg.myshopify.com"}`;
  assert.equal(Number(rows[0]!.n), 0);
});
