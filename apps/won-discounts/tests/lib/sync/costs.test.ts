import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";

import {
  clearCostMirror,
  desiredCostValue,
  loadCostState,
  mirrorInventoryItems,
  mirrorProducts,
  parseCostValue,
  runCostPass,
  type CostPending,
} from "../../../app/lib/sync/costs.ts";
import { COST_PAGE_SIZE, GQL } from "../../../app/lib/sync/graphql.ts";
import { Transport } from "../../../app/lib/sync/transport.ts";
import { createTestDatabase, type TestDatabase } from "../test-db.ts";
import { FakeShopify } from "./fake-shopify.ts";

// The cost mirror (margin protection, MVP 2): inventoryItem.unitCost →
// `$app:won_discounts/variant` = {"cost": n, "cur": "CZK"} on variants with a
// cost > 0, diffed against the value Shopify HAS (only changed variants are
// written, ≤ 25 per metafieldsSet), deleted where the cost disappeared; the
// full pass pages productVariants, is cancellable, resumes from its saved
// cursor and retries throttled / failed calls (API-3); webhook-sized mirrors
// re-read one inventory item or one product; switching protection off clears
// every metafield the sync wrote.

let db: TestDatabase;
let seq = 0;
let shop: string;
before(() => {
  db = createTestDatabase("sync-costs");
});
after(async () => {
  await db.drop();
});
beforeEach(() => {
  seq += 1;
  shop = `costs-${seq}.myshopify.com`;
});

const quiet = { info() {}, warn() {}, error() {} };
const NOW = new Date("2026-09-29T10:00:00Z");

function ctxFor(fake: FakeShopify, extra: { isCancelled?: () => boolean; sleeps?: number[]; now?: () => Date } = {}) {
  const sleeps = extra.sleeps ?? [];
  const transport = new Transport(fake, { attempts: 4, baseDelayMs: 100, maxDelayMs: 1000 }, async (ms) => void sleeps.push(ms), quiet);
  return { transport, db: db.prisma, shop, now: extra.now ?? (() => NOW), ...(extra.isCancelled ? { isCancelled: extra.isCancelled } : {}) };
}

const setCalls = (fake: FakeShopify) =>
  fake
    .callsOf("WonSyncMetafieldsSet")
    .map((call) => (call.variables as { metafields: { key: string; ownerId: string; value: string }[] }).metafields)
    .filter((mfs) => mfs[0]!.key === "variant");
const deleteCalls = (fake: FakeShopify) =>
  fake
    .callsOf("WonSyncMetafieldsDelete")
    .map((call) => (call.variables as { metafields: { key: string; ownerId: string }[] }).metafields)
    .filter((mfs) => mfs[0]!.key === "variant");
const rows = async () => db.prisma.variantCost.findMany({ where: { shop }, orderBy: { variantId: "asc" } });

/** 30 products × 2 variants, every even product's variants with a cost. */
function catalogue(fake: FakeShopify, products = 30) {
  const out = [];
  for (let i = 1; i <= products; i += 1) {
    const product = fake.addProduct(i, 2);
    if (i % 2 === 0) for (const v of product.variantIds) fake.setCost(v, `${i}.50`);
    out.push(product);
  }
  return out;
}

test("value shape: {cost, cur} only for a cost > 0 with an ISO currency; the reader is as tolerant as the function", () => {
  assert.equal(desiredCostValue({ amount: "6.0", currencyCode: "USD" }), '{"cost":6,"cur":"USD"}');
  assert.equal(desiredCostValue({ amount: "12.345", currencyCode: "czk" }), '{"cost":12.345,"cur":"CZK"}');
  assert.equal(desiredCostValue({ amount: "0.00", currencyCode: "USD" }), null);
  assert.equal(desiredCostValue({ amount: "-1", currencyCode: "USD" }), null);
  assert.equal(desiredCostValue({ amount: "abc", currencyCode: "USD" }), null);
  assert.equal(desiredCostValue({ amount: "5", currencyCode: "" }), null);
  assert.equal(desiredCostValue(null), null);
  assert.deepEqual(parseCostValue('{"cost":6,"cur":"USD"}'), { cost: 6, cur: "USD" });
  assert.equal(parseCostValue('{"cost":0,"cur":"USD"}'), null);
  assert.equal(parseCostValue('{"cost":"6","cur":"USD"}'), null);
  assert.equal(parseCostValue("not json"), null);
});

test("the page document asks for COST_PAGE_SIZE variants", () => {
  assert.match(GQL.costVariants, new RegExp(`productVariants\\(first: ${COST_PAGE_SIZE}, after: \\$after\\)`));
});

test("full pass: paged, only variants with a cost get the metafield (≤ 25 per call), every variant recorded, freshness recorded", async () => {
  const fake = new FakeShopify();
  fake.pageSize = 7;
  catalogue(fake);
  const progress: CostPending[] = [];
  const result = await runCostPass({ ...ctxFor(fake), onProgress: (p) => progress.push(p) });
  assert.equal(result.outcome, "done", JSON.stringify(result.errors));
  assert.equal(result.read, 60);
  assert.equal(result.written, 30);
  assert.equal(fake.callsOf("WonSyncCostVariants").length, Math.ceil(60 / 7), "paged");
  assert.deepEqual(setCalls(fake).map((mfs) => mfs.length).reduce((a, b) => a + b, 0), 30);
  assert.ok(setCalls(fake).every((mfs) => mfs.length <= 25));
  assert.deepEqual(fake.variantCostMetafield("gid://shopify/ProductVariant/201"), { cost: 2.5, cur: "CZK" });
  assert.equal(fake.variantCostMetafield("gid://shopify/ProductVariant/101"), undefined, "no cost → no metafield");
  const recorded = await rows();
  assert.equal(recorded.length, 60);
  const row = recorded.find((r) => r.variantId === "gid://shopify/ProductVariant/201")!;
  assert.equal(row.productId, "gid://shopify/Product/2");
  assert.equal(row.inventoryItemId, "gid://shopify/InventoryItem/201");
  assert.equal(row.cost, "2.50");
  assert.equal(row.currency, "CZK");
  assert.equal(row.price, "10.00");
  assert.equal(row.title, "Product 2");
  assert.equal(row.metafieldValue, '{"cost":2.5,"cur":"CZK"}');
  assert.equal(recorded.find((r) => r.variantId === "gid://shopify/ProductVariant/101")!.metafieldValue, null);
  const state = await loadCostState(db.prisma, shop);
  assert.equal(state.scannedAt?.toISOString(), NOW.toISOString());
  assert.equal(state.cursor, null);
  assert.equal(state.pending, null);
  assert.equal(progress.at(-1)!.done, 60);
  assert.equal(progress.at(-1)!.total, 60, "total from productVariantsCount");
});

test("second pass: nothing changed → no write; a changed cost → only that variant; a removed cost → its metafield deleted", async () => {
  const fake = new FakeShopify();
  catalogue(fake, 6);
  await runCostPass(ctxFor(fake));
  fake.calls = [];
  const same = await runCostPass(ctxFor(fake));
  assert.equal(same.outcome, "done");
  assert.equal(setCalls(fake).length + deleteCalls(fake).length, 0, "unchanged → no mutation");

  fake.calls = [];
  fake.setCost("gid://shopify/ProductVariant/201", "3.00");
  fake.setCost("gid://shopify/ProductVariant/401", null);
  fake.setCost("gid://shopify/ProductVariant/101", "1.25");
  const changed = await runCostPass(ctxFor(fake));
  assert.equal(changed.outcome, "done");
  assert.deepEqual(setCalls(fake).flat().map((mf) => mf.ownerId).sort(), ["gid://shopify/ProductVariant/101", "gid://shopify/ProductVariant/201"]);
  assert.deepEqual(deleteCalls(fake).flat().map((mf) => mf.ownerId), ["gid://shopify/ProductVariant/401"]);
  assert.equal(fake.variantCostMetafield("gid://shopify/ProductVariant/401"), undefined);
  assert.deepEqual(fake.variantCostMetafield("gid://shopify/ProductVariant/201"), { cost: 3, cur: "CZK" });
  const row = (await rows()).find((r) => r.variantId === "gid://shopify/ProductVariant/401")!;
  assert.equal(row.metafieldValue, null);
  assert.equal(row.cost, null);
});

test("a metafield Shopify lost (reinstall) is rewritten: the diff is against Shopify, not the DB", async () => {
  const fake = new FakeShopify();
  catalogue(fake, 2);
  await runCostPass(ctxFor(fake));
  fake.variants.get("gid://shopify/ProductVariant/201")!.metafields.clear();
  fake.calls = [];
  await runCostPass(ctxFor(fake));
  assert.deepEqual(setCalls(fake).flat().map((mf) => mf.ownerId), ["gid://shopify/ProductVariant/201"]);
});

test("rows of deleted variants are dropped at the end of a pass (re-read by id first)", async () => {
  const fake = new FakeShopify();
  catalogue(fake, 3);
  await runCostPass(ctxFor(fake));
  fake.deleteVariant("gid://shopify/ProductVariant/202");
  const result = await runCostPass(ctxFor(fake));
  assert.equal(result.outcome, "done");
  assert.equal(result.removed, 1);
  assert.equal((await rows()).some((r) => r.variantId === "gid://shopify/ProductVariant/202"), false);
  assert.equal((await rows()).length, 5);
});

test("cancelled mid-pass (a newer job): stops before the next call, keeps its cursor; the next pass resumes from it", async () => {
  const fake = new FakeShopify();
  fake.pageSize = 10;
  catalogue(fake, 15);
  let pages = 0;
  const first = await runCostPass({
    ...ctxFor(fake, { isCancelled: () => pages >= 2 }),
    onProgress: (p) => {
      if (p.done > 0) pages += 1;
    },
  });
  assert.equal(first.outcome, "cancelled");
  const state = await loadCostState(db.prisma, shop);
  assert.equal(state.cursor, "20");
  assert.equal(state.pending?.done, 20);
  assert.equal(state.scannedAt, null, "not complete");

  fake.calls = [];
  const second = await runCostPass(ctxFor(fake));
  assert.equal(second.outcome, "done");
  assert.equal(second.resumed, true);
  assert.equal((fake.callsOf("WonSyncCostVariants")[0]!.variables as { after: string }).after, "20", "continues from the cursor");
  assert.equal(second.read, 10);
  assert.equal(fake.callsOf("WonSyncCostVariantsCount").length, 0, "the total is kept");
  assert.equal(state.pending?.token, (await db.prisma.variantCost.findFirst({ where: { shop, variantId: "gid://shopify/ProductVariant/1501" } }))!.scanId);
  assert.equal((await rows()).length, 30);
  const done = await loadCostState(db.prisma, shop);
  assert.equal(done.scannedAt?.toISOString(), state.pending!.since, "freshness = when the pass STARTED");
  assert.equal(done.cursor, null);
});

test("restart: an unfinished pass is not resumed when asked to start over (or when its cursor is older than a day)", async () => {
  const fake = new FakeShopify();
  fake.pageSize = 10;
  catalogue(fake, 15);
  let calls = 0;
  await runCostPass({ ...ctxFor(fake, { isCancelled: () => calls++ > 3 }) });
  assert.ok((await loadCostState(db.prisma, shop)).cursor !== null);
  fake.calls = [];
  const restarted = await runCostPass({ ...ctxFor(fake), restart: true });
  assert.equal(restarted.resumed, false);
  assert.equal((fake.callsOf("WonSyncCostVariants")[0]!.variables as { after: string | null }).after, null);

  let n = 0;
  await runCostPass({ ...ctxFor(fake, { isCancelled: () => n++ > 3 }), restart: true });
  const later = new Date(NOW.getTime() + 25 * 60 * 60_000);
  fake.calls = [];
  const stale = await runCostPass(ctxFor(fake, { now: () => later }));
  assert.equal(stale.resumed, false);
});

test("API-3: throttled reads and a 5xx on a write are retried with backoff; the pass still completes", async () => {
  const fake = new FakeShopify();
  catalogue(fake, 4);
  fake.fail("WonSyncCostVariants", { throttled: true }, 2);
  fake.fail("WonSyncMetafieldsSet", { transport: 503 }, 1);
  const sleeps: number[] = [];
  const result = await runCostPass(ctxFor(fake, { sleeps }));
  assert.equal(result.outcome, "done", JSON.stringify(result.errors));
  assert.deepEqual(sleeps, [100, 200, 100]);
  assert.deepEqual(fake.variantCostMetafield("gid://shopify/ProductVariant/402"), { cost: 4.5, cur: "CZK" });
});

test("one refused variant: its batch is split per variant, the other 24 are written, the refusal is recorded, the pass completes", async () => {
  const fake = new FakeShopify();
  catalogue(fake, 30); // 30 variants with a cost: batches of 25 + 5
  const refused = "gid://shopify/ProductVariant/402";
  fake.refusedOwners.add(refused);
  const result = await runCostPass(ctxFor(fake));
  assert.equal(result.outcome, "done", JSON.stringify(result.errors));
  assert.equal(result.refused, 1);
  assert.equal(result.written, 29);
  const sizes = setCalls(fake).map((mfs) => mfs.length);
  assert.deepEqual(sizes.slice(0, 1), [25], "the first batch went out whole");
  assert.equal(sizes.filter((n) => n === 1).length, 25, "then one call per variant of the refused batch");
  assert.equal(fake.variantCostMetafield(refused), undefined);
  assert.deepEqual(fake.variantCostMetafield("gid://shopify/ProductVariant/401"), { cost: 4.5, cur: "CZK" });
  const row = (await rows()).find((r) => r.variantId === refused)!;
  assert.match(row.writeError ?? "", /Value is invalid/);
  assert.equal(row.writeFailedAt?.toISOString(), NOW.toISOString());
  assert.equal(row.metafieldValue, null, "only confirmed values");
  assert.equal(row.mayCarry, false, "refused = nothing applied");
  const state = await loadCostState(db.prisma, shop);
  assert.equal(state.scannedAt?.toISOString(), NOW.toISOString(), "the pass counts as complete");
  assert.equal(state.pending, null);

  // Within the back-off it is not re-sent; after it (or when the merchant asks) it is, and a success clears the record.
  fake.calls = [];
  await runCostPass(ctxFor(fake, { now: () => new Date(NOW.getTime() + 10 * 60_000) }));
  assert.equal(setCalls(fake).length, 0, "backed off");
  fake.refusedOwners.clear();
  await runCostPass({ ...ctxFor(fake, { now: () => new Date(NOW.getTime() + 20 * 60_000) }), restart: true });
  assert.deepEqual(setCalls(fake).flat().map((mf) => mf.ownerId), [refused], "Obnovit retries it");
  const fixed = (await rows()).find((r) => r.variantId === refused)!;
  assert.equal(fixed.writeError, null);
  assert.equal(fixed.metafieldValue, '{"cost":4.5,"cur":"CZK"}');
});

test("a write whose answer is lost (5xx after every retry): the value is NOT claimed, the variant stays marked for a clear", async () => {
  const fake = new FakeShopify();
  catalogue(fake, 2);
  fake.fail("WonSyncMetafieldsSet", { transportAfterApply: 503 }, 4);
  const result = await runCostPass(ctxFor(fake));
  assert.equal(result.outcome, "failed", "a call failed as a whole");
  const row = (await rows()).find((r) => r.variantId === "gid://shopify/ProductVariant/201")!;
  assert.equal(row.metafieldValue, null, "never a value Shopify did not confirm");
  assert.equal(row.mayCarry, true, "it may have landed");
  assert.deepEqual(fake.variantCostMetafield("gid://shopify/ProductVariant/201"), { cost: 2.5, cur: "CZK" }, "(it did land)");
  const cleared = await clearCostMirror(ctxFor(fake));
  assert.equal(cleared.outcome, "done");
  assert.equal(fake.variantCostMetafield("gid://shopify/ProductVariant/201"), undefined, "the clear found it through the marker");
});

test("a read that shows the metafield confirms it; a usable cost only (0 is no cost)", async () => {
  const fake = new FakeShopify();
  const product = fake.addProduct(1, 2);
  fake.setCost(product.variantIds[0]!, "0.00");
  fake.setCost(product.variantIds[1]!, "3.00");
  await runCostPass(ctxFor(fake));
  const [zero, three] = await rows();
  assert.deepEqual([zero!.cost, zero!.currency, zero!.metafieldValue, zero!.mayCarry], [null, null, null, false]);
  assert.deepEqual([three!.cost, three!.currency, three!.metafieldValue, three!.mayCarry], ["3.00", "CZK", '{"cost":3,"cur":"CZK"}', true]);
});

test("a read that keeps failing ends the pass as failed (never throws)", async () => {
  const fake = new FakeShopify();
  catalogue(fake, 2);
  fake.fail("WonSyncCostVariants", { graphqlError: "Access denied for productVariants field" }, 1);
  const result = await runCostPass(ctxFor(fake));
  assert.equal(result.outcome, "failed");
  assert.match((await loadCostState(db.prisma, shop)).pending?.error ?? "", /Access denied/);
});

test("inventory_items/update mirror: the item's variant is re-read and only its metafield written; idempotent; unknown items ignored", async () => {
  const fake = new FakeShopify();
  catalogue(fake, 2);
  await runCostPass(ctxFor(fake));
  fake.setCost("gid://shopify/ProductVariant/101", "4.00");
  fake.calls = [];
  const once = await mirrorInventoryItems(ctxFor(fake), ["gid://shopify/InventoryItem/101", "gid://shopify/InventoryItem/101"]);
  assert.equal(once.written, 1);
  assert.deepEqual(setCalls(fake).flat().map((mf) => mf.ownerId), ["gid://shopify/ProductVariant/101"]);
  assert.deepEqual(fake.variantCostMetafield("gid://shopify/ProductVariant/101"), { cost: 4, cur: "CZK" });
  assert.equal((await rows()).find((r) => r.variantId === "gid://shopify/ProductVariant/101")!.cost, "4.00");

  fake.calls = [];
  const twice = await mirrorInventoryItems(ctxFor(fake), ["gid://shopify/InventoryItem/101"]);
  assert.equal(twice.written, 0, "WBH-2: a repeated delivery changes nothing more");
  assert.equal(setCalls(fake).length, 0);

  const unknown = await mirrorInventoryItems(ctxFor(fake), ["gid://shopify/InventoryItem/999999"]);
  assert.deepEqual({ written: unknown.written, cleared: unknown.cleared, errors: unknown.errors }, { written: 0, cleared: 0, errors: [] });

  // A variant the mirror never saw (created after the last pass) is picked up by its item.
  const product = fake.products.get("gid://shopify/Product/1")!;
  fake.addVariant(product, "gid://shopify/ProductVariant/109");
  fake.setCost("gid://shopify/ProductVariant/109", "2.00");
  await mirrorInventoryItems(ctxFor(fake), ["gid://shopify/InventoryItem/109"]);
  assert.equal((await rows()).find((r) => r.variantId === "gid://shopify/ProductVariant/109")!.metafieldValue, '{"cost":2,"cur":"CZK"}');
});

test("products/create|update mirror: every variant of the product; a removed variant's row and a deleted product's rows go", async () => {
  const fake = new FakeShopify();
  const product = fake.addProduct(7, 3);
  fake.setCost(product.variantIds[0]!, "5.00");
  const first = await mirrorProducts(ctxFor(fake), [product.id]);
  assert.equal(first.written, 1);
  assert.equal((await rows()).length, 3);
  fake.deleteVariant(product.variantIds[2]!);
  const second = await mirrorProducts(ctxFor(fake), [product.id]);
  assert.equal(second.removed, 1);
  assert.equal((await rows()).length, 2);
  fake.products.delete(product.id);
  const gone = await mirrorProducts(ctxFor(fake), [product.id]);
  assert.equal(gone.removed, 2);
  assert.equal((await rows()).length, 0);
});

test("switched off: every metafield the sync wrote is deleted (≤ 250 per call), the rows and the pass bookkeeping go", async () => {
  const fake = new FakeShopify();
  catalogue(fake, 4);
  await runCostPass(ctxFor(fake));
  fake.calls = [];
  const cleared = await clearCostMirror(ctxFor(fake));
  assert.equal(cleared.outcome, "done");
  assert.equal(cleared.cleared, 4);
  assert.deepEqual(deleteCalls(fake).flat().map((mf) => mf.ownerId).sort(), [
    "gid://shopify/ProductVariant/201",
    "gid://shopify/ProductVariant/202",
    "gid://shopify/ProductVariant/401",
    "gid://shopify/ProductVariant/402",
  ]);
  assert.equal(fake.variantCostMetafield("gid://shopify/ProductVariant/201"), undefined);
  assert.equal((await rows()).length, 0);
  const state = await loadCostState(db.prisma, shop);
  assert.deepEqual(state, { scannedAt: null, cursor: null, pending: null });
});

test("a failed clear keeps the rows that still carry a value (the next clear retries them)", async () => {
  const fake = new FakeShopify();
  catalogue(fake, 2);
  await runCostPass(ctxFor(fake));
  fake.fail("WonSyncMetafieldsDelete", { userErrors: [{ message: "Internal error" }] }, 1);
  const cleared = await clearCostMirror(ctxFor(fake));
  assert.equal(cleared.outcome, "failed");
  assert.equal((await db.prisma.variantCost.count({ where: { shop, mayCarry: true } })), 2);
  const again = await clearCostMirror(ctxFor(fake));
  assert.equal(again.outcome, "done");
  assert.equal((await rows()).length, 0);
});

test("uninstall keeps only cost-free markers; a DELAYED uninstall after a reinstall still lets a switch-off clear what was written since", async () => {
  const { forgetShopifyState } = await import("../../../app/lib/sync/sync-state.server.ts");
  const fake = new FakeShopify();
  catalogue(fake, 2);
  await runCostPass(ctxFor(fake)); // after a (re)install: 2 variants carry the metafield, 2 do not
  await forgetShopifyState(db.prisma, shop); // the old uninstall's delivery arrives late
  const markers = await rows();
  assert.deepEqual(
    markers.map((r) => [r.variantId, r.mayCarry, r.cost, r.currency, r.metafieldValue]),
    [
      ["gid://shopify/ProductVariant/201", true, null, null, null],
      ["gid://shopify/ProductVariant/202", true, null, null, null],
    ],
    "no purchase cost kept; only the variants that may carry it",
  );
  assert.equal((await loadCostState(db.prisma, shop)).scannedAt, null, "the next pass re-reads Shopify");
  const cleared = await clearCostMirror(ctxFor(fake));
  assert.equal(cleared.cleared, 2);
  assert.equal(fake.variantCostMetafield("gid://shopify/ProductVariant/201"), undefined, "the live metafield written after the reinstall is gone");
});

test("a refused write on a variant that still carries an OLDER cost deletes that stale value (the ceiling applies), and is due for a retry after the back-off", async () => {
  const { costsDue, jobFor, ensureCostsFresh, costIdle } = await import("../../../app/lib/sync/cost-lane.server.ts");
  const { saveConfig } = await import("../../../app/lib/config.server.ts");
  const fake = new FakeShopify();
  catalogue(fake, 2);
  await runCostPass(ctxFor(fake)); // 201 carries {"cost":2.5}
  const variant = "gid://shopify/ProductVariant/201";
  fake.setCost(variant, "4.00");
  fake.refusedOwners.add(variant);
  const result = await runCostPass(ctxFor(fake));
  assert.equal(result.outcome, "done");
  assert.equal(fake.variantCostMetafield(variant), undefined, "the stale 2.5 is gone: checkout falls back to the ceiling");
  const row = (await rows()).find((r) => r.variantId === variant)!;
  assert.deepEqual([row.metafieldValue, row.mayCarry], [null, false]);
  assert.match(row.writeError ?? "", /Value is invalid/);

  // Fresh pass, but the refused variant is due for a retry once its back-off has passed.
  assert.equal(await costsDue(db.prisma, shop, true, new Date(NOW.getTime() + 30 * 60_000)), null, "within the back-off");
  const later = new Date(NOW.getTime() + 61 * 60_000);
  assert.equal(await costsDue(db.prisma, shop, true, later), "retry");
  assert.deepEqual(await jobFor(db.prisma, shop, "retry", later), { kind: "items", inventoryItemIds: ["gid://shopify/InventoryItem/201"], retryRefused: true });

  // The retry (Přehled / reconcile) writes it once Shopify accepts it.
  await saveConfig(db.prisma, shop, { modules: { margin: { enabled: true, global: { maxDiscountPercent: 50 }, perCollection: [] } } });
  fake.refusedOwners.clear();
  const started = await ensureCostsFresh(shop, { client: fake, db: db.prisma, plan: async () => "free", now: () => later, sleep: async () => {} }, true);
  assert.equal(started, "started_retry");
  await costIdle(shop);
  assert.deepEqual(fake.variantCostMetafield(variant), { cost: 4, cur: "CZK" });
  assert.equal((await rows()).find((r) => r.variantId === variant)!.writeError, null);
  assert.equal(await costsDue(db.prisma, shop, true, later), null);
});

/** Pass 1 writes 201 = {"cost":2.5}; then its cost becomes 4 and Shopify refuses the write (pass 2 at NOW). */
async function refusedAfterOlderCost(fake: FakeShopify, opts: { failStaleDelete?: boolean } = {}) {
  catalogue(fake, 2);
  await runCostPass(ctxFor(fake));
  const variant = "gid://shopify/ProductVariant/201";
  fake.setCost(variant, "4.00");
  fake.refusedOwners.add(variant);
  if (opts.failStaleDelete) fake.fail("WonSyncMetafieldsDelete", { userErrors: [{ message: "Internal error" }] }, 1);
  const refused = await runCostPass(ctxFor(fake));
  return { variant, refused };
}

test("a backed-off write on a variant that still carries an older cost: a later pass (still in back-off) deletes the stale value the first pass could not", async () => {
  const fake = new FakeShopify();
  const { variant, refused } = await refusedAfterOlderCost(fake, { failStaleDelete: true });
  assert.equal(refused.outcome, "failed", "the stale delete failed");
  assert.deepEqual(fake.variantCostMetafield(variant), { cost: 2.5, cur: "CZK" }, "still live after pass 2");
  const writesOf = () => setCalls(fake).flat().filter((mf) => mf.ownerId === variant).length;
  const writesBefore = writesOf();

  // 20 minutes later, within the refusal's back-off: the write is not re-sent, but the older, different value goes.
  const next = await runCostPass(ctxFor(fake, { now: () => new Date(NOW.getTime() + 20 * 60_000) }));
  assert.equal(next.outcome, "done", JSON.stringify(next.errors));
  assert.equal(writesOf(), writesBefore, "backed off: no new write of 4");
  assert.equal(fake.variantCostMetafield(variant), undefined, "the stale 2.5 is gone: the stricter ceiling applies until the retry writes 4");
  const row = (await rows()).find((r) => r.variantId === variant)!;
  assert.deepEqual([row.metafieldValue, row.mayCarry], [null, false]);
  assert.match(row.writeError ?? "", /Value is invalid/, "the refusal stays recorded (retried after the back-off)");

  // A backed-off variant that carries nothing is left alone (no delete call).
  const deletesBefore = deleteCalls(fake).length;
  await runCostPass(ctxFor(fake, { now: () => new Date(NOW.getTime() + 25 * 60_000) }));
  assert.equal(deleteCalls(fake).length, deletesBefore);
});

/**
 * Margin protection as checkout runs it, for the refusal decision (audit P2-1b): global
 * min-margin / max-discount, one collection setting, and each product's marginRefs.
 */
function floorsOf(opts: { min?: number; max: number; col?: Record<string, [number | null, number | null]>; refs?: Record<string, unknown[]> }) {
  return {
    payload: { enabled: true as const, ...(opts.min !== undefined ? { min: opts.min } : {}), max: opts.max, ...(opts.col ? { col: opts.col } : {}) },
    marginRefs: async (productIds: readonly string[]) => new Map(productIds.map((id) => [id, opts.refs?.[id] ?? []])),
  };
}

/** Pass 1 writes 201 = {"cost": old}; its cost becomes `next` and Shopify refuses the write (pass 2, with `floors`). */
async function refusedWithFloors(fake: FakeShopify, old: string, next: string, floors: ReturnType<typeof floorsOf>) {
  const product = fake.addProduct(2, 1); // variant 201, price 10.00 CZK
  const variant = product.variantIds[0]!;
  fake.setCost(variant, old);
  await runCostPass(ctxFor(fake));
  fake.setCost(variant, next);
  fake.refusedOwners.add(variant);
  const result = await runCostPass({ ...ctxFor(fake), floors });
  return { variant, product, result };
}

test("refused higher cost: the OLDER cost stays when its floor is stricter than the percent floor at the current price", async () => {
  const fake = new FakeShopify();
  // Price 10.00: old cost 8 → floor 8.00; the 50 % ceiling → floor 5.00. The older cost is stricter: it stays.
  const { variant, result } = await refusedWithFloors(fake, "8.00", "9.00", floorsOf({ max: 50 }));
  assert.equal(result.outcome, "done", JSON.stringify(result.errors));
  assert.deepEqual(fake.variantCostMetafield(variant), { cost: 8, cur: "CZK" }, "kept: stricter than the ceiling");
  const row = (await rows()).find((r) => r.variantId === variant)!;
  assert.deepEqual([row.metafieldValue ? JSON.parse(row.metafieldValue) : null, row.mayCarry], [{ cost: 8, cur: "CZK" }, true]);
  assert.match(row.writeError ?? "", /Value is invalid/, "the refusal stays recorded and is retried");
  // Later passes in the back-off keep it too (no delete call for it).
  const deletes = deleteCalls(fake).flat().filter((mf) => mf.ownerId === variant).length;
  await runCostPass({ ...ctxFor(fake, { now: () => new Date(NOW.getTime() + 20 * 60_000) }), floors: floorsOf({ max: 50 }) });
  assert.equal(deleteCalls(fake).flat().filter((mf) => mf.ownerId === variant).length, deletes);
  assert.deepEqual(fake.variantCostMetafield(variant), { cost: 8, cur: "CZK" });
});

test("refused higher cost: the older cost goes when the percent floor is the stricter one (global, or the product's collection setting)", async () => {
  // Old cost 2.5 → floor 2.50 < the 50 % ceiling's 5.00: deleted (the ceiling applies).
  const global = new FakeShopify();
  const low = await refusedWithFloors(global, "2.50", "4.00", floorsOf({ max: 50 }));
  assert.equal(global.variantCostMetafield(low.variant), undefined);
  // Old cost 8 with min margin 0 → floor 8.00; the product's collection allows at most 10 % off → floor 9.00: the ceiling is stricter.
  shop = `${shop}-collection`; // a shop of its own: the rows (and the refusal's back-off) are per shop
  const collection = new FakeShopify();
  const product = "gid://shopify/Product/2";
  const inCollection = await refusedWithFloors(collection, "8.00", "9.00", floorsOf({ max: 50, col: { "5": [null, 10] }, refs: { [product]: ["5"] } }));
  assert.equal(collection.variantCostMetafield(inCollection.variant), undefined, "the collection's 10 % ceiling (floor 9.00) beats the older cost's 8.00");
  // A minimum margin raises the cost floor: 8 / (1 − 0.2) = 10.00 ≥ 9.00 → kept.
  shop = `${shop}-margin`;
  const margin = new FakeShopify();
  const kept = await refusedWithFloors(margin, "8.00", "9.00", floorsOf({ min: 20, max: 50, col: { "5": [null, 10] }, refs: { [product]: ["5"] } }));
  assert.deepEqual(margin.variantCostMetafield(kept.variant), { cost: 8, cur: "CZK" });
});

test("refused higher cost: a product listing more than 4 marginRefs is judged by the store's strictest setting, as at checkout (junk entries count)", async () => {
  // Collection 5: at most 10 % off; 6: at most 90 %. Old cost 8 → floor 8.00.
  const product = "gid://shopify/Product/2";
  const col = { "5": [null, 10] as [null, number], "6": [null, 90] as [null, number] };
  // Its one collection (6) → the 90 % ceiling's floor 1.00: the older cost is stricter and stays.
  shop = `${shop}-one`;
  const one = new FakeShopify();
  const kept = await refusedWithFloors(one, "8.00", "9.00", floorsOf({ max: 50, col, refs: { [product]: ["6"] } }));
  assert.deepEqual(one.variantCostMetafield(kept.variant), { cost: 8, cur: "CZK" });
  // 5 entries (collection 6 and junk): the strictest of the store, 10 % → floor 9.00 beats 8.00: deleted.
  shop = `${shop}-five`;
  const five = new FakeShopify();
  const gone = await refusedWithFloors(five, "8.00", "9.00", floorsOf({ max: 50, col, refs: { [product]: ["6", 7, null, "6", "6"] } }));
  assert.equal(five.variantCostMetafield(gone.variant), undefined, "judged by the strictest setting (10 %), not collection 6 (90 %)");
});

test("a refused-variant retry that fails before touching its rows is recorded: not re-queued on every load, due again after the back-off", async () => {
  const { costsDue, ensureCostsFresh, costIdle } = await import("../../../app/lib/sync/cost-lane.server.ts");
  const { saveConfig } = await import("../../../app/lib/config.server.ts");
  const fake = new FakeShopify();
  const { variant } = await refusedAfterOlderCost(fake);
  await saveConfig(db.prisma, shop, { modules: { margin: { enabled: true, global: { maxDiscountPercent: 50 }, perCollection: [] } } });
  const later = new Date(NOW.getTime() + 61 * 60_000);
  const deps = (now: Date) => ({ client: fake, db: db.prisma, plan: async () => "free" as const, now: () => now, sleep: async () => {}, logger: quiet });
  assert.equal(await costsDue(db.prisma, shop, true, later), "retry");

  // The retry's read fails as a whole: the job never reaches the variant's row.
  fake.fail("WonSyncCostInventoryItems", { graphqlError: "Internal error" }, 1);
  assert.equal(await ensureCostsFresh(shop, deps(later), true), "started_retry");
  await costIdle(shop);
  assert.equal(fake.callsOf("WonSyncCostInventoryItems").length, 1);
  assert.equal(await costsDue(db.prisma, shop, true, later), null, "the attempt counts: not due again at once");
  assert.equal(await ensureCostsFresh(shop, deps(new Date(later.getTime() + 5 * 60_000)), true), "up_to_date", "the next Přehled load queues nothing");
  assert.equal(await costsDue(db.prisma, shop, true, new Date(later.getTime() + 30 * 60_000)), null, "within the back-off of the attempt");
  assert.equal(fake.callsOf("WonSyncCostInventoryItems").length, 1, "no second job");

  // Once the back-off of the attempt has passed it is due again, and a retry Shopify accepts writes the cost.
  const next = new Date(later.getTime() + 61 * 60_000);
  assert.equal(await costsDue(db.prisma, shop, true, next), "retry");
  fake.refusedOwners.clear();
  assert.equal(await ensureCostsFresh(shop, deps(next), true), "started_retry");
  await costIdle(shop);
  assert.deepEqual(fake.variantCostMetafield(variant), { cost: 4, cur: "CZK" });
  assert.equal((await rows()).find((r) => r.variantId === variant)!.writeError, null);
});

test("two simultaneous loads queue ONE job (the shop is claimed before the first await)", async () => {
  const { ensureCostsFresh, costIdle } = await import("../../../app/lib/sync/cost-lane.server.ts");
  const { saveConfig } = await import("../../../app/lib/config.server.ts");
  const fake = new FakeShopify();
  await refusedAfterOlderCost(fake);
  await saveConfig(db.prisma, shop, { modules: { margin: { enabled: true, global: { maxDiscountPercent: 50 }, perCollection: [] } } });
  const later = new Date(NOW.getTime() + 61 * 60_000);
  const deps = { client: fake, db: db.prisma, plan: async () => "free" as const, now: () => later, sleep: async () => {}, logger: quiet };
  const retry = await Promise.all([ensureCostsFresh(shop, deps, true), ensureCostsFresh(shop, deps, true)]);
  assert.deepEqual([...retry].sort(), ["running", "started_retry"]);
  await costIdle(shop);
  assert.equal(fake.callsOf("WonSyncCostInventoryItems").length, 1, "one retry job read the item");

  // The same for a full pass (none finished yet in a new shop).
  shop = `${shop}-full`;
  await saveConfig(db.prisma, shop, { modules: { margin: { enabled: true, global: { maxDiscountPercent: 50 }, perCollection: [] } } });
  const counts = fake.callsOf("WonSyncCostVariantsCount").length;
  const full = await Promise.all([ensureCostsFresh(shop, deps, true), ensureCostsFresh(shop, deps, true), ensureCostsFresh(shop, deps, true)]);
  assert.deepEqual([...full].sort(), ["running", "running", "started_full"]);
  await costIdle(shop);
  assert.equal(fake.callsOf("WonSyncCostVariantsCount").length, counts + 1, "one full pass ran");
});

test("no-op passes and mirrors never move updatedAt (the impact cache keys on it)", async () => {
  const fake = new FakeShopify();
  catalogue(fake, 3);
  await runCostPass(ctxFor(fake));
  const before = await db.prisma.variantCost.aggregate({ where: { shop }, _max: { updatedAt: true }, _count: { _all: true } });
  await new Promise((resolve) => setTimeout(resolve, 5));
  await runCostPass({ ...ctxFor(fake), restart: true });
  await mirrorProducts(ctxFor(fake), ["gid://shopify/Product/1", "gid://shopify/Product/2"]);
  await mirrorInventoryItems(ctxFor(fake), ["gid://shopify/InventoryItem/201"]);
  const after = await db.prisma.variantCost.aggregate({ where: { shop }, _max: { updatedAt: true }, _count: { _all: true } });
  assert.deepEqual(after, before);
  const token = (await loadCostState(db.prisma, shop)).scannedAt;
  assert.ok(token);
  const scanIds = new Set((await rows()).map((r) => r.scanId));
  assert.equal(scanIds.size, 1, "every row carries the newest pass's token (set without touching updatedAt)");
});

test("OQ3: products/update echoes of the mirror's own metafield writes end the loop — the re-read writes nothing", async () => {
  // Shopify may fire products/update for an app-owned variant metafield write (shopify.dev does not say it
  // does not); the echo cannot be told apart from a merchant edit (the payload has only id + updated_at),
  // so it is not filtered: the product's variants are re-read and diffed against what Shopify now holds.
  const fake = new FakeShopify();
  const products = catalogue(fake, 6);
  const first = await runCostPass(ctxFor(fake));
  assert.ok(first.written > 0);
  const setsBefore = setCalls(fake).length;
  const deletesBefore = deleteCalls(fake).length;
  const echo = await mirrorProducts(ctxFor(fake), products.map((p) => p.id));
  assert.deepEqual([echo.written, echo.cleared, echo.errors.length], [0, 0, 0]);
  assert.equal(setCalls(fake).length, setsBefore, "no write → no further echo");
  assert.equal(deleteCalls(fake).length, deletesBefore);
  // A collapsed queue (more than COST_QUEUE_MAX echoes) becomes one full pass: also no write.
  const again = await runCostPass(ctxFor(fake));
  assert.deepEqual([again.written, again.cleared], [0, 0]);
});
