import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";

import { saveConfig } from "../../../app/lib/config.server.ts";
import { costIdle, costJobKind, costPassProgress, startCostJob, type CostLaneDeps } from "../../../app/lib/sync/cost-lane.server.ts";
import { loadCostState } from "../../../app/lib/sync/costs.ts";
import type { AdminClient } from "../../../app/lib/admin-client.server.ts";
import { createTestDatabase, type TestDatabase } from "../test-db.ts";
import { FakeShopify } from "./fake-shopify.ts";

// The cost jobs of a shop run one after another in this process (a webhook
// mirror never interleaves with a full pass: an older read could otherwise
// overwrite a newer cost). A newer full pass or clear supersedes a queued or
// running one (it stops at its next Shopify call; a full pass keeps its
// cursor and the newer one continues from it). Every job re-checks the STORED
// config when it runs: a full pass or a mirror only while margin protection is
// on, a clear only while it is off.

let db: TestDatabase;
let seq = 0;
let shop: string;
before(() => {
  db = createTestDatabase("sync-cost-lane");
});
after(async () => {
  await db.drop();
});
beforeEach(() => {
  seq += 1;
  shop = `cost-lane-${seq}.myshopify.com`;
});

const quiet = { info() {}, warn() {}, error() {} };

async function saveMargin(enabled: boolean) {
  const saved = await saveConfig(db.prisma, shop, { modules: { margin: { enabled, global: { maxDiscountPercent: 50 }, perCollection: [] } } });
  assert.equal(saved.ok, true);
}

function deps(client: AdminClient): CostLaneDeps {
  return { client, db: db.prisma, plan: async () => "free", logger: quiet, sleep: async () => {} };
}

function catalogue(fake: FakeShopify, products: number) {
  for (let i = 1; i <= products; i += 1) {
    const product = fake.addProduct(i, 1);
    fake.setCost(product.variantIds[0]!, "3.00");
  }
}

const costSets = (fake: FakeShopify) =>
  fake
    .callsOf("WonSyncMetafieldsSet")
    .flatMap((call) => (call.variables as { metafields: { key: string; ownerId: string }[] }).metafields)
    .filter((mf) => mf.key === "variant");

test("full pass while protection is on: runs, reports progress while running, records freshness", async () => {
  const fake = new FakeShopify();
  catalogue(fake, 5);
  await saveMargin(true);
  const running = startCostJob(shop, deps(fake), { kind: "full" });
  assert.equal(costJobKind(shop), "full");
  const outcome = await running;
  assert.equal(outcome.done, "full");
  assert.equal(costSets(fake).length, 5);
  assert.equal(costJobKind(shop), null);
  assert.equal(costPassProgress(shop), null, "no progress once done");
  assert.ok((await loadCostState(db.prisma, shop)).scannedAt);
});

test("protection off: a full pass and a mirror are skipped without a Shopify call; a clear runs", async () => {
  const fake = new FakeShopify();
  catalogue(fake, 2);
  await saveMargin(false);
  assert.deepEqual(await startCostJob(shop, deps(fake), { kind: "full" }), { done: "skipped", reason: "margin_off" });
  assert.deepEqual(await startCostJob(shop, deps(fake), { kind: "items", inventoryItemIds: ["gid://shopify/InventoryItem/101"] }), {
    done: "skipped",
    reason: "margin_off",
  });
  assert.equal(fake.calls.length, 0);
  const cleared = await startCostJob(shop, deps(fake), { kind: "clear" });
  assert.equal(cleared.done, "clear");
});

test("protection on: a clear is skipped (it would remove the costs checkout needs)", async () => {
  const fake = new FakeShopify();
  await saveMargin(true);
  assert.deepEqual(await startCostJob(shop, deps(fake), { kind: "clear" }), { done: "skipped", reason: "margin_on" });
});

test("a newer full pass supersedes the running one at its next call; the newer continues from the cursor", async () => {
  const fake = new FakeShopify();
  fake.pageSize = 3;
  catalogue(fake, 12);
  await saveMargin(true);
  const newerJob: { run: ReturnType<typeof startCostJob> | null } = { run: null };
  let pages = 0;
  const client: AdminClient = {
    async graphql(query, variables) {
      const result = await fake.graphql(query, variables);
      if (query.includes("WonSyncCostVariants(") && (pages += 1) === 2 && !newerJob.run) newerJob.run = startCostJob(shop, deps(client), { kind: "full" });
      return result;
    },
  };
  const first = await startCostJob(shop, deps(client), { kind: "full" });
  assert.equal(first.done, "full");
  assert.equal(first.done === "full" && first.result.outcome, "cancelled");
  assert.ok(newerJob.run, "the newer pass was started mid-way");
  const newer = await newerJob.run;
  assert.equal(newer.done === "full" && newer.result.outcome, "done");
  assert.equal(newer.done === "full" && newer.result.resumed, true);
  assert.equal(new Set(costSets(fake).map((mf) => mf.ownerId)).size, 12, "every variant written once overall");
  assert.equal(costSets(fake).length, 12, "no page written twice");
});

test("a queued (not started) full pass is dropped when a clear comes after it", async () => {
  const fake = new FakeShopify();
  catalogue(fake, 2);
  await saveMargin(true);
  const blocker = startCostJob(shop, deps(fake), { kind: "items", productIds: ["gid://shopify/Product/1"] });
  const full = startCostJob(shop, deps(fake), { kind: "full" });
  await saveMargin(false);
  const clear = startCostJob(shop, deps(fake), { kind: "clear" });
  await blocker;
  assert.deepEqual(await full, { done: "skipped", reason: "superseded" });
  assert.equal((await clear).done, "clear");
  await costIdle(shop);
});

test("a webhook mirror waits for the running pass (never interleaves) and then runs", async () => {
  const fake = new FakeShopify();
  fake.pageSize = 2;
  catalogue(fake, 6);
  await saveMargin(true);
  const order: string[] = [];
  const client: AdminClient = {
    async graphql(query, variables) {
      const op = /(?:query|mutation)\s+(\w+)/.exec(query)?.[1] ?? "";
      if (op.startsWith("WonSyncCost")) order.push(op);
      return fake.graphql(query, variables);
    },
  };
  const full = startCostJob(shop, deps(client), { kind: "full" });
  const items = startCostJob(shop, deps(client), { kind: "items", inventoryItemIds: ["gid://shopify/InventoryItem/101"] });
  await Promise.all([full, items]);
  const firstItem = order.indexOf("WonSyncCostInventoryItems");
  assert.ok(firstItem > order.lastIndexOf("WonSyncCostVariants"), order.join(" "));
});
