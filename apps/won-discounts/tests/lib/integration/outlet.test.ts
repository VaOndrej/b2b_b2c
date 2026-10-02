import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";

import { deleteShopData, saveConfig } from "../../../app/lib/config.server.ts";
import {
  endOutletRun,
  keepOutletEnded,
  recordOutletWebhook,
  reopenOutletRun,
  settleOutletWebhook,
  startOutletRun,
  type OutletDeps,
} from "../../../app/lib/integration/outlet.server.ts";
import { FakeShopify } from "../sync/fake-shopify.ts";
import { createTestDatabase, type TestDatabase } from "../test-db.ts";

// MVP 5 contracts O1–O9 (docs/plans/2026-10-02-won-discounts-mvp5.md): a sale on an existing variant, end to end
// against a fake Shopify and a real (migrated) test DB.

let db: TestDatabase;
let seq = 0;
let shop: string;
let clock: Date;
before(() => {
  db = createTestDatabase("outlet");
});
after(async () => {
  await db.drop();
});
beforeEach(() => {
  seq += 1;
  shop = `outlet-${seq}.myshopify.com`;
  clock = new Date("2026-10-02T10:00:00Z");
});

const LIST = "gid://shopify/PriceList/27005124849";

function setup(plan: "pro" | "free" = "pro") {
  const fake = new FakeShopify();
  const product = fake.addProduct(77, 2);
  const [small, large] = product.variantIds as [string, string];
  fake.variants.get(large)!.price = "18.00";
  fake.priceLists.set(LIST, { id: LIST, name: "česko", currency: "CZK", catalogTitle: "česko", fixed: new Map([[large, { price: "199.00", compareAt: null }]]) });
  const deps: OutletDeps = {
    shop,
    db: db.prisma,
    client: fake,
    plan: async () => plan,
    now: () => clock,
    sleep: async () => {},
    retry: { attempts: 1 },
  };
  return { fake, deps, product, small, large };
}

const draft = (variantId: string, productId: string, extra: Record<string, unknown> = {}) => ({ variantId, productId, quota: 5, percent: 50, priceListIds: [LIST], ...extra });
const events = async (runId: string) => (await db.prisma.outletEvent.findMany({ where: { runId }, orderBy: { at: "asc" } })).map((e) => e.kind);
const flag = (fake: FakeShopify, variantId: string) => fake.variants.get(variantId)!.metafields.get("$app:won_discounts/outlet")?.value;
const order = (id: number, variantId: string, quantity: number, lineId = id * 10, created = "2026-10-02T11:00:00Z") => ({
  id,
  created_at: created,
  line_items: [{ id: lineId, variant_id: Number(variantId.split("/").pop()), quantity }],
});

test("O4: start — backup first, the flag, the variant price (compareAt = the price before), the picked list's fixed price, the storefront value", async () => {
  const { fake, deps, product, large } = setup();
  const r = await startOutletRun(deps, draft(large, product.id));
  assert.ok(r.ok, JSON.stringify(r));
  const run = (await db.prisma.outletRun.findUnique({ where: { id: r.runId } }))!;
  assert.equal(run.status, "active");
  assert.deepEqual(JSON.parse(run.backup!), { currency: "CZK", variant: { price: 1800, compareAt: null }, lists: [{ id: LIST, currency: "CZK", price: 19900, compareAt: null }] });
  assert.equal(fake.variants.get(large)!.price, "9.00");
  assert.equal(fake.variants.get(large)!.compareAtPrice, "18.00");
  assert.deepEqual(fake.priceLists.get(LIST)!.fixed.get(large), { price: "99.50", compareAt: "199.00" });
  assert.equal(flag(fake, large), "true", "the variant's sale flag (the function's wonOutlet)");
  assert.equal(fake.productMetafield(product.id), undefined, "the sync's product metafield is not touched");
  const storefront = fake.products.get(product.id)!.metafields.get("$app:won_discounts/outlet");
  assert.deepEqual(JSON.parse(storefront!.value), { d: "strike_badge", v: { [large.split("/").pop()!]: 5 } });
  assert.deepEqual(await events(r.runId), ["started"]);
});

test("O4: the flag goes out BEFORE any price (a sale price never runs without it)", async () => {
  const { fake, deps, product, large } = setup();
  await startOutletRun(deps, draft(large, product.id));
  const ops = fake.calls.map((c) => c.op);
  assert.ok(ops.indexOf("WonSyncMetafieldsSet") < ops.indexOf("WonOutletVariantUpdate"));
});

test("O4: Free never starts a sale; one sale per variant; bounds come back as field errors", async () => {
  const free = setup("free");
  const r = await startOutletRun(free.deps, draft(free.large, free.product.id));
  assert.ok(!r.ok && r.reason === "invalid" && r.errors[0]!.key === "outlet.error.pro");
  assert.equal(free.fake.variants.get(free.large)!.price, "18.00");

  const { deps, product, large } = setup();
  assert.ok((await startOutletRun(deps, draft(large, product.id))).ok);
  const again = await startOutletRun(deps, draft(large, product.id));
  assert.ok(!again.ok && again.reason === "invalid" && again.errors[0]!.key === "outlet.error.running");
  const bad = await startOutletRun(deps, draft(large, product.id, { quota: 0, percent: 95 }));
  assert.ok(!bad.ok && bad.reason === "invalid");
});

test("O2/O3: `silent` keeps compareAt; a picked list without a fixed price for the variant is skipped and untouched", async () => {
  const { fake, deps, product, small } = setup();
  const saved = await saveConfig(db.prisma, shop, { modules: { outlet: { display: "silent" } } });
  assert.ok(saved.ok);
  const r = await startOutletRun(deps, draft(small, product.id, { percent: 30 }));
  assert.ok(r.ok);
  assert.deepEqual(r.skippedLists, [LIST]);
  assert.equal(fake.variants.get(small)!.price, "7.00");
  assert.equal(fake.variants.get(small)!.compareAtPrice ?? null, null, "silent: no strike");
  assert.ok(!fake.callsOf("WonOutletVariantUpdate").some((c) => JSON.stringify(c.variables).includes("compareAtPrice")));
  assert.equal(fake.callsOf("WonOutletFixedPrices").length, 0);
  assert.deepEqual(await events(r.runId), ["started", "price_list_skipped"]);
});

test("O4: a refused variant write leaves every price as it was, the flag gone, the sale ended with the error", async () => {
  const { fake, deps, product, large } = setup();
  fake.fail("WonOutletVariantUpdate", { userErrors: [{ field: ["price"], message: "Price is invalid" }] });
  const r = await startOutletRun(deps, draft(large, product.id));
  assert.ok(!r.ok && r.reason === "failed");
  assert.equal(fake.variants.get(large)!.price, "18.00");
  assert.equal(flag(fake, large), undefined, "flag removed again");
  const run = (await db.prisma.outletRun.findFirst({ where: { shop } }))!;
  assert.equal(run.status, "ended");
  assert.match(run.error!, /Price is invalid/);
  assert.deepEqual(await events(run.id), ["start_failed"]);
});

test("O4: a refused price list write after the variant was written undoes the variant (prices first, then the flag)", async () => {
  const { fake, deps, product, large } = setup();
  fake.fail("WonOutletFixedPrices", { userErrors: [{ message: "Catalog is locked" }] });
  const r = await startOutletRun(deps, draft(large, product.id));
  assert.ok(!r.ok);
  assert.equal(fake.variants.get(large)!.price, "18.00");
  assert.equal(fake.variants.get(large)!.compareAtPrice, null);
  assert.equal(flag(fake, large), undefined);
  const ops = fake.calls.map((c) => c.op);
  assert.ok(ops.lastIndexOf("WonOutletVariantUpdate") < ops.lastIndexOf("WonSyncMetafieldsDelete"), "prices back before the flag goes");
});

test("O5: a manual end restores every field still on sale, then drops the flag and the storefront value", async () => {
  const { fake, deps, product, large } = setup();
  const r = await startOutletRun(deps, draft(large, product.id));
  assert.ok(r.ok);
  const end = await endOutletRun(deps, r.runId, "manual");
  assert.ok(end.ok);
  assert.equal(fake.variants.get(large)!.price, "18.00");
  assert.equal(fake.variants.get(large)!.compareAtPrice, null);
  assert.deepEqual(fake.priceLists.get(LIST)!.fixed.get(large), { price: "199.00", compareAt: null });
  assert.equal(flag(fake, large), undefined);
  assert.equal(fake.products.get(product.id)!.metafields.get("$app:won_discounts/outlet"), undefined);
  const run = (await db.prisma.outletRun.findUnique({ where: { id: r.runId } }))!;
  assert.equal(run.status, "ended");
  assert.equal(run.endReason, "manual");
  const ops = fake.calls.map((c) => c.op);
  assert.ok(ops.lastIndexOf("WonOutletFixedPrices") < ops.lastIndexOf("WonSyncMetafieldsDelete"));
  assert.ok((await endOutletRun(deps, r.runId, "manual")).ok, "ending twice is a no-op");
});

test("O5: a price changed outside the app during the sale is kept (recorded), the rest restored", async () => {
  const { fake, deps, product, large } = setup();
  const r = await startOutletRun(deps, draft(large, product.id));
  assert.ok(r.ok);
  fake.variants.get(large)!.price = "7.00"; // the merchant lowered it further by hand
  await endOutletRun(deps, r.runId, "manual");
  assert.equal(fake.variants.get(large)!.price, "7.00");
  assert.equal(fake.variants.get(large)!.compareAtPrice, null, "compareAt still ours: back to none");
  const kinds = await events(r.runId);
  assert.ok(kinds.includes("price_kept") && kinds.includes("price_restored"));
});

test("O5: an end that fails stays `ending` (flag kept, next attempt scheduled) and a retry finishes it", async () => {
  const { fake, deps, product, large } = setup();
  const r = await startOutletRun(deps, draft(large, product.id));
  assert.ok(r.ok);
  fake.fail("WonOutletVariant", { transport: 503 });
  const first = await endOutletRun(deps, r.runId, "date");
  assert.ok(!first.ok);
  let run = (await db.prisma.outletRun.findUnique({ where: { id: r.runId } }))!;
  assert.equal(run.status, "ending");
  assert.ok(run.nextAttemptAt && run.nextAttemptAt > clock);
  assert.equal(flag(fake, large), "true", "still on sale: still flagged");
  const second = await endOutletRun(deps, r.runId, "date");
  assert.ok(second.ok);
  run = (await db.prisma.outletRun.findUnique({ where: { id: r.runId } }))!;
  assert.equal(run.status, "ended");
  assert.equal(run.endReason, "date");
  assert.equal(fake.variants.get(large)!.price, "18.00");
});

test("O7: orders count pieces once per order line; the quota used up ends the sale (prices back); a late order is oversold, exactly", async () => {
  const { fake, deps, product, large } = setup();
  const r = await startOutletRun(deps, draft(large, product.id));
  assert.ok(r.ok);
  const first = await recordOutletWebhook(deps, "ORDERS_CREATE", order(1, large, 3));
  assert.equal(first.recorded, 1);
  assert.deepEqual(first.end, []);
  assert.equal((await recordOutletWebhook(deps, "ORDERS_CREATE", order(1, large, 3))).recorded, 0, "a repeated delivery changes nothing");
  const second = await recordOutletWebhook(deps, "ORDERS_CREATE", order(2, large, 2));
  assert.deepEqual(second.end, [r.runId]);
  clock = new Date("2026-10-02T11:30:00Z");
  await settleOutletWebhook(deps, second);
  assert.equal(fake.variants.get(large)!.price, "18.00");
  let run = (await db.prisma.outletRun.findUnique({ where: { id: r.runId } }))!;
  assert.equal(run.status, "ended");
  assert.equal(run.endReason, "quota");
  assert.equal(run.sold, 5);
  // An order placed while the price was on sale whose webhook arrives after the end: sold, and oversold by 1.
  clock = new Date("2026-10-02T12:00:00Z");
  const late = await recordOutletWebhook(deps, "ORDERS_CREATE", order(3, large, 1, 30, "2026-10-02T11:15:00Z"));
  assert.equal(late.recorded, 1);
  assert.deepEqual(late.end, [], "already ended");
  run = (await db.prisma.outletRun.findUnique({ where: { id: r.runId } }))!;
  assert.equal(run.sold, 6);
  assert.ok((await events(r.runId)).includes("oversold"));
  // An order placed after the end (full price) is not the sale's.
  const after = await recordOutletWebhook(deps, "ORDERS_CREATE", order(4, large, 1, 40, "2026-10-02T12:30:00Z"));
  assert.equal(after.recorded, 0);
});

test("O7: a sale past the quota while the end is still running is recorded as oversold", async () => {
  const { deps, product, large } = setup();
  const r = await startOutletRun(deps, draft(large, product.id, { quota: 2 }));
  assert.ok(r.ok);
  const a = await recordOutletWebhook(deps, "ORDERS_CREATE", order(1, large, 2));
  assert.deepEqual(a.end, [r.runId]);
  await db.prisma.outletRun.update({ where: { id: r.runId }, data: { status: "ending" } }); // the end is under way
  await recordOutletWebhook(deps, "ORDERS_CREATE", order(2, large, 1));
  const kinds = await events(r.runId);
  assert.ok(kinds.includes("oversold"));
  assert.equal((await db.prisma.outletRun.findUnique({ where: { id: r.runId } }))!.sold, 3);
});

test("O7: orders placed before the start and other variants are not counted", async () => {
  const { deps, product, large, small } = setup();
  const r = await startOutletRun(deps, draft(large, product.id));
  assert.ok(r.ok);
  assert.equal((await recordOutletWebhook(deps, "ORDERS_CREATE", order(1, large, 1, 10, "2026-10-01T09:00:00Z"))).recorded, 0);
  assert.equal((await recordOutletWebhook(deps, "ORDERS_CREATE", order(2, small, 1))).recorded, 0);
});

test("O7: a cancellation gives back what the line sold; a restocked refund at most what is left; no_restock nothing; repeats nothing", async () => {
  const { deps, product, large } = setup();
  const r = await startOutletRun(deps, draft(large, product.id));
  assert.ok(r.ok);
  await recordOutletWebhook(deps, "ORDERS_CREATE", order(1, large, 3));
  const refund = { id: 900, order_id: 1, refund_line_items: [{ id: 901, line_item_id: 10, quantity: 1, restock_type: "return" }] };
  assert.equal((await recordOutletWebhook(deps, "REFUNDS_CREATE", refund)).recorded, 1);
  assert.equal((await recordOutletWebhook(deps, "REFUNDS_CREATE", refund)).recorded, 0);
  const noRestock = { id: 902, order_id: 1, refund_line_items: [{ id: 903, line_item_id: 10, quantity: 1, restock_type: "no_restock" }] };
  assert.equal((await recordOutletWebhook(deps, "REFUNDS_CREATE", noRestock)).recorded, 0);
  const cancel = { id: 1, line_items: [{ id: 10, variant_id: 1, quantity: 3 }] };
  assert.equal((await recordOutletWebhook(deps, "ORDERS_CANCELLED", cancel)).recorded, 1);
  assert.equal((await recordOutletWebhook(deps, "ORDERS_CANCELLED", cancel)).recorded, 0);
  const run = (await db.prisma.outletRun.findUnique({ where: { id: r.runId } }))!;
  assert.equal(run.sold, 3);
  assert.equal(run.returned, 3, "1 refunded + 2 by the cancellation, never more than sold");
});

test("O7: a return after the end — `ask` waits for the merchant (reopen or keep), `auto` reopens on Pro, Free only records", async () => {
  const { fake, deps, product, large } = setup();
  const r = await startOutletRun(deps, draft(large, product.id, { quota: 1 }));
  assert.ok(r.ok);
  await settleOutletWebhook(deps, await recordOutletWebhook(deps, "ORDERS_CREATE", order(1, large, 1)));
  assert.equal((await db.prisma.outletRun.findUnique({ where: { id: r.runId } }))!.status, "ended");
  const ret = await recordOutletWebhook(deps, "ORDERS_CANCELLED", { id: 1, line_items: [{ id: 10, quantity: 1 }] });
  assert.deepEqual(ret.reopen, []);
  let run = (await db.prisma.outletRun.findUnique({ where: { id: r.runId } }))!;
  assert.equal(run.returnPending, 1, "default `ask`");
  fake.variants.get(large)!.price = "20.00"; // the price moved since: the reopen backs up the new one
  const reopened = await reopenOutletRun(deps, r.runId);
  assert.ok(reopened.ok, JSON.stringify(reopened));
  run = (await db.prisma.outletRun.findUnique({ where: { id: r.runId } }))!;
  assert.equal(run.status, "active");
  assert.equal(run.returnPending, 0);
  assert.equal(JSON.parse(run.backup!).variant.price, 2000);
  assert.equal(fake.variants.get(large)!.price, "10.00");
  await endOutletRun(deps, r.runId, "manual");
  assert.equal(fake.variants.get(large)!.price, "20.00");

  // auto (Pro) → reopen requested
  const saved = await saveConfig(db.prisma, shop, { modules: { outlet: { reopenOnReturnAfterEnd: "auto" } } });
  assert.ok(saved.ok);
  await recordOutletWebhook(deps, "ORDERS_CREATE", order(5, large, 1, 50, "2026-10-02T09:00:00Z")); // before the reopen: not counted
  const sold = await db.prisma.outletEvent.findFirst({ where: { key: "sale:1:10" } });
  assert.ok(sold);
  const refund = await recordOutletWebhook(deps, "REFUNDS_CREATE", { id: 7, order_id: 1, refund_line_items: [{ id: 8, line_item_id: 10, quantity: 1, restock_type: "return" }] });
  assert.equal(refund.recorded, 0, "that line was already given back by the cancellation");
  assert.ok(await keepOutletEnded(deps, r.runId));
});

test("O7: `auto` reopens on Pro; on Free a return after the end is only recorded (A6)", async () => {
  for (const plan of ["pro", "free"] as const) {
    seq += 1;
    shop = `outlet-auto-${seq}.myshopify.com`;
    const pro = setup("pro");
    const r = await startOutletRun(pro.deps, draft(pro.large, pro.product.id, { quota: 1 }));
    assert.ok(r.ok);
    await settleOutletWebhook(pro.deps, await recordOutletWebhook(pro.deps, "ORDERS_CREATE", order(1, pro.large, 1)));
    assert.ok((await saveConfig(db.prisma, shop, { modules: { outlet: { reopenOnReturnAfterEnd: "auto" } } })).ok);
    const deps = { ...pro.deps, plan: async () => plan };
    const ret = await recordOutletWebhook(deps, "ORDERS_CANCELLED", { id: 1, line_items: [{ id: 10, quantity: 1 }] });
    assert.deepEqual(ret.reopen, plan === "pro" ? [r.runId] : []);
    assert.equal((await db.prisma.outletRun.findUnique({ where: { id: r.runId } }))!.returnPending, 0);
  }
});

test("shop/redact erases the shop's sales and their history", async () => {
  const { deps, product, large } = setup();
  const r = await startOutletRun(deps, draft(large, product.id));
  assert.ok(r.ok);
  await deleteShopData(db.prisma, shop);
  assert.equal(await db.prisma.outletRun.count({ where: { shop } }), 0);
  assert.equal(await db.prisma.outletEvent.count({ where: { shop } }), 0);
});
