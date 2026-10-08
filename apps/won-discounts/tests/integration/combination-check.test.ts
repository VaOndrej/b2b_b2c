// Kontrola kombinací (feedback 2026-10-06, bod 16), with the database: the check is planned after a save and once
// a day and STORED; the pages only read it. The products come from what the app has stored, Free gets the counts
// and nothing else, a scenario opens in the manual cart — and a page asks Shopify nothing for any of it.

import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";

import { milestoneRule } from "@won/core/discounts/milestones";

import type { PrismaClient } from "../../app/generated/prisma/client.ts";
import type { AdminClient } from "../../app/lib/admin-client.server.ts";
import { loadConfig, saveConfig } from "../../app/lib/config.server.ts";
import { combinationCheck, loadScenarioProducts, loadStoredCheck, refreshCombinationCheck } from "../../app/lib/integration/combination-check.server.ts";
import type { ShopCtx } from "../../app/lib/integration/context.server.ts";
import { overviewPage, tryCartPage } from "../../app/lib/integration/pages.server.ts";
import { settingsAction } from "../../app/lib/integration/settings.server.ts";
import { runCombinationsDailyOnce } from "../../app/lib/jobs/scheduler.server.ts";
import { createSync } from "../../app/lib/sync/sync.server.ts";
import { productionSyncDeps } from "../../app/lib/sync/wiring.server.ts";
import { clearSignalCache } from "../../app/lib/ui-actions.server.ts";
import { createTestDatabase, type TestDatabase } from "../lib/test-db.ts";
import { FakeStore, formOf, quiet, testCtx } from "./helpers.ts";

let db: TestDatabase;
let seq = 0;
let shop: string;
before(() => {
  db = createTestDatabase("int-combination-check");
});
after(async () => {
  await db.drop();
});
beforeEach(() => {
  seq += 1;
  shop = `combos-${seq}.myshopify.com`;
  clearSignalCache();
});

type Plan = "free" | "pro";
const PAGE = { scopes: "write_discounts,read_products,write_products,read_themes,read_markets" };

function ctxFor(store: FakeStore, plan: Plan): ShopCtx {
  return {
    ...testCtx(db.prisma, shop, store),
    scopes: PAGE.scopes,
    now: () => new Date("2026-10-08T10:00:00Z"),
    createSync: (client: AdminClient, prisma: PrismaClient) => createSync({ ...productionSyncDeps(client, prisma, quiet), sleep: async () => {}, plan: async () => plan }),
  };
}

const TIERS = { sets: [{ id: "g", scope: "global", countAcross: "product", breaks: [{ minQty: 3, percent: 10 }] }] };
const RULES = [
  { id: "code", enabled: true, name: "LETO10", method: "code", codes: ["LETO10"], value: { kind: "percentage", percent: 10 }, target: { kind: "order" } },
  milestoneRule({ id: "ms-a", threshold: { CZK: 2000_00 }, value: { kind: "percentage", percent: 5 } }),
  milestoneRule({ id: "ms-b", threshold: { CZK: 4000_00 }, value: { kind: "percentage", percent: 10 } }),
];

async function storeDiscounts(margin = false) {
  const base = (await loadConfig(db.prisma, shop)).config;
  const saved = await saveConfig(db.prisma, shop, {
    ...base,
    markets: [{ handle: "cz", currency: "CZK", enabled: true, countries: ["CZ"] }],
    modules: { ...base.modules, tiers: TIERS, codes: { rules: RULES }, ...(margin ? { margin: { enabled: true, global: { minMarginPercent: 20, maxDiscountPercent: 60 }, perCollection: [] } } : {}) },
  });
  assert.equal(saved.ok, true, JSON.stringify(saved));
}

const V = (n: number) => `gid://shopify/ProductVariant/${n}`;
const P = (n: number) => `gid://shopify/Product/${n}`;
const cost = (n: number, title: string, price: string, c: string | null) => ({ shop, variantId: V(n), productId: P(n), inventoryItemId: `gid://shopify/InventoryItem/${n}`, title, price, cost: c, currency: c === null ? null : "CZK" });

async function storeProducts() {
  await db.prisma.variantCost.createMany({
    data: [cost(1, "Mikina", "1000.00", "500.00"), cost(2, "Tričko", "400.00", "350.00"), cost(3, "Čepice", "300.00", null), cost(4, "Bunda", "2000.00", "900.00"), cost(5, "Šála", "250.00", "100.00")],
  });
  await db.prisma.productTargetIndex.createMany({
    data: [
      { shop, productId: P(2), value: JSON.stringify({ ruleIds: ["r:code"], variantRuleIds: {} }) },
      { shop, productId: P(4), value: JSON.stringify({ ruleIds: [], variantRuleIds: {}, tierRef: "vip" }) },
    ],
  });
  await db.prisma.outletRun.create({ data: { shop, productId: P(5), variantId: V(5), quota: 10, percent: 30, status: "active" } });
}

test("the products come from what the app has stored: the lowest margin, a product with its own tiers, a variant on sale — with the refs checkout reads", async () => {
  await storeProducts();
  const products = await loadScenarioProducts(db.prisma, shop, "CZK");
  assert.deepEqual(
    products.map((p) => ({ title: p.title, role: p.role, unitPrice: p.unitPrice, unitCost: p.unitCost, refs: p.refs })),
    [
      { title: "Tričko", role: "lowMargin", unitPrice: 400_00, unitCost: 350, refs: { ruleIds: ["r:code"], variantRuleIds: {} } },
      // A product a discount aims at (the sync's refs name the discount): here the same Tričko.
      { title: "Tričko", role: "targeted", unitPrice: 400_00, unitCost: 350, refs: { ruleIds: ["r:code"], variantRuleIds: {} } },
      { title: "Bunda", role: "exception", unitPrice: 2000_00, unitCost: 900, refs: { ruleIds: [], variantRuleIds: {}, tierRef: "vip" } },
      { title: "Šála", role: "outlet", unitPrice: 250_00, unitCost: 100, refs: undefined },
    ],
  );
  // Another shop's rows are never read (SEC-2).
  assert.deepEqual(await loadScenarioProducts(db.prisma, "someone-else.myshopify.com", "CZK"), []);
});

const NOW = new Date("2026-10-08T10:00:00Z");
const SHOP_FACTS = { shopCurrency: "CZK", timezone: "Europe/Prague", now: NOW };
/** What a sync of the shop's config leaves behind: the check, planned and stored. */
const refresh = (plan: Plan, more: Partial<Parameters<typeof refreshCombinationCheck>[2]> = {}) => refreshCombinationCheck(db.prisma, shop, { ...SHOP_FACTS, plan, ...more });
const viewOf = async (plan: Plan, marketNames = { cz: "Česko" }) => (await combinationCheck(ctxFor(new FakeStore(), plan), { plan, marketNames, config: (await loadConfig(db.prisma, shop)).config }))?.view ?? null;

test("Free gets the number of warnings and nothing else; Pro gets which scenarios and why, with the discount behind each", async () => {
  await storeDiscounts(true);
  await storeProducts();
  await refresh("pro");
  const pro = (await viewOf("pro"))!;
  assert.equal(pro.sample, false);
  assert.ok(pro.warnings >= 2, JSON.stringify(pro.scenarios?.map((s) => [s.id, s.status])));
  const byId = new Map(pro.scenarios!.map((s) => [s.id, s]));
  // The product with the lowest margin (350 of 400 Kč): the tier's 10 % would go under the 20 % margin — the link names the tier.
  assert.deepEqual(byId.get("tiers")!.findings.map((f) => [f.kind, f.href, f.label]), [["margin", "/app/tiers#global", "Otevřít množstevní slevy"]]);
  // The lower step lost to the higher one: the link opens that very step on Milníky.
  assert.ok(byId.get("steps")!.findings.some((f) => f.kind === "step_superseded" && f.href === "/app/rewards#step-1" && f.label === "Otevřít 1. stupeň Milníků"));
  assert.equal(byId.get("tiers")!.open, "/app/try-cart?scenario=tiers");

  await refresh("free");
  const free = (await viewOf("free"))!;
  assert.deepEqual(Object.keys(free).sort(), ["ok", "sample", "warnings"]);
  assert.ok(free.warnings >= 1);
  assert.doesNotMatch(JSON.stringify(free), /Tričko|LETO10|margin|scenario/);
  // Nothing runs → no check at all; the shop's currency unknown → none either (never a guess).
  const config = (await loadConfig(db.prisma, shop)).config;
  await saveConfig(db.prisma, shop, { ...config, modules: { ...config.modules, tiers: { sets: [] }, codes: { rules: [] } } });
  assert.equal(await refresh("pro"), null);
  assert.equal(await viewOf("pro"), null);
  await saveConfig(db.prisma, shop, config);
  assert.ok(await refresh("pro"));
  assert.equal(await refresh("pro", { shopCurrency: null }), null);
  assert.equal(await viewOf("pro"), null);
});

test("when it is computed: a save of any setting stores it, the pages only read it — nothing is planned when a page opens", async () => {
  await storeDiscounts(true);
  await storeProducts();
  // Stored discounts, but no sync since: the pages have nothing to show and compute nothing themselves.
  assert.equal(await loadStoredCheck(db.prisma, shop), null);
  assert.equal((await tryCartPage(ctxFor(new FakeStore(), "pro"), PAGE)).combos, undefined);
  assert.equal(await loadStoredCheck(db.prisma, shop), null, "opening the page stored nothing either");

  // A save on any page goes through the sync, and the sync leaves the check behind.
  clearSignalCache();
  const store = new FakeStore();
  const ctx = ctxFor(store, "pro");
  const version = (await loadConfig(db.prisma, shop)).version;
  const saved = await settingsAction(ctx, formOf([["intent", "save"], ["configVersion", version ?? ""], ["productWithOrder", "on"], ["productWithShipping", "on"], ["orderWithShipping", "on"], ["outletWithAnything", "on"]]));
  assert.equal(saved.ok, true, JSON.stringify(saved));
  const row = await db.prisma.combinationCheck.findUnique({ where: { shop } });
  assert.ok(row, "the save stored the check");
  assert.equal(row.plan, "pro");
  assert.equal(store.ops.includes("WonCombinationProducts"), false, "the cost mirror holds the products: Shopify is not asked for any");
  const after = (await overviewPage(ctxFor(new FakeStore(), "pro"), PAGE)).combos;
  assert.ok(after && after.ok + after.warnings >= 3);

  // Proof the page reads and never plans: the stored discounts change behind its back (no sync), it still says what was stored…
  const config = (await loadConfig(db.prisma, shop)).config;
  await saveConfig(db.prisma, shop, { ...config, modules: { ...config.modules, tiers: { sets: [] }, codes: { rules: [] } } });
  clearSignalCache();
  const tryCart = await tryCartPage(ctxFor(new FakeStore(), "pro"), PAGE);
  assert.deepEqual({ ok: tryCart.combos?.ok, warnings: tryCart.combos?.warnings }, after);
  // …until the next computation: nothing runs any more, so there is no check.
  await refresh("pro");
  clearSignalCache();
  assert.equal((await tryCartPage(ctxFor(new FakeStore(), "pro"), PAGE)).combos, undefined);
});

test("once a day: the scheduler plans every shop's check again from the database (a campaign's day moves), asking Shopify only for the products of a shop without the cost mirror", async () => {
  await storeDiscounts(true);
  await storeProducts();
  await db.prisma.shopSyncState.create({ data: { shop, timezone: "Europe/Prague", currency: "CZK", appliedPlan: "pro" } });
  const offline: AdminClient = { graphql: async () => assert.fail("the daily check called Shopify for a shop with the cost mirror") };
  const first = await runCombinationsDailyOnce({ db: db.prisma, clientFor: async () => offline, plan: async () => "pro", now: () => NOW });
  // (the test database holds the shops of the other tests too)
  assert.deepEqual([first.computed.includes(shop), first.failed], [true, []]);
  const row = await db.prisma.combinationCheck.findUnique({ where: { shop } });
  assert.equal(row?.computedAt.toISOString(), NOW.toISOString());
  // The next day: computed again, the same row.
  const tomorrow = new Date(NOW.getTime() + 86_400_000);
  await runCombinationsDailyOnce({ db: db.prisma, clientFor: async () => offline, plan: async () => "pro", now: () => tomorrow });
  assert.equal((await db.prisma.combinationCheck.findUnique({ where: { shop } }))?.computedAt.toISOString(), tomorrow.toISOString());
  // A shop the sync never recorded a currency for is left alone (never a guess); no session → the stored products are used.
  await db.prisma.shopSyncState.update({ where: { shop }, data: { currency: null } });
  const skipped = await runCombinationsDailyOnce({ db: db.prisma, clientFor: async () => null, plan: async () => "pro", now: () => tomorrow });
  assert.deepEqual([skipped.computed.includes(shop), skipped.failed], [false, []]);
});

test("real products without margin protection: one Shopify read with a sync or the daily run, kept for a day — never when a page opens", async () => {
  await storeDiscounts();
  // No cost mirror (margin protection is off). A discount aims at product 7; the sync's refs say so.
  const base = (await loadConfig(db.prisma, shop)).config;
  await saveConfig(db.prisma, shop, { ...base, modules: { ...base.modules, codes: { rules: [...RULES, { id: "mikiny", enabled: true, name: "Mikiny −25 %", method: "automatic", value: { kind: "percentage", percent: 25 }, target: { kind: "products", productIds: [P(7)] } }] } } });
  await db.prisma.productTargetIndex.create({ data: { shop, productId: P(7), value: JSON.stringify({ ruleIds: ["mikiny"], variantRuleIds: {} }) } });
  const store = new FakeStore();
  store.overrides.set("WonCombinationProducts", async (variables) => {
    assert.deepEqual(variables, { ids: [P(7)] }, "the products the scenarios need by name");
    const product = (n: number, title: string, price: string) => ({ id: P(n), title, variants: { nodes: [{ id: V(n), title: "Default Title", price }] } });
    return { data: { products: { nodes: [product(1, "Mikina", "600.00")] }, nodes: [product(7, "Mikina s kapucí", "900.00")] } };
  });
  const asked = () => store.ops.filter((op) => op === "WonCombinationProducts").length;

  // Without Shopify at hand (and nothing stored yet): a sample product, said as one.
  assert.equal((await refresh("pro"))?.sample, true);
  // With it: one read, and the scenarios use the shop's own products and prices.
  const check = (await refresh("pro", { client: store }))!;
  assert.equal(asked(), 1);
  assert.equal(check.sample, false);
  const cart = (id: string) => check.scenarios.find((s) => s.id === id)?.cart?.lines.map((l) => [l.title, l.unitPrice.CZK]);
  assert.deepEqual(cart("tiers"), [["Mikina", 600_00]]);
  assert.deepEqual(cart("product"), [["Mikina s kapucí", 900_00]], "the product the discount aims at");
  // The next saves of the day read nothing: the listed products are stored with the check.
  await refresh("pro", { client: store });
  await refresh("pro", { client: store, now: new Date(NOW.getTime() + 23 * 3_600_000) });
  assert.equal(asked(), 1);
  // A day later they are read again; and at once when a scenario needs a product that is not among them.
  await refresh("pro", { client: store, now: new Date(NOW.getTime() + 25 * 3_600_000) });
  assert.equal(asked(), 2);
  await db.prisma.productTargetIndex.create({ data: { shop, productId: P(8), value: JSON.stringify({ ruleIds: [], variantRuleIds: {}, tierRef: "vip" }) } });
  store.overrides.set("WonCombinationProducts", async () => ({ data: { products: { nodes: [] }, nodes: [] } }));
  await refresh("pro", { client: store, now: new Date(NOW.getTime() + 26 * 3_600_000) });
  assert.equal(asked(), 3);
  // Shopify does not answer: the stored products stay, the check is still there.
  store.overrides.set("WonCombinationProducts", async () => ({ data: null, errors: [{ message: "Throttled" }] }));
  await db.prisma.combinationCheck.update({ where: { shop }, data: { products: JSON.stringify([{ variantId: V(1), productId: P(1), title: "Mikina", price: "600.00" }]), productsReadAt: null } });
  assert.deepEqual((await refresh("pro", { client: store }))?.scenarios.find((s) => s.id === "tiers")?.cart?.lines.map((l) => l.title), ["Mikina"]);

  // The pages: no Shopify read for the check, with or without stored products.
  clearSignalCache();
  const pageStore = new FakeStore();
  const page = await tryCartPage(ctxFor(pageStore, "pro"), PAGE);
  assert.ok(page.combos);
  assert.equal(pageStore.ops.includes("WonCombinationProducts"), false);
});

test("a page asks Shopify nothing for the check: it makes exactly the reads it made without it", async () => {
  await storeDiscounts(true);
  await storeProducts();
  await refresh("pro");
  const config = (await loadConfig(db.prisma, shop)).config;
  // The same operations for a shop with a stored check as for the same shop with none.
  const reads = async () => {
    clearSignalCache();
    const store = new FakeStore();
    const props = await tryCartPage(ctxFor(store, "pro"), PAGE);
    return { ops: [...store.ops].sort(), combos: props.combos };
  };
  const withTry = await reads();
  assert.ok(withTry.combos, "the page carries the check");
  await saveConfig(db.prisma, shop, { ...config, modules: { ...config.modules, tiers: { sets: [] }, codes: { rules: [] } } });
  await refresh("pro");
  const withoutTry = await reads();
  assert.equal(withoutTry.combos, undefined);
  assert.deepEqual(withTry.ops, withoutTry.ops, "Vyzkoušet košík: no Shopify read more for the check");
  assert.ok(withTry.ops.every((op) => !op.startsWith("WonSync") && !op.startsWith("WonTryCart") && op !== "WonCombinationProducts"), withTry.ops.join(", "));
});

test("Přehled carries the two counts on every plan; Vyzkoušet košík the list on Pro and the counts on Free", async () => {
  await storeDiscounts();
  await storeProducts();
  await refresh("free");
  const home = await overviewPage(ctxFor(new FakeStore(), "free"), PAGE);
  assert.deepEqual(Object.keys(home.combos ?? {}).sort(), ["ok", "warnings"]);
  assert.equal((home.combos?.ok ?? 0) + (home.combos?.warnings ?? 0) >= 3, true);
  clearSignalCache();
  const free = await tryCartPage(ctxFor(new FakeStore(), "free"), PAGE);
  assert.equal(free.pro, false);
  assert.equal(free.combos?.scenarios, undefined);
  assert.deepEqual({ ok: free.combos?.ok, warnings: free.combos?.warnings }, home.combos);
  await refresh("pro");
  clearSignalCache();
  const pro = await tryCartPage(ctxFor(new FakeStore(), "pro"), PAGE);
  assert.ok((pro.combos?.scenarios ?? []).length >= 3);
});

test("a scenario opens in the manual cart (Pro) from the stored check — its products with the stored prices, its code ticked, its market; Free gets no prepared cart", async () => {
  await storeDiscounts();
  await storeProducts();
  await refresh("pro");
  const before = await db.prisma.combinationCheck.findUnique({ where: { shop } });
  const pro = await tryCartPage(ctxFor(new FakeStore(), "pro"), { ...PAGE, scenario: "steps-code" });
  // 4 000 Kč of the 400 Kč product reach the higher step; the code is the rule's.
  assert.deepEqual(pro.lines, [{ variantId: V(2), productId: P(2), title: "Tričko", quantity: 10, unitPrice: { CZK: 400_00 } }]);
  assert.deepEqual([pro.ruleIds, pro.currency, pro.date, pro.time, pro.opened], [["code"], "CZK:cz", "2026-10-08", "12:00", "Stupeň se slevou + kód LETO10"]);
  assert.equal(pro.plan, null, "prepared, not calculated: the merchant runs it with the store's current prices");
  assert.deepEqual(await db.prisma.combinationCheck.findUnique({ where: { shop } }), before, "opening a scenario computes and stores nothing");
  clearSignalCache();
  const unknown = await tryCartPage(ctxFor(new FakeStore(), "pro"), { ...PAGE, scenario: "nope" });
  assert.deepEqual([unknown.lines, unknown.opened], [[], undefined]);
  clearSignalCache();
  const free = await tryCartPage(ctxFor(new FakeStore(), "free"), { ...PAGE, scenario: "steps-code" });
  assert.deepEqual([free.lines, free.opened], [[], undefined]);
});
