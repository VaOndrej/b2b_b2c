import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";

import { buildMarginPayload, resolveMargin } from "@won/core/discounts/margin";
import { productRuleIndex } from "@won/core/discounts/targeting";

import { onlyAddsRefs } from "../../../app/lib/sync/products.ts";
import { createSync } from "../../../app/lib/sync/sync.server.ts";
import { createTestDatabase, type TestDatabase } from "../test-db.ts";
import { FakeShopify } from "./fake-shopify.ts";
import { autoRule, configWith, makeDeps } from "./helpers.ts";

// Margin protection around the sync's limits and lanes (MVP 2 audit fixes):
//   P1-1  the 10 000-product collection limit fails CLOSED for margin: margin
//         collections are counted first; one that still does not fit is folded
//         into the shop payload's global values (and every other collection's),
//         strictest wins, and products that already carry its ref keep it;
//   P2-3  a product whose marginRefs CHANGE (added, replaced, removed while the
//         collection's setting is still in force) is written BEFORE the shop
//         config, and a failed such write holds the new config (stale risk);
//   P2-1d protection on and no shop currency → nothing written, config held.
// (margin-refs.test.ts pins the targeting itself; the core decides which refs a product carries.)

let db: TestDatabase;
let seq = 0;
let shop: string;
before(() => {
  db = createTestDatabase("sync-margin-limits");
});
after(async () => {
  await db.drop();
});
beforeEach(() => {
  seq += 1;
  shop = `margin-limits-${seq}.myshopify.com`;
});

const COLLECTION = "gid://shopify/Collection/5";
const OTHER = "gid://shopify/Collection/6";

function marginConfig(opts: { enabled?: boolean; rules?: unknown[]; perCollection?: unknown[] } = {}) {
  return configWith(opts.rules ?? [], {
    modules: {
      codes: { rules: opts.rules ?? [] },
      margin: {
        enabled: opts.enabled ?? true,
        global: { minMarginPercent: 10, maxDiscountPercent: 40 },
        perCollection: opts.perCollection ?? [{ collectionId: COLLECTION, minMarginPercent: 30 }],
      },
    },
  });
}

/** Real engine targeting (the refs checkout reads). */
function realDeps(fake: FakeShopify, plan: "free" | "pro" = "pro") {
  const deps = makeDeps(fake, db.prisma, {
    plan: async () => plan,
    productRuleIndex: (config, products) => productRuleIndex(config, products),
  });
  return { deps };
}

// --- The 10 000-product limit (audit P1-1: fail closed) --------------------------------------------

/** The margin settings a product actually gets from a shop config the sync built (the engine's own resolution). */
function floorFor(shopConfig: { modules: { margin: unknown } }, marginRefs: string[]) {
  const payload = buildMarginPayload(shopConfig.modules.margin as Parameters<typeof buildMarginPayload>[0], "CZK");
  return resolveMargin(payload, marginRefs)!;
}

test("margin collections are counted into the 10 000 limit FIRST: rule collection 9 500 + margin collection 600 → the margin collection is read", async () => {
  const fake = new FakeShopify();
  const low = fake.addProduct(1);
  const ruled = fake.addProduct(2);
  fake.addCollection(7, [ruled.id]);
  fake.collectionCounts.set("gid://shopify/Collection/7", 9_500);
  fake.addCollection(5, [low.id]);
  fake.collectionCounts.set(COLLECTION, 600);
  const { deps } = realDeps(fake);
  const config = marginConfig({
    rules: [autoRule("r", { target: { kind: "collections", ids: ["gid://shopify/Collection/7"] } })],
    perCollection: [{ collectionId: COLLECTION, minMarginPercent: 40 }],
  });
  const result = await createSync(deps).syncShop(shop, config);
  assert.deepEqual(fake.productMetafield(low.id), { ruleIds: [], variantRuleIds: {}, marginRefs: ["5"] }, "the margin collection is indexed");
  assert.equal(result.steps.some((s) => s.step === "margin.too_large"), false, JSON.stringify(result.steps));
  const ruleStep = result.steps.find((s) => s.step === "products.too_large:r");
  assert.ok(ruleStep && !ruleStep.ok, "the RULE collection is the one left out (fail closed: less discount)");
  assert.doesNotMatch(ruleStep!.detail, /gid:\/\//, "titles, not GIDs");
  const shopConfig = deps.log.shopConfigs.at(-1)!;
  assert.equal(shopConfig.modules.margin.global.minMarginPercent, 10, "nothing folded: the margin collection fits");
});

test("a margin collection that still does not fit is folded into the payload's global values (and every other collection's): no product gets a looser floor", async () => {
  const fake = new FakeShopify();
  const inBig = fake.addProduct(1);
  const inBoth = fake.addProduct(2);
  const inOther = fake.addProduct(3);
  const outside = fake.addProduct(4);
  fake.addCollection(5, [inBig.id, inBoth.id]);
  fake.collectionCounts.set(COLLECTION, 10_400); // Shopify says "at least 10 000": never read
  fake.collectionTitles.set(COLLECTION, "Nízká marže");
  fake.addCollection(6, [inBoth.id, inOther.id]);
  const { deps } = realDeps(fake);
  const config = marginConfig({
    perCollection: [
      { collectionId: COLLECTION, minMarginPercent: 40, maxDiscountPercent: 20 },
      { collectionId: OTHER, minMarginPercent: 15 },
    ],
  });
  const result = await createSync(deps).syncShop(shop, config);
  const step = result.steps.find((s) => s.step === "margin.too_large");
  assert.ok(step && !step.ok, JSON.stringify(result.steps));
  assert.deepEqual(step!.params, { collectionId: COLLECTION, collection: "Nízká marže", count: null });
  assert.equal(fake.callsOf("WonSyncCollectionProducts").filter((c) => (c.variables as { id: string }).id === COLLECTION).length, 0, "never paged");

  const shopConfig = deps.log.shopConfigs.at(-1)!;
  assert.deepEqual(shopConfig.modules.margin.global, { minMarginPercent: 40, maxDiscountPercent: 20 }, "strictest: max min-margin, min max-discount");
  assert.deepEqual(shopConfig.modules.margin.perCollection, [{ collectionId: OTHER, minMarginPercent: 40 }], "the other collection is tightened too");
  // What checkout resolves for each product, with the refs the sync wrote: never looser than the big collection's 40 % / 20 %.
  for (const product of [inBig, inBoth, inOther, outside]) {
    const refs = (fake.productMetafield(product.id) as { marginRefs?: string[] } | undefined)?.marginRefs ?? [];
    const settings = floorFor(shopConfig, refs);
    assert.ok(settings.minMarginPercent >= 40 && settings.maxDiscountPercent <= 20, `${product.id}: ${JSON.stringify(settings)}`);
  }
  assert.ok(fake.shopMetafieldValue("function_config"), "the shop config is written (folded)");
  // The stored config is never changed (§14a).
  assert.equal(config.modules.margin.global.minMarginPercent, 10);
});

test("a margin collection that grows past the limit keeps the refs products already carry (never loosened before the flip)", async () => {
  const fake = new FakeShopify();
  const a = fake.addProduct(1);
  fake.addCollection(5, [a.id]);
  const { deps } = realDeps(fake);
  const sync = createSync(deps);
  const config = marginConfig({ perCollection: [{ collectionId: COLLECTION, minMarginPercent: 40 }] });
  await sync.syncShop(shop, config);
  assert.deepEqual(fake.productMetafield(a.id), { ruleIds: [], variantRuleIds: {}, marginRefs: ["5"] });
  fake.collectionCounts.set(COLLECTION, 12_000);
  fake.calls = [];
  const result = await sync.syncShop(shop, config);
  assert.ok(result.steps.some((s) => s.step === "margin.too_large" && s.params?.collectionId === COLLECTION && !s.ok));
  assert.deepEqual(fake.productMetafield(a.id), { ruleIds: [], variantRuleIds: {}, marginRefs: ["5"] }, "the ref stays: the running config still has the stricter collection");
  assert.equal(deps.log.shopConfigs.at(-1)!.modules.margin.global.minMarginPercent, 40, "the new payload is folded");
  // The products-only refresh keeps it too.
  const refreshed = await sync.refreshProducts(shop, config);
  assert.ok(
    refreshed.steps.some((s) => s.step === "margin.too_large" && s.params?.collectionId === COLLECTION && !s.ok),
    "the refresh reports it (its failed step makes the next resync write the folded config)",
  );
  assert.deepEqual(fake.productMetafield(a.id), { ruleIds: [], variantRuleIds: {}, marginRefs: ["5"] });
});

// --- marginRefs added before the flip (audit P2-3) ---------------------------------------------------

test("a product that only GAINS marginRefs is written BEFORE the shop config (a stricter collection is never missing after the flip)", async () => {
  const fake = new FakeShopify();
  const fresh = fake.addProduct(1);
  fake.addCollection(5, [fresh.id]);
  const { deps } = realDeps(fake);
  const sync = createSync(deps);
  await sync.syncShop(shop, marginConfig({ perCollection: [] }));
  fake.calls = [];
  // A rule change too, so the (fake) payload differs and the shop config is written in this run.
  const result = await sync.syncShop(shop, marginConfig({ rules: [autoRule("r2")], perCollection: [{ collectionId: COLLECTION, minMarginPercent: 40 }] }), {
    productWrites: "background",
  });
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.equal(result.background, undefined, "nothing left for the AFTER lane");
  const sets = fake.mutations().filter((c) => c.op === "WonSyncMetafieldsSet");
  const productWrite = sets.findIndex((c) => JSON.stringify(c.variables).includes(fresh.id));
  const configWrite = sets.findIndex((c) => JSON.stringify(c.variables).includes('"function_config"'));
  assert.ok(productWrite >= 0 && configWrite > productWrite, `product first, then the shop config: ${productWrite} / ${configWrite}`);
  assert.deepEqual(fake.productMetafield(fresh.id), { ruleIds: [], variantRuleIds: {}, marginRefs: ["5"] });
});

test("a SET that adds a marginRef fails → the new shop config is held (stale risk, retried)", async () => {
  const fake = new FakeShopify();
  const ruled = fake.addProduct(1);
  fake.addCollection(5, [ruled.id]);
  const { deps } = realDeps(fake);
  const sync = createSync(deps);
  const rules = [autoRule("r", { target: { kind: "products", productIds: [ruled.id], variantIds: [] } })];
  await sync.syncShop(shop, marginConfig({ rules, perCollection: [] }));
  const before = fake.shopMetafieldValue("function_config");
  fake.refusedOwners.add(ruled.id);
  const result = await sync.syncShop(shop, marginConfig({ rules, perCollection: [{ collectionId: COLLECTION, minMarginPercent: 40 }] }));
  assert.equal(result.ok, false);
  assert.ok(result.pending.includes("stale_product_refs"), JSON.stringify(result.pending));
  assert.ok(result.steps.some((s) => s.step === "shop_config.write" && !s.ok && /held/.test(s.detail)), JSON.stringify(result.steps));
  assert.equal(fake.shopMetafieldValue("function_config"), before, "the previous shop config stays");
});

test("onlyAddsRefs: any change of marginRefs is not 'only adds' — except dropping a ref whose collection has no setting in force any more", () => {
  const value = (ruleIds: string[], marginRefs?: string[]) => JSON.stringify({ ruleIds, variantRuleIds: {}, ...(marginRefs ? { marginRefs } : {}) });
  const live = new Set(["5", "6"]);
  assert.equal(onlyAddsRefs(value(["r", "s"]), value(["r"]), live), true);
  assert.equal(onlyAddsRefs(value(["r"], ["5"]), value(["r"]), live), false, "adds a marginRef");
  assert.equal(onlyAddsRefs(value(["r"], ["6"]), value(["r"], ["5"]), live), false, "replaces one (a decisive collection changed)");
  assert.equal(onlyAddsRefs(value(["r"]), value(["r"], ["5"]), live), false, "drops a ref whose collection setting is still in force: the stale ref could keep a looser collection value");
  assert.equal(onlyAddsRefs(value(["r"]), value(["r"], ["7"]), live), true, "drops a ref no setting names any more: checkout ignores it, it never loosens a floor");
  assert.equal(onlyAddsRefs(value(["r"]), value(["r"], ["5"])), false, "live set unknown: any change holds");
  assert.equal(onlyAddsRefs(value([]), value(["r"]), live), false, "removes a rule ref");
  assert.equal(onlyAddsRefs(value(["r"], ["5"]), null, live), false, "a new product gaining a marginRef");
});

test("a product whose marginRef is REPLACED (a decisive collection changed) and whose write fails holds the new config", async () => {
  const fake = new FakeShopify();
  const product = fake.addProduct(1);
  fake.addCollection(5, [product.id]);
  fake.addCollection(6, [product.id]);
  const { deps } = realDeps(fake);
  const sync = createSync(deps);
  await sync.syncShop(shop, marginConfig({ perCollection: [{ collectionId: COLLECTION, minMarginPercent: 30 }] }));
  assert.deepEqual(fake.productMetafield(product.id), { ruleIds: [], variantRuleIds: {}, marginRefs: ["5"] });
  const before = fake.shopMetafieldValue("function_config");
  fake.refusedOwners.add(product.id);
  // Collection 5's setting goes, collection 6 gets one: the product's ref is replaced (5 → 6).
  const result = await sync.syncShop(shop, marginConfig({ rules: [autoRule("r2")], perCollection: [{ collectionId: OTHER, minMarginPercent: 30 }] }));
  assert.ok(result.pending.includes("stale_product_refs"), JSON.stringify(result.steps));
  assert.equal(fake.shopMetafieldValue("function_config"), before, "held");
});

test("dropping a marginRef whose collection setting was removed never holds the config (checkout ignores the stale ref); a still-live one does", async () => {
  // A product that keeps a rule and loses a ref whose setting is gone: a failed write does not hold.
  const fake2 = new FakeShopify();
  const kept = fake2.addProduct(1);
  fake2.addCollection(5, [kept.id]);
  const { deps: deps2 } = realDeps(fake2);
  const sync2 = createSync(deps2);
  const rules = [autoRule("r", { target: { kind: "products", productIds: [kept.id], variantIds: [] } })];
  await sync2.syncShop(shop, marginConfig({ rules, perCollection: [{ collectionId: COLLECTION, minMarginPercent: 30 }] }));
  assert.deepEqual(fake2.productMetafield(kept.id), { ruleIds: ["r"], variantRuleIds: {}, marginRefs: ["5"] });
  fake2.refusedOwners.add(kept.id);
  const gone = await sync2.syncShop(shop, marginConfig({ rules: [...rules, autoRule("r2")], perCollection: [] }));
  assert.equal(gone.pending.includes("stale_product_refs"), false, JSON.stringify(gone.steps));
  assert.ok(gone.steps.some((s) => s.step === "shop_config.write" && s.ok), "the new config is written");

  // The product LEFT collection 5 while its setting stays: the stale ref could keep 5's value — the failure holds.
  const fake3 = new FakeShopify();
  const left = fake3.addProduct(1);
  fake3.addCollection(5, [left.id]);
  const { deps: deps3 } = realDeps(fake3);
  const sync3 = createSync(deps3);
  shop = `${shop}-3`;
  const rules3 = [autoRule("r", { target: { kind: "products", productIds: [left.id], variantIds: [] } })];
  const config3 = marginConfig({ rules: rules3, perCollection: [{ collectionId: COLLECTION, minMarginPercent: 5 }] });
  await sync3.syncShop(shop, config3);
  fake3.collections.set(COLLECTION, []);
  fake3.refusedOwners.add(left.id);
  const live = await sync3.syncShop(shop, marginConfig({ rules: [...rules3, autoRule("r2")], perCollection: [{ collectionId: COLLECTION, minMarginPercent: 5 }] }));
  assert.equal(live.pending.includes("stale_product_refs"), true, JSON.stringify(live.steps));
});

test("protection on and Shopify gives no shop currency → nothing is written, the previous config holds (failed step, retried)", async () => {
  const fake = new FakeShopify();
  const { deps } = realDeps(fake);
  const sync = createSync(deps);
  await sync.syncShop(shop, marginConfig({ perCollection: [] }));
  const before = fake.shopMetafieldValue("function_config");
  fake.currencyCode = "";
  fake.calls = [];
  const result = await sync.syncShop(shop, marginConfig({ perCollection: [], rules: [autoRule("new")] }));
  assert.equal(result.ok, false);
  const step = result.steps.find((s) => s.step === "shop.currency");
  assert.ok(step && !step.ok, JSON.stringify(result.steps));
  assert.ok(result.pending.includes("failed_steps"));
  assert.equal(fake.mutations().length, 0, "nothing written");
  assert.equal(fake.shopMetafieldValue("function_config"), before);
  // Protection off: the currency is not needed.
  const off = await sync.syncShop(shop, marginConfig({ enabled: false, perCollection: [] }));
  assert.equal(off.ok, true, JSON.stringify(off.errors));
});
