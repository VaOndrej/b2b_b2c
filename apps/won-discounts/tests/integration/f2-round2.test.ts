import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";

import { createElement } from "react";

import type { PrismaClient } from "../../app/generated/prisma/client.ts";
import type { AdminClient } from "../../app/lib/admin-client.server.ts";
import { loadConfig, saveConfig } from "../../app/lib/config.server.ts";
import { ConfigLockBusy, configLockIdle, isConfigLocked, withConfigLock } from "../../app/lib/integration/lock.server.ts";
import { clearDetectionCache, createSaveAndSync, moveNativeDiscounts } from "../../app/lib/integration/native.server.ts";
import { discountsPage, overviewAction, overviewPage, ruleEditorAction, ruleEditorPage, tryCartCompute } from "../../app/lib/integration/pages.server.ts";
import { clearResyncDebounce, loadRuleSync, whenOverviewIdle } from "../../app/lib/integration/sync-status.server.ts";
import { createTargetingRefresher } from "../../app/lib/integration/targeting.server.ts";
import { clearMarketCountryCache } from "../../app/lib/integration/try-cart.server.ts";
import { appliedPlanOf } from "../../app/lib/sync/runs.ts";
import { resyncIfPending } from "../../app/lib/sync/save-and-sync.server.ts";
import { loadShopSyncFacts, markTargetingStale, recordProductsSynced } from "../../app/lib/sync/sync-state.server.ts";
import { createSync, isSyncRunning, syncIdle } from "../../app/lib/sync/sync.server.ts";
import { productionSyncDeps } from "../../app/lib/sync/wiring.server.ts";
import { clearSignalCache, saveOnboarding } from "../../app/lib/ui-actions.server.ts";
import { FIELD } from "../../app/components/model/rule-form.ts";
import { DiscountsScreen } from "../../app/components/screens/DiscountsScreen.tsx";
import { createTestDatabase, type TestDatabase } from "../lib/test-db.ts";
import { basicNode } from "../lib/native/fake-shopify.ts";
import { FakeStore, formOf, quiet, renderPage, testCtx, text } from "./helpers.ts";

// F2 fix round 2 (f2-rereview.md), through the real admin / sync paths:
//   I-1  the targeting refresh never holds the config lock for a product pass
//        (webhook refresher, Přehled auto-refresh, "Obnovit produkty ve slevách": the pass is
//        queued in the sync queue, a newer save cancels it); every admin write
//        waits for the lock at most a deadline → an honest "busy"; while syncs
//        keep failing the Přehled refresh keeps the 5-min retry backoff;
//   I-2  the plan the LIVE shop config was built for is recorded; another plan
//        now (a pre-F2 Pro config on a Free shop, a downgrade) → resync, and
//        until then the admin / Try Cart say checkout still runs Pro settings;
//   M-2  a change during a product pass keeps the targeting stale;
//   M-3  a stale mark makes only collection rules "Propisuje se"; refreshes of
//        one shop at most every 5 min;
//   M-6  markets are read only with read_markets (native adapter, refresher);
//   plus: pruning always keeps the newest applying SyncRun.

let db: TestDatabase;
let seq = 0;
let shop: string;
before(() => {
  db = createTestDatabase("int-f2-round2");
});
after(async () => {
  await db.drop();
});
beforeEach(() => {
  seq += 1;
  shop = `f2-round2-${seq}.myshopify.com`;
  clearDetectionCache();
  clearSignalCache();
  clearResyncDebounce();
  clearMarketCountryCache();
});

const PAGE = { scopes: "write_discounts,read_products,write_products,read_themes,read_markets" };

const auto = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  enabled: true,
  name: `Sleva ${id}`,
  method: "automatic",
  value: { kind: "percentage", percent: 10 },
  target: { kind: "order" },
  ...extra,
});

async function seed(input: unknown) {
  const saved = await saveConfig(db.prisma, shop, input);
  assert.equal(saved.ok, true, JSON.stringify(saved));
}

async function settle() {
  await whenOverviewIdle(shop);
  await configLockIdle(shop);
  await syncIdle(shop);
}

const hold = () => {
  let release!: () => void;
  const held = withConfigLock(shop, () => new Promise<void>((resolve) => (release = resolve)));
  return { release: () => release(), held };
};

const saveForm = (percent: string): [string, string][] => [
  ["intent", "save"],
  [FIELD.name, "Sleva a1"],
  [FIELD.enabled, "on"],
  [FIELD.valueKind, "percentage"],
  [FIELD.percent, percent],
  [FIELD.target, "order"],
  [FIELD.method, "automatic"],
];

// --- I-1: lock waits have a deadline --------------------------------------------------------------

test("I-1: withConfigLock with waitMs rejects ConfigLockBusy when the lock stays held; the timed-out work never runs later", async () => {
  const { release, held } = hold();
  let ran = false;
  await assert.rejects(
    withConfigLock(shop, async () => {
      ran = true;
    }, { waitMs: 30 }),
    (error: unknown) => error instanceof ConfigLockBusy,
  );
  release();
  await held;
  await configLockIdle(shop);
  assert.equal(ran, false, "its turn came and was skipped");
  assert.equal(isConfigLocked(shop), false);
});

test("I-1: rule save, delete, onboarding and a native move answer 'busy' after the wait (nothing written), and the copy says so", async () => {
  await seed({ modules: { codes: { rules: [auto("a1")] } } });
  const store = new FakeStore();
  store.native.add(basicNode({ title: "JARO", codes: ["JARO"] }));
  const ctx = { ...testCtx(db.prisma, shop, store), lockWaitMs: 40 };
  const before = (await loadConfig(db.prisma, shop)).version;
  const { release, held } = hold();
  const started = Date.now();
  const save = await ruleEditorAction(ctx, formOf(saveForm("15")), "a1");
  const del = await ruleEditorAction(ctx, formOf([["intent", "delete"]]), "a1");
  const onboarding = await saveOnboarding(ctx, { step: 3 });
  const move = await moveNativeDiscounts(ctx, ["gid://shopify/DiscountCodeNode/1"]);
  assert.ok(Date.now() - started < 2_000, "no request hangs behind the writer");
  assert.deepEqual(save, { result: { ok: false, reason: "busy" } });
  assert.deepEqual(del, { result: { ok: false, reason: "busy" } });
  assert.deepEqual(onboarding, { ok: false, reason: "busy" });
  assert.deepEqual(move, { ok: false, reason: "busy" });
  release();
  await held;
  await configLockIdle(shop);
  assert.equal((await loadConfig(db.prisma, shop)).version, before, "nothing was written, not even later");
  const page = await ruleEditorPage(ctx, { ...PAGE, ruleId: "a1", recipe: null, saved: false });
  const { RuleEditorScreen } = await import("../../app/components/screens/RuleEditorScreen.tsx");
  const html = text(await renderPage(createElement(RuleEditorScreen, { ...page!, result: { ok: false, reason: "busy" } })));
  assert.match(html, /Nastavení se právě zapisuje do Shopify\. Zkuste to za chvíli, nic se neuložilo\./);
});

// --- I-1: the refresh paths never hold the lock for a product pass -----------------------------------

async function collectionShop(members = 60) {
  const store = new FakeStore();
  const products = Array.from({ length: members }, (_, i) => store.sync.addProduct(300 + i).id);
  const collection = store.sync.addCollection(31, products);
  store.sync.pageSize = 5; // many pages: a long pass
  await seed({ modules: { codes: { rules: [auto("c", { target: { kind: "collections", ids: [collection] } })] } } });
  return { store, products, collection };
}

test("I-1: 'Obnovit produkty ve slevách' answers at once and releases the lock; the pass runs in the sync queue and a save right after cancels it", async () => {
  const { store, products, collection } = await collectionShop();
  const ctx = testCtx(db.prisma, shop, store);
  await overviewPage(ctx, PAGE);
  await settle();

  store.sync.collections.set(collection, products.slice(0, 30)); // half of them left the collection
  store.delayMs = 5; // a slow Shopify: the pass takes a while
  const started = Date.now();
  const refreshed = await overviewAction(ctx, formOf([["intent", "refresh_targeting"]]));
  assert.deepEqual(refreshed.ok && refreshed.syncing, { targeting: true }, JSON.stringify(refreshed));
  assert.equal(isConfigLocked(shop), false, "the lock is free while the pass runs");
  assert.equal(isSyncRunning(shop), true, "the pass is queued / running");
  // A save goes through without waiting for the pass (the lock is free) and supersedes it.
  const save = await ruleEditorAction(
    ctx,
    formOf([
      ["intent", "save"],
      [FIELD.name, "Kolekce"],
      [FIELD.enabled, "on"],
      [FIELD.valueKind, "percentage"],
      [FIELD.percent, "20"],
      [FIELD.target, "collections"],
      [FIELD.collectionIds, collection],
      [FIELD.method, "automatic"],
    ]),
    "c",
  );
  assert.ok("result" in save && save.result.ok, JSON.stringify(save));
  assert.ok(Date.now() - started < 5_000, `answered in ${Date.now() - started} ms`);
  await settle();
  store.delayMs = 0;
  // Whatever the cancelled pass had done, the save's own sync left the refs right.
  for (const p of products.slice(0, 30)) assert.deepEqual(store.sync.productMetafield(p), { ruleIds: ["c"], variantRuleIds: {} });
  for (const p of products.slice(30)) assert.equal(store.sync.productMetafield(p), undefined);
});

test("I-1: the webhook refresher tries the lock (never waits), queues the product pass, and reschedules when a writer holds the lock", async () => {
  const { store, products, collection } = await collectionShop(10);
  const ctx = testCtx(db.prisma, shop, store);
  await overviewPage(ctx, PAGE);
  await settle();
  const refresher = createTargetingRefresher({
    db: db.prisma,
    clientFor: async () => ({ client: store, scopes: PAGE.scopes }),
    createSync: ctx.createSync,
    delayMs: 60_000,
    logger: quiet,
  });
  try {
    const { release, held } = hold();
    assert.deepEqual(await refresher.runNow(shop), { done: "locked" });
    assert.equal(refresher.scheduled(shop), true, "tried again after the debounce");
    release();
    await held;
    refresher.cancelAll();

    store.sync.collections.set(collection, products.slice(0, 5));
    const outcome = await refresher.runNow(shop);
    assert.equal(outcome.done, "refresh", JSON.stringify(outcome));
    assert.equal(isConfigLocked(shop), false, "the lock was held only for the decision");
    await syncIdle(shop);
    assert.equal(store.sync.productMetafield(products[9]!), undefined, "the queued pass ran: a product that left is cleared");
  } finally {
    refresher.cancelAll();
  }
});

test("I-1: while syncs keep failing, Přehled loads every 31 s run no full resync inside the 5-min backoff (targeting due or not)", async () => {
  const { store } = await collectionShop(3);
  store.sync.fail("WonSyncMetafieldsSet", { graphqlError: "Internal error" }, 1_000);
  let clock = Date.now();
  const ctx = { ...testCtx(db.prisma, shop, store), now: () => new Date(clock) };
  await overviewPage(ctx, PAGE);
  await settle();
  const runs = await db.prisma.syncRun.count({ where: { shop } });
  assert.equal(runs, 1);
  for (let i = 0; i < 5; i++) {
    clock += 31_000;
    await overviewPage(ctx, PAGE);
    await settle();
  }
  assert.equal(await db.prisma.syncRun.count({ where: { shop } }), 1, "no resync while backing off");
  clock += 5 * 60_000;
  await overviewPage(ctx, PAGE);
  await settle();
  assert.equal(await db.prisma.syncRun.count({ where: { shop } }), 2, "retried once the interval passed");
});

// --- I-2: the plan the live config was built for -----------------------------------------------------

const proSetup = {
  modules: {
    codes: {
      rules: [auto("base"), auto("stack", { name: "Sčítaná", combinesWith: { ruleIds: ["base"] } })],
    },
  },
};

/** A shop whose live config was written before the sync gated for plans (the dev store today). */
async function preF2ProShop() {
  await seed(proSetup);
  const store = new FakeStore();
  const proSync = (client: AdminClient, prisma: PrismaClient) =>
    createSync({ ...productionSyncDeps(client, prisma, quiet), sleep: async () => {}, plan: async () => "pro" });
  const loaded = await loadConfig(db.prisma, shop);
  const version = await db.prisma.configVersion.findFirst({ where: { shop }, orderBy: { createdAt: "desc" } });
  await proSync(store, db.prisma).syncShop(shop, loaded.config, { configVersionId: version!.id });
  // Before F2: no applied plan recorded, no plan step on the applying run.
  await db.prisma.shopSyncState.updateMany({ where: { shop }, data: { appliedPlan: null } });
  const run = await db.prisma.syncRun.findFirst({ where: { shop }, orderBy: { startedAt: "desc" } });
  const steps = (JSON.parse(run!.steps) as { step: string }[]).filter((s) => s.step !== "plan");
  await db.prisma.syncRun.update({ where: { id: run!.id }, data: { steps: JSON.stringify(steps) } });
  assert.match(store.sync.shopMetafieldValue("function_config")!, /combinesWith/, "Pro is live in checkout");
  return store;
}

test("I-2: a pre-F2 Pro config on a Free shop — the admin and Try Cart say checkout still runs it; the next Přehled load resyncs it away", async () => {
  const store = await preF2ProShop();
  const ctx = testCtx(db.prisma, shop, store);
  assert.equal(await appliedPlanOf(db.prisma, shop), "pro", "legacy applying run = ungated = Pro");

  const discounts = await discountsPage(ctx, { ...PAGE, deleted: false });
  assert.equal(discounts.gatePending, true);
  const html = text(await renderPage(createElement(DiscountsScreen, discounts)));
  assert.match(html, /V pokladně zatím běží starší nastavení s Pro funkcemi — zapisujeme…/);
  assert.doesNotMatch(html, /Tohle je v tarifu Pro, zákazník to nedostane/);
  assert.equal(discounts.ruleSync?.stack, "pending", "the combined rule is not 'Aktivní' as the plan wants it");

  const editor = await ruleEditorPage(ctx, { ...PAGE, ruleId: "stack", recipe: null, saved: false });
  assert.equal(editor?.gatePending, true);

  store.sync.addProduct(9);
  store.prices.set("gid://shopify/ProductVariant/901", { CZK: "100.00" });
  const run = await tryCartCompute(
    ctx,
    formOf([["intent", "run"], ["variantId", "gid://shopify/ProductVariant/901"], ["productId", "gid://shopify/Product/9"], ["quantity", "1"], ["currency", "CZK"]]),
    PAGE,
  );
  assert.ok(run.plan?.warnings?.some((w) => w.key === "tryCart.warning.planPending"), JSON.stringify(run.plan?.warnings));

  // Přehled: the plan mismatch is a reason to resync (not "up to date").
  const overview = await overviewPage(ctx, PAGE);
  await settle();
  assert.doesNotMatch(store.sync.shopMetafieldValue("function_config")!, /combinesWith/, "the Free config is live now");
  assert.equal(await appliedPlanOf(db.prisma, shop), "free");
  void overview;
  const after = await discountsPage(ctx, { ...PAGE, deleted: false });
  assert.equal(after.gatePending, undefined);
  assert.match(text(await renderPage(createElement(DiscountsScreen, after))), /Tohle je v tarifu Pro, zákazník to nedostane/);
});

test("I-2: a downgrade (config applied for Pro, the shop is Free now) → resyncIfPending resyncs with why 'plan'", async () => {
  await seed(proSetup);
  const store = new FakeStore();
  let plan: "free" | "pro" = "pro";
  const sync = (client: AdminClient, prisma: PrismaClient) =>
    createSync({ ...productionSyncDeps(client, prisma, quiet), sleep: async () => {}, plan: async () => plan });
  const common = { client: store, db: db.prisma, shop, createSync: sync, logger: quiet };
  assert.equal((await resyncIfPending(common)).resynced, true, "first sync");
  assert.equal((await loadShopSyncFacts(db.prisma, shop)).appliedPlan, "pro");
  assert.deepEqual(await resyncIfPending(common), { resynced: false, reason: "up_to_date" });
  plan = "free";
  const result = await resyncIfPending(common);
  assert.equal(result.resynced && result.why, "plan");
  assert.doesNotMatch(store.sync.shopMetafieldValue("function_config")!, /combinesWith/);
  assert.deepEqual(await resyncIfPending(common), { resynced: false, reason: "up_to_date" });
});

// --- M-2 / M-3 -------------------------------------------------------------------------------------

test("M-2: a change that lands while a pass runs keeps the targeting stale (the mark keeps the latest change)", async () => {
  const t1 = new Date("2026-09-28T10:00:00Z");
  const passStart = new Date("2026-09-28T10:01:00Z");
  const t2 = new Date("2026-09-28T10:02:00Z");
  await markTargetingStale(db.prisma, shop, "collections/update A", t1);
  await markTargetingStale(db.prisma, shop, "products/update B", t2);
  await markTargetingStale(db.prisma, shop, "late redelivery of A", t1);
  assert.deepEqual((await loadShopSyncFacts(db.prisma, shop)).targetingStaleAt, t2, "latest, never moved back");
  await recordProductsSynced(db.prisma, shop, passStart);
  assert.ok((await loadShopSyncFacts(db.prisma, shop)).targetingStaleAt, "B was not read by that pass: still stale");
  await recordProductsSynced(db.prisma, shop, new Date("2026-09-28T10:03:00Z"));
  assert.equal((await loadShopSyncFacts(db.prisma, shop)).targetingStaleAt, null);
});

test("M-3: a stale mark makes only collection rules 'Zapisuje se'; a rule on a product list stays 'Běží'", async () => {
  const store = new FakeStore();
  const p = store.sync.addProduct(1);
  const collection = store.sync.addCollection(7, [p.id]);
  await seed({
    modules: {
      codes: {
        rules: [
          auto("coll", { target: { kind: "collections", ids: [collection] } }),
          auto("list", { target: { kind: "products", productIds: [p.id], variantIds: [] } }),
        ],
      },
    },
  });
  const ctx = testCtx(db.prisma, shop, store);
  await overviewPage(ctx, PAGE);
  await settle();
  await markTargetingStale(db.prisma, shop, "products/update", new Date());
  const facts = await loadRuleSync(ctx, (await loadConfig(db.prisma, shop)).config);
  assert.deepEqual(facts, { coll: "refreshing", list: "synced" });
});

test("M-3: steady webhooks refresh one shop at most every TARGETING_MIN_INTERVAL_MS", async () => {
  const clock = 1_000_000;
  const store = new FakeStore();
  const refresher = createTargetingRefresher({
    db: db.prisma,
    clientFor: async () => ({ client: store, scopes: PAGE.scopes }),
    delayMs: 10,
    minIntervalMs: 60_000,
    now: () => new Date(clock),
    logger: quiet,
  });
  try {
    await seed({ modules: { codes: { rules: [] } } });
    await refresher.runNow(shop); // a refresh just ran
    refresher.schedule(shop);
    await new Promise((resolve) => setTimeout(resolve, 40));
    assert.equal(refresher.scheduled(shop), true, "not yet: the next one waits for the minimum interval, not the 10 ms debounce");
  } finally {
    refresher.cancelAll();
  }
});

// --- M-6: optional read_markets ---------------------------------------------------------------------

test("M-6: the native adapter reads markets only with read_markets", async () => {
  const store = new FakeStore();
  store.sync.markets = [{ handle: "cz", name: "Česko", status: "ACTIVE", currency: "CZK", countries: ["CZ"] }];
  const config = (await import("@won/core/discounts/config")).sanitizeConfig({
    markets: [{ handle: "cz", currency: "CZK", enabled: true, countries: ["CZ"] }],
    modules: { codes: { rules: [auto("m", { targeting: { markets: ["cz"] } })] } },
  }).config;
  const saveAndSync = createSaveAndSync({
    client: store,
    db: db.prisma,
    grantedScopes: "write_discounts,read_products,write_products,read_themes",
    createSync: testCtx(db.prisma, shop, store).createSync,
    logger: quiet,
  });
  await saveAndSync({ shop, config });
  assert.equal(store.ops.filter((op) => op === "WonSyncMarkets").length, 0);
});

// --- pruning ----------------------------------------------------------------------------------------

test("the newest applying SyncRun is never pruned by product refreshes (the 'Běží' facts and 'not applied' stay right)", async () => {
  const { store } = await collectionShop(2);
  const ctx = testCtx(db.prisma, shop, store);
  await overviewPage(ctx, PAGE);
  await settle();
  const { config } = await loadConfig(db.prisma, shop);
  const sync = ctx.createSync!(store, db.prisma);
  for (let i = 0; i < 25; i++) await sync.refreshProducts(shop, config);
  const runs = await db.prisma.syncRun.findMany({ where: { shop } });
  assert.equal(runs.length, 21, "20 newest + the applying one");
  assert.deepEqual(await loadRuleSync(ctx, config), { c: "synced" });
  assert.deepEqual(await resyncIfPending({ client: store, db: db.prisma, shop, createSync: ctx.createSync, logger: quiet }), {
    resynced: false,
    reason: "up_to_date",
  });
});

// --- Try Cart: the targeting warning only for carts that involve collection rules ---------------------

async function mixedTargetingShop() {
  const store = new FakeStore();
  const inCollection = store.sync.addProduct(1);
  const onList = store.sync.addProduct(2);
  const collection = store.sync.addCollection(7, [inCollection.id]);
  store.prices.set("gid://shopify/ProductVariant/101", { CZK: "1000.00" });
  store.prices.set("gid://shopify/ProductVariant/201", { CZK: "500.00" });
  await seed({
    modules: {
      codes: {
        rules: [
          auto("coll", { value: { kind: "percentage", percent: 20 }, target: { kind: "collections", ids: [collection] } }),
          auto("list", { value: { kind: "percentage", percent: 5 }, target: { kind: "products", productIds: [onList.id], variantIds: [] } }),
        ],
      },
    },
  });
  const ctx = testCtx(db.prisma, shop, store);
  await overviewPage(ctx, PAGE);
  await settle();
  await markTargetingStale(db.prisma, shop, "products/update", new Date());
  return { ctx, store, collection, inCollection, onList };
}

const cartOf = (variantId: string, productId: string) =>
  formOf([["intent", "run"], ["variantId", variantId], ["productId", productId], ["quantity", "1"], ["currency", "CZK"]]);

test("Try Cart: a cart of product-list products only gets NO 'cílení se obnovuje' warning while the targeting is stale", async () => {
  const { ctx, onList } = await mixedTargetingShop();
  const run = await tryCartCompute(ctx, cartOf("gid://shopify/ProductVariant/201", onList.id), PAGE);
  assert.equal(run.plan?.lines[0]?.discount, 25_00, "the list rule applies");
  assert.ok(!(run.plan?.warnings ?? []).some((w) => w.key === "tryCart.warning.targeting"), JSON.stringify(run.plan?.warnings));
});

test("Try Cart: a cart with a product a collection rule targets gets the warning while the targeting is stale", async () => {
  const { ctx, inCollection } = await mixedTargetingShop();
  const run = await tryCartCompute(ctx, cartOf("gid://shopify/ProductVariant/101", inCollection.id), PAGE);
  assert.equal(run.plan?.lines[0]?.discount, 200_00, "the collection rule applies");
  assert.ok((run.plan?.warnings ?? []).some((w) => w.key === "tryCart.warning.targeting"), JSON.stringify(run.plan?.warnings));
});

// --- Try Cart: live collection membership vs the refs checkout reads (stale targeting) -------------------

test("Try Cart: a FRESH JOINER — live in a targeted collection but without the rule's ref yet — gets the membership warning", async () => {
  const { ctx, store, collection, inCollection, onList } = await mixedTargetingShop();
  // In Shopify, the list product has just joined the targeted collection; checkout has no ref for it yet.
  store.sync.collections.set(collection, [inCollection.id, onList.id]);
  const run = await tryCartCompute(ctx, cartOf("gid://shopify/ProductVariant/201", onList.id), PAGE);
  assert.equal(run.plan?.lines[0]?.discount, 25_00, "checkout gives only the list rule for now");
  const warnings = run.plan?.warnings ?? [];
  assert.ok(warnings.some((w) => w.key === "tryCart.warning.membership"), JSON.stringify(warnings));
  assert.equal(store.calls.find((c) => c.op === "WonTryCartVariants")?.variables.withCollections, true, "live collections read while stale");
});

test("Try Cart: a LEAVER — carries a collection ref but has left the collection — gets the membership warning too", async () => {
  const { ctx, store, collection, inCollection } = await mixedTargetingShop();
  store.sync.collections.set(collection, []);
  const run = await tryCartCompute(ctx, cartOf("gid://shopify/ProductVariant/101", inCollection.id), PAGE);
  assert.equal(run.plan?.lines[0]?.discount, 200_00, "checkout still has the ref");
  assert.ok((run.plan?.warnings ?? []).some((w) => w.key === "tryCart.warning.membership"), JSON.stringify(run.plan?.warnings));
});

test("Try Cart: targeting fresh → no live collection read, no membership warning", async () => {
  const { ctx, store, onList } = await mixedTargetingShop();
  await db.prisma.shopSyncState.update({ where: { shop }, data: { targetingStaleAt: null } });
  const run = await tryCartCompute(ctx, cartOf("gid://shopify/ProductVariant/201", onList.id), PAGE);
  assert.ok(!(run.plan?.warnings ?? []).some((w) => w.key === "tryCart.warning.membership" || w.key === "tryCart.warning.targeting"));
  assert.equal(store.calls.find((c) => c.op === "WonTryCartVariants")?.variables.withCollections, false);
});
