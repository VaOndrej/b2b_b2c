import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";

import { buildShopFunctionConfig, verifyShopFunctionConfig } from "@won/core/discounts/function-payload";
import { buildMarginPayload, marginFloorUnit, resolveMargin } from "@won/core/discounts/margin";
import { decisiveMarginRefs, productRuleIndex } from "@won/core/discounts/targeting";

import { bridgeMarginRefs, onlyAddsRefs } from "../../../app/lib/sync/products.ts";
import { operationName } from "../../../app/lib/sync/graphql.ts";
import { marginTooLargeOf } from "../../../app/lib/sync/margin-fold.ts";
import { backgroundProductPass, createSync, isSettingsSyncRunning, syncIdle } from "../../../app/lib/sync/sync.server.ts";
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
  assert.deepEqual(ruleStep!.params, { collection: "Collection 7", count: 1 }, "a title for the admin (the detail is for support)");
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

// --- Fix rounds 2 + 3: the marginRef bridge across the flip ------------------------------------------

/**
 * The real engine end to end: core productRuleIndex (decisive marginRefs) and
 * the real shop payload (it carries the margin, so the bridge knows the LIVE
 * settings); the payloads built are logged like the test builders log them.
 */
function coreDeps(fake: FakeShopify) {
  const deps = makeDeps(fake, db.prisma, { plan: async () => "pro", productRuleIndex: (config, products) => productRuleIndex(config, products) });
  deps.buildShopFunctionConfig = (config, options) => {
    deps.log.shopConfigs.push(config);
    return buildShopFunctionConfig(config, options);
  };
  deps.verifyShopFunctionConfig = (json) => verifyShopFunctionConfig(json);
  return deps;
}

const refsWritten = (fake: FakeShopify, productId: string) =>
  fake
    .mutations()
    .filter((c) => c.op === "WonSyncMetafieldsSet")
    .flatMap((c) => (c.variables as { metafields: { ownerId: string; key: string; value: string }[] }).metafields)
    .filter((mf) => mf.ownerId === productId || mf.key === "function_config")
    .map((mf) => (mf.key === "function_config" ? "CONFIG" : ((JSON.parse(mf.value) as { marginRefs?: string[] }).marginRefs ?? [])));

const C5 = "gid://shopify/Collection/5";
const C6 = "gid://shopify/Collection/6";
const C7 = "gid://shopify/Collection/7";
const C8 = "gid://shopify/Collection/8";
const byMin = (entries: [string, number][]) => entries.map(([collectionId, minMarginPercent]) => ({ collectionId, minMarginPercent }));

test("a REPLACED marginRef crosses the flip as the new refs + the live config's decisive refs, pruned after it (A 30/B 20 → A 10/B 25)", async () => {
  const fake = new FakeShopify();
  const product = fake.addProduct(1);
  fake.addCollection(5, [product.id]);
  fake.addCollection(6, [product.id]);
  const sync = createSync(coreDeps(fake));
  await sync.syncShop(shop, marginConfig({ perCollection: byMin([[C5, 30], [C6, 20]]) }));
  assert.deepEqual(fake.productMetafield(product.id), { ruleIds: [], variantRuleIds: {}, marginRefs: ["5"] });
  fake.calls = [];
  const result = await sync.syncShop(shop, marginConfig({ perCollection: byMin([[C5, 10], [C6, 25]]) }));
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  // Before the flip [5, 6] (the live config resolves 30, the new one 25), then the config, then [6].
  assert.deepEqual(refsWritten(fake, product.id), [["5", "6"], "CONFIG", ["6"]], JSON.stringify(result.steps));
  assert.deepEqual(fake.productMetafield(product.id), { ruleIds: [], variantRuleIds: {}, marginRefs: ["6"] });
  assert.ok(result.steps.find((s) => s.step === "products.prune")?.ok, JSON.stringify(result.steps));
});

test("the round-3 example: in C/D/E it carried [C], it LEFT C; live C40/D30/E20 → new C40/D10/E35: the bridge [D, E] keeps the live 30 (never the 20 a dropped-C bridge gave), held or not", async () => {
  const setup = async (hold: boolean) => {
    const fake = new FakeShopify();
    const product = fake.addProduct(1);
    const ruled = fake.addProduct(2);
    fake.addCollection(5, [product.id]);
    fake.addCollection(6, [product.id]);
    fake.addCollection(7, [product.id]);
    const sync = createSync(coreDeps(fake));
    const rules = [autoRule("r", { target: { kind: "products", productIds: [ruled.id], variantIds: [] } })];
    const live = marginConfig({ rules, perCollection: byMin([[C5, 40], [C6, 30], [C7, 20]]) });
    await sync.syncShop(shop, live);
    assert.deepEqual((fake.productMetafield(product.id) as { marginRefs: string[] }).marginRefs, ["5"]);
    fake.collections.set(C5, []); // the product leaves C
    fake.calls = [];
    if (hold) fake.fail("WonSyncMetafieldsDelete", { userErrors: [{ message: "Internal error" }] }, 1); // the rule's product cannot be cleared
    const result = await sync.syncShop(shop, marginConfig({ rules: hold ? [] : rules, perCollection: byMin([[C5, 40], [C6, 10], [C7, 35]]) }));
    return { fake, product, result, live };
  };
  const flipped = await setup(false);
  assert.deepEqual(refsWritten(flipped.fake, flipped.product.id), [["6", "7"], "CONFIG", ["7"]], JSON.stringify(flipped.result.steps));
  const held = await setup(true);
  shop = `${shop}-held`;
  assert.ok(held.result.steps.some((s) => s.step === "shop_config.write" && s.params?.held === "rule_refs"), JSON.stringify(held.result.steps));
  const refs = (held.fake.productMetafield(held.product.id) as { marginRefs: string[] }).marginRefs;
  assert.deepEqual(refs, ["6", "7"]);
  assert.equal(resolveMargin(buildMarginPayload(held.live.modules.margin, "CZK"), refs)!.minMarginPercent, 30, "≥ min(live 30, new 35)");
});

test("a collection whose setting the new config drops is still read for the bridge's membership (a product that joined it gets the live floor across the flip)", async () => {
  const fake = new FakeShopify();
  const product = fake.addProduct(1);
  fake.addCollection(8, []);
  const sync = createSync(coreDeps(fake));
  const ruleFor = (id: string) => autoRule(id, { target: { kind: "products", productIds: [product.id], variantIds: [] } });
  // Live: global 10 %, collection 8 at 50 %. The product is not in it yet.
  await sync.syncShop(shop, marginConfig({ rules: [ruleFor("r")], perCollection: byMin([[C8, 50]]) }));
  fake.collections.set(C8, [product.id]); // it joins 8 (no refresh ran)
  fake.calls = [];
  // New: 8's setting goes, the global minimum rises to 45 %, and the product's rule changes (it is written in this sync).
  const next = configWith([ruleFor("r2")], { modules: { codes: { rules: [ruleFor("r2")] }, margin: { enabled: true, global: { minMarginPercent: 45, maxDiscountPercent: 40 }, perCollection: [] } } });
  const result = await sync.syncShop(shop, next);
  assert.ok(fake.callsOf("WonSyncCollectionProducts").some((c) => (c.variables as { id: string }).id === C8), "8 is read (membership only)");
  assert.equal(result.steps.some((s) => /too_large/.test(s.step)), false);
  // Before the flip it carries [8] (the live config resolves 50 ≥ min(50, 45)), after it nothing.
  assert.deepEqual(refsWritten(fake, product.id), [["8"], "CONFIG", []], JSON.stringify(result.steps));
  assert.deepEqual(fake.productMetafield(product.id), { ruleIds: ["r2"], variantRuleIds: {} });
});

test("property (rounds 2 + 3): with random live/new settings and random joins and leaves, the bridge never resolves looser than min(live floor, new floor) for the product's collections under the LIVE config, and exactly the new floor under the NEW one — at most 4 refs", () => {
  // mulberry32: a deterministic PRNG with good low bits (a failure always reproduces).
  let a = 20260930 >>> 0;
  const rnd = (n: number) => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return Math.floor((((t ^ (t >>> 14)) >>> 0) / 4294967296) * n);
  };
  const ids = [C5, C6, C7, C8];
  const key = (id: string) => id.split("/").pop()!;
  const moduleOf = () => ({
    enabled: true,
    global: { minMarginPercent: rnd(40), maxDiscountPercent: 20 + rnd(80) },
    // A collection may have no setting (never listed, or dropped by the new config).
    perCollection: ids
      .filter(() => rnd(5) > 0)
      .map((collectionId) => ({
        collectionId,
        ...(rnd(3) > 0 ? { minMarginPercent: rnd(60) } : {}),
        ...(rnd(3) > 0 ? { maxDiscountPercent: 5 + rnd(90) } : {}),
      })),
  });
  const floor = (payload: ReturnType<typeof buildMarginPayload>, refs: string[], price: number, cost: number | null) => {
    const settings = resolveMargin(payload, refs)!;
    return marginFloorUnit({ unitPrice: price, costMinor: cost, ...settings }).floorUnit;
  };
  let round2WouldLoosen = 0;
  let directWouldLoosen = 0;
  for (let i = 0; i < 3_000; i += 1) {
    const live = buildMarginPayload(moduleOf() as never, "CZK");
    const next = buildMarginPayload(moduleOf() as never, "CZK");
    const before = ids.filter(() => rnd(2) === 0).map(key);
    const carried = decisiveMarginRefs(live, before); // what the product carries under the live config
    const members = [...before.filter(() => rnd(4) > 0), ...ids.map(key).filter((k) => !before.includes(k) && rnd(4) === 0)]; // leaves and joins
    const wanted = decisiveMarginRefs(next, members); // core productRuleIndex over its collections now
    const bridge = bridgeMarginRefs(wanted, live, members);
    assert.ok(bridge.length <= 4, `case ${i}: ${bridge}`);
    const round2 = [...new Set([...wanted, ...carried.filter((ref) => members.includes(ref) || !ids.map(key).includes(ref))])];
    const price = 1_000 + rnd(9_000);
    for (const cost of [null, 100 + rnd(price)]) {
      const liveTrue = floor(live, members, price, cost);
      const newTrue = floor(next, members, price, cost);
      assert.ok(floor(live, bridge, price, cost) >= Math.min(liveTrue, newTrue), `live config, case ${i}`);
      assert.equal(floor(next, bridge, price, cost), newTrue, `new config, case ${i}`);
      if (floor(live, round2, price, cost) < Math.min(liveTrue, newTrue)) round2WouldLoosen += 1;
      if (floor(live, wanted, price, cost) < Math.min(liveTrue, newTrue)) directWouldLoosen += 1;
    }
  }
  assert.ok(round2WouldLoosen > 0, "the round-2 bridge (carried refs minus the left ones) WOULD loosen some floors");
  assert.ok(directWouldLoosen > 0, "writing the new refs directly WOULD loosen some floors");
});

test("a failed read of the targeted products holds the new config when a margin collection is in force — also with no product indexed yet (fresh shop)", async () => {
  const fake = new FakeShopify();
  const product = fake.addProduct(1);
  fake.addCollection(5, [product.id]);
  const { deps } = realDeps(fake);
  fake.fail("WonSyncCollectionProducts", { transport: 500 }, 10);
  const result = await createSync(deps).syncShop(shop, marginConfig({ perCollection: [{ collectionId: COLLECTION, minMarginPercent: 40 }] }));
  assert.equal(result.ok, false);
  assert.ok(result.pending.includes("stale_product_refs"), JSON.stringify(result.pending));
  assert.ok(result.steps.some((s) => s.step === "shop_config.write" && !s.ok && s.params?.held === "products_unread"), JSON.stringify(result.steps));
  assert.equal(fake.shopMetafieldValue("function_config"), undefined, "no config relies on refs nobody could write");
});

test("a products-only refresh that finds a margin collection grown past the limit runs the full sync, so the LIVE payload folds it; once folded, refreshes stay products-only", async () => {
  const fake = new FakeShopify();
  const a = fake.addProduct(1);
  fake.addCollection(5, [a.id]);
  const { deps } = realDeps(fake);
  const sync = createSync(deps);
  const config = marginConfig({ perCollection: [{ collectionId: COLLECTION, minMarginPercent: 40 }] });
  await sync.syncShop(shop, config);
  assert.equal(deps.log.shopConfigs.at(-1)!.modules.margin.global.minMarginPercent, 10);
  fake.collectionCounts.set(COLLECTION, 12_000);
  const refreshed = await sync.refreshProducts(shop, config);
  assert.ok(refreshed.steps.some((s) => s.step === "shop_config.write" && s.ok), `the full sync ran: ${JSON.stringify(refreshed.steps.map((s) => s.step))}`);
  assert.equal(deps.log.shopConfigs.at(-1)!.modules.margin.global.minMarginPercent, 40, "the live payload is folded — what the admin says");
  assert.match(fake.shopMetafieldValue("function_config")!, /"rules"/);
  const builds = deps.log.shopConfigs.length;
  const again = await sync.refreshProducts(shop, config);
  assert.equal(deps.log.shopConfigs.length, builds, "the live config folds it already: products only");
  assert.ok(again.steps.some((s) => s.step === "margin.too_large" && !s.ok));
});

test("one refused product never blocks its batch (split per product): the others are written, the refusal is counted, and only a refused marginRef change holds", async () => {
  const fake = new FakeShopify();
  const products = [fake.addProduct(1), fake.addProduct(2), fake.addProduct(3)];
  fake.addCollection(5, products.map((p) => p.id));
  const { deps } = realDeps(fake);
  const sync = createSync(deps);
  const rules = [autoRule("r", { target: { kind: "products", productIds: products.map((p) => p.id), variantIds: [] } })];
  // Rule refs only (the AFTER lane): the poison product is refused, the other two are written, nothing held.
  fake.refusedOwners.add(products[1]!.id);
  const first = await sync.syncShop(shop, marginConfig({ rules, perCollection: [] }));
  const added = first.steps.find((s) => s.step === "products.add");
  assert.deepEqual([added?.ok, added?.params], [false, { refused: 1 }], JSON.stringify(first.steps));
  assert.deepEqual(fake.productMetafield(products[0]!.id), { ruleIds: ["r"], variantRuleIds: {} });
  assert.deepEqual(fake.productMetafield(products[2]!.id), { ruleIds: ["r"], variantRuleIds: {} });
  assert.equal(fake.productMetafield(products[1]!.id), undefined);
  assert.ok(first.steps.some((s) => s.step === "shop_config.write" && s.ok), "not held");
  // A marginRef the new config relies on (the BEFORE lane): the poison holds the config, the others are written.
  fake.refusedOwners.clear();
  await sync.syncShop(shop, marginConfig({ rules, perCollection: [] }));
  fake.refusedOwners.add(products[1]!.id);
  const before = fake.shopMetafieldValue("function_config");
  const second = await sync.syncShop(shop, marginConfig({ rules, perCollection: [{ collectionId: COLLECTION, minMarginPercent: 40 }] }));
  const set = second.steps.find((s) => s.step === "products.set");
  assert.deepEqual(set?.params, { refused: 1 });
  assert.deepEqual((fake.productMetafield(products[0]!.id) as { marginRefs?: string[] }).marginRefs, ["5"]);
  assert.deepEqual((fake.productMetafield(products[2]!.id) as { marginRefs?: string[] }).marginRefs, ["5"]);
  assert.ok(second.steps.some((s) => s.step === "shop_config.write" && s.params?.held === "margin_refs"), JSON.stringify(second.steps));
  assert.equal(fake.shopMetafieldValue("function_config"), before);
});

// --- Fix round 3: one source for "folded", the escalated refresh, the background count ------------------

test("the fold every view uses is the LIVE config's (the applying run), never a newer products-only run", async () => {
  const run = (steps: unknown[], minutesAgo: number) =>
    db.prisma.syncRun.create({ data: { shop, ok: false, startedAt: new Date(Date.now() - minutesAgo * 60_000), steps: JSON.stringify(steps) } });
  const tooLarge = { step: "margin.too_large", ok: false, detail: "x", params: { collectionId: C5, collection: "Velká", count: null } };
  const applied = { step: "shop_config.write", ok: true, detail: "x" };
  const scope = { step: "products.scope", ok: true, detail: "x" };
  // Applied with the fold; a newer products-only refresh no longer reports it: checkout still runs the fold.
  await run([tooLarge, scope, applied], 10);
  await run([scope], 5);
  assert.deepEqual(await marginTooLargeOf(db.prisma, shop), [{ collectionId: C5, title: "Velká", count: null }]);
  // A newer products-only run that reports one the live config does not fold: not in force.
  shop = `${shop}-b`;
  await run([scope, applied], 10);
  await run([tooLarge, scope], 5);
  assert.deepEqual(await marginTooLargeOf(db.prisma, shop), []);
});

test("a refresh escalates to the full sync when a collection the live config folds FITS again (the payload unfolds), and not again once it matches", async () => {
  const fake = new FakeShopify();
  const a = fake.addProduct(1);
  fake.addCollection(5, [a.id]);
  fake.collectionCounts.set(C5, 12_000);
  const { deps } = realDeps(fake);
  const sync = createSync(deps);
  const config = marginConfig({ perCollection: [{ collectionId: COLLECTION, minMarginPercent: 40 }] });
  await sync.syncShop(shop, config);
  assert.equal(deps.log.shopConfigs.at(-1)!.modules.margin.global.minMarginPercent, 40, "folded");
  assert.equal((await marginTooLargeOf(db.prisma, shop)).length, 1);
  fake.collectionCounts.delete(C5); // it shrank: 1 product
  const refreshed = await sync.refreshProducts(shop, config);
  assert.ok(refreshed.steps.some((s) => s.step === "shop_config.write" && s.ok), JSON.stringify(refreshed.steps.map((s) => s.step)));
  assert.equal(deps.log.shopConfigs.at(-1)!.modules.margin.global.minMarginPercent, 10, "the live payload unfolds");
  assert.deepEqual(await marginTooLargeOf(db.prisma, shop), [], "and every view follows it");
  assert.deepEqual(fake.productMetafield(a.id), { ruleIds: [], variantRuleIds: {}, marginRefs: ["5"] });
  const builds = deps.log.shopConfigs.length;
  await sync.refreshProducts(shop, config);
  assert.equal(deps.log.shopConfigs.length, builds, "matches now: products only");
});

/** Pause the fake at its next call of `op` (resolves `reached`), until `release()`. */
function gate(fake: FakeShopify, op: string) {
  const original = fake.graphql.bind(fake);
  let reached!: () => void;
  let release!: () => void;
  const hit = new Promise<void>((resolve) => (reached = resolve));
  const open = new Promise<void>((resolve) => (release = resolve));
  let armed = true;
  fake.graphql = (async (query: string, variables?: Record<string, unknown>) => {
    if (armed && operationName(query) === op) {
      armed = false;
      reached();
      await open;
    }
    return original(query, variables);
  }) as typeof fake.graphql;
  return { hit, release };
}

test("the escalated refresh counts as a settings sync while it runs (and keeps its lane), and never runs when a newer sync superseded it", async () => {
  // Flags while the escalated full sync runs.
  const fake = new FakeShopify();
  const a = fake.addProduct(1);
  fake.addCollection(5, [a.id]);
  const { deps } = realDeps(fake);
  const sync = createSync(deps);
  const config = marginConfig({ perCollection: [{ collectionId: COLLECTION, minMarginPercent: 40 }] });
  await sync.syncShop(shop, config);
  fake.collectionCounts.set(C5, 12_000);
  const paused = gate(fake, "WonSyncShop"); // the full sync's first call
  await sync.refreshProducts(shop, config, { productWrites: "background" });
  await paused.hit;
  assert.equal(isSettingsSyncRunning(shop), true, "a settings sync runs");
  assert.equal(backgroundProductPass(shop), "refresh", "still the refresh's lane");
  paused.release();
  await syncIdle(shop);
  assert.equal(isSettingsSyncRunning(shop), false);
  assert.equal(backgroundProductPass(shop), null);
  assert.equal(deps.log.shopConfigs.at(-1)!.modules.margin.global.minMarginPercent, 40, "it folded");

  // Superseded while deciding: the refresh does not run the full sync; the newer sync does (once).
  shop = `${shop}-superseded`;
  const fake2 = new FakeShopify();
  const b = fake2.addProduct(1);
  fake2.addCollection(5, [b.id]);
  const { deps: deps2 } = realDeps(fake2);
  const sync2 = createSync(deps2);
  await sync2.syncShop(shop, config);
  fake2.collectionCounts.set(C5, 12_000);
  const sizes = gate(fake2, "WonSyncCollectionSizes"); // the refresh's size check
  fake2.calls = [];
  await sync2.refreshProducts(shop, config, { productWrites: "background" });
  await sizes.hit;
  const newer = sync2.syncShop(shop, config); // supersedes the refresh
  sizes.release();
  await newer;
  await syncIdle(shop);
  assert.equal(fake2.callsOf("WonSyncShop").length, 1, "one full sync: the newer one");
});

test("the background count says only the products that GAIN refs: a sync whose AFTER lane only prunes bridges reports none", async () => {
  const fake = new FakeShopify();
  const product = fake.addProduct(1);
  fake.addCollection(5, [product.id]);
  fake.addCollection(6, [product.id]);
  const sync = createSync(coreDeps(fake));
  await sync.syncShop(shop, marginConfig({ perCollection: byMin([[C5, 30], [C6, 20]]) }));
  const result = await sync.syncShop(shop, marginConfig({ perCollection: byMin([[C5, 10], [C6, 25]]) }), { productWrites: "background" });
  assert.ok(result.pending.includes("products_in_progress"), "the prune runs in the background");
  assert.deepEqual(result.background, {}, "no 'Produkty, které slevu nově dostanou (N)' for a prune");
  await syncIdle(shop);
  assert.deepEqual(fake.productMetafield(product.id), { ruleIds: [], variantRuleIds: {}, marginRefs: ["6"] });
});

test("a breaker for shop-wide refusals: after 3 batches refused product by product, the rest is not split any more, the refusal is recorded once and the new config is held", async () => {
  const fake = new FakeShopify();
  const products = Array.from({ length: 80 }, (_, i) => fake.addProduct(100 + i));
  const { deps } = realDeps(fake);
  const sync = createSync(deps);
  const target = { target: { kind: "products", productIds: products.map((p) => p.id), variantIds: [] } };
  await sync.syncShop(shop, marginConfig({ rules: [autoRule("r", target)], perCollection: [] }));
  for (const p of products) fake.refusedOwners.add(p.id);
  fake.calls = [];
  const before = fake.shopMetafieldValue("function_config");
  // Every product only GAINS a rule (normally never held): Shopify refuses every write.
  const result = await sync.syncShop(shop, marginConfig({ rules: [autoRule("r", target), autoRule("s", target)], perCollection: [] }));
  const productSets = fake.callsOf("WonSyncMetafieldsSet").filter((c) => JSON.stringify(c.variables).includes('"product"'));
  assert.equal(productSets.length, 3 * 26 + 1, "3 batches split (1 + 25 calls each), then the last batch as one call");
  const set = result.steps.find((s) => s.step === "products.set");
  assert.deepEqual(set?.params, { refused: 80, breaker: 1 }, JSON.stringify(set));
  assert.ok(result.steps.some((s) => s.step === "shop_config.write" && s.params?.held === "products_refused"), JSON.stringify(result.steps));
  assert.equal(fake.shopMetafieldValue("function_config"), before, "held");
});
