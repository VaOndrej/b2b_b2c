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
    data: { shop, variantId: "gid://shopify/ProductVariant/1", productId: "gid://shopify/Product/1", inventoryItemId: "gid://shopify/InventoryItem/1", price: "1", metafieldValue: '{"cost":1,"cur":"CZK"}', mayCarry: true },
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
    data: { shop: off, variantId: product.variantIds[0]!, productId: product.id, inventoryItemId: "gid://shopify/InventoryItem/101", price: "1", metafieldValue: '{"cost":2,"cur":"CZK"}', mayCarry: true },
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

test("a Přehled load and the reconcile at the same moment start ONE job (the shop is claimed while the job is decided)", async () => {
  const { ensureCostsFresh } = await import("../../../app/lib/sync/cost-lane.server.ts");
  const fake = new FakeShopify();
  fake.setCost(fake.addProduct(1, 1).variantIds[0]!, "2.00");
  await saveMargin(shop, true);
  const [load, reconcile] = await Promise.all([
    ensureCostsFresh(shop, { client: fake, db: db.prisma, plan: async () => "free" }, true),
    runCostReconcileOnce({ db: db.prisma, clientFor: async () => fake, plan: async () => "free" }),
  ]);
  assert.equal(load, "started_full");
  assert.deepEqual(reconcile.started, [], "the reconcile left the shop to the load");
  await costIdle(shop);
  assert.equal(fake.callsOf("WonSyncCostVariantsCount").length, 1);
});

test("reconcile starts at most maxShops jobs per run", async () => {
  const fake = new FakeShopify();
  for (let i = 0; i < 4; i += 1) await saveMargin(`${shop}-${i}`, true);
  const result = await runCostReconcileOnce({ db: db.prisma, clientFor: async () => fake, plan: async () => "free", maxShops: 2 });
  assert.equal(result.started.length, 2);
  await Promise.all(result.started.map((s) => costIdle(s.shop)));
});

test("reconcile rotates (audit P3-1): the least recently attempted shops first — never scanned, then the oldest scan — not alphabetically; failing shops never take every slot", async () => {
  const fake = new FakeShopify();
  const failedAt = (ms: number) => JSON.stringify({ token: "t", since: new Date(NOW.getTime() - ms).toISOString(), done: 0, total: null, failedAt: new Date(NOW.getTime() - ms).toISOString(), error: "costs.read: Throttled" });
  // Alphabetically first: three shops whose pass keeps failing (failed 20 min ago, never scanned).
  const failing = [1, 2, 3].map((i) => `a-${i}-${shop}`);
  for (const s of failing) {
    await saveMargin(s, true);
    await db.prisma.shopSyncState.create({ data: { shop: s, costsPending: failedAt(20 * 60_000) } });
  }
  const never = `n-never-${shop}`;
  const older = `m-older-${shop}`;
  const old = `z-old-${shop}`;
  await saveMargin(never, true);
  await saveMargin(older, true);
  await saveMargin(old, true);
  await db.prisma.shopSyncState.create({ data: { shop: older, costsScannedAt: new Date(NOW.getTime() - 40 * HOUR) } });
  await db.prisma.shopSyncState.create({ data: { shop: old, costsScannedAt: new Date(NOW.getTime() - 30 * HOUR) } });
  const run = (maxShops: number) =>
    runCostReconcileOnce({ db: db.prisma, clientFor: async () => fake, plan: async () => "free", now: () => NOW, maxShops });
  const first = await run(2);
  assert.deepEqual(first.started.map((s) => s.shop), [never, older], "never scanned first, then the oldest scan — the failing shops wait");
  await Promise.all(first.started.map((s) => costIdle(s.shop)));
  // Per-shop cap: a shop whose pass failed within COST_RECONCILE_FAILED_INTERVAL_MS gets no slot from the reconcile.
  const second = await run(5);
  assert.deepEqual(second.started.map((s) => s.shop), [old], "the recently failed shops are capped");
  await Promise.all(second.started.map((s) => costIdle(s.shop)));
  // Once their cap has passed they rotate in, the least recently attempted first.
  await db.prisma.shopSyncState.update({ where: { shop: failing[1]! }, data: { costsPending: failedAt(8 * HOUR) } });
  await db.prisma.shopSyncState.update({ where: { shop: failing[2]! }, data: { costsPending: failedAt(7 * HOUR) } });
  const third = await run(1);
  assert.deepEqual(third.started.map((s) => s.shop), [failing[1]], "failed 8 h ago before 7 h ago, never the one that failed 20 min ago");
  await Promise.all(third.started.map((s) => costIdle(s.shop)));
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

test("ensureCostReconcileJob is idempotent: two calls start ONE periodic job; its first run reconciles once", async () => {
  const { ensureCostReconcileJob, stopCostReconcileJob, costReconcileJobStarted } = await import("../../../app/lib/jobs/cost-reconcile.server.ts");
  stopCostReconcileJob();
  const due = `${shop}-boot`;
  await saveMargin(due, true);
  const fake = new FakeShopify();
  const sessions: string[] = [];
  const deps = {
    db: db.prisma,
    plan: async () => "free" as const,
    clientFor: async (s: string) => {
      sessions.push(s);
      return fake;
    },
  };
  try {
    ensureCostReconcileJob(db.prisma, { clientFor: deps.clientFor, deps, force: true, firstDelayMs: 5, intervalMs: 60_000 });
    ensureCostReconcileJob(db.prisma, { clientFor: deps.clientFor, deps, force: true, firstDelayMs: 5, intervalMs: 60_000 });
    assert.equal(costReconcileJobStarted(), true);
    for (let i = 0; i < 100 && sessions.length === 0; i += 1) await new Promise((resolve) => setTimeout(resolve, 10));
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.deepEqual(sessions, [due], "one run, one due shop");
    await costIdle(due);
  } finally {
    stopCostReconcileJob();
  }
  assert.equal(costReconcileJobStarted(), false);
});
