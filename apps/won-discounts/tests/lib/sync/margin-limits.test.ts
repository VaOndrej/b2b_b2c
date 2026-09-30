import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";

import { buildShopFunctionConfig, verifyShopFunctionConfig } from "@won/core/discounts/function-payload";
import { buildMarginPayload, marginFloorUnit, readMarginPayload, resolveMargin, type FunctionMarginPayload } from "@won/core/discounts/margin";
import { decisiveMarginRefs, productRuleIndex } from "@won/core/discounts/targeting";

import { bridgeMarginRefs, crossingRefs, onlyAddsRefs } from "../../../app/lib/sync/products.ts";
import { operationName } from "../../../app/lib/sync/graphql.ts";
import { marginTooLargeOf } from "../../../app/lib/sync/margin-fold.ts";
import { appliedPlanMismatch, appliedRun } from "../../../app/lib/sync/runs.ts";
import { loadShopSyncFacts } from "../../../app/lib/sync/sync-state.server.ts";
import { backgroundProductPass, createSync, isSettingsSyncRunning, syncIdle } from "../../../app/lib/sync/sync.server.ts";
import { createTestDatabase, type TestDatabase } from "../test-db.ts";
import { FakeShopify } from "./fake-shopify.ts";
import { autoRule, codeRule, configWith, makeDeps } from "./helpers.ts";

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

test("a margin collection that grows past the limit: a product carrying its ref keeps it across the flip (the bridge — never loosened), and the folded payload needs no ref after it (audit fix round 4: no refs kept by hand, so ≤ 4 refs holds)", async () => {
  const fake = new FakeShopify();
  const a = fake.addProduct(1);
  fake.addCollection(5, [a.id]);
  const deps = coreDeps(fake); // the real payload: the bridge knows the live settings
  const sync = createSync(deps);
  const config = marginConfig({ perCollection: [{ collectionId: COLLECTION, minMarginPercent: 40 }] });
  await sync.syncShop(shop, config);
  assert.deepEqual(fake.productMetafield(a.id), { ruleIds: [], variantRuleIds: {}, marginRefs: ["5"] });
  const start = { config: fake.shopMetafieldValue("function_config")!, refs: ["5"] };
  fake.collectionCounts.set(COLLECTION, 12_000);
  fake.calls = [];
  const result = await sync.syncShop(shop, config);
  assert.ok(result.steps.some((s) => s.step === "margin.too_large" && s.params?.collectionId === COLLECTION && !s.ok));
  assert.equal(deps.log.shopConfigs.at(-1)!.modules.margin.global.minMarginPercent, 40, "the new payload is folded");
  // Every moment of the sync: [5] under the live config (40 %), then the folded config (global 40 %) — never below.
  const points = floorsOverTime(fake, a.id, start);
  assert.ok(points.length > 0 && points.every((p) => p.min >= 40), JSON.stringify(points));
  assert.equal(fake.productMetafield(a.id), undefined, "after the flip the folded payload names no collection: the ref goes (pruned)");
  // The products-only refresh (the live config folds it now) has nothing to do for it.
  const refreshed = await sync.refreshProducts(shop, config);
  assert.ok(
    refreshed.steps.some((s) => s.step === "margin.too_large" && s.params?.collectionId === COLLECTION && !s.ok),
    "the refresh reports it (its failed step makes the next resync write the folded config)",
  );
  assert.equal(fake.productMetafield(a.id), undefined);
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

// --- Fix round 4 --------------------------------------------------------------------------------------

/**
 * What checkout resolves for `productId` after every write of the sync, in order: the shop config and the
 * product's refs as Shopify holds them at that moment (`start` = before the sync).
 */
function floorsOverTime(fake: FakeShopify, productId: string, start: { config: string; refs: string[] }) {
  let config = start.config;
  let refs = start.refs;
  const out: { min: number; max: number; at: string }[] = [];
  for (const call of fake.mutations()) {
    const metafields = (call.variables as { metafields?: { ownerId: string; key: string; value?: string }[] }).metafields ?? [];
    let touched = false;
    if (call.op === "WonSyncMetafieldsSet") {
      for (const mf of metafields) {
        if (mf.key === "function_config") config = mf.value!;
        else if (mf.ownerId === productId && mf.key === "product") refs = (JSON.parse(mf.value!) as { marginRefs?: string[] }).marginRefs ?? [];
        else continue;
        touched = true;
      }
    } else if (call.op === "WonSyncMetafieldsDelete" && metafields.some((mf) => mf.ownerId === productId && mf.key === "product")) {
      refs = [];
      touched = true;
    }
    if (!touched) continue;
    const settings = resolveMargin(readMarginPayload((JSON.parse(config) as { modules: { margin: unknown } }).modules.margin), refs)!;
    out.push({ min: settings.minMarginPercent, max: settings.maxDiscountPercent, at: `${call.op}: [${refs.join(",")}]` });
  }
  return out;
}

const marginRefsOf = (fake: FakeShopify, productId: string) => (fake.productMetafield(productId) as { marginRefs?: string[] } | undefined)?.marginRefs;
const C1 = "gid://shopify/Collection/1";
const C3 = "gid://shopify/Collection/3";
const margin = (global: { minMarginPercent?: number; maxDiscountPercent: number }, perCollection: unknown[], rules: unknown[] = []) =>
  configWith(rules, { modules: { codes: { rules }, margin: { enabled: true, global, perCollection } } });

test("round 4, item 1 (property, the reviewer's generators): a live-listed collection this pass did not read — (a) live-only past the leftover budget, (b) folded under the new config — never leaves a bridge looser than BOTH the status quo and the requirement: its membership is read one by one, or the product keeps its value and the config is held", () => {
  let seed = 12345;
  const rnd = () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = seed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const pick = <T,>(a: T[]) => a[Math.floor(rnd() * a.length)]!;
  const KEYS = ["1", "2", "3", "4", "5", "6"];
  const vals = [null, 0, 5, 10, 20, 30, 35, 40, 50];
  const pvals = [null, 10, 20, 30, 50, 70, 100];
  type Margin = { global: { minMarginPercent?: number; maxDiscountPercent: number }; perCollection: { collectionId: string; minMarginPercent?: number; maxDiscountPercent?: number }[]; enabled: true };
  const randMargin = (): Margin => {
    const per: Margin["perCollection"] = [];
    for (const k of KEYS) {
      if (rnd() < 0.4) continue;
      const m = pick(vals);
      const p = pick(pvals);
      if (m === null && p === null) continue;
      per.push({ collectionId: `gid://shopify/Collection/${k}`, ...(m !== null ? { minMarginPercent: m } : {}), ...(p !== null ? { maxDiscountPercent: p } : {}) });
    }
    const gm = pick(vals);
    return { enabled: true, global: { ...(gm !== null ? { minMarginPercent: gm } : {}), maxDiscountPercent: pick([20, 50, 70]) }, perCollection: per };
  };
  const fold = (m: Margin, dropped: Set<string>): Margin => {
    const out = JSON.parse(JSON.stringify(m)) as Margin;
    let min: number | undefined;
    let max: number | undefined;
    for (const o of out.perCollection) {
      if (!dropped.has(o.collectionId)) continue;
      if (o.minMarginPercent !== undefined) min = Math.max(min ?? 0, o.minMarginPercent);
      if (o.maxDiscountPercent !== undefined) max = Math.min(max ?? 100, o.maxDiscountPercent);
    }
    if (min !== undefined) out.global.minMarginPercent = Math.max(out.global.minMarginPercent ?? 0, min);
    if (max !== undefined) out.global.maxDiscountPercent = Math.min(out.global.maxDiscountPercent, max);
    out.perCollection = out.perCollection
      .filter((o) => !dropped.has(o.collectionId))
      .map((o) => ({
        ...o,
        ...(o.minMarginPercent !== undefined && min !== undefined ? { minMarginPercent: Math.max(o.minMarginPercent, min) } : {}),
        ...(o.maxDiscountPercent !== undefined && max !== undefined ? { maxDiscountPercent: Math.min(o.maxDiscountPercent, max) } : {}),
      }));
    return out;
  };
  const payloadOf = (m: Margin): FunctionMarginPayload => readMarginPayload(JSON.parse(JSON.stringify(buildMarginPayload(m as never, "CZK"))));
  const gid = (k: string) => `gid://shopify/Collection/${k}`;
  const listed = (m: Margin) => new Set(m.perCollection.map((o) => o.collectionId.split("/").pop()!));
  const subset = () => KEYS.filter(() => rnd() < 0.45);
  const resolve = (payload: FunctionMarginPayload, refs: readonly string[]) => resolveMargin(payload, refs)!;

  const run = (mode: "all-read" | "alsoRead-unfit" | "new-fold", N = 50_000) => {
    let round3 = 0;
    let unsure = 0;
    for (let i = 0; i < N; i += 1) {
      const Lcfg = randMargin();
      const Ncfg = randMargin();
      const L = payloadOf(Lcfg);
      const Lkeys = listed(Lcfg);
      const Nkeys = listed(Ncfg);
      // (b): live-listed collections too large under the new config (folded, never read).
      const droppedN = new Set<string>();
      if (mode === "new-fold") for (const k of Nkeys) if (Lkeys.has(k) && rnd() < 0.3) droppedN.add(k);
      const Nlim: Margin = { ...Ncfg, perCollection: Ncfg.perCollection.filter((o) => !droppedN.has(o.collectionId.split("/").pop()!)) };
      const Npay = payloadOf(droppedN.size ? fold(Ncfg, new Set([...droppedN].map(gid))) : Ncfg);
      const NlimKeys = listed(Nlim);
      // (a): live-only collections (read for membership only) that do not fit the leftover budget.
      const liveOnly = [...Lkeys].filter((k) => !Nkeys.has(k));
      const unreadLiveOnly = new Set(mode === "alsoRead-unfit" ? liveOnly.filter(() => rnd() < 0.5) : []);
      const read = new Set([...NlimKeys, ...liveOnly.filter((k) => !unreadLiveOnly.has(k))]);
      const M0 = subset();
      const M1 = subset();
      const carried = decisiveMarginRefs(L, M0); // the last sync applied L
      // Item 3: the new refs are decisive under the (folded) payload that ships.
      const next = decisiveMarginRefs(Npay, M1.filter((k) => NlimKeys.has(k)));
      const fL = resolve(L, M1);
      const fN = resolve(Npay, M1);
      const quo = resolve(L, carried);
      const worse = (refs: readonly string[]) => {
        const r = resolve(L, refs);
        return (
          (r.minMarginPercent < Math.min(fL.minMarginPercent, fN.minMarginPercent) && r.minMarginPercent < quo.minMarginPercent) ||
          (r.maxDiscountPercent > Math.max(fL.maxDiscountPercent, fN.maxDiscountPercent) && r.maxDiscountPercent > quo.maxDiscountPercent)
        );
      };
      // What planProducts does: the bridge over what this pass read …
      const first = crossingRefs({ next, live: L, members: M1.filter((k) => read.has(k)), read, carried });
      if (worse(first.refs)) round3 += 1; // … which round 3 wrote as it was
      let refs = first.refs;
      if (first.needsMembership) {
        unsure += 1;
        // … the membership in the unread live-listed collections read one by one (productsInCollection) …
        const all = new Set([...read, ...Lkeys]);
        const second = crossingRefs({ next, live: L, members: M1.filter((k) => all.has(k)), read: all, carried });
        assert.equal(second.needsMembership, false, `${mode} ${i}: nothing unread any more`);
        refs = second.refs;
        // … or, when that read fails, the product keeps `carried` under the live config (the new one is held).
        assert.equal(worse(carried), false);
      }
      assert.equal(worse(refs), false, `${mode} ${i}: ${JSON.stringify({ L, Npay, M0, M1, carried, next, refs })}`);
      const rN = resolve(Npay, refs);
      assert.deepEqual([rN.minMarginPercent, rN.maxDiscountPercent], [fN.minMarginPercent, fN.maxDiscountPercent], `${mode} ${i}: exact under the new config`);
      assert.ok(refs.length <= 4, `${mode} ${i}: ${refs}`);
    }
    return { round3, unsure };
  };
  const all = run("all-read");
  assert.deepEqual(all, { round3: 0, unsure: 0 }, "everything read: never unsure, never looser");
  for (const mode of ["alsoRead-unfit", "new-fold"] as const) {
    const { round3, unsure } = run(mode);
    assert.ok(round3 > 0, `${mode}: the round-3 bridge WOULD be looser than both in some cases (${round3})`);
    assert.ok(unsure >= round3, mode);
  }
});

test("round 4, item 1 (b), the reviewer's example: live global 40/50, collection 1 = 40/20, 3 = 35/30; a product carried [3], is now only in 1, and 1 grew past the limit (folded) — its membership in 1 is read one by one and it crosses the flip with [1], never the global 50 %; when that read fails it keeps [3] and the config is held", async () => {
  const setup = async (membershipFails: boolean) => {
    shop = `${shop}-${membershipFails ? "held" : "read"}`;
    const fake = new FakeShopify();
    const product = fake.addProduct(1);
    fake.addCollection(1, []);
    fake.addCollection(3, [product.id]);
    const sync = createSync(coreDeps(fake));
    const config = margin({ minMarginPercent: 40, maxDiscountPercent: 50 }, [
      { collectionId: C1, minMarginPercent: 40, maxDiscountPercent: 20 },
      { collectionId: C3, minMarginPercent: 35, maxDiscountPercent: 30 },
    ]);
    await sync.syncShop(shop, config);
    assert.deepEqual(marginRefsOf(fake, product.id), ["3"]);
    const start = { config: fake.shopMetafieldValue("function_config")!, refs: ["3"] };
    fake.collections.set(C3, []);
    fake.collections.set(C1, [product.id]);
    fake.collectionCounts.set(C1, 12_000); // folded under the new payload: never paged
    fake.calls = [];
    if (membershipFails) fake.fail("WonSyncProductsInCollection", { transport: 500 }, 10);
    const result = await sync.syncShop(shop, config);
    assert.equal(fake.callsOf("WonSyncCollectionProducts").some((c) => (c.variables as { id: string }).id === C1), false, "1 is never paged");
    return { fake, product, result, start };
  };

  const read = await setup(false);
  const asked = read.fake.callsOf("WonSyncProductsInCollection").map((c) => c.variables as { ids: string[]; collection: string });
  assert.deepEqual(asked, [{ ids: [read.product.id], collection: C1 }], "only the unsure product, only the unread collection");
  const points = floorsOverTime(read.fake, read.product.id, read.start);
  assert.deepEqual(points.map((p) => p.at), ["WonSyncMetafieldsSet: [1]", "WonSyncMetafieldsSet: [1]", "WonSyncMetafieldsDelete: []"], JSON.stringify(read.result.steps));
  assert.ok(points.every((p) => p.min >= 40 && p.max <= 20), `never looser than collection 1 (the live floor) nor the folded payload: ${JSON.stringify(points)}`);
  assert.ok(read.result.steps.some((s) => s.step === "shop_config.write" && s.ok), JSON.stringify(read.result.steps));

  const held = await setup(true);
  assert.deepEqual(marginRefsOf(held.fake, held.product.id), ["3"], "it keeps its current value");
  assert.equal(floorsOverTime(held.fake, held.product.id, held.start).length, 0, "nothing written");
  assert.ok(held.result.steps.some((s) => s.step === "products.membership" && !s.ok), JSON.stringify(held.result.steps));
  assert.ok(held.result.steps.some((s) => s.step === "shop_config.write" && !s.ok && s.params?.held === "margin_refs"), JSON.stringify(held.result.steps));
  assert.ok(held.result.pending.includes("stale_product_refs"), "retried like every hold");
  assert.equal(held.fake.shopMetafieldValue("function_config"), held.start.config, "the live config stays");
});

test("round 4, item 1 (a): a live-only collection past the leftover budget (its setting removed, never read) — a product that moved into it from [3] crosses the flip with [8] (live 40/20), never the live global 50 %", async () => {
  const fake = new FakeShopify();
  const product = fake.addProduct(1);
  const C8b = "gid://shopify/Collection/8";
  fake.addCollection(8, []);
  fake.addCollection(3, [product.id]);
  const sync = createSync(coreDeps(fake));
  await sync.syncShop(
    shop,
    margin({ minMarginPercent: 40, maxDiscountPercent: 50 }, [
      { collectionId: C8b, minMarginPercent: 40, maxDiscountPercent: 20 },
      { collectionId: C3, minMarginPercent: 35, maxDiscountPercent: 30 },
    ]),
  );
  assert.deepEqual(marginRefsOf(fake, product.id), ["3"]);
  const start = { config: fake.shopMetafieldValue("function_config")!, refs: ["3"] };
  fake.collections.set(C3, []);
  fake.collections.set(C8b, [product.id]);
  fake.collectionCounts.set(C8b, 12_000); // "at least 10 000": never read for membership
  fake.calls = [];
  // The new config drops 8's setting and caps the global maximum at 30 %.
  const result = await sync.syncShop(shop, margin({ minMarginPercent: 40, maxDiscountPercent: 30 }, [{ collectionId: C3, minMarginPercent: 35, maxDiscountPercent: 30 }]));
  assert.equal(fake.callsOf("WonSyncCollectionProducts").some((c) => (c.variables as { id: string }).id === C8b), false);
  const points = floorsOverTime(fake, product.id, start);
  assert.ok(points.length >= 2 && points.every((p) => p.min >= 40 && p.max <= 30), JSON.stringify({ points, steps: result.steps }));
  assert.equal(fake.productMetafield(product.id), undefined, "pruned after the flip");
});

test("round 4, item 2: a campaign switch's phase 1 carries the LIVE margin unchanged (live C1 10 / C2 50, the product carries [2]; new C1 40 / C2 5): ≥ 40 % at every point in time", async () => {
  const fake = new FakeShopify();
  const product = fake.addProduct(1);
  fake.addCollection(5, [product.id]);
  fake.addCollection(6, [product.id]);
  const sync = createSync(coreDeps(fake));
  const bf = {
    id: "bf",
    name: "Black Friday",
    window: { start: "2026-09-28T00:00:00", end: "2026-09-29T00:00:00" },
    overrides: [{ ruleId: "c", patch: { value: { kind: "percentage", percent: 30 } } }],
    killed: false,
  };
  const withMargin = (c1: number, c2: number, campaign: typeof bf) =>
    configWith([codeRule("c")], {
      campaigns: [campaign],
      modules: { codes: { rules: [codeRule("c")] }, margin: { enabled: true, global: { maxDiscountPercent: 50 }, perCollection: byMin([[C5, c1], [C6, c2]]) } },
    });
  await sync.syncShop(shop, withMargin(10, 50, bf));
  assert.deepEqual(marginRefsOf(fake, product.id), ["6"]);
  const start = { config: fake.shopMetafieldValue("function_config")!, refs: ["6"] };
  fake.calls = [];
  const moved = { ...bf, window: { start: "2026-09-28T06:00:00", end: "2026-09-30T00:00:00" } };
  const result = await sync.syncShop(shop, withMargin(40, 5, moved));
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  const configs = fake
    .callsOf("WonSyncMetafieldsSet")
    .flatMap((c) => (c.variables as { metafields: { key: string; value: string }[] }).metafields)
    .filter((mf) => mf.key === "function_config")
    .map((mf) => JSON.parse(mf.value) as { campaignId: string | null; modules: { margin: unknown } });
  assert.equal(configs.length, 2, "phase 1 and the final config");
  assert.equal(configs[0]!.campaignId, null);
  assert.deepEqual(configs[0]!.modules.margin, (JSON.parse(start.config) as { modules: { margin: unknown } }).modules.margin, "phase 1: the live margin part, unchanged");
  const points = floorsOverTime(fake, product.id, start);
  assert.ok(points.length >= 3 && points.every((p) => p.min >= 40), JSON.stringify(points));
  assert.deepEqual(marginRefsOf(fake, product.id), ["5"]);
});

test("round 4, item 2: a first sync with a campaign has no live margin to keep — phase 1 folds every collection into the global values (strictest), never the new collection values over products that carry no ref yet", async () => {
  const fake = new FakeShopify();
  const product = fake.addProduct(1);
  fake.addCollection(5, [product.id]);
  const deps = coreDeps(fake);
  const sync = createSync(deps);
  const bf = { id: "bf", name: "BF", window: { start: "2026-09-28T00:00:00", end: "2026-09-29T00:00:00" }, overrides: [], killed: false };
  const config = configWith([codeRule("c")], {
    campaigns: [bf],
    modules: { codes: { rules: [codeRule("c")] }, margin: { enabled: true, global: { minMarginPercent: 10, maxDiscountPercent: 50 }, perCollection: byMin([[C5, 40]]) } },
  });
  const result = await sync.syncShop(shop, config);
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  const phase1 = fake
    .callsOf("WonSyncMetafieldsSet")
    .flatMap((c) => (c.variables as { metafields: { key: string; value: string }[] }).metafields)
    .find((mf) => mf.key === "function_config")!;
  const margin1 = readMarginPayload((JSON.parse(phase1.value) as { modules: { margin: unknown } }).modules.margin);
  assert.deepEqual(resolveMargin(margin1, []), { minMarginPercent: 40, maxDiscountPercent: 50, source: "global" }, "no product carries a ref yet: 40 % for all");
  assert.deepEqual(marginRefsOf(fake, product.id), ["5"]);
});

test("round 4, item 2: when the live margin part does not fit the no-campaign payload's budget, phase 1 folds every collection instead — never the new values early, never over budget", async () => {
  const fake = new FakeShopify();
  const product = fake.addProduct(1);
  fake.addCollection(5, [product.id]);
  const sync = createSync(coreDeps(fake));
  const bf = { id: "bf", name: "BF", window: { start: "2026-09-28T00:00:00", end: "2026-09-29T00:00:00" }, overrides: [], killed: false };
  const config = (campaign: typeof bf) =>
    configWith([codeRule("c")], {
      campaigns: [campaign],
      modules: { codes: { rules: [codeRule("c")] }, margin: { enabled: true, global: { minMarginPercent: 10, maxDiscountPercent: 50 }, perCollection: byMin([[C5, 40]]) } },
    });
  await sync.syncShop(shop, config(bf));
  // The live config (as another version of the app could have left it): a margin part of 700 collections.
  const live = fake.shopMetafields.get("$app:won_discounts/function_config")!;
  const stored = JSON.parse(live.value) as { modules: { margin: { col: Record<string, unknown> } } };
  for (let i = 0; i < 700; i += 1) stored.modules.margin.col[String(1_000 + i)] = [5, null];
  live.value = JSON.stringify(stored);
  fake.calls = [];
  const result = await sync.syncShop(shop, config({ ...bf, window: { start: "2026-09-28T06:00:00", end: "2026-09-30T00:00:00" } }));
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  const phase1 = fake
    .callsOf("WonSyncMetafieldsSet")
    .flatMap((c) => (c.variables as { metafields: { key: string; value: string }[] }).metafields)
    .find((mf) => mf.key === "function_config")!;
  assert.ok(Buffer.byteLength(phase1.value) <= 9_000, `${Buffer.byteLength(phase1.value)} B`);
  const margin1 = readMarginPayload((JSON.parse(phase1.value) as { modules: { margin: unknown } }).modules.margin);
  assert.equal("col" in margin1, false, "every collection folded");
  assert.deepEqual(resolveMargin(margin1, ["5"]), { minMarginPercent: 40, maxDiscountPercent: 50, source: "global" });
});

test("round 4, item 3: with a fold in force and the margin unchanged, a rule-only edit writes no bridge (the refs are decisive under the folded payload that ships)", async () => {
  const fake = new FakeShopify();
  const product = fake.addProduct(1);
  const other = fake.addProduct(2);
  fake.addCollection(5, [product.id]);
  fake.addCollection(6, [product.id]);
  fake.addCollection(7, [other.id]);
  fake.collectionCounts.set(C7, 12_000); // folded: global and every collection at ≥ 30 %
  const sync = createSync(coreDeps(fake));
  const config = (ruleId: string) =>
    margin({ minMarginPercent: 0, maxDiscountPercent: 50 }, byMin([[C5, 10], [C6, 20], [C7, 30]]), [
      autoRule(ruleId, { target: { kind: "products", productIds: [other.id], variantIds: [] } }),
    ]);
  await sync.syncShop(shop, config("r"));
  const live = readMarginPayload((JSON.parse(fake.shopMetafieldValue("function_config")!) as { modules: { margin: unknown } }).modules.margin);
  assert.deepEqual(marginRefsOf(fake, product.id), decisiveMarginRefs(live, ["5", "6"]), "decisive under the folded payload");
  fake.calls = [];
  const result = await sync.syncShop(shop, config("r2"));
  assert.ok(result.steps.some((s) => s.step === "shop_config.write" && s.ok));
  assert.deepEqual(refsWritten(fake, product.id), ["CONFIG"], "no bridge before the flip, no prune after it");
  assert.equal(result.steps.some((s) => s.step === "products.prune"), false);
});

test("round 4, item 6: a run whose only live write was a campaign switch's phase 1 is not 'applied' — for the fold views (appliedRun) and for the plan (appliedPlan) alike", async () => {
  const fake = new FakeShopify();
  const product = fake.addProduct(1);
  let plan: "free" | "pro" = "pro";
  const deps = makeDeps(fake, db.prisma, { plan: async () => plan });
  const sync = createSync(deps);
  const bf = { id: "bf", name: "BF", window: { start: "2026-09-28T00:00:00", end: "2026-09-29T00:00:00" }, overrides: [], killed: false };
  const target = { target: { kind: "products", productIds: [product.id], variantIds: [] } };
  const first = await sync.syncShop(shop, configWith([codeRule("c"), autoRule("r", target)], { campaigns: [bf] }));
  assert.equal(first.ok, true, JSON.stringify(first.errors));
  // Downgrade: Free strips the campaign (a switch: phase 1), and the product that loses rule r cannot be cleared (held).
  plan = "free";
  fake.fail("WonSyncMetafieldsDelete", { userErrors: [{ message: "Internal error" }] }, 1);
  const second = await sync.syncShop(shop, configWith([codeRule("c")], { campaigns: [bf] }));
  assert.ok(second.steps.some((s) => s.step === "shop_config.phase1.write" && s.ok && /written/.test(s.detail)), JSON.stringify(second.steps));
  assert.ok(second.steps.some((s) => s.step === "shop_config.write" && s.params?.held === "rule_refs"), JSON.stringify(second.steps));
  assert.equal((await appliedRun(db.prisma, shop))?.runId, first.runId, "the fold views read the last final write");
  assert.equal((await loadShopSyncFacts(db.prisma, shop)).appliedPlan, "pro", "and so does the plan");
  assert.deepEqual(await appliedPlanMismatch(db.prisma, shop, "free"), { applied: "pro" }, "a resync follows");
});
