import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";

import { buildMarginPayload, marginFloorUnit, resolveMargin } from "@won/core/discounts/margin";
import { productRuleIndex } from "@won/core/discounts/targeting";

import { bridgeMarginRefs, onlyAddsRefs } from "../../../app/lib/sync/products.ts";
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
  assert.deepEqual(ruleStep!.params, { collections: "Collection 7", untitled: 0 }, "titles for the admin (the detail is for support)");
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

// --- Fix round 2 -----------------------------------------------------------------------------------

/** The effective values a collection has in a margin module (an empty field = the global value). */
type Mod = { enabled: boolean; global: { minMarginPercent?: number; maxDiscountPercent: number }; perCollection: { collectionId: string; minMarginPercent?: number; maxDiscountPercent?: number }[] };

/** Decisive refs like the core's (the max effective min-margin and the min effective max-discount), independent of the core build. */
function decisive(margin: Mod, members: readonly string[]): string[] {
  const keyed = margin.perCollection.filter((o) => members.includes(o.collectionId) && (o.minMarginPercent !== undefined || o.maxDiscountPercent !== undefined));
  if (keyed.length === 0) return [];
  const m = (o: Mod["perCollection"][number]) => o.minMarginPercent ?? margin.global.minMarginPercent ?? 0;
  const p = (o: Mod["perCollection"][number]) => o.maxDiscountPercent ?? margin.global.maxDiscountPercent;
  const key = (o: Mod["perCollection"][number]) => o.collectionId.split("/").pop()!;
  const strictM = Math.max(...keyed.map(m));
  const strictP = Math.min(...keyed.map(p));
  const both = keyed.find((o) => m(o) === strictM && p(o) === strictP);
  if (both) return [key(both)];
  return [key(keyed.find((o) => m(o) === strictM)!), key(keyed.find((o) => p(o) === strictP)!)].sort();
}

/** Real config targeting by the fake builders, with the decisive marginRefs added. */
function decisiveDeps(fake: FakeShopify) {
  const deps = makeDeps(fake, db.prisma, { plan: async () => "pro" });
  const base = deps.productRuleIndex;
  deps.productRuleIndex = (config, products) => {
    const index = base(config, products);
    const margin = config.modules.margin as unknown as Mod;
    for (const product of products) {
      const refs = margin.enabled ? decisive(margin, product.collectionIds) : [];
      const entry = index.get(product.productId)!;
      index.set(product.productId, refs.length > 0 ? { ...entry, marginRefs: refs } : entry);
    }
    return index;
  };
  return deps;
}

const refsWritten = (fake: FakeShopify, productId: string) =>
  fake
    .mutations()
    .filter((c) => c.op === "WonSyncMetafieldsSet")
    .flatMap((c, i) => (c.variables as { metafields: { ownerId: string; key: string; value: string }[] }).metafields.map((mf) => ({ i, ...mf })))
    .filter((mf) => mf.ownerId === productId || mf.key === "function_config")
    .map((mf) => (mf.key === "function_config" ? "CONFIG" : ((JSON.parse(mf.value) as { marginRefs?: string[] }).marginRefs ?? [])));

test("a REPLACED marginRef crosses the flip as the union of the old and the new refs, pruned after it (the coordinator's example: never looser than both configs)", async () => {
  const fake = new FakeShopify();
  const product = fake.addProduct(1);
  fake.addCollection(5, [product.id]);
  fake.addCollection(6, [product.id]);
  const deps = decisiveDeps(fake);
  const sync = createSync(deps);
  const oldConfig = marginConfig({ perCollection: [{ collectionId: COLLECTION, minMarginPercent: 30 }, { collectionId: OTHER, minMarginPercent: 20 }] });
  await sync.syncShop(shop, oldConfig);
  assert.deepEqual(fake.productMetafield(product.id), { ruleIds: [], variantRuleIds: {}, marginRefs: ["5"] });
  fake.calls = [];
  // (A rule change too: the test builders' payload carries no margin, and the config must flip.)
  const newConfig = marginConfig({ rules: [autoRule("r2")], perCollection: [{ collectionId: COLLECTION, minMarginPercent: 10 }, { collectionId: OTHER, minMarginPercent: 25 }] });
  const result = await sync.syncShop(shop, newConfig);
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  // Before the flip [5, 6] (the old config resolves 30, the new one 25), then the config, then [6].
  assert.deepEqual(refsWritten(fake, product.id), [["5", "6"], "CONFIG", ["6"]], JSON.stringify(result.steps));
  assert.deepEqual(fake.productMetafield(product.id), { ruleIds: [], variantRuleIds: {}, marginRefs: ["6"] });
  const pruned = result.steps.find((s) => s.step === "products.prune");
  assert.ok(pruned?.ok, JSON.stringify(result.steps));
});

test("the new config HELD after a bridge: the product keeps the union, which the still-running old config resolves at least as strict as before", async () => {
  const fake = new FakeShopify();
  const product = fake.addProduct(1);
  const leaving = fake.addProduct(2);
  fake.addCollection(5, [product.id]);
  fake.addCollection(6, [product.id]);
  const deps = decisiveDeps(fake);
  const sync = createSync(deps);
  const rules = [autoRule("r", { target: { kind: "products", productIds: [leaving.id], variantIds: [] } })];
  const oldConfig = marginConfig({ rules, perCollection: [{ collectionId: COLLECTION, minMarginPercent: 30 }, { collectionId: OTHER, minMarginPercent: 20 }] });
  await sync.syncShop(shop, oldConfig);
  const before = fake.shopMetafieldValue("function_config");
  fake.fail("WonSyncMetafieldsDelete", { userErrors: [{ message: "Internal error" }] }, 1); // the rule's product cannot be cleared
  const result = await sync.syncShop(shop, marginConfig({ rules: [autoRule("r2")], perCollection: [{ collectionId: COLLECTION, minMarginPercent: 10 }, { collectionId: OTHER, minMarginPercent: 25 }] }));
  assert.ok(result.pending.includes("stale_product_refs"));
  assert.equal(fake.shopMetafieldValue("function_config"), before, "held");
  assert.ok(result.steps.some((s) => s.step === "shop_config.write" && s.params?.held === "rule_refs"));
  const refs = (fake.productMetafield(product.id) as { marginRefs: string[] }).marginRefs;
  assert.deepEqual(refs, ["5", "6"]);
  const oldMargin = buildMarginPayload(oldConfig.modules.margin, "CZK");
  assert.equal(resolveMargin(oldMargin, refs)!.minMarginPercent, 30, "the old config (still running) resolves 30 — never the 20 a direct [6] would give");
});

test("property: across the flip the bridge never resolves looser than the looser of the old and the new floor, and resolves exactly to the new one after it", () => {
  let seed = 7;
  const rnd = (n: number) => {
    seed = (seed * 1103515245 + 12345) % 2 ** 31;
    return seed % n;
  };
  const maybe = (v: number) => (rnd(3) === 0 ? undefined : v);
  const ids = ["gid://shopify/Collection/5", "gid://shopify/Collection/6", "gid://shopify/Collection/7"];
  const moduleOf = (): Mod => ({
    enabled: true,
    global: { minMarginPercent: rnd(40), maxDiscountPercent: 20 + rnd(80) },
    perCollection: ids.map((collectionId) => ({ collectionId, minMarginPercent: maybe(rnd(60)), maxDiscountPercent: maybe(5 + rnd(90)) })),
  });
  const floor = (m: Mod, refs: string[], price: number, cost: number | null) => {
    const settings = resolveMargin(buildMarginPayload(m as never, "CZK"), refs)!;
    return marginFloorUnit({ unitPrice: price, costMinor: cost, ...settings }).floorUnit;
  };
  let directWouldLoosen = 0;
  for (let i = 0; i < 2_000; i += 1) {
    const oldM = moduleOf();
    const newM = moduleOf();
    const members = ids.filter(() => rnd(2) === 0);
    const current = decisive(oldM, members);
    const next = decisive(newM, members);
    const bridge = bridgeMarginRefs(current, next, new Set());
    const all = members.map((id) => id.split("/").pop()!);
    const price = 1_000 + rnd(9_000);
    for (const cost of [null, 100 + rnd(price)]) {
      const oldTrue = floor(oldM, all, price, cost);
      const newTrue = floor(newM, all, price, cost);
      assert.ok(floor(oldM, bridge, price, cost) >= Math.min(oldTrue, newTrue), `old config, case ${i}`);
      assert.equal(floor(newM, bridge, price, cost), newTrue, `new config, case ${i}`);
      if (floor(oldM, next, price, cost) < Math.min(oldTrue, newTrue)) directWouldLoosen += 1;
    }
  }
  assert.ok(directWouldLoosen > 0, "writing the new refs directly WOULD loosen some floors (what the bridge prevents)");
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
