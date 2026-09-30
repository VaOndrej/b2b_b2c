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
  marginImpactIdle,
  readMarginForm,
  refreshCostsAction,
  ruleMarginImpact,
  saveMarginSettings,
} from "../../app/lib/integration/margin.server.ts";
import { setMarginImpactMinInterval } from "../../app/lib/integration/margin-impact.server.ts";
import type { MarginImpactClock } from "../../app/lib/integration/margin-impact.server.ts";
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
  // The 30 s minimum interval between two impact computations of a shop has its own test (below); here every change recomputes at once.
  setMarginImpactMinInterval(0);
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
  await marginImpactIdle(s);
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
        // Titles are never taken from the form, and never a GID: "" (the page reads them).
        { collectionId: COLLECTION, title: "", minMarginPercent: 30, maxDiscountPercent: null },
        { collectionId: "gid://shopify/Collection/6", title: "", minMarginPercent: null, maxDiscountPercent: 10 },
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
  await loadMarginScreen(ctx); // schedules the impact if the background has not computed this state yet
  await settle();
  const data = await loadMarginScreen(ctx);
  assert.equal(data.plan, "pro");
  assert.deepEqual(data.gateNotes, []);
  const impact = data.impact!;
  assert.ok(impact);
  assert.equal(impact.status, "ready");
  // Tričko: price 1000, cost 600, m 25 % → floor 800 → allowed 200 (wanted 500). Mikina: no cost, p 30 % → allowed 600 (wanted 1000).
  const half = impact.rules.find((r) => r.ruleId === "half")!;
  assert.deepEqual([half.ruleName, half.discountClass, half.variants], ["Půlka", "product", 3]);
  assert.deepEqual(
    half.rows.map((r) => [r.variantId, r.wanted, r.allowed, r.basis, r.source]),
    [
      ["gid://shopify/ProductVariant/201", 1000, 600, "max_percent", "global"],
      ["gid://shopify/ProductVariant/202", 1000, 600, "max_percent", "global"],
      ["gid://shopify/ProductVariant/101", 500, 200, "cost", "global"],
    ],
  );
  assert.equal(half.rows[2]!.title, "Tričko");
  // The order rule (20 %): Tričko 200 ≤ 200 fine; Čepice (collection m 60 %: floor 1000 ≥ price) → below.
  assert.deepEqual(
    impact.rules.filter((r) => r.discountClass === "order").map((r) => [r.ruleId, r.ruleName, r.variants, r.rows.length]),
    [["order", "Objednávka", 1, 0]],
  );
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

test("ruleMarginImpact: null while protection is off; on: Pro gets the number of variants, Free no number", async () => {
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
  await ruleMarginImpact(ctx, "half"); // the product refs changed after the save's own recompute: this load schedules the current state
  await settle();
  // Free: protection lowers "half" somewhere — said without a number (přehled zásahů is Pro).
  assert.deepEqual(await ruleMarginImpact(ctx, "half"), { state: "ready", discountClass: "product" });
  assert.equal(await ruleMarginImpact(ctx, "tiny"), null, "never lowered: no note");
  assert.equal(await ruleMarginImpact(ctx, "missing"), null);
  // Pro: the count of variants.
  const pro = ctxFor(store, "pro");
  await ruleMarginImpact(pro, "half");
  await settle();
  assert.deepEqual(await ruleMarginImpact(pro, "half"), { state: "ready", discountClass: "product", variants: 3 });
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
  assert.deepEqual(plan.margin, { rateEstimated: false, linesWithoutCost: 1, linesCostNotConverted: 0 });
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
  assert.deepEqual(run.plan!.margin, { rateEstimated: true, linesWithoutCost: 0, linesCostNotConverted: 0 });
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

test("a loader never reads the catalogue (audit P3-5): the impact is computed in the background, the page says 'počítá se' meanwhile", async () => {
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
  await settle(); // the save and the cost pass recomputed it in the background
  const spy = spyFindMany(db.prisma);
  const reads = marginCatalogueReads();
  const first = await loadMarginScreen({ ...ctx, db: spy.db });
  assert.equal(first.impact?.status, "ready", "computed after the save / the cost pass, before anyone opened the page");
  assert.equal(await ruleMarginImpact({ ...ctx, db: spy.db }, "half").then((v) => (v && v.state !== "computing" ? v.variants : null)), 3);
  await loadMarginOverview({ ...ctx, db: spy.db }, await loadConfig(db.prisma, shop), { timezone: null, trigger: true, shopCurrency: "CZK" });
  assert.equal(marginCatalogueReads(), reads, "the screen, the editor and Přehled read no catalogue");
  assert.ok(spy.calls.every(bounded), `every VariantCost read on those loads is bounded: ${JSON.stringify(spy.calls)}`);

  // A cost change (webhook mirror): the lane recomputes in the background; a load meanwhile shows the last numbers.
  store.sync.setCost("gid://shopify/ProductVariant/201", "15.00");
  const { startCostJob } = await import("../../app/lib/sync/cost-lane.server.ts");
  await startCostJob(shop, { client: store, db: db.prisma, plan: async () => "pro" }, { kind: "items", inventoryItemIds: ["gid://shopify/InventoryItem/201"] });
  await settle();
  const second = await loadMarginScreen(ctx);
  assert.equal(second.impact?.status, "ready");
  assert.notDeepEqual(second.impact, first.impact);
  assert.equal(marginCatalogueReads(), reads + 1, "one background computation for the cost change");

  // A state no trigger saw (a restart, a product sync): the load does not compute it — it schedules it and says so.
  const { clearMarginImpactCache } = await import("../../app/lib/integration/margin.server.ts");
  clearMarginImpactCache();
  const before = marginCatalogueReads();
  const cold = await loadMarginScreen(ctx);
  assert.equal(cold.impact?.status, "computing");
  assert.deepEqual(cold.impact?.rules, []);
  assert.equal(marginCatalogueReads(), before, "not inside the request");
  await marginImpactIdle(shop);
  assert.equal(marginCatalogueReads(), before + 1, "computed once in the background");
  assert.equal((await loadMarginScreen(ctx)).impact?.status, "ready");
  // The editor's note on a cold state says the same.
  clearMarginImpactCache();
  assert.deepEqual(await ruleMarginImpact(ctx, "half"), { state: "computing" });
  await marginImpactIdle(shop);
  assert.deepEqual(await ruleMarginImpact(ctx, "half"), { state: "ready", discountClass: "product", variants: 3 });
});

test("Přehled zásahů per rule (audit P2-2): a rule outside the largest losses still has its rows and its full count; the counts equal the editor's", async () => {
  const store = new FakeStore();
  const big: string[] = [];
  for (let i = 1; i <= 60; i += 1) {
    const product = store.sync.addProduct(100 + i, 1); // price 10.00, no cost: the 30 % ceiling
    big.push(product.id);
  }
  const small = [store.sync.addProduct(201, 1).id, store.sync.addProduct(202, 1).id];
  const ctx = ctxFor(store, "pro");
  await saveConfig(db.prisma, shop, {
    modules: {
      codes: {
        rules: [
          // 60 % off 60 products: 30 % more than the ceiling allows — the largest losses.
          { id: "big", name: "Velká", method: "automatic", value: { kind: "percentage", percent: 60 }, target: { kind: "products", productIds: big, variantIds: [] } },
          // 40 % off 2 products: 10 % over — never among a global top 50.
          { id: "small", name: "Malá", method: "automatic", value: { kind: "percentage", percent: 40 }, target: { kind: "products", productIds: small, variantIds: [] } },
        ],
      },
    },
  });
  await saveMarginSettings(ctx, settings(), { configVersion: (await loadConfig(db.prisma, shop)).version });
  await settle();
  await loadMarginScreen(ctx);
  await settle();
  const all = (await loadMarginScreen(ctx)).impact!;
  assert.deepEqual(all.rules.map((r) => [r.ruleId, r.variants, r.rows.length]), [
    ["big", 60, 10],
    ["small", 2, 2],
  ]);
  const focused = (await loadMarginScreen(ctx, { focusRuleId: "small" })).impact!;
  assert.deepEqual(focused.focus, { ruleId: "small", ruleName: "Malá" });
  assert.deepEqual(focused.rules.map((r) => [r.ruleId, r.variants, r.rows.length]), [["small", 2, 2]], "the filter is applied on the server: never empty");
  for (const rule of all.rules) {
    const note = await ruleMarginImpact(ctx, rule.ruleId);
    assert.deepEqual(note, { state: "ready", discountClass: "product", variants: rule.variants }, "the editor's number is the overview's");
  }
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
  const problems = data.mirror.state === "failed" ? data.mirror.problems : [];
  assert.equal(problems[0]?.key, "margin.mirror.refused", "its own sentence, not an English detail in a generic one");
  assert.deepEqual(problems[0]?.params, { n: 1, title: "Čepice" }, "the Czech sentence carries no Shopify text");
  assert.equal(problems[1]?.key, "margin.mirror.detail", "Shopify's own words only as a secondary detail");
  assert.match(String(problems[1]?.params?.detail), /Value is invalid/);
  const { t } = await import("../../app/i18n/index.ts");
  assert.match(t("cs", problems[0]!.key, problems[0]!.params), /^Shopify odmítl zapsat nákupní cenu u variant: 1 \(např\. Čepice\)\./);
  assert.doesNotMatch(t("cs", problems[0]!.key, problems[0]!.params), /Value is invalid|gid:\/\//);
});

test("a failed cost READ is said as a read failure in its own sentence (never 'Část změn se do Shopify nepropsala'), the technical detail second", async () => {
  const { costMirrorView } = await import("../../app/lib/integration/costs.server.ts");
  const failed = { token: "t", since: "2026-09-29T08:00:00.000Z", done: 150, total: 900, failedAt: "2026-09-29T08:05:00.000Z", error: "costs.read: Throttled (3 attempts)" };
  await db.prisma.shopSyncState.create({ data: { shop, costsPending: JSON.stringify(failed) } });
  const view = await costMirrorView({ db: db.prisma, shop }, { enabled: true, timezone: "Europe/Prague" });
  assert.equal(view.state, "failed");
  const problems = view.state === "failed" ? view.problems : [];
  assert.deepEqual(problems, [
    { key: "margin.mirror.readFailed" },
    { key: "margin.mirror.detail", params: { detail: "costs.read: Throttled (3 attempts)" } },
  ]);
  const { t } = await import("../../app/i18n/index.ts");
  assert.match(t("cs", "margin.mirror.readFailed"), /^Nákupní ceny se nepodařilo načíst/);
  await db.prisma.shopSyncState.update({ where: { shop }, data: { costsPending: JSON.stringify({ ...failed, error: "costs.set: HTTP 502" }) } });
  const write = await costMirrorView({ db: db.prisma, shop }, { enabled: true, timezone: null });
  assert.equal(write.state === "failed" ? write.problems[0]?.key : null, "margin.mirror.writeFailed");
});

test("no usable offline session (OQ4): the reconcile records it, the admin says 'open the app', and a load with a session retries at once", async () => {
  const { runCostReconcileOnce } = await import("../../app/lib/jobs/cost-reconcile.server.ts");
  const { costMirrorView } = await import("../../app/lib/integration/costs.server.ts");
  const { ensureCostsFresh } = await import("../../app/lib/sync/cost-lane.server.ts");
  const store = storeWithCatalogue();
  await saveConfig(db.prisma, shop, { modules: { margin: { enabled: true, global: { maxDiscountPercent: 50 }, perCollection: [] } } });
  const now = new Date("2026-09-29T10:00:00Z");
  const result = await runCostReconcileOnce({ db: db.prisma, clientFor: async () => null, plan: async () => "free", now: () => now });
  assert.ok(result.skippedNoSession >= 1);
  const view = await costMirrorView({ db: db.prisma, shop, now: () => now }, { enabled: true, timezone: null });
  assert.equal(view.state, "failed");
  assert.deepEqual(view.state === "failed" ? view.problems : null, [{ key: "margin.mirror.reauth" }]);
  const { t } = await import("../../app/i18n/index.ts");
  assert.match(t("cs", "margin.mirror.reauth"), /Otevři appku, ať můžeme pokračovat na pozadí/);
  // The next admin load has a session: the pass starts at once (no 15-min retry wait for this failure).
  const started = await ensureCostsFresh(shop, { client: store, db: db.prisma, plan: async () => "free", now: () => new Date(now.getTime() + 60_000) }, true);
  assert.equal(started, "started_full");
  await settle();
  assert.equal((await costMirrorView({ db: db.prisma, shop, now: () => now }, { enabled: true, timezone: null })).state, "fresh");
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
  await settle();
  const reads = marginCatalogueReads();
  const { startCostJob } = await import("../../app/lib/sync/cost-lane.server.ts");
  const lane = { client: store, db: db.prisma, plan: async () => "pro" as const };
  const mirrored = await startCostJob(shop, lane, { kind: "items", productIds: ["gid://shopify/Product/1", "gid://shopify/Product/2"] });
  assert.equal(mirrored.done, "items");
  const pass = await startCostJob(shop, lane, { kind: "full", restart: true });
  assert.equal(pass.done === "full" && pass.result.outcome, "done");
  await settle();
  assert.equal((await loadMarginScreen(ctx)).impact?.status, "ready");
  assert.equal(marginCatalogueReads(), reads, "nothing meaningful changed: the stored impact is reused");
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
  assert.deepEqual(plan.margin, { rateEstimated: false, linesWithoutCost: 2, linesCostNotConverted: 0 });
  assert.deepEqual(plan.lines.map((l) => l.marginCapped ?? false), [true, true, false, false, false]);
});

test("Vyzkoušet košík: a line that HAS a cost it could not convert (no usable rate) is never said to have 'no cost price' (audit P2-1c)", async () => {
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
  const run = (locale: "cs" | "en") =>
    planTryCart(config, {
      lines: [line(1, { unitCost: 6, unitCostCurrency: "CZK" }), line(2)],
      productRefs: new Map([
        ["gid://shopify/Product/1", { ruleIds: ["half"], variantRuleIds: {} }],
        ["gid://shopify/Product/2", { ruleIds: ["half"], variantRuleIds: {} }],
      ]),
      currency: "EUR",
      shopCurrency: "CZK",
      shopToCartRate: null, // no usable rate: the cost cannot be converted
      countryCode: null,
      codes: [],
      date: "2026-09-29",
      time: "12:00:00",
      shopTimezone: "Europe/Prague",
      locale,
    });
  const plan = run("cs");
  assert.deepEqual(plan.margin, { rateEstimated: false, linesWithoutCost: 1, linesCostNotConverted: 1 });
  const only = (id: string) => (e: { lineIds?: string[] }) => e.lineIds?.length === 1 && e.lineIds[0] === id;
  const costed = plan.explain.filter(only("L1"));
  const bare = plan.explain.filter(only("L2"));
  assert.ok(costed.length > 0 && bare.length > 0, JSON.stringify(plan.explain));
  for (const item of costed) {
    assert.doesNotMatch(item.text, /nemá nákupní cenu/, item.text);
    assert.match(item.text, /nákupní cenu nešlo přepočítat do EUR, proto je sleva nejvýš 30\u00a0%/);
  }
  assert.ok(bare.some((e) => /položka nemá nákupní cenu/.test(e.text)), "a line without any cost keeps the engine's sentence");
  const en = run("en").explain.filter(only("L1"));
  assert.ok(en.every((e) => !/has no cost price/.test(e.text)) && en.some((e) => /could not be converted to EUR/.test(e.text)), JSON.stringify(en));
});

test("a Pro collection too large to read (P1-1): the margin screen and the Přehled card name it, and the impact counts with the folded, stricter values checkout runs", async () => {
  const store = storeWithCatalogue();
  store.sync.collectionCounts.set(COLLECTION, 12_000);
  store.sync.collectionTitles.set(COLLECTION, "Zimní");
  const ctx = ctxFor(store, "pro");
  await saveConfig(db.prisma, shop, {
    modules: {
      codes: {
        rules: [{ id: "half", name: "Půlka", method: "automatic", value: { kind: "percentage", percent: 50 }, target: { kind: "products", productIds: ["gid://shopify/Product/1"], variantIds: [] } }],
      },
    },
  });
  await saveMarginSettings(
    ctx,
    settings({ minMarginPercent: 25, collections: [{ collectionId: COLLECTION, title: "", minMarginPercent: 60, maxDiscountPercent: null }] }),
    { configVersion: (await loadConfig(db.prisma, shop)).version },
  );
  await settle();
  await loadMarginScreen(ctx);
  await settle();
  const data = await loadMarginScreen(ctx);
  assert.deepEqual(data.tooLarge, [{ collectionId: COLLECTION, title: "Zimní", count: null }]);
  // Tričko (price 10.00, cost 6.00) is not in the collection, but checkout runs the folded 60 %: floor 15.00 ≥ price → nothing allowed.
  const half = data.impact!.rules.find((r) => r.ruleId === "half")!;
  assert.deepEqual(half.rows.map((r) => [r.variantId, r.wanted, r.allowed]), [["gid://shopify/ProductVariant/101", 500, 0]]);
  const card = await loadMarginOverview(ctx, await loadConfig(db.prisma, shop), { timezone: null, trigger: false, shopCurrency: "CZK" });
  assert.deepEqual(card.tooLarge, [{ collectionId: COLLECTION, title: "Zimní", count: null }]);
  // Přehled's card carries it from the last product pass — the sync line only shows the LATEST run, which a
  // later background lane may have replaced with an OK one.
  const overview = await overviewData(ctx, { scopes: "write_discounts,read_products,read_themes", syncDeadlineMs: 2_000, nativeDeadlineMs: 50 });
  assert.deepEqual(overview.options.signals.margin?.tooLarge, [{ collectionId: COLLECTION, title: "Zimní", count: null }]);
  await settle();
});

test("an untitled product is never named by its GID (audit fix round 2): coverage sample and Try Cart say 'Produkt bez názvu'", async () => {
  const store = storeWithCatalogue();
  store.sync.products.get("gid://shopify/Product/2")!.title = undefined; // Mikina (no cost) loses its title
  store.titles.set("gid://shopify/ProductVariant/101", { product: "", variant: "Default Title" });
  const ctx = ctxFor(store);
  await saveConfig(db.prisma, shop, {
    modules: {
      codes: {
        rules: [{ id: "half", name: "Půlka", method: "automatic", value: { kind: "percentage", percent: 50 }, target: { kind: "products", productIds: ["gid://shopify/Product/1"], variantIds: [] } }],
      },
    },
  });
  await saveMarginSettings(ctx, settings(), { configVersion: (await loadConfig(db.prisma, shop)).version });
  await settle();
  const data = await loadMarginScreen(ctx);
  assert.deepEqual(data.coverage?.sample.map((p) => p.title), [""], "untitled = '' (the screen words it)");
  const { renderToStaticMarkup } = await import("react-dom/server");
  const { createElement } = await import("react");
  const { CostsSection } = await import("../../app/components/margin/CostsSection.tsx");
  const { LocaleProvider } = await import("../../app/i18n/context.tsx");
  const html = renderToStaticMarkup(
    createElement(LocaleProvider as never, { locale: "cs" } as never, createElement(CostsSection, { coverage: data.coverage, mirror: { state: "running", done: 1, total: 4, since: "2026-09-29T10:00:00" }, maxDiscountPercent: 30 })),
  );
  assert.match(html, /Produkt bez názvu/);
  assert.doesNotMatch(html.replace(/href="[^"]*"/g, ""), /gid:\/\//);
  const run = await tryCartAction(
    ctx,
    formOf([
      ["intent", "run"],
      ["locale", "cs"],
      ["currency", "CZK"],
      ["date", "2026-09-29"],
      ["variantId", "gid://shopify/ProductVariant/101"],
      ["productId", "gid://shopify/Product/1"],
      ["quantity", "1"],
    ]),
    { scopes: "write_discounts,read_products,read_themes" },
  );
  assert.equal(run.result, null, JSON.stringify(run.result));
  assert.equal(run.plan!.lines[0]!.title, "Produkt bez názvu");
  assert.ok(run.plan!.explain.every((e) => !/gid:\/\//.test(e.text)));
});

test("Try Cart runs what checkout runs: a margin collection too large to read is folded into the whole store's values (audit fix round 2)", async () => {
  const store = storeWithCatalogue();
  const ctx = ctxFor(store, "pro");
  await saveConfig(db.prisma, shop, {
    modules: {
      codes: {
        rules: [{ id: "half", name: "Půlka", method: "automatic", value: { kind: "percentage", percent: 50 }, target: { kind: "products", productIds: ["gid://shopify/Product/2"], variantIds: [] } }],
      },
    },
  });
  // Mikina (no cost, price 20.00) is not in collection 5; the store-wide ceiling is 50 %, collection 5 allows 10 %.
  await saveMarginSettings(ctx, settings({ maxDiscountPercent: 50, collections: [{ collectionId: COLLECTION, title: "", minMarginPercent: null, maxDiscountPercent: 10 }] }), {
    configVersion: (await loadConfig(db.prisma, shop)).version,
  });
  await settle();
  const cart = formOf([
    ["intent", "run"],
    ["locale", "cs"],
    ["currency", "CZK"],
    ["date", "2026-09-29"],
    ["variantId", "gid://shopify/ProductVariant/201"],
    ["productId", "gid://shopify/Product/2"],
    ["quantity", "1"],
  ]);
  const scopes = { scopes: "write_discounts,read_products,read_themes" };
  assert.equal((await tryCartAction(ctx, cart, scopes)).plan!.lines[0]!.discount, 1000, "as stored: 50 % of 20.00");
  await db.prisma.syncRun.create({
    data: {
      shop,
      startedAt: new Date(Date.now() + 60_000),
      ok: false,
      steps: JSON.stringify([
        { step: "margin.too_large", ok: false, detail: "x", params: { collectionId: COLLECTION, collection: "Zimní", count: null } },
        { step: "products.scope", ok: true, detail: "x" },
            { step: "shop_config.write", ok: true, detail: "x" },
      ]),
    },
  });
  assert.equal((await tryCartAction(ctx, cart, scopes)).plan!.lines[0]!.discount, 200, "folded: at most 10 % for the whole store");
});

test("Pro preview with protection OFF and a folded collection: the loader and the background count for the SAME config — 'ready' stays 'ready' (audit fix round 2)", async () => {
  const store = storeWithCatalogue();
  const ctx = ctxFor(store, "pro");
  await saveConfig(db.prisma, shop, {
    modules: {
      codes: {
        rules: [{ id: "half", name: "Půlka", method: "automatic", value: { kind: "percentage", percent: 50 }, target: { kind: "products", productIds: ["gid://shopify/Product/1"], variantIds: [] } }],
      },
      margin: { enabled: false, global: { maxDiscountPercent: 50 }, perCollection: [{ collectionId: COLLECTION, maxDiscountPercent: 10 }] },
    },
  });
  await db.prisma.syncRun.create({
    data: {
      shop,
      ok: false,
      steps: JSON.stringify([
        { step: "margin.too_large", ok: false, detail: "x", params: { collectionId: COLLECTION, collection: "Zimní", count: null } },
        { step: "products.scope", ok: true, detail: "x" },
            { step: "shop_config.write", ok: true, detail: "x" },
      ]),
    },
  });
  const { refreshMarginImpact } = await import("../../app/lib/integration/margin-impact.server.ts");
  await refreshMarginImpact(shop, { db: db.prisma, client: store, plan: async () => "pro" });
  await settle();
  const reads = marginCatalogueReads();
  for (let i = 0; i < 3; i += 1) {
    assert.equal((await loadMarginScreen(ctx)).impact?.status, "ready", `load ${i + 1}`);
    await settle();
  }
  assert.equal(marginCatalogueReads(), reads, "no load recomputed: both sides key the same config");
});

/**
 * A clock for `setMarginImpactClock` whose `wait` never resolves on its own —
 * only when `releaseWaits` is called — so a test can drive the coalescing
 * race deterministically: fire a burst of triggers, wait for them all to
 * register (`marginImpactPrepared`), assert nothing computed yet, then
 * release. `now()` starts at the real clock so it composes with a
 * `lastComputedAt` recorded earlier under the real clock (see the test
 * below), without ever depending on real elapsed time for correctness.
 */
function fakeMarginClock(): { clock: MarginImpactClock; requestedDelays: number[]; releaseWaits(): void } {
  let t = Date.now();
  const pendingResolvers: (() => void)[] = [];
  const requestedDelays: number[] = [];
  return {
    requestedDelays,
    clock: {
      now: () => t,
      wait: (ms: number) => {
        requestedDelays.push(ms);
        return new Promise<void>((resolve) => {
          pendingResolvers.push(() => {
            t += ms;
            resolve();
          });
        });
      },
    },
    releaseWaits() {
      const resolvers = pendingResolvers.splice(0);
      for (const resolve of resolvers) resolve();
    },
  };
}

test("background recompute (audit fix round 2): Pro shops only, and at most once per minimum interval per shop", async () => {
  const {
    refreshMarginImpact,
    setMarginImpactMinInterval: setInterval,
    setMarginImpactClock,
    marginImpactPrepared,
  } = await import("../../app/lib/integration/margin-impact.server.ts");
  const { startCostJob } = await import("../../app/lib/sync/cost-lane.server.ts");
  // Free, protection on: a webhook batch recomputes nothing (the editor note computes on demand).
  const free = storeWithCatalogue();
  const freeCtx = ctxFor(free, "free");
  await saveMarginSettings(freeCtx, settings(), { configVersion: null });
  await settle();
  const before = marginCatalogueReads();
  free.sync.setCost("gid://shopify/ProductVariant/201", "11.00");
  await startCostJob(shop, { client: free, db: db.prisma, plan: async () => "free" }, { kind: "items", inventoryItemIds: ["gid://shopify/InventoryItem/201"] });
  await settle();
  assert.equal(marginCatalogueReads(), before, "Free: nothing computed in the background");

  // Pro: a burst of changes within the interval → one computation after it.
  shop = `${shop}-pro`;
  const pro = storeWithCatalogue();
  const proCtx = ctxFor(pro, "pro");
  await saveMarginSettings(proCtx, settings(), { configVersion: null });
  await settle();
  setInterval(300);
  const fake = fakeMarginClock();
  setMarginImpactClock(fake.clock);
  try {
    const first = marginCatalogueReads();
    for (const cost of ["7.00", "8.00", "9.00"]) {
      pro.sync.setCost("gid://shopify/ProductVariant/101", cost);
      await startCostJob(shop, { client: pro, db: db.prisma, plan: async () => "pro" }, { kind: "items", inventoryItemIds: ["gid://shopify/InventoryItem/101"] });
    }
    void refreshMarginImpact(shop, { db: db.prisma, client: pro, plan: async () => "pro" });
    // All four triggers have registered with the coalesced job — deterministic,
    // no real timer involved yet — before we let the interval's wait resolve.
    await marginImpactPrepared(shop);
    assert.equal(marginCatalogueReads(), first, "parked on the interval, nothing computed yet");
    assert.ok(fake.requestedDelays.length >= 1 && fake.requestedDelays[0] >= 250, "waited close to the full interval since the last computation");
    fake.releaseWaits();
    await marginImpactIdle(shop);
    assert.equal(marginCatalogueReads(), first + 1, "coalesced into one computation");
    assert.equal((await loadMarginScreen(proCtx)).impact?.status, "ready", "and it is the newest state's");
  } finally {
    setMarginImpactClock(null);
    setInterval(0);
  }
});
