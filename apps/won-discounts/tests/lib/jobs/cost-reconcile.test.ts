import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";

import { saveConfig } from "../../../app/lib/config.server.ts";
import { createCostRefresher } from "../../../app/lib/integration/costs.server.ts";
import { runCostReconcileOnce } from "../../../app/lib/jobs/cost-reconcile.server.ts";
import { costIdle, costsDue } from "../../../app/lib/sync/cost-lane.server.ts";
import { loadCostState } from "../../../app/lib/sync/costs.ts";
import { FakeShopify } from "../sync/fake-shopify.ts";
import { createTestDatabase, type TestDatabase } from "../test-db.ts";

// Freshness of the cost mirror without anyone looking (margin protection,
// MVP 2): the debounced webhook mirror flushes one "items" job per shop with
// the shop's offline session; the daily reconcile starts a full pass for every
// shop whose last complete pass is older than 24 h (or never finished, or
// failed longer ago than the retry interval), and a clear for a shop that
// switched protection off while variants still carry the sync's metafield.

let db: TestDatabase;
let seq = 0;
let shop: string;
before(() => {
  db = createTestDatabase("jobs-cost-reconcile");
});
after(async () => {
  await db.drop();
});
beforeEach(async () => {
  seq += 1;
  shop = `reconcile-${seq}.myshopify.com`;
  await db.prisma.shopConfig.deleteMany({});
});

const NOW = new Date("2026-09-29T10:00:00Z");
const HOUR = 60 * 60_000;

async function saveMargin(s: string, enabled: boolean) {
  const saved = await saveConfig(db.prisma, s, { modules: { margin: { enabled, global: { maxDiscountPercent: 50 }, perCollection: [] } } });
  assert.equal(saved.ok, true);
}

test("costsDue: never scanned / older than 24 h / cut short → full; fresh → nothing; failed → only after the retry interval", async () => {
  assert.equal(await costsDue(db.prisma, shop, true, NOW), "full", "never scanned");
  await db.prisma.shopSyncState.create({ data: { shop, costsScannedAt: new Date(NOW.getTime() - 2 * HOUR) } });
  assert.equal(await costsDue(db.prisma, shop, true, NOW), null, "fresh");
  await db.prisma.shopSyncState.update({ where: { shop }, data: { costsScannedAt: new Date(NOW.getTime() - 25 * HOUR) } });
  assert.equal(await costsDue(db.prisma, shop, true, NOW), "full", "older than a day");
  await db.prisma.shopSyncState.update({ where: { shop }, data: { costsScannedAt: new Date(NOW.getTime() - HOUR), costsCursor: "150" } });
  assert.equal(await costsDue(db.prisma, shop, true, NOW), "full", "a pass was cut short");
  const failed = { token: "t", since: NOW.toISOString(), done: 3, total: 9, failedAt: new Date(NOW.getTime() - 5 * 60_000).toISOString(), error: "x" };
  await db.prisma.shopSyncState.update({ where: { shop }, data: { costsCursor: null, costsPending: JSON.stringify(failed) } });
  assert.equal(await costsDue(db.prisma, shop, true, NOW), null, "failed 5 min ago: not yet");
  assert.equal(await costsDue(db.prisma, shop, true, new Date(NOW.getTime() + 20 * 60_000)), "full", "retried after the interval");
  assert.equal(await costsDue(db.prisma, shop, false, NOW), null, "off, nothing carried");
  await db.prisma.variantCost.create({
    data: { shop, variantId: "gid://shopify/ProductVariant/1", productId: "gid://shopify/Product/1", inventoryItemId: "gid://shopify/InventoryItem/1", price: "1", metafieldValue: '{"cost":1,"cur":"CZK"}' },
  });
  assert.equal(await costsDue(db.prisma, shop, false, NOW), "clear", "off while variants still carry the metafield");
});

test("reconcile: a full pass for an on-shop that is due, a clear for an off-shop still carrying values, nothing for the rest", async () => {
  const fake = new FakeShopify();
  const product = fake.addProduct(1, 1);
  fake.setCost(product.variantIds[0]!, "2.00");
  const due = `${shop}-due`;
  const fresh = `${shop}-fresh`;
  const off = `${shop}-off`;
  const gone = `${shop}-gone`;
  await saveMargin(due, true);
  await saveMargin(fresh, true);
  await saveMargin(off, false);
  await saveMargin(gone, true);
  await db.prisma.shopSyncState.create({ data: { shop: fresh, costsScannedAt: new Date() } });
  await db.prisma.variantCost.create({
    data: { shop: off, variantId: product.variantIds[0]!, productId: product.id, inventoryItemId: "gid://shopify/InventoryItem/101", price: "1", metafieldValue: '{"cost":2,"cur":"CZK"}' },
  });
  const result = await runCostReconcileOnce({
    db: db.prisma,
    clientFor: async (s) => (s === gone ? null : fake),
    plan: async () => "free",
  });
  assert.deepEqual(result.started.sort((a, b) => a.shop.localeCompare(b.shop)), [
    { shop: due, kind: "full" },
    { shop: off, kind: "clear" },
  ]);
  assert.equal(result.skippedNoSession, 1);
  await Promise.all([costIdle(due), costIdle(off)]);
  assert.ok((await loadCostState(db.prisma, due)).scannedAt, "the full pass ran");
  assert.equal(await db.prisma.variantCost.count({ where: { shop: off } }), 0, "cleared");
});

test("reconcile starts at most maxShops jobs per run", async () => {
  const fake = new FakeShopify();
  for (let i = 0; i < 4; i += 1) await saveMargin(`${shop}-${i}`, true);
  const result = await runCostReconcileOnce({ db: db.prisma, clientFor: async () => fake, plan: async () => "free", maxShops: 2 });
  assert.equal(result.started.length, 2);
  await Promise.all(result.started.map((s) => costIdle(s.shop)));
});

test("webhook refresher: queued items and products flush as ONE mirror job with the offline session; no session → dropped", async () => {
  const fake = new FakeShopify();
  const a = fake.addProduct(1, 1);
  const b = fake.addProduct(2, 2);
  fake.setCost(a.variantIds[0]!, "4.00");
  fake.setCost(b.variantIds[1]!, "7.00");
  await saveMargin(shop, true);
  let sessions = 0;
  const refresher = createCostRefresher({
    db: db.prisma,
    delayMs: 60_000,
    clientFor: async () => {
      sessions += 1;
      return fake;
    },
  });
  refresher.note(shop, { inventoryItemIds: ["gid://shopify/InventoryItem/101"] });
  refresher.note(shop, { productIds: [b.id] });
  refresher.note(shop, { inventoryItemIds: ["gid://shopify/InventoryItem/101"] });
  assert.equal(refresher.scheduled(shop), true);
  assert.equal(sessions, 0, "nothing before the debounce");
  const outcome = await refresher.runNow(shop);
  assert.equal(outcome.done, "job");
  assert.equal(sessions, 1);
  assert.equal(refresher.scheduled(shop), false);
  assert.deepEqual(fake.variantCostMetafield(a.variantIds[0]!), { cost: 4, cur: "CZK" });
  assert.deepEqual(fake.variantCostMetafield(b.variantIds[1]!), { cost: 7, cur: "CZK" });
  assert.equal(fake.callsOf("WonSyncCostInventoryItems").length, 1);
  assert.equal(fake.callsOf("WonSyncCostProductVariants").length, 1);
  assert.deepEqual(await refresher.runNow(shop), { done: "nothing" });

  const orphan = createCostRefresher({ db: db.prisma, delayMs: 60_000, clientFor: async () => null });
  orphan.note(shop, { productIds: [a.id] });
  assert.deepEqual(await orphan.runNow(shop), { done: "no_session" });
  orphan.cancelAll();
  refresher.cancelAll();
});
