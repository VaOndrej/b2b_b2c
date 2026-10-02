import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";

import { createSync } from "../../../app/lib/sync/sync.server.ts";
import { createTestDatabase, type TestDatabase } from "../test-db.ts";
import { FakeShopify } from "./fake-shopify.ts";
import { autoRule, configWith, makeDeps } from "./helpers.ts";

// MVP 5 contract O6: the product metafield carries `outlet` (GIDs of the product's variants with a sale not yet
// ended, sorted) — the function keeps every other discount off those lines. The sale's own lane writes it at the
// start (outlet.server.ts); every full sync must KEEP it (it reads the runs from the app DB): a sync that dropped
// it would let a sale price take more discounts.

let db: TestDatabase;
let seq = 0;
let shop: string;
before(() => {
  db = createTestDatabase("sync-outlet-flags");
});
after(async () => {
  await db.drop();
});
beforeEach(() => {
  seq += 1;
  shop = `outlet-flags-${seq}.myshopify.com`;
});

const run = (productId: string, variantId: string, status: string, extra: Record<string, unknown> = {}) =>
  db.prisma.outletRun.create({ data: { shop, productId, variantId, quota: 5, percent: 30, status, ...extra } });

test("a product with a running sale and no rule gets `outlet` from a full sync; an ended sale's flag is cleared", async () => {
  const fake = new FakeShopify();
  const p = fake.addProduct(1, 2);
  const [v1, v2] = p.variantIds as [string, string];
  await run(p.id, v2, "active");
  await run(p.id, v1, "starting");
  const deps = makeDeps(fake, db.prisma);
  const sync = createSync(deps);

  const first = await sync.syncShop(shop, configWith([]));
  assert.equal(first.ok, true, JSON.stringify(first.errors));
  assert.deepEqual(fake.productMetafield(p.id), { ruleIds: [], variantRuleIds: {}, outlet: [v1, v2].sort() });

  await db.prisma.outletRun.updateMany({ where: { shop }, data: { status: "ended" } });
  const second = await sync.syncShop(shop, configWith([]));
  assert.equal(second.ok, true, JSON.stringify(second.errors));
  assert.equal(fake.productMetafield(p.id), undefined, "nothing left to carry: cleared and untracked");
  assert.equal(await db.prisma.productTargetIndex.count({ where: { shop } }), 0);
});

test("a targeted product keeps its rule refs AND its outlet list; an unchanged second sync writes nothing", async () => {
  const fake = new FakeShopify();
  const p = fake.addProduct(2);
  await run(p.id, p.variantIds[0]!, "active");
  const config = configWith([autoRule("r", { target: { kind: "products", productIds: [p.id], variantIds: [] } })]);
  const sync = createSync(makeDeps(fake, db.prisma));
  await sync.syncShop(shop, config);
  assert.deepEqual(fake.productMetafield(p.id), { ruleIds: ["r"], variantRuleIds: {}, outlet: [p.variantIds[0]] });

  fake.calls = [];
  await sync.syncShop(shop, config);
  assert.equal(fake.callsOf("WonSyncMetafieldsSet").filter((c) => JSON.stringify(c.variables).includes('"key":"product"')).length, 0);
});

test("a sale whose prices are back (ending, endedAt set) no longer flags; other shops' runs never leak in", async () => {
  const fake = new FakeShopify();
  const p = fake.addProduct(3);
  await run(p.id, p.variantIds[0]!, "ending", { endedAt: new Date() });
  await db.prisma.outletRun.create({ data: { shop: "other.myshopify.com", productId: p.id, variantId: p.variantIds[0]!, quota: 1, percent: 10, status: "active" } });
  const result = await createSync(makeDeps(fake, db.prisma)).syncShop(shop, configWith([]));
  assert.equal(result.ok, true);
  assert.equal(fake.productMetafield(p.id), undefined);
});
