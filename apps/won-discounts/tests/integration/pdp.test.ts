import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";

import { gateConfigForPlan } from "@won/core/discounts/plan-gate";
import { marginKey, pdpFloor } from "@won/core/discounts/storefront-config";

import type { PrismaClient } from "../../app/generated/prisma/client.ts";
import type { AdminClient } from "../../app/lib/admin-client.server.ts";
import { loadConfig } from "../../app/lib/config.server.ts";
import { costIdle, costJobKind, fullPassCovers, startCostJob } from "../../app/lib/sync/cost-lane.server.ts";
import { pdpMarginKey } from "../../app/lib/sync/costs.ts";
import { saveAndSync } from "../../app/lib/sync/save-and-sync.server.ts";
import { createSync, PDP_ITEMS_MAX, syncIdle } from "../../app/lib/sync/sync.server.ts";
import { productionSyncDeps } from "../../app/lib/sync/wiring.server.ts";
import { createTestDatabase, type TestDatabase } from "../lib/test-db.ts";
import { FakeStore, quiet } from "./helpers.ts";

// The variant `pdp` metafield (MVP 3, contract K4 v2): `$app:won_discounts/pdp` =
// {"f": <the floor of one item in minor units of the SHOP currency — exactly the
// engine's floorUnit>, "k": "<the margin settings' key>"} — written by the cost
// mirror in the SAME metafieldsSet as the cost, only for variants with a known
// cost while protection is on; recomputed when the cost changes
// (inventory_items/update), when the margin settings change (`k`: the sync
// queues a full pass) and when a product's margin collections change (the sync
// queues its variants); `f` does not depend on the price, so a price change
// writes nothing; deleted when the cost disappears or protection goes off.
// Only changed values are written. {f, k} = core pdpFloor with the gated margin
// checkout runs, the shop currency and the product's marginRefs (what the
// function reads); the storefront config's margin carries the same `k`.

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

/** What core says for a variant (gated stored margin, the shop currency, the product's refs from the index). */
async function expectedPdp(plan: Plan, variant: { cost: number; productId: string }) {
  const loaded = await loadConfig(db.prisma, shop);
  const row = await db.prisma.productTargetIndex.findUnique({ where: { shop_productId: { shop, productId: variant.productId } } });
  const refs = row?.value ? ((JSON.parse(row.value) as { marginRefs?: string[] }).marginRefs ?? []) : [];
  return pdpFloor({ unitCost: variant.cost, costCurrency: "CZK", shopCurrency: "CZK", margin: gateConfigForPlan(loaded.config, plan).config.modules.margin, collectionIds: refs });
}

/** The key of the stored margin as checkout runs it (gated) in the shop currency. */
async function keyOf(plan: Plan) {
  return marginKey(gateConfigForPlan((await loadConfig(db.prisma, shop)).config, plan).config.modules.margin, "CZK");
}

const variantSets = (store: FakeStore) =>
  store.sync
    .callsOf("WonSyncMetafieldsSet")
    .map((call) => (call.variables as { metafields: { ownerId: string; key: string; value: string }[] }).metafields)
    .filter((mfs) => mfs.every((mf) => mf.key === "variant" || mf.key === "pdp"));

test("a full pass writes pdp {f, k} with the cost in the same metafieldsSet (cost 6.00, min. margin 25 % → floor 8.00)", async () => {
  const { store, v1, v2 } = catalogue();
  const plan = { current: "pro" as Plan };
  await save(store, plan, marginInput());
  await startCostJob(shop, laneDeps(store, plan), { kind: "full", restart: true });
  await settle();
  assert.deepEqual(store.sync.variantPdpMetafield(v1), { f: 800, k: await keyOf("pro") });
  assert.deepEqual(store.sync.variantCostMetafield(v1), { cost: 6, cur: "CZK" });
  // The storefront config carries the same key (the same gated margin and shop currency): the PDP trusts `f`.
  assert.equal((store.sync.storefrontConfig() as { margin: { k?: string; cur?: string } }).margin.k, await keyOf("pro"));
  assert.equal((store.sync.storefrontConfig() as { margin: { k?: string; cur?: string } }).margin.cur, "CZK");
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
  // Cost 4.00 with the collection's min. margin 50 % → floor 8.00 (the global 25 % would give 5.34).
  assert.deepEqual(store.sync.variantPdpMetafield(v3), { f: 800, k: await keyOf("pro") });
  assert.deepEqual(await expectedPdp("pro", { cost: 4, productId: p3.id }), { f: 800, k: await keyOf("pro") });
  assert.deepEqual(store.sync.variantPdpMetafield(v1), { f: 800, k: await keyOf("pro") });
});

test("Free: the gated margin (collections folded into the store's values) decides, like checkout", async () => {
  const { store, v1, p1 } = catalogue();
  const plan = { current: "free" as Plan };
  await save(store, plan, marginInput({ perCollection: [{ collectionId: COLLECTION, minMarginPercent: 50 }] }));
  await startCostJob(shop, laneDeps(store, plan), { kind: "full", restart: true });
  await settle();
  const want = await expectedPdp("free", { cost: 6, productId: p1.id });
  assert.deepEqual(store.sync.variantPdpMetafield(v1), want);
  assert.equal(want?.f, 1200, "Free folds the 50 % collection into every product: cost 6.00 → floor 12.00");
});

test("a price change (products/update → the product's variants) writes nothing: the floor does not depend on the price", async () => {
  const { store, v1, p1 } = catalogue();
  const plan = { current: "pro" as Plan };
  await save(store, plan, marginInput());
  await startCostJob(shop, laneDeps(store, plan), { kind: "full", restart: true });
  await settle();
  store.sync.calls = [];
  store.sync.variants.get(v1)!.price = "20.00";
  await startCostJob(shop, laneDeps(store, plan), { kind: "items", productIds: [p1.id] });
  assert.deepEqual(store.sync.variantPdpMetafield(v1), { f: 800, k: await keyOf("pro") });
  assert.equal(store.sync.mutations().length, 0, "nothing written");
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
  // Cost 7.00, min. margin 25 % → floor ⌈9.333⌉ = 9.34.
  assert.deepEqual(store.sync.variantPdpMetafield(v1), { f: 934, k: await keyOf("pro") });
  assert.deepEqual(await expectedPdp("pro", { cost: 7, productId: p1.id }), { f: 934, k: await keyOf("pro") });
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
  const before = await keyOf("pro");
  assert.deepEqual(store.sync.variantPdpMetafield(v1), { f: 800, k: before });
  // Min. margin 10 %: floor ⌈6.667⌉ = 6.67, and a new key.
  await save(store, plan, marginInput({ min: 10 }));
  const after = await keyOf("pro");
  assert.notEqual(after, before);
  assert.deepEqual(store.sync.variantPdpMetafield(v1), { f: 667, k: after });
  assert.equal((store.sync.storefrontConfig() as { margin: { k?: string } }).margin.k, after, "the storefront config moved to the same key");
});

test("a product that joins a margin collection (targeting refresh) gets its pdp recomputed", async () => {
  const { store, v1, p1 } = catalogue();
  const plan = { current: "pro" as Plan };
  await save(store, plan, marginInput({ perCollection: [{ collectionId: COLLECTION, minMarginPercent: 50 }] }));
  await startCostJob(shop, laneDeps(store, plan), { kind: "full", restart: true });
  await settle();
  assert.deepEqual(store.sync.variantPdpMetafield(v1), { f: 800, k: await keyOf("pro") });
  store.sync.collections.get(COLLECTION)!.push(p1.id);
  const loaded = await loadConfig(db.prisma, shop);
  await syncFor(plan)(store, db.prisma).refreshProducts(shop, loaded.config);
  await settle();
  // Cost 6.00 with the collection's min. margin 50 %: floor 12.00.
  assert.deepEqual(store.sync.variantPdpMetafield(v1), { f: 1200, k: await keyOf("pro") });
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
  const old = { f: 800, k: await keyOf("pro") };
  store.sync.refusedOwners.add(v1);
  // A margin change: the cost stays, pdp alone must move (new f and k) — Shopify refuses it.
  await save(store, plan, marginInput({ min: 10 }));
  const row = await db.prisma.variantCost.findUnique({ where: { shop_variantId: { shop, variantId: v1 } } });
  assert.match(row!.writeError ?? "", /pdp/);
  assert.deepEqual(store.sync.variantPdpMetafield(v1), old, "the old value (old k: the PDP promises nothing for it) stays until the retry");
  store.sync.calls = [];
  await startCostJob(shop, laneDeps(store, plan), { kind: "items", productIds: [p1.id] });
  assert.equal(store.sync.mutations().length, 0, "backed off");
});

const COST_OPS = ["WonSyncCostShop", "WonSyncCostVariantsCount", "WonSyncCostVariants", "WonSyncCostVariantNodes", "WonSyncCostInventoryItems", "WonSyncCostProductVariants"];
const costOps = (store: FakeStore) => store.ops.filter((op) => COST_OPS.includes(op));

test("a rules-only change (margin and marginRefs unchanged) queues no cost job", async () => {
  const { store } = catalogue();
  const plan = { current: "pro" as Plan };
  await save(store, plan, marginInput());
  await startCostJob(shop, laneDeps(store, plan), { kind: "full", restart: true });
  await settle();
  store.ops = [];
  const withRule = marginInput();
  (withRule.modules.codes as { rules: unknown[] }).rules = [{ id: "r", name: "R", method: "automatic", value: { kind: "percentage", percent: 10 }, target: { kind: "order" } }];
  const result = await saveAndSync({ client: store, db: db.prisma, shop, input: withRule, createSync: syncFor(plan), logger: quiet });
  assert.equal(result.sync?.ok, true, JSON.stringify(result.sync?.errors));
  assert.equal(costJobKind(shop), null, "nothing queued");
  await settle();
  assert.deepEqual(costOps(store), []);
});

test("more than PDP_ITEMS_MAX products whose margin collections changed → one full pass (not a read per product)", async () => {
  const store = new FakeStore();
  const ids: string[] = [];
  for (let i = 1; i <= PDP_ITEMS_MAX + 1; i += 1) {
    const product = store.sync.addProduct(1000 + i, 1);
    store.sync.setCost(product.variantIds[0]!, "6.00");
    ids.push(product.id);
  }
  store.sync.addCollection(5, []);
  const plan = { current: "pro" as Plan };
  await save(store, plan, marginInput({ perCollection: [{ collectionId: COLLECTION, minMarginPercent: 50 }] }));
  await startCostJob(shop, laneDeps(store, plan), { kind: "full", restart: true });
  await settle();
  const first = store.sync.products.get(ids[0]!)!.variantIds[0]!;
  assert.deepEqual(store.sync.variantPdpMetafield(first), { f: 800, k: await keyOf("pro") });
  store.sync.collections.get(COLLECTION)!.push(...ids);
  store.ops = [];
  await syncFor(plan)(store, db.prisma).refreshProducts(shop, (await loadConfig(db.prisma, shop)).config);
  await settle();
  assert.ok(costOps(store).includes("WonSyncCostVariants"), "a full pass ran");
  assert.equal(costOps(store).filter((op) => op === "WonSyncCostProductVariants").length, 0, "no per-product reads");
  assert.deepEqual(store.sync.variantPdpMetafield(first), { f: 1200, k: await keyOf("pro") });
});

test("a margin change while a full pass for the SAME margin already runs starts no second pass (coalesced)", async () => {
  const { store } = catalogue();
  const plan = { current: "pro" as Plan };
  await save(store, plan, marginInput());
  // A full pass that blocks on its first Shopify read (the shop currency) until released.
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  let entered!: () => void;
  const running = new Promise<void>((resolve) => (entered = resolve));
  store.overrides.set("WonSyncCostShop", async (variables) => {
    entered();
    await gate;
    store.overrides.delete("WonSyncCostShop");
    return store.sync.graphql("query WonSyncCostShop { x }", variables);
  });
  await settle();
  store.ops = [];
  const pass = startCostJob(shop, laneDeps(store, plan), { kind: "full", restart: true });
  const key = pdpMarginKey(gateConfigForPlan((await loadConfig(db.prisma, shop)).config, "pro").config.modules.margin);
  assert.equal(fullPassCovers(shop, key), true, "queued: it reads the stored config when it starts");
  await running;
  assert.equal(fullPassCovers(shop, key), true, "running for this margin");
  assert.equal(fullPassCovers(shop, "another margin"), false);
  // The live shop config is gone (e.g. a reinstall): the sync sees a margin change, but the running pass already covers it.
  store.sync.shopMetafields.clear();
  const result = await saveAndSync({ client: store, db: db.prisma, shop, input: marginInput(), createSync: syncFor(plan), logger: quiet });
  assert.equal(result.sync?.ok, true, JSON.stringify(result.sync?.errors));
  release();
  const outcome = await pass;
  assert.equal(outcome.done === "full" && outcome.result.outcome, "done", "not superseded");
  await settle();
  assert.equal(store.ops.filter((op) => op === "WonSyncCostVariantsCount").length, 1, "one pass");
});

test("a pass cut short under another margin is not resumed: the next pass starts over (every pdp is recomputed)", async () => {
  const { store } = catalogue();
  const plan = { current: "pro" as Plan };
  await save(store, plan, marginInput());
  await settle();
  const since = new Date().toISOString();
  const cutShort = (margin: string) =>
    db.prisma.shopSyncState.upsert({
      where: { shop },
      create: { shop, costsCursor: "1", costsPending: JSON.stringify({ token: "t-old", since, done: 1, total: 3, margin }) },
      update: { costsCursor: "1", costsPending: JSON.stringify({ token: "t-old", since, done: 1, total: 3, margin }) },
    });
  await cutShort("another margin");
  const fresh = await startCostJob(shop, laneDeps(store, plan), { kind: "full" });
  assert.equal(fresh.done === "full" && fresh.result.resumed, false);
  const key = pdpMarginKey(gateConfigForPlan((await loadConfig(db.prisma, shop)).config, "pro").config.modules.margin);
  await cutShort(key);
  const resumed = await startCostJob(shop, laneDeps(store, plan), { kind: "full" });
  assert.equal(resumed.done === "full" && resumed.result.resumed, true, "the same margin: resumed where it stopped");
});

test("the margin-change pass keeps the refusal back-off (it does not re-send writes Shopify just refused)", async () => {
  const { store, v1 } = catalogue();
  const plan = { current: "pro" as Plan };
  store.sync.refusedOwners.add(v1);
  await save(store, plan, marginInput()); // its sync queues the first pass: v1's cost + pdp write is refused
  const refused = await db.prisma.variantCost.findUnique({ where: { shop_variantId: { shop, variantId: v1 } } });
  assert.ok(refused?.writeError, "refused once");
  store.sync.calls = [];
  await save(store, plan, marginInput({ min: 10 }));
  const resent = store.sync
    .callsOf("WonSyncMetafieldsSet")
    .some((call) => (call.variables as { metafields: { ownerId: string }[] }).metafields.some((mf) => mf.ownerId === v1));
  assert.equal(resent, false, "still backed off");
});

test("the shop config is written although the product plan did not finish: a margin change still recomputes every pdp", async () => {
  const { store, v1 } = catalogue();
  const plan = { current: "pro" as Plan };
  // The only product target is a collection that cannot be read: the plan fails, but nothing is indexed and no margin
  // collection is in force, so nothing is at risk — the shop config (with the new margin) is written all the same.
  store.sync.fail("WonSyncCollectionProducts", { graphqlError: "Internal error" }, 100);
  const input = marginInput();
  (input.modules.codes as { rules: unknown[] }).rules = [
    { id: "r", name: "R", method: "automatic", value: { kind: "percentage", percent: 10 }, target: { kind: "collections", ids: [COLLECTION] } },
  ];
  const result = await save(store, plan, input);
  assert.ok(result.sync?.steps.some((s) => s.step === "products" && !s.ok), JSON.stringify(result.sync?.steps));
  assert.ok(result.sync?.steps.some((s) => s.step === "shop_config.write" && s.ok));
  assert.deepEqual(store.sync.variantPdpMetafield(v1), { f: 800, k: await keyOf("pro") });
});
