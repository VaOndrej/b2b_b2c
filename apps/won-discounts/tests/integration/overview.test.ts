import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";

import { createElement } from "react";

import { loadConfig, saveConfig } from "../../app/lib/config.server.ts";
import { cachedNativeCodes, clearDetectionCache, forgetDetection } from "../../app/lib/integration/native.server.ts";
import { onboardingPage, overviewAction, overviewPage } from "../../app/lib/integration/pages.server.ts";
import { clearSignalCache } from "../../app/lib/ui-actions.server.ts";
import { loadSyncStatus } from "../../app/lib/sync/save-and-sync.server.ts";
import { OverviewScreen } from "../../app/components/screens/OverviewScreen.tsx";
import { createTestDatabase, type TestDatabase } from "../lib/test-db.ts";
import { basicNode, otherNode } from "../lib/native/fake-shopify.ts";
import { FakeStore, formOf, renderPage, testCtx, text } from "./helpers.ts";

// Přehled (integration step 2): the loader is the sync retry trigger
// (resyncIfPending) bounded by a deadline (REL-1), shows the real sync state
// with "Synchronizovat znovu", and the native discounts from a cached detection
// (movable with Přesunout, not-movable with their reason, conflicts).

let db: TestDatabase;
let seq = 0;
let shop: string;
before(() => {
  db = createTestDatabase("int-overview");
});
after(async () => {
  await db.drop();
});
beforeEach(() => {
  seq += 1;
  shop = `overview-${seq}.myshopify.com`;
  clearDetectionCache();
  clearSignalCache();
});

const PAGE = { scopes: "write_discounts,read_products,read_themes,read_markets" };

const auto = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  enabled: true,
  name: `Sleva ${id}`,
  method: "automatic",
  value: { kind: "percentage", percent: 10 },
  target: { kind: "order" },
  ...extra,
});

async function seed(rules: unknown[]) {
  const saved = await saveConfig(db.prisma, shop, { modules: { codes: { rules } } });
  assert.equal(saved.ok, true);
}

test("a saved config that never reached Shopify is synced by the Přehled load; the rule then 'Běží'", async () => {
  await seed([auto("a1")]);
  const store = new FakeStore();
  const props = await overviewPage(testCtx(db.prisma, shop, store), PAGE);
  assert.equal(props.signals?.sync.state, "ok", JSON.stringify(props.signals?.sync));
  assert.deepEqual(props.ruleSync, { a1: "synced" });
  assert.ok(store.sync.shopMetafieldValue("function_config"), "the shop config was written");
  const html = text(await renderPage(createElement(OverviewScreen, props)));
  assert.match(html, /Synchronizováno 28\. 9\. 2026|Synchronizováno \d+\. \d+\. \d{4} \d{2}:\d{2}/);
  assert.match(html, /1 sleva · 1 běží/);
  assert.doesNotMatch(html, /Synchronizovat znovu/);
});

test("REL-1: a slow Shopify does not hold the page — 'synchronizace právě běží', the sync finishes in the background", async () => {
  await seed([auto("a1")]);
  const store = new FakeStore();
  store.delayMs = 40;
  const started = Date.now();
  const props = await overviewPage(testCtx(db.prisma, shop, store), { ...PAGE, syncDeadlineMs: 20, nativeDeadlineMs: 20 });
  assert.ok(Date.now() - started < 1500, `rendered in ${Date.now() - started} ms`);
  assert.equal(props.signals?.sync.state, "running");
  assert.equal(props.signals?.native.state, "loading");
  const html = text(await renderPage(createElement(OverviewScreen, props)));
  assert.match(html, /Synchronizace právě běží/);
  assert.match(html, /Slevy v Shopify se ještě načítají/);

  // The background resync finishes: the next load sees it (and does not resync again).
  for (let i = 0; i < 200 && !(await loadSyncStatus(db.prisma, shop)); i++) await new Promise((r) => setTimeout(r, 20));
  store.delayMs = 0;
  const next = await overviewPage(testCtx(db.prisma, shop, store), PAGE);
  assert.equal(next.signals?.sync.state, "ok");
});

test("a failed sync: the problem in words + 'Synchronizovat znovu'; the button resyncs and reports it", async () => {
  await seed([auto("a1")]);
  const store = new FakeStore();
  store.sync.fail("WonSyncMetafieldsSet", { graphqlError: "Internal error" }, 50);
  const ctx = testCtx(db.prisma, shop, store);
  const props = await overviewPage(ctx, PAGE);
  assert.equal(props.signals?.sync.state, "error");
  assert.deepEqual(props.ruleSync, { a1: "failed" });
  const html = text(await renderPage(createElement(OverviewScreen, props)));
  assert.match(html, /Synchronizace selhala/);
  assert.match(html, /Nové nastavení slev se do pokladny zatím nezapsalo, platí předchozí \(could not write the shop config/);
  assert.match(html, /Synchronizovat znovu/);
  assert.match(html, /Nepropsáno/);

  // Still failing → an honest refusal with the problems.
  const again = await overviewAction(ctx, formOf([["intent", "resync"]]));
  assert.ok(!again.ok && again.reason === "sync_failed" && again.problems.length > 0, JSON.stringify(again));

  // Shopify recovers → "Synchronizováno", the rule runs.
  (store.sync as unknown as { failures: Map<string, unknown[]> }).failures.clear();
  const fixed = await overviewAction(ctx, formOf([["intent", "resync"]]));
  assert.deepEqual(fixed, { ok: true, message: "synced", sync: { ok: true, problems: [], warnings: [] } });
  const after = await overviewPage(ctx, PAGE);
  assert.equal(after.signals?.sync.state, "ok");
  assert.deepEqual(after.ruleSync, { a1: "synced" });
});

test("an unreadable stored config is never synced (it would delete every Won discount): the sync line says why", async () => {
  await db.prisma.shopConfig.create({ data: { shop, schemaVersion: 1, data: "not json" } });
  const store = new FakeStore();
  const props = await overviewPage(testCtx(db.prisma, shop, store), PAGE);
  assert.deepEqual(props.signals?.sync, { state: "blocked", reason: "unreadable_config" });
  assert.equal(store.ops.filter((op) => op.startsWith("WonSync")).length, 0);
  assert.match(text(await renderPage(createElement(OverviewScreen, props))), /Uložené nastavení nejde přečíst/);
  assert.deepEqual(await overviewAction(testCtx(db.prisma, shop, store), formOf([["intent", "resync"]])), {
    ok: false,
    reason: "unreadable_config",
  });
});

test("native discounts: movable ones with what a move loses (planMove), BXGY with its reason, conflicts; detection cached", async () => {
  await seed([{ ...auto("won-code"), method: "code", codes: ["LETO15"] }]);
  const store = new FakeStore();
  store.native.add(basicNode({ title: "LETO15", codes: ["LETO15"], percentage: 0.15, used: 42, usageLimit: 100, oncePerCustomer: true }));
  store.native.add(otherNode("DiscountAutomaticBxgy", { title: "Kup 2, třetí zdarma" }));
  const ctx = testCtx(db.prisma, shop, store);

  const props = await overviewPage(ctx, PAGE);
  const native = props.signals?.native;
  assert.equal(native?.state, "ok");
  assert.ok(native?.state === "ok");
  const leto = native.discounts.find((d) => d.title === "LETO15");
  assert.equal(leto?.movable, true);
  assert.equal(leto?.code, "LETO15");
  assert.match(leto?.summary ?? "", /^15\u00a0% z objednávky$/, "the core formatter's wording");
  assert.ok(leto?.losses.some((l) => /zatím 42×/.test(l)), JSON.stringify(leto?.losses));
  assert.ok(leto?.warnings?.some((w) => /zbývajících 58/.test(w)), JSON.stringify(leto?.warnings));
  const bxgy = native.discounts.find((d) => d.title === "Kup 2, třetí zdarma");
  assert.equal(bxgy?.movable, false);
  assert.equal(bxgy?.blockedReason, "bxgy");
  assert.ok(bxgy?.reason);
  assert.equal(native.conflicts?.length, 1, "same code in Shopify and in Won");

  const html = text(await renderPage(createElement(OverviewScreen, props)));
  assert.match(html, /LETO15/);
  assert.match(html, /Přesunout/);
  assert.match(html, /Střetává se s Won/);
  assert.match(html, new RegExp(bxgy!.reason!.slice(0, 30).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));

  // The shop's native codes (hash-collision check of rule saves) are at hand per shop, whatever language detected them.
  assert.deepEqual(cachedNativeCodes(shop), ["LETO15"]);
  assert.deepEqual(cachedNativeCodes(shop, leto!.id), []);
  assert.equal(cachedNativeCodes("another-shop.myshopify.com"), undefined);

  const reads = store.ops.filter((op) => op === "WonNativeDiscounts").length;
  await overviewPage(ctx, PAGE);
  assert.equal(store.ops.filter((op) => op === "WonNativeDiscounts").length, reads, "second load within 60 s: from the cache");

  // Onboarding step 2 shows the same list (one Move button for all).
  const onboarding = await onboardingPage(ctx, { ...PAGE, fresh: false });
  assert.equal(onboarding.native.state, "ok");
  forgetDetection(shop);
  assert.equal(cachedNativeCodes(shop), undefined, "forgotten with the detection");
});

test("a detection failure is said, and never hides the undo of an earlier move", async () => {
  await seed([]);
  const store = new FakeStore();
  store.overrides.set("WonNativeDiscounts", () => ({ errors: [{ message: "Access denied for discountNodes field." }] }));
  await db.prisma.nativeDiscountBackup.create({
    data: { shop, nativeId: "gid://shopify/DiscountCodeNode/77", kind: "code_basic", title: "JARO10", snapshot: "{}", wonRuleId: "native-77", status: "moved" },
  });
  const props = await overviewPage(testCtx(db.prisma, shop, store), PAGE);
  assert.equal(props.signals?.native.state, "error");
  const html = text(await renderPage(createElement(OverviewScreen, props)));
  assert.match(html, /Slevy se nepodařilo načíst ze Shopify/);
  assert.match(html, /JARO10/);
  assert.match(html, /Vrátit zpět/);
  assert.deepEqual((await loadConfig(db.prisma, shop)).config.modules.codes.rules, []);
});

// --- Fix round 1, item 1: the Přehled GET trigger is locked and debounced -------------------

test("concurrent Přehled loads (prefetch + navigation) run ONE resync; the other renders 'synchronizace právě běží'", async () => {
  await seed([auto("a1")]);
  const store = new FakeStore();
  store.delayMs = 5;
  const ctx = testCtx(db.prisma, shop, store);
  const [a, b] = await Promise.all([overviewPage(ctx, PAGE), overviewPage(ctx, PAGE)]);
  assert.equal(await db.prisma.syncRun.count({ where: { shop } }), 1, "one resync for two loads");
  assert.deepEqual([a.signals?.sync.state, b.signals?.sync.state].sort(), ["ok", "running"]);
});

test("a Přehled load while a save holds the config lock does not resync (non-blocking): it says a sync is running", async () => {
  await seed([auto("a1")]);
  const store = new FakeStore();
  const ctx = testCtx(db.prisma, shop, store);
  const { withConfigLock } = await import("../../app/lib/integration/lock.server.ts");
  let release!: () => void;
  const held = withConfigLock(shop, () => new Promise<void>((resolve) => (release = resolve)));
  const props = await overviewPage(ctx, PAGE);
  assert.equal(props.signals?.sync.state, "running");
  assert.equal(await db.prisma.syncRun.count({ where: { shop } }), 0, "no resync next to the running save");
  release();
  await held;
});

test("Přehled reloads within 30 s never re-trigger a resync (debounce per shop), after 30 s they may", async () => {
  await seed([auto("a1")]);
  const store = new FakeStore();
  store.sync.fail("WonSyncMetafieldsSet", { graphqlError: "Internal error" }, 500);
  let clock = Date.now();
  const ctx = { ...testCtx(db.prisma, shop, store), now: () => new Date(clock) };
  await overviewPage(ctx, PAGE);
  assert.equal(await db.prisma.syncRun.count({ where: { shop } }), 1);
  // resyncIfPending's own 5-min retry interval has passed (failed run) …
  clock += 6 * 60_000;
  await overviewPage(ctx, PAGE);
  assert.equal(await db.prisma.syncRun.count({ where: { shop } }), 2, "retried once the interval passed");
  // … but a reload within 30 s of that retry is debounced, whatever resyncIfPending would say.
  await overviewPage(ctx, PAGE);
  await overviewPage(ctx, PAGE);
  assert.equal(await db.prisma.syncRun.count({ where: { shop } }), 2, "debounced");
  clock += 31_000;
  clock += 6 * 60_000;
  await overviewPage(ctx, PAGE);
  assert.equal(await db.prisma.syncRun.count({ where: { shop } }), 3);
});
