import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";

import { gateConfigForPlan } from "@won/core/discounts/plan-gate";
import { pdpMaxDiscountPercent } from "@won/core/discounts/storefront-config";

import type { PrismaClient } from "../../app/generated/prisma/client.ts";
import type { AdminClient } from "../../app/lib/admin-client.server.ts";
import { loadConfig } from "../../app/lib/config.server.ts";
import { costIdle, startCostJob } from "../../app/lib/sync/cost-lane.server.ts";
import { saveAndSync } from "../../app/lib/sync/save-and-sync.server.ts";
import { createSync, syncIdle } from "../../app/lib/sync/sync.server.ts";
import { productionSyncDeps } from "../../app/lib/sync/wiring.server.ts";
import { createTestDatabase, type TestDatabase } from "../lib/test-db.ts";
import { FakeStore, quiet } from "./helpers.ts";

// The variant `pdp` metafield (MVP 3, contract K4): `$app:won_discounts/pdp` =
// {"max": <the largest discount % margin protection allows at the variant's
// price in the SHOP currency, one decimal, rounded down>} — written by the cost
// mirror in the SAME metafieldsSet as the cost, only for variants with a known
// cost while protection is on; recomputed when the price changes
// (products/update → the product's variants), when the cost changes
// (inventory_items/update), when the margin settings change (the sync queues a
// full pass) and when a product's margin collections change (the sync queues
// its variants); deleted when the cost disappears or protection goes off.
// Only changed values are written. `max` = core pdpMaxDiscountPercent with the
// gated margin checkout runs and the product's marginRefs (what the function reads).

let db: TestDatabase;
let seq = 0;
let shop: string;
before(() => {
  db = createTestDatabase("int-pdp");
});
after(async () => {
  await db.drop();
});
beforeEach(() => {
  seq += 1;
  shop = `pdp-${seq}.myshopify.com`;
});

type Plan = "free" | "pro";
const COLLECTION = "gid://shopify/Collection/5";

function laneDeps(store: FakeStore, plan: { current: Plan }) {
  return { client: store as AdminClient, db: db.prisma, plan: async () => plan.current, logger: quiet, sleep: async () => {} };
}

function syncFor(plan: { current: Plan }) {
  return (client: AdminClient, prisma: PrismaClient) =>
    createSync({ ...productionSyncDeps(client, prisma, quiet), sleep: async () => {}, plan: async () => plan.current });
}

function marginInput(opts: { enabled?: boolean; min?: number; max?: number; perCollection?: unknown[] } = {}) {
  return {
    modules: {
      codes: { rules: [] },
      margin: {
        enabled: opts.enabled ?? true,
        global: { minMarginPercent: opts.min ?? 25, maxDiscountPercent: opts.max ?? 30 },
        perCollection: opts.perCollection ?? [],
      },
    },
  };
}

async function save(store: FakeStore, plan: { current: Plan }, input: unknown) {
  const result = await saveAndSync({ client: store, db: db.prisma, shop, input, createSync: syncFor(plan), logger: quiet });
  assert.equal(result.save.ok, true, JSON.stringify(result.save));
  await settle();
  return result;
}

async function settle() {
  await syncIdle(shop);
  await costIdle(shop);
  await syncIdle(shop);
  await costIdle(shop);
}

/** Product 1: price 10.00 CZK, cost 6.00; product 2: price 20.00, no cost; product 3 (in collection 5): price 10.00, cost 4.00. */
function catalogue() {
  const store = new FakeStore();
  const p1 = store.sync.addProduct(1, 1);
  const p2 = store.sync.addProduct(2, 1);
  const p3 = store.sync.addProduct(3, 1);
  store.sync.setCost(p1.variantIds[0]!, "6.00");
  store.sync.variants.get(p2.variantIds[0]!)!.price = "20.00";
  store.sync.setCost(p3.variantIds[0]!, "4.00");
  store.sync.addCollection(5, [p3.id]);
  return { store, v1: p1.variantIds[0]!, v2: p2.variantIds[0]!, v3: p3.variantIds[0]!, p1, p3 };
}

/** What core says for a variant (gated stored margin, the product's refs from the index). */
async function expectedMax(plan: Plan, variant: { price: string; cost: number; productId: string }) {
  const loaded = await loadConfig(db.prisma, shop);
  const row = await db.prisma.productTargetIndex.findUnique({ where: { shop_productId: { shop, productId: variant.productId } } });
  const refs = row?.value ? ((JSON.parse(row.value) as { marginRefs?: string[] }).marginRefs ?? []) : [];
  return pdpMaxDiscountPercent({
    unitPrice: Math.round(Number(variant.price) * 100),
    unitCost: variant.cost,
    costCurrency: "CZK",
    shopCurrency: "CZK",
    margin: gateConfigForPlan(loaded.config, plan).config.modules.margin,
    collectionIds: refs,
  });
}

const variantSets = (store: FakeStore) =>
  store.sync
    .callsOf("WonSyncMetafieldsSet")
    .map((call) => (call.variables as { metafields: { ownerId: string; key: string; value: string }[] }).metafields)
    .filter((mfs) => mfs.every((mf) => mf.key === "variant" || mf.key === "pdp"));

test("a full pass writes pdp {max} with the cost in the same metafieldsSet (10.00 at cost 6.00, min. margin 25 % → 20 %)", async () => {
  const { store, v1, v2 } = catalogue();
  const plan = { current: "pro" as Plan };
  await save(store, plan, marginInput());
  await startCostJob(shop, laneDeps(store, plan), { kind: "full", restart: true });
  await settle();
  assert.deepEqual(store.sync.variantPdpMetafield(v1), { max: 20 });
  assert.deepEqual(store.sync.variantCostMetafield(v1), { cost: 6, cur: "CZK" });
  assert.equal(store.sync.variantPdpMetafield(v2), undefined, "no cost → no pdp (the storefront uses the config cap)");
  const withV1 = variantSets(store).filter((mfs) => mfs.some((mf) => mf.ownerId === v1));
  assert.ok(
    withV1.some((mfs) => mfs.some((mf) => mf.ownerId === v1 && mf.key === "variant") && mfs.some((mf) => mf.ownerId === v1 && mf.key === "pdp")),
    `cost and pdp in one write: ${JSON.stringify(withV1)}`,
  );
});

test("the product's margin collections decide (marginRefs, as checkout): a stricter collection lowers pdp", async () => {
  const { store, v1, v3, p3 } = catalogue();
  const plan = { current: "pro" as Plan };
  await save(store, plan, marginInput({ perCollection: [{ collectionId: COLLECTION, minMarginPercent: 50 }] }));
  await startCostJob(shop, laneDeps(store, plan), { kind: "full", restart: true });
  await settle();
  // 10.00 at cost 4.00, min. margin 50 % → floor 8.00 → 20 %; the global 25 % would give 46.6 % (floor 5.34).
  assert.deepEqual(store.sync.variantPdpMetafield(v3), { max: 20 });
  assert.equal(20, await expectedMax("pro", { price: "10.00", cost: 4, productId: p3.id }));
  assert.deepEqual(store.sync.variantPdpMetafield(v1), { max: 20 });
});

test("Free: the gated margin (collections folded into the store's values) decides, like checkout", async () => {
  const { store, v1, p1 } = catalogue();
  const plan = { current: "free" as Plan };
  await save(store, plan, marginInput({ perCollection: [{ collectionId: COLLECTION, minMarginPercent: 50 }] }));
  await startCostJob(shop, laneDeps(store, plan), { kind: "full", restart: true });
  await settle();
  const want = await expectedMax("free", { price: "10.00", cost: 6, productId: p1.id });
  assert.deepEqual(store.sync.variantPdpMetafield(v1), { max: want });
  assert.equal(want, 0, "Free folds the 50 % collection into every product: 10.00 at cost 6.00 has no room");
});

test("a price change (products/update → the product's variants) recomputes pdp; only pdp is written, nothing when unchanged", async () => {
  const { store, v1, p1 } = catalogue();
  const plan = { current: "pro" as Plan };
  await save(store, plan, marginInput());
  await startCostJob(shop, laneDeps(store, plan), { kind: "full", restart: true });
  await settle();
  store.sync.calls = [];
  store.sync.variants.get(v1)!.price = "20.00";
  await startCostJob(shop, laneDeps(store, plan), { kind: "items", productIds: [p1.id] });
  // 20.00 at cost 6.00, min. margin 25 % → floor 8.00 → 60 % (the 30 % cap is for variants WITHOUT a cost).
  assert.deepEqual(store.sync.variantPdpMetafield(v1), { max: 60 });
  assert.deepEqual(
    variantSets(store).map((mfs) => mfs.map((mf) => `${mf.key}:${mf.ownerId}`)),
    [[`pdp:${v1}`]],
    "the cost did not change: only pdp",
  );
  store.sync.calls = [];
  await startCostJob(shop, laneDeps(store, plan), { kind: "items", productIds: [p1.id] });
  assert.equal(store.sync.mutations().length, 0, "nothing changed: nothing written");
});

test("a cost change (inventory_items/update) recomputes pdp together with the cost", async () => {
  const { store, v1, p1 } = catalogue();
  const plan = { current: "pro" as Plan };
  await save(store, plan, marginInput());
  await startCostJob(shop, laneDeps(store, plan), { kind: "full", restart: true });
  await settle();
  store.sync.setCost(v1, "7.00");
  store.sync.calls = [];
  await startCostJob(shop, laneDeps(store, plan), { kind: "items", inventoryItemIds: [store.sync.variants.get(v1)!.inventoryItemId] });
  const want = await expectedMax("pro", { price: "10.00", cost: 7, productId: p1.id });
  assert.deepEqual(store.sync.variantPdpMetafield(v1), { max: want });
  assert.ok(want !== null && want < 20);
  assert.deepEqual(variantSets(store).map((mfs) => mfs.map((mf) => mf.key).sort()), [["pdp", "variant"]]);
});

test("the cost disappears → the cost and pdp are deleted in one call", async () => {
  const { store, v1 } = catalogue();
  const plan = { current: "pro" as Plan };
  await save(store, plan, marginInput());
  await startCostJob(shop, laneDeps(store, plan), { kind: "full", restart: true });
  await settle();
  store.sync.setCost(v1, null);
  store.sync.calls = [];
  await startCostJob(shop, laneDeps(store, plan), { kind: "items", inventoryItemIds: [store.sync.variants.get(v1)!.inventoryItemId] });
  assert.equal(store.sync.variantPdpMetafield(v1), undefined);
  assert.equal(store.sync.variantCostMetafield(v1), undefined);
  const deletes = store.sync.callsOf("WonSyncMetafieldsDelete").map((call) => (call.variables as { metafields: { key: string }[] }).metafields.map((mf) => mf.key).sort());
  assert.deepEqual(deletes, [["pdp", "variant"]]);
});

test("a cost in another currency than the shop's: checkout ignores it, so no pdp either", async () => {
  const { store, v1 } = catalogue();
  store.sync.setCost(v1, "6.00", "EUR");
  const plan = { current: "pro" as Plan };
  await save(store, plan, marginInput());
  await startCostJob(shop, laneDeps(store, plan), { kind: "full", restart: true });
  await settle();
  assert.deepEqual(store.sync.variantCostMetafield(v1), { cost: 6, cur: "EUR" });
  assert.equal(store.sync.variantPdpMetafield(v1), undefined);
});

test("margin settings change: the sync queues a full pass that recomputes every pdp", async () => {
  const { store, v1 } = catalogue();
  const plan = { current: "pro" as Plan };
  await save(store, plan, marginInput());
  await startCostJob(shop, laneDeps(store, plan), { kind: "full", restart: true });
  await settle();
  assert.deepEqual(store.sync.variantPdpMetafield(v1), { max: 20 });
  // Min. margin 10 %: floor ⌈6.667⌉ = 6.67 → 33.3 % (rounded down to 0.1 %).
  await save(store, plan, marginInput({ min: 10 }));
  assert.deepEqual(store.sync.variantPdpMetafield(v1), { max: 33.3 });
  assert.equal(33.3, await expectedMax("pro", { price: "10.00", cost: 6, productId: store.sync.variants.get(v1)!.productId }));
});

test("a product that joins a margin collection (targeting refresh) gets its pdp recomputed", async () => {
  const { store, v1, p1 } = catalogue();
  const plan = { current: "pro" as Plan };
  await save(store, plan, marginInput({ perCollection: [{ collectionId: COLLECTION, minMarginPercent: 50 }] }));
  await startCostJob(shop, laneDeps(store, plan), { kind: "full", restart: true });
  await settle();
  assert.deepEqual(store.sync.variantPdpMetafield(v1), { max: 20 });
  store.sync.collections.get(COLLECTION)!.push(p1.id);
  const loaded = await loadConfig(db.prisma, shop);
  await syncFor(plan)(store, db.prisma).refreshProducts(shop, loaded.config);
  await settle();
  // 10.00 at cost 6.00 with min. margin 50 %: floor 12.00 > price → 0 %.
  assert.deepEqual(store.sync.variantPdpMetafield(v1), { max: 0 });
});

test("protection switched off: the clear deletes the cost and pdp of every variant", async () => {
  const { store, v1, v3 } = catalogue();
  const plan = { current: "pro" as Plan };
  await save(store, plan, marginInput());
  await startCostJob(shop, laneDeps(store, plan), { kind: "full", restart: true });
  await settle();
  assert.ok(store.sync.variantPdpMetafield(v3));
  await save(store, plan, marginInput({ enabled: false }));
  await startCostJob(shop, laneDeps(store, plan), { kind: "clear" });
  await settle();
  for (const v of [v1, v3]) {
    assert.equal(store.sync.variantPdpMetafield(v), undefined);
    assert.equal(store.sync.variantCostMetafield(v), undefined);
  }
});

test("the shop currency cannot be read: the pass fails (retried) and writes no pdp", async () => {
  const { store, v1 } = catalogue();
  const plan = { current: "pro" as Plan };
  store.sync.fail("WonSyncCostShop", { graphqlError: "Internal error" }, 20);
  await save(store, plan, marginInput());
  const outcome = await startCostJob(shop, laneDeps(store, plan), { kind: "full", restart: true });
  assert.equal(outcome.done === "full" && outcome.result.outcome, "failed");
  assert.equal(store.sync.variantPdpMetafield(v1), undefined);
});

test("a pdp write Shopify refuses is recorded on the variant and backed off (not re-sent by every mirror)", async () => {
  const { store, v1, p1 } = catalogue();
  const plan = { current: "pro" as Plan };
  await save(store, plan, marginInput());
  await startCostJob(shop, laneDeps(store, plan), { kind: "full", restart: true });
  await settle();
  store.sync.variants.get(v1)!.price = "20.00";
  store.sync.refusedOwners.add(v1);
  const first = await startCostJob(shop, laneDeps(store, plan), { kind: "items", productIds: [p1.id] });
  assert.equal(first.done === "items" && first.result.refused, 1);
  const row = await db.prisma.variantCost.findUnique({ where: { shop_variantId: { shop, variantId: v1 } } });
  assert.match(row!.writeError ?? "", /pdp/);
  store.sync.calls = [];
  await startCostJob(shop, laneDeps(store, plan), { kind: "items", productIds: [p1.id] });
  assert.equal(store.sync.mutations().length, 0, "backed off");
  assert.deepEqual(store.sync.variantPdpMetafield(v1), { max: 20 }, "the old value stays until the retry");
});
