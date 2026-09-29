import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";

import type { PrismaClient } from "../../app/generated/prisma/client.ts";
import type { AdminClient } from "../../app/lib/admin-client.server.ts";
import { loadConfig, saveConfig } from "../../app/lib/config.server.ts";
import type { ShopCtx } from "../../app/lib/integration/context.server.ts";
import { withConfigLock } from "../../app/lib/integration/lock.server.ts";
import {
  loadMarginOverview,
  loadMarginScreen,
  marginCatalogueReads,
  readMarginForm,
  refreshCostsAction,
  ruleMarginImpact,
  saveMarginSettings,
} from "../../app/lib/integration/margin.server.ts";
import { overviewData, tryCartAction } from "../../app/lib/integration/pages.server.ts";
import { clearMarketCountryCache, estimateShopToCartRate } from "../../app/lib/integration/try-cart.server.ts";
import { costIdle } from "../../app/lib/sync/cost-lane.server.ts";
import { createSync, syncIdle } from "../../app/lib/sync/sync.server.ts";
import { productionSyncDeps } from "../../app/lib/sync/wiring.server.ts";
import { clearSignalCache } from "../../app/lib/ui-actions.server.ts";
import type { MarginSettingsView } from "../../app/components/model/types.ts";
import { createTestDatabase, type TestDatabase } from "../lib/test-db.ts";
import { FakeStore, formOf, quiet, testCtx } from "./helpers.ts";

// Ochrana marže, the server side Task 4's screens call (MVP 2):
//   readMarginForm        the form (SEC-1): percents, collections, the toggle;
//   saveMarginSettings    the rule-save path (config lock, F12 version token,
//                         unreadable guard, saveAndSync) + the cost mirror:
//                         switched on → a full pass in the background
//                         (`syncing.costs`), switched off → the metafields cleared;
//   loadMarginScreen      stored settings (collection titles from Shopify), the
//                         plan, gate notes, the mirror state, coverage, and the
//                         impact overview (Pro only, BILL-1);
//   refreshCostsAction    "Obnovit nákupní ceny";
//   ruleMarginImpact      the editor's "Na N produktech se sleva sníží";
//   Přehled               AdminSignals.margin;
//   Vyzkoušet košík       costs from the mirror, the rate estimate, capped lines.

let db: TestDatabase;
let seq = 0;
let shop: string;
before(() => {
  db = createTestDatabase("int-margin");
});
after(async () => {
  await db.drop();
});
beforeEach(() => {
  seq += 1;
  shop = `margin-${seq}.myshopify.com`;
  clearSignalCache();
  clearMarketCountryCache();
});

const COLLECTION = "gid://shopify/Collection/5";

function ctxFor(store: FakeStore, plan: "free" | "pro" = "free"): ShopCtx {
  return {
    ...testCtx(db.prisma, shop, store),
    createSync: (client: AdminClient, prisma: PrismaClient) =>
      createSync({ ...productionSyncDeps(client, prisma, quiet), sleep: async () => {}, plan: async () => plan }),
    lockWaitMs: 200,
  };
}

/** A store: product 1 (cost 6.00, price 10.00 CZK), product 2 (no cost, price 20.00), product 3 in collection 5 (cost 4.00). */
function storeWithCatalogue(): FakeStore {
  const store = new FakeStore();
  const p1 = store.sync.addProduct(1, 1);
  const p2 = store.sync.addProduct(2, 2);
  const p3 = store.sync.addProduct(3, 1);
  store.sync.products.get(p1.id)!.title = "Tričko";
  store.sync.products.get(p2.id)!.title = "Mikina";
  store.sync.products.get(p3.id)!.title = "Čepice";
  store.sync.setCost(p1.variantIds[0]!, "6.00");
  store.sync.setCost(p3.variantIds[0]!, "4.00");
  store.sync.variants.get(p2.variantIds[0]!)!.price = "20.00";
  store.sync.variants.get(p2.variantIds[1]!)!.price = "20.00";
  store.sync.addCollection(5, [p3.id]);
  store.prices.set(p1.variantIds[0]!, { CZK: "10.00", EUR: "0.40" });
  store.prices.set(p2.variantIds[0]!, { CZK: "20.00", EUR: "0.80" });
  store.titles.set(p1.variantIds[0]!, { product: "Tričko", variant: "Default Title" });
  store.collectionTitles.set(COLLECTION, "Zimní");
  return store;
}

const settings = (patch: Partial<MarginSettingsView> = {}): MarginSettingsView => ({
  enabled: true,
  minMarginPercent: 25,
  maxDiscountPercent: 30,
  collections: [],
  ...patch,
});

async function settle(s = shop) {
  await syncIdle(s);
  await costIdle(s);
}

// --- readMarginForm -------------------------------------------------------------------------

test("readMarginForm: the toggle, percents (a comma decimal too), collections in order; empty = null", () => {
  const read = readMarginForm(
    formOf([
      ["enabled", "on"],
      ["minMarginPercent", "12,5"],
      ["maxDiscountPercent", "40"],
      ["collectionId[]", COLLECTION],
      ["collectionMin[]", "30"],
      ["collectionMax[]", ""],
      ["collectionId[]", "gid://shopify/Collection/6"],
      ["collectionMin[]", ""],
      ["collectionMax[]", "10"],
      ["collectionId[]", "gid://shopify/Collection/7"],
      ["collectionMin[]", ""],
      ["collectionMax[]", ""],
    ]),
  );
  assert.deepEqual(read, {
    ok: true,
    settings: {
      enabled: true,
      minMarginPercent: 12.5,
      maxDiscountPercent: 40,
      collections: [
        { collectionId: COLLECTION, title: COLLECTION, minMarginPercent: 30, maxDiscountPercent: null },
        { collectionId: "gid://shopify/Collection/6", title: "gid://shopify/Collection/6", minMarginPercent: null, maxDiscountPercent: 10 },
      ],
    },
  });
  const off = readMarginForm(formOf([["minMarginPercent", ""], ["maxDiscountPercent", "50"]]));
  assert.deepEqual(off, { ok: true, settings: { enabled: false, minMarginPercent: null, maxDiscountPercent: 50, collections: [] } });
});

test("readMarginForm: out of range, a missing ceiling, a bad collection id → field errors, nothing else", () => {
  const read = readMarginForm(
    formOf([
      ["enabled", "on"],
      ["minMarginPercent", "96"],
      ["maxDiscountPercent", ""],
      ["collectionId[]", "gid://shopify/Product/1"],
      ["collectionMin[]", "10"],
      ["collectionMax[]", ""],
      ["collectionId[]", COLLECTION],
      ["collectionMin[]", ""],
      ["collectionMax[]", "101"],
    ]),
  );
  assert.equal(read.ok, false);
  const fields = read.ok ? [] : read.errors.map((e) => [e.field, e.key, e.params ?? null]);
  assert.deepEqual(fields, [
    ["minMarginPercent", "margin.error.percent", { max: 95 }],
    ["maxDiscountPercent", "margin.error.percent", { max: 100 }],
    ["collectionId[0]", "margin.error.collection", null],
    ["collectionMax[1]", "margin.error.percent", { max: 100 }],
  ]);
});

// --- saveMarginSettings ---------------------------------------------------------------------

test("switching protection on: saved + synced (the shop config carries the margin with the shop currency), a full cost pass in the background", async () => {
  const store = storeWithCatalogue();
  const ctx = ctxFor(store);
  const result = await saveMarginSettings(ctx, settings(), { configVersion: null });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.ok && result.message, "saved");
  assert.deepEqual(result.ok && result.syncing, { costs: true });
  await settle();
  const shopConfig = JSON.parse(store.sync.shopMetafieldValue("function_config")!) as { modules: { margin: unknown } };
  assert.deepEqual(shopConfig.modules.margin, { enabled: true, min: 25, max: 30, cur: "CZK" });
  assert.deepEqual(store.sync.variantCostMetafield("gid://shopify/ProductVariant/101"), { cost: 6, cur: "CZK" });
  assert.deepEqual(store.sync.variantCostMetafield("gid://shopify/ProductVariant/301"), { cost: 4, cur: "CZK" });
  assert.equal(store.sync.variantCostMetafield("gid://shopify/ProductVariant/201"), undefined);
  const stored = (await loadConfig(db.prisma, shop)).config.modules.margin;
  assert.deepEqual(stored, { enabled: true, global: { minMarginPercent: 25, maxDiscountPercent: 30 }, perCollection: [] });
});

test("switching protection off clears the variant metafields the mirror wrote", async () => {
  const store = storeWithCatalogue();
  const ctx = ctxFor(store);
  await saveMarginSettings(ctx, settings(), { configVersion: null });
  await settle();
  const version = (await loadConfig(db.prisma, shop)).version;
  const off = await saveMarginSettings(ctx, settings({ enabled: false }), { configVersion: version });
  assert.equal(off.ok, true, JSON.stringify(off));
  assert.equal(off.ok && off.syncing?.costs, undefined, "nothing to propagate");
  await settle();
  assert.equal(store.sync.variantCostMetafield("gid://shopify/ProductVariant/101"), undefined);
  assert.equal(await db.prisma.variantCost.count({ where: { shop } }), 0);
});

test("F12: a config saved meanwhile that changed the margin settings → base_changed, nothing saved; a change elsewhere → re-applied on top", async () => {
  const store = storeWithCatalogue();
  const ctx = ctxFor(store);
  await saveMarginSettings(ctx, settings(), { configVersion: null });
  await settle();
  const loadedVersion = (await loadConfig(db.prisma, shop)).version;
  // Another tab changes the minimum margin.
  const other = (await loadConfig(db.prisma, shop)).config;
  await saveConfig(db.prisma, shop, { ...other, modules: { ...other.modules, margin: { ...other.modules.margin, global: { minMarginPercent: 40, maxDiscountPercent: 30 } } } });
  const refused = await saveMarginSettings(ctx, settings({ maxDiscountPercent: 20 }), { configVersion: loadedVersion });
  assert.deepEqual(refused, { ok: false, reason: "base_changed" });
  assert.equal((await loadConfig(db.prisma, shop)).config.modules.margin.global.minMarginPercent, 40, "nothing overwritten");

  // Another tab saves a rule (the margin untouched): the margin change is applied on top.
  const base = (await loadConfig(db.prisma, shop)).version;
  const current = (await loadConfig(db.prisma, shop)).config;
  await saveConfig(db.prisma, shop, {
    ...current,
    modules: { ...current.modules, codes: { rules: [{ id: "r1", name: "Léto", method: "automatic", value: { kind: "percentage", percent: 10 }, target: { kind: "order" } }] } },
  });
  const merged = await saveMarginSettings(ctx, settings({ minMarginPercent: 40, maxDiscountPercent: 15 }), { configVersion: base });
  assert.equal(merged.ok, true, JSON.stringify(merged));
  const after = (await loadConfig(db.prisma, shop)).config;
  assert.equal(after.modules.codes.rules.length, 1, "the other change kept");
  assert.equal(after.modules.margin.global.maxDiscountPercent, 15);
  await settle();
});

test("an unreadable stored config is not replaced without the confirmation; another writer holding the lock → busy", async () => {
  const store = storeWithCatalogue();
  const ctx = ctxFor(store);
  await db.prisma.shopConfig.create({ data: { shop, schemaVersion: 1, data: "{not json" } });
  const version = (await loadConfig(db.prisma, shop)).version;
  assert.deepEqual(await saveMarginSettings(ctx, settings(), { configVersion: version }), { ok: false, reason: "unreadable_config" });
  const replaced = await saveMarginSettings(ctx, settings(), { configVersion: version, replaceUnreadable: true });
  assert.equal(replaced.ok, true, JSON.stringify(replaced));
  await settle();

  let release!: () => void;
  const held = withConfigLock(shop, () => new Promise<void>((resolve) => (release = resolve)));
  const busy = await saveMarginSettings(ctx, settings(), { configVersion: (await loadConfig(db.prisma, shop)).version });
  assert.deepEqual(busy, { ok: false, reason: "busy" });
  release();
  await held;
});

// --- loadMarginScreen -----------------------------------------------------------------------

test("Free: stored settings with collection titles, the Pro setting explained as not in force, mirror + coverage, no impact (BILL-1)", async () => {
  const store = storeWithCatalogue();
  const ctx = ctxFor(store, "free");
  await saveMarginSettings(ctx, settings({ collections: [{ collectionId: COLLECTION, title: "x", minMarginPercent: 40, maxDiscountPercent: null }] }), {
    configVersion: null,
  });
  await settle();
  const data = await loadMarginScreen(ctx);
  assert.equal(data.plan, "free");
  assert.equal(data.shopCurrency, "CZK");
  assert.equal(data.configVersion, (await loadConfig(db.prisma, shop)).version);
  assert.deepEqual(data.settings, {
    enabled: true,
    minMarginPercent: 25,
    maxDiscountPercent: 30,
    collections: [{ collectionId: COLLECTION, title: "Zimní", minMarginPercent: 40, maxDiscountPercent: null }],
  });
  assert.equal(data.gateNotes.length, 1);
  assert.match(data.gateNotes[0]!.text, /marž/i);
  assert.equal(data.mirror.state, "fresh");
  assert.deepEqual(data.coverage, {
    variants: 4,
    variantsWithCost: 2,
    productsWithoutCost: 1,
    sample: [{ productId: "gid://shopify/Product/2", title: "Mikina", variantsWithoutCost: 2 }],
  });
  assert.equal(data.impact, null, "Free never gets the data");
});

test("never switched on: mirror off, coverage null; a pass cut short reads as stale and the load resumes it", async () => {
  const store = storeWithCatalogue();
  const ctx = ctxFor(store);
  const data = await loadMarginScreen(ctx);
  assert.deepEqual(data.mirror, { state: "off" });
  assert.equal(data.coverage, null);
  assert.equal(data.settings.enabled, false);
  assert.equal(data.settings.maxDiscountPercent, 50, "default ceiling");

  await saveConfig(db.prisma, shop, { modules: { margin: { enabled: true, global: { maxDiscountPercent: 50 }, perCollection: [] } } });
  const due = await loadMarginScreen(ctx);
  assert.equal(due.mirror.state, "running", "the load started the due pass");
  await settle();
  assert.equal((await loadMarginScreen(ctx)).mirror.state, "fresh");
});

test("Pro: the impact overview — where protection lowers active discounts (rule → variant, wanted vs. allowed, why)", async () => {
  const store = storeWithCatalogue();
  const ctx = ctxFor(store, "pro");
  const saved = await saveConfig(db.prisma, shop, {
    modules: {
      codes: {
        rules: [
          { id: "half", name: "Půlka", method: "automatic", value: { kind: "percentage", percent: 50 }, target: { kind: "products", productIds: ["gid://shopify/Product/1", "gid://shopify/Product/2"], variantIds: [] } },
          { id: "order", name: "Objednávka", method: "code", codes: ["OBJ20"], value: { kind: "percentage", percent: 20 }, target: { kind: "order" } },
        ],
      },
    },
  });
  assert.equal(saved.ok, true);
  const on = await saveMarginSettings(
    ctx,
    settings({ minMarginPercent: 25, maxDiscountPercent: 30, collections: [{ collectionId: COLLECTION, title: "", minMarginPercent: 60, maxDiscountPercent: null }] }),
    { configVersion: (await loadConfig(db.prisma, shop)).version },
  );
  assert.equal(on.ok, true, JSON.stringify(on));
  await settle();
  assert.deepEqual(store.sync.productMetafield("gid://shopify/Product/3"), { ruleIds: [], variantRuleIds: {}, marginRefs: ["5"] });
  const data = await loadMarginScreen(ctx);
  assert.equal(data.plan, "pro");
  assert.deepEqual(data.gateNotes, []);
  const impact = data.impact!;
  assert.ok(impact);
  // Tričko: price 1000, cost 600, m 25 % → floor 800 → allowed 200 (wanted 500). Mikina: no cost, p 30 % → allowed 600 (wanted 1000).
  assert.deepEqual(
    impact.rows.map((r) => [r.ruleId, r.ruleName, r.variantId, r.wanted, r.allowed, r.basis, r.source]),
    [
      ["half", "Půlka", "gid://shopify/ProductVariant/201", 1000, 600, "max_percent", "global"],
      ["half", "Půlka", "gid://shopify/ProductVariant/202", 1000, 600, "max_percent", "global"],
      ["half", "Půlka", "gid://shopify/ProductVariant/101", 500, 200, "cost", "global"],
    ],
  );
  assert.equal(impact.rows[2]!.title, "Tričko");
  // The order rule (20 %): Tričko 200 ≤ 200 fine; Čepice (collection m 60 %: floor 1000 ≥ price) → below.
  assert.deepEqual(impact.orderRules, [{ ruleId: "order", ruleName: "Objednávka", variantsBelow: 1 }]);
  assert.equal(impact.withoutCost, 2);
});

// --- refreshCostsAction / ruleMarginImpact ----------------------------------------------------

test("Obnovit nákupní ceny: a full pass from the start while on (syncing.costs); off → nothing to do", async () => {
  const store = storeWithCatalogue();
  const ctx = ctxFor(store);
  assert.deepEqual(await refreshCostsAction(ctx), { ok: true, message: "synced" });
  await saveMarginSettings(ctx, settings(), { configVersion: null });
  await settle();
  store.sync.setCost("gid://shopify/ProductVariant/201", "9.00");
  const result = await refreshCostsAction(ctx);
  assert.deepEqual(result, { ok: true, message: "synced", syncing: { costs: true } });
  await settle();
  assert.deepEqual(store.sync.variantCostMetafield("gid://shopify/ProductVariant/201"), { cost: 9, cur: "CZK" });
});

test("ruleMarginImpact: null while protection is off; the number of variants it is lowered on when on", async () => {
  const store = storeWithCatalogue();
  const ctx = ctxFor(store);
  await saveConfig(db.prisma, shop, {
    modules: {
      codes: {
        rules: [
          { id: "half", name: "Půlka", method: "automatic", value: { kind: "percentage", percent: 50 }, target: { kind: "products", productIds: ["gid://shopify/Product/1", "gid://shopify/Product/2"], variantIds: [] } },
          { id: "tiny", name: "Drobná", method: "automatic", value: { kind: "percentage", percent: 5 }, target: { kind: "products", productIds: ["gid://shopify/Product/1"], variantIds: [] } },
        ],
      },
    },
  });
  await createSync({ ...productionSyncDeps(store, db.prisma, quiet), sleep: async () => {}, plan: async () => "free" }).syncShop(shop, (await loadConfig(db.prisma, shop)).config);
  assert.equal(await ruleMarginImpact(ctx, "half"), null);
  await saveMarginSettings(ctx, settings(), { configVersion: (await loadConfig(db.prisma, shop)).version });
  await settle();
  assert.equal(await ruleMarginImpact(ctx, "half"), 3);
  assert.equal(await ruleMarginImpact(ctx, "tiny"), 0);
  assert.equal(await ruleMarginImpact(ctx, "missing"), 0);
});

// --- Přehled + Vyzkoušet košík ---------------------------------------------------------------

test("Přehled: AdminSignals.margin — on/off, the settings in force, products without a cost, the mirror", async () => {
  const store = storeWithCatalogue();
  const ctx = ctxFor(store);
  const before = await overviewData(ctx, { scopes: "write_discounts,read_products,read_themes", syncDeadlineMs: 2_000, nativeDeadlineMs: 50 });
  assert.deepEqual(before.options.signals.margin, { enabled: false, minMarginPercent: null, maxDiscountPercent: 50, productsWithoutCost: null, mirror: { state: "off" } });
  await saveMarginSettings(ctx, settings(), { configVersion: null });
  await settle();
  clearSignalCache();
  const on = await overviewData(ctx, { scopes: "write_discounts,read_products,read_themes", syncDeadlineMs: 2_000, nativeDeadlineMs: 50 });
  const margin = on.options.signals.margin!;
  assert.equal(margin.enabled, true);
  assert.equal(margin.minMarginPercent, 25);
  assert.equal(margin.maxDiscountPercent, 30);
  assert.equal(margin.productsWithoutCost, 1);
  assert.equal(margin.mirror.state, "fresh");
  await settle();
});

test("Vyzkoušet košík: the cost from the mirror caps the line (admin explanation with the reason); margin off → no margin block", async () => {
  const store = storeWithCatalogue();
  const ctx = ctxFor(store);
  await saveConfig(db.prisma, shop, {
    modules: {
      codes: {
        rules: [{ id: "half", name: "Půlka", method: "automatic", value: { kind: "percentage", percent: 50 }, target: { kind: "products", productIds: ["gid://shopify/Product/1", "gid://shopify/Product/2"], variantIds: [] } }],
      },
    },
  });
  const cart = formOf([
    ["intent", "run"],
    ["locale", "cs"],
    ["currency", "CZK"],
    ["date", "2026-09-29"],
    ["variantId", "gid://shopify/ProductVariant/101"],
    ["productId", "gid://shopify/Product/1"],
    ["quantity", "1"],
    ["variantId", "gid://shopify/ProductVariant/201"],
    ["productId", "gid://shopify/Product/2"],
    ["quantity", "1"],
  ]);
  await createSync({ ...productionSyncDeps(store, db.prisma, quiet), sleep: async () => {}, plan: async () => "free" }).syncShop(shop, (await loadConfig(db.prisma, shop)).config);
  const offRun = await tryCartAction(ctx, cart, { scopes: "write_discounts,read_products,read_themes" });
  assert.equal(offRun.plan?.margin, undefined);
  assert.equal(offRun.plan?.lines[0]!.discount, 500);

  await saveMarginSettings(ctx, settings(), { configVersion: (await loadConfig(db.prisma, shop)).version });
  await settle();
  const run = await tryCartAction(ctx, cart, { scopes: "write_discounts,read_products,read_themes" });
  assert.equal(run.result, null, JSON.stringify(run.result));
  const plan = run.plan!;
  assert.deepEqual(plan.margin, { rateEstimated: false, linesWithoutCost: 1 });
  assert.deepEqual(plan.lines.map((l) => [l.discount, l.marginCapped ?? false]), [
    [200, true], // 1000 − floor 800 (cost 600, 25 %)
    [600, true], // no cost: at most 30 %
  ]);
  assert.ok(plan.explain.some((e) => /nákupní cen/.test(e.text) && /25/.test(e.text)), JSON.stringify(plan.explain));
});

test("Vyzkoušet košík in another currency: the cost is converted with the median market/base price ratio and flagged as an estimate", async () => {
  const store = storeWithCatalogue();
  store.sync.markets = [
    { handle: "cz", name: "Česko", status: "ACTIVE", currency: "CZK", countries: ["CZ"] },
    { handle: "eu", name: "Eurozóna", status: "ACTIVE", currency: "EUR", countries: ["SK"] },
  ];
  const ctx = ctxFor(store);
  await saveConfig(db.prisma, shop, {
    markets: [
      { handle: "cz", currency: "CZK", enabled: true },
      { handle: "eu", currency: "EUR", enabled: true },
    ],
    modules: {
      codes: {
        rules: [{ id: "half", name: "Půlka", method: "automatic", value: { kind: "percentage", percent: 50 }, target: { kind: "products", productIds: ["gid://shopify/Product/1"], variantIds: [] } }],
      },
    },
  });
  await saveMarginSettings(ctx, settings({ minMarginPercent: 0 }), { configVersion: (await loadConfig(db.prisma, shop)).version });
  await settle();
  const run = await tryCartAction(
    ctx,
    formOf([
      ["intent", "run"],
      ["locale", "cs"],
      ["currency", "EUR:eu"],
      ["date", "2026-09-29"],
      ["variantId", "gid://shopify/ProductVariant/101"],
      ["productId", "gid://shopify/Product/1"],
      ["quantity", "1"],
    ]),
    { scopes: "write_discounts,read_products,read_themes,read_markets" },
  );
  assert.equal(run.result, null, JSON.stringify(run.result));
  // Rate 0.40 / 10.00 = 0.04: cost 6.00 CZK → 0.24 EUR = 24 cents; price 40 cents → at most 16 off (wanted 20).
  assert.deepEqual(run.plan!.margin, { rateEstimated: true, linesWithoutCost: 0 });
  assert.equal(run.plan!.lines[0]!.discount, 16);
  assert.equal(run.plan!.lines[0]!.marginCapped, true);
});

test("the rate estimate: 1 in the shop currency; else the median market/base ratio (even count → the mean of the middle two); none → unknown", () => {
  const cur = { currency: "EUR", shopCurrency: "CZK" };
  assert.deepEqual(estimateShopToCartRate([{ amount: "1", basePrice: "25" }], { currency: "CZK", shopCurrency: "CZK" }), { rate: 1, estimated: false });
  assert.deepEqual(
    estimateShopToCartRate(
      [
        { amount: "1.00", basePrice: "25.00" },
        { amount: "4.00", basePrice: "100.00" },
        { amount: "5.00", basePrice: "100.00" },
        { amount: null, basePrice: "10.00" },
      ],
      cur,
    ),
    { rate: 0.04, estimated: true },
  );
  assert.deepEqual(estimateShopToCartRate([{ amount: "1.00", basePrice: "20.00" }, { amount: "3.00", basePrice: "20.00" }], cur), { rate: 0.1, estimated: true });
  assert.deepEqual(estimateShopToCartRate([{ amount: "1.00", basePrice: "0" }], cur), { rate: null, estimated: false });
});

// --- Fix round 1: bounded work per admin request -------------------------------------------------

/** The DB with every variantCost.findMany recorded (to prove a load never reads the whole catalogue). */
function spyFindMany(prisma: PrismaClient): { db: PrismaClient; calls: unknown[] } {
  const calls: unknown[] = [];
  const delegate = new Proxy(prisma.variantCost, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver) as unknown;
      if (prop === "findMany") {
        return (args: unknown) => {
          calls.push(args);
          return (value as (a: unknown) => unknown).call(target, args);
        };
      }
      return typeof value === "function" ? (value as (...a: unknown[]) => unknown).bind(target) : value;
    },
  });
  const db = new Proxy(prisma, {
    get(target, prop, receiver) {
      if (prop === "variantCost") return delegate;
      const value = Reflect.get(target, prop, receiver) as unknown;
      return typeof value === "function" ? (value as (...a: unknown[]) => unknown).bind(target) : value;
    },
  });
  return { db, calls };
}

/** A findMany that cannot return the whole catalogue: a page (`take`) or a list of ids. */
function bounded(args: unknown): boolean {
  const a = (args ?? {}) as { take?: number; where?: { variantId?: { in?: unknown[] }; productId?: { in?: unknown[] } } };
  return (typeof a.take === "number" && a.take <= 100) || Array.isArray(a.where?.variantId?.in) || Array.isArray(a.where?.productId?.in);
}

test("the impact is computed once per state: a second screen load and the editor's count reuse it; a changed cost recomputes it", async () => {
  const store = storeWithCatalogue();
  const ctx = ctxFor(store, "pro");
  await saveConfig(db.prisma, shop, {
    modules: {
      codes: {
        rules: [{ id: "half", name: "Půlka", method: "automatic", value: { kind: "percentage", percent: 50 }, target: { kind: "products", productIds: ["gid://shopify/Product/1", "gid://shopify/Product/2"], variantIds: [] } }],
      },
    },
  });
  await saveMarginSettings(ctx, settings(), { configVersion: (await loadConfig(db.prisma, shop)).version });
  await settle();
  const before = marginCatalogueReads();
  const first = await loadMarginScreen(ctx);
  assert.equal(marginCatalogueReads(), before + 1, "computed once");
  const spy = spyFindMany(db.prisma);
  const second = await loadMarginScreen({ ...ctx, db: spy.db });
  assert.deepEqual(second.impact, first.impact);
  assert.equal(await ruleMarginImpact({ ...ctx, db: spy.db }, "half"), 3);
  await loadMarginOverview({ ...ctx, db: spy.db }, await loadConfig(db.prisma, shop), { timezone: null, trigger: true, shopCurrency: "CZK" });
  assert.equal(marginCatalogueReads(), before + 1, "the second load, the editor and Přehled did not re-read the catalogue");
  assert.ok(spy.calls.every(bounded), `every VariantCost read on those loads is bounded: ${JSON.stringify(spy.calls)}`);

  // A cost change (webhook mirror) changes the state: the next load recomputes once.
  store.sync.setCost("gid://shopify/ProductVariant/201", "15.00");
  const { startCostJob } = await import("../../app/lib/sync/cost-lane.server.ts");
  await startCostJob(shop, { client: store, db: db.prisma, plan: async () => "pro" }, { kind: "items", inventoryItemIds: ["gid://shopify/InventoryItem/201"] });
  const third = await loadMarginScreen(ctx);
  assert.equal(marginCatalogueReads(), before + 2);
  assert.notDeepEqual(third.impact, first.impact);
});

test("coverage: the margin screen and the Přehled card count in the same currency with the same bounded queries", async () => {
  const store = storeWithCatalogue();
  const ctx = ctxFor(store);
  await saveMarginSettings(ctx, settings(), { configVersion: null });
  await settle();
  const screen = await loadMarginScreen(ctx);
  const card = await loadMarginOverview(ctx, await loadConfig(db.prisma, shop), { timezone: null, trigger: false });
  assert.equal(card.productsWithoutCost, screen.coverage!.productsWithoutCost);
  const viaPage = await loadMarginOverview(ctx, await loadConfig(db.prisma, shop), { timezone: null, trigger: false, shopCurrency: "CZK" });
  assert.equal(viaPage.productsWithoutCost, screen.coverage!.productsWithoutCost);
});

test("a variant whose cost Shopify refuses is surfaced in the mirror status (the pass completed; the rest is written)", async () => {
  const store = storeWithCatalogue();
  store.sync.refusedOwners.add("gid://shopify/ProductVariant/301");
  const ctx = ctxFor(store);
  await saveMarginSettings(ctx, settings(), { configVersion: null });
  await settle();
  assert.deepEqual(store.sync.variantCostMetafield("gid://shopify/ProductVariant/101"), { cost: 6, cur: "CZK" });
  const data = await loadMarginScreen(ctx);
  assert.equal(data.mirror.state, "failed");
  const problem = data.mirror.state === "failed" ? data.mirror.problems[0] : undefined;
  assert.equal(problem?.key, "margin.mirror.refused", "its own sentence, not an English detail in a generic one");
  assert.equal(problem?.params?.n, 1);
  assert.equal(problem?.params?.title, "Čepice");
  assert.match(String(problem?.params?.detail), /Value is invalid/);
  const { t } = await import("../../app/i18n/index.ts");
  assert.match(t("cs", problem!.key, problem!.params), /^Shopify odmítl zapsat nákupní cenu u variant: 1 \(např\. Čepice\)/);
});

test("a cs save that the sanitizer adjusts reports the adjustments in Czech (rounded + clamped percent)", async () => {
  const store = storeWithCatalogue();
  const ctx = ctxFor(store);
  const result = await saveMarginSettings(ctx, settings({ minMarginPercent: 12.35, maxDiscountPercent: 120 }), { configVersion: null });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.deepEqual(result.ok ? result.fixes : null, [
    "Hodnota 120\u00a0% je mimo rozsah 0 až 100\u00a0%, uložilo se 100\u00a0%.",
    "Procenta marže mají jedno desetinné místo. 12,35\u00a0% se zaokrouhlilo na 12,4\u00a0%, na přísnější stranu.",
  ]);
  await settle();
  const en = await saveMarginSettings({ ...ctx, locale: "en" }, settings({ minMarginPercent: 20.05 }), { configVersion: (await loadConfig(db.prisma, shop)).version });
  assert.deepEqual(en.ok ? en.fixes : null, ["Margin percents have one decimal. 20.05% was rounded to 20.1%, the stricter way."]);
  await settle();
});

test("a no-op products/update or a no-op full pass does not invalidate the impact cache", async () => {
  const store = storeWithCatalogue();
  const ctx = ctxFor(store, "pro");
  await saveConfig(db.prisma, shop, {
    modules: {
      codes: {
        rules: [{ id: "half", name: "Půlka", method: "automatic", value: { kind: "percentage", percent: 50 }, target: { kind: "products", productIds: ["gid://shopify/Product/1"], variantIds: [] } }],
      },
    },
  });
  await saveMarginSettings(ctx, settings(), { configVersion: (await loadConfig(db.prisma, shop)).version });
  await settle();
  await loadMarginScreen(ctx);
  const reads = marginCatalogueReads();
  const { startCostJob } = await import("../../app/lib/sync/cost-lane.server.ts");
  const lane = { client: store, db: db.prisma, plan: async () => "pro" as const };
  const mirrored = await startCostJob(shop, lane, { kind: "items", productIds: ["gid://shopify/Product/1", "gid://shopify/Product/2"] });
  assert.equal(mirrored.done, "items");
  const pass = await startCostJob(shop, lane, { kind: "full", restart: true });
  assert.equal(pass.done === "full" && pass.result.outcome, "done");
  await loadMarginScreen(ctx);
  assert.equal(marginCatalogueReads(), reads, "nothing meaningful changed: the cached impact is reused");
});


test("linesWithoutCost counts the lines margin protection applies to whose cost is unknown — not outlet or gift lines, capped or not", async () => {
  const { planTryCart } = await import("../../app/lib/integration/try-cart-plan.ts");
  const { sanitizeConfig } = await import("@won/core/discounts/config");
  const { config } = sanitizeConfig({
    modules: {
      codes: {
        rules: [{ id: "half", name: "Půlka", method: "automatic", value: { kind: "percentage", percent: 50 }, target: { kind: "products", productIds: ["gid://shopify/Product/1", "gid://shopify/Product/2"], variantIds: [] } }],
      },
      margin: { enabled: true, global: { minMarginPercent: 0, maxDiscountPercent: 30 }, perCollection: [] },
    },
  });
  const line = (n: number, extra: Record<string, unknown> = {}) => ({
    variantId: `gid://shopify/ProductVariant/${n}01`,
    productId: `gid://shopify/Product/${n}`,
    title: `P${n}`,
    quantity: 1,
    unitPrice: 1000,
    collectionIds: [],
    ...extra,
  });
  const refs = new Map([
    ["gid://shopify/Product/1", { ruleIds: ["half"], variantRuleIds: {} }],
    ["gid://shopify/Product/2", { ruleIds: ["half"], variantRuleIds: {} }],
  ]);
  const plan = planTryCart(config, {
    lines: [
      line(1, { unitCost: 6, unitCostCurrency: "CZK" }), // cost known: not counted
      line(2), // no cost, discount capped by the 30 % ceiling: counted
      line(3), // no cost, no discount at all (not targeted): counted — the ceiling would still be its floor
      line(4, { outlet: true }), // outlet: margin never applies — not counted
      line(5, { giftTierId: "g1" }), // gift: not counted
    ],
    productRefs: refs,
    currency: "CZK",
    shopCurrency: "CZK",
    shopToCartRate: 1,
    countryCode: null,
    codes: [],
    date: "2026-09-29",
    time: "12:00:00",
    shopTimezone: "Europe/Prague",
    locale: "cs",
  });
  assert.deepEqual(plan.margin, { rateEstimated: false, linesWithoutCost: 2 });
  assert.deepEqual(plan.lines.map((l) => l.marginCapped ?? false), [true, true, false, false, false]);
});
