import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";

import { startOutletRun, type OutletDeps } from "../../../app/lib/integration/outlet.server.ts";
import {
  OUTLET_HISTORY_RETENTION_DAYS,
  pruneHistoryOnce,
  runDueTasks,
  runOutletDueOnce,
} from "../../../app/lib/jobs/scheduler.server.ts";
import { FakeShopify } from "../sync/fake-shopify.ts";
import { createTestDatabase, type TestDatabase } from "../test-db.ts";

// MVP 5 contract O8: the scheduler — persisted per-task state (JobState: a restart runs what came due while the
// process was down), the sale tasks (end by date, end a used-up quota a webhook could not end, retry a failed end,
// settle an interrupted start) and the history retention (sale events 400 days after the end; the config history,
// pruneExpiredConfigHistory, wired at last).

let db: TestDatabase;
let seq = 0;
let shop: string;
let clock: Date;
before(() => {
  db = createTestDatabase("scheduler");
});
after(async () => {
  await db.drop();
});
beforeEach(async () => {
  seq += 1;
  shop = `scheduler-${seq}.myshopify.com`;
  clock = new Date("2026-10-02T10:00:00Z");
  await db.prisma.jobState.deleteMany({});
});

function setup() {
  const fake = new FakeShopify();
  const product = fake.addProduct(40 + seq, 1);
  const variant = product.variantIds[0]!;
  fake.variants.get(variant)!.price = "20.00";
  const deps: OutletDeps = { shop, db: db.prisma, client: fake, plan: async () => "pro", now: () => clock, sleep: async () => {}, retry: { attempts: 1 } };
  const due = (extra: Partial<Parameters<typeof runOutletDueOnce>[0]> = {}) =>
    runOutletDueOnce({ db: db.prisma, clientFor: async () => fake, plan: async () => "pro", now: () => clock, outletDeps: { sleep: async () => {}, retry: { attempts: 1 } }, ...extra });
  return { fake, deps, product, variant, due };
}

test("runDueTasks: a task runs when it never ran or its interval passed; the state survives (a new process reads it)", async () => {
  const ran: string[] = [];
  const tasks = [
    { name: "a", everyMs: 60_000, run: async () => void ran.push("a") },
    { name: "b", everyMs: 24 * 3_600_000, run: async () => void ran.push("b") },
  ];
  await runDueTasks(db.prisma, tasks, clock);
  assert.deepEqual(ran, ["a", "b"]);
  await runDueTasks(db.prisma, tasks, new Date(clock.getTime() + 30_000));
  assert.deepEqual(ran, ["a", "b"], "nothing due yet");
  await runDueTasks(db.prisma, tasks, new Date(clock.getTime() + 61_000));
  assert.deepEqual(ran, ["a", "b", "a"]);
  assert.ok((await db.prisma.jobState.findUnique({ where: { name: "b" } }))?.lastRunAt);
});

test("runDueTasks: a failing task records its error and never stops the others", async () => {
  const ran: string[] = [];
  const results = await runDueTasks(
    db.prisma,
    [
      { name: "boom", everyMs: 1, run: async () => { throw new Error("nope"); } },
      { name: "ok", everyMs: 1, run: async () => void ran.push("ok") },
    ],
    clock,
  );
  assert.deepEqual(ran, ["ok"]);
  assert.equal(results.find((r) => r.name === "boom")?.error, "nope");
  assert.equal((await db.prisma.jobState.findUnique({ where: { name: "boom" } }))?.lastError, "nope");
});

test("outlet.due: a sale at its end date ends (prices back); one without a date or before it stays", async () => {
  const { fake, deps, product, variant, due } = setup();
  const r = await startOutletRun(deps, { variantId: variant, productId: product.id, quota: 5, percent: 25, endsAt: "2026-10-03T10:00:00Z", priceListIds: [] });
  assert.ok(r.ok);
  assert.equal(fake.variants.get(variant)!.price, "15.00");
  await due();
  assert.equal((await db.prisma.outletRun.findUnique({ where: { id: r.runId } }))!.status, "active");
  clock = new Date("2026-10-03T10:00:30Z");
  const result = await due();
  assert.deepEqual(result.ended, [r.runId]);
  const run = (await db.prisma.outletRun.findUnique({ where: { id: r.runId } }))!;
  assert.equal(run.status, "ended");
  assert.equal(run.endReason, "date");
  assert.equal(fake.variants.get(variant)!.price, "20.00");
});

test("outlet.due: a used-up quota a webhook could not end (no session then) is ended here", async () => {
  const { fake, deps, product, variant, due } = setup();
  const r = await startOutletRun(deps, { variantId: variant, productId: product.id, quota: 2, percent: 25, priceListIds: [] });
  assert.ok(r.ok);
  await db.prisma.outletRun.update({ where: { id: r.runId }, data: { sold: 2 } });
  await due();
  const run = (await db.prisma.outletRun.findUnique({ where: { id: r.runId } }))!;
  assert.equal(run.status, "ended");
  assert.equal(run.endReason, "quota");
  assert.equal(fake.variants.get(variant)!.price, "20.00");
});

test("outlet.due: a failed end is retried only after its next attempt time", async () => {
  const { fake, deps, product, variant, due } = setup();
  const r = await startOutletRun(deps, { variantId: variant, productId: product.id, quota: 5, percent: 25, priceListIds: [] });
  assert.ok(r.ok);
  await db.prisma.outletRun.update({ where: { id: r.runId }, data: { status: "ending", endReason: "manual", nextAttemptAt: new Date("2026-10-02T10:05:00Z") } });
  await due();
  assert.equal((await db.prisma.outletRun.findUnique({ where: { id: r.runId } }))!.status, "ending", "not yet");
  clock = new Date("2026-10-02T10:06:00Z");
  await due();
  assert.equal((await db.prisma.outletRun.findUnique({ where: { id: r.runId } }))!.status, "ended");
  assert.equal(fake.variants.get(variant)!.price, "20.00");
});

test("outlet.due: a start interrupted before its backup is closed (nothing was written); after it, prices go back", async () => {
  const { fake, product, variant, due } = setup();
  const stale = await db.prisma.outletRun.create({ data: { shop, productId: product.id, variantId: variant, quota: 1, percent: 10, status: "starting", createdAt: new Date("2026-10-02T09:00:00Z") } });
  await due();
  const closed = (await db.prisma.outletRun.findUnique({ where: { id: stale.id } }))!;
  assert.equal(closed.status, "ended");
  assert.match(closed.error ?? "", /interrupted/);

  fake.variants.get(variant)!.price = "18.00"; // written by the interrupted start
  const backup = { currency: "CZK", variant: { price: 2000, compareAt: null }, lists: [] };
  const sale = { currency: "CZK", variant: { price: 1800, compareAt: 2000 }, lists: [] };
  const half = await db.prisma.outletRun.create({
    data: { shop, productId: product.id, variantId: variant, quota: 1, percent: 10, status: "starting", createdAt: new Date("2026-10-02T09:00:00Z"), backup: JSON.stringify(backup), sale: JSON.stringify(sale) },
  });
  await due();
  assert.equal((await db.prisma.outletRun.findUnique({ where: { id: half.id } }))!.status, "ended");
  assert.equal(fake.variants.get(variant)!.price, "20.00");
});

test("outlet.due: a shop without a session is skipped, not failed", async () => {
  const { deps, product, variant, due } = setup();
  const r = await startOutletRun(deps, { variantId: variant, productId: product.id, quota: 5, percent: 25, endsAt: "2026-10-02T11:00:00Z", priceListIds: [] });
  assert.ok(r.ok);
  clock = new Date("2026-10-02T12:00:00Z");
  const result = await due({ clientFor: async () => null });
  assert.equal(result.skippedNoSession, 1);
  assert.equal((await db.prisma.outletRun.findUnique({ where: { id: r.runId } }))!.status, "active");
});

test("history.prune: sale events go 400 days after the sale ended (the sale row stays); old config versions go", async () => {
  const old = new Date(clock.getTime() - (OUTLET_HISTORY_RETENTION_DAYS + 1) * 86_400_000);
  const ended = await db.prisma.outletRun.create({ data: { shop, productId: "gid://shopify/Product/1", variantId: "gid://shopify/ProductVariant/1", quota: 1, percent: 10, status: "ended", endedAt: old } });
  const recent = await db.prisma.outletRun.create({ data: { shop, productId: "gid://shopify/Product/2", variantId: "gid://shopify/ProductVariant/2", quota: 1, percent: 10, status: "ended", endedAt: clock } });
  for (const run of [ended, recent]) await db.prisma.outletEvent.create({ data: { shop, runId: run.id, kind: "started", key: `started:${run.id}`, at: old } });
  await db.prisma.configVersion.create({ data: { shop, schemaVersion: 1, data: "{}", createdAt: old } });
  const result = await pruneHistoryOnce(db.prisma, clock);
  assert.equal(result.outletEvents, 1);
  assert.ok(result.configVersions >= 1);
  assert.equal(await db.prisma.outletEvent.count({ where: { runId: ended.id } }), 0);
  assert.equal(await db.prisma.outletEvent.count({ where: { runId: recent.id } }), 1);
  assert.equal(await db.prisma.outletRun.count({ where: { id: ended.id } }), 1);
});
