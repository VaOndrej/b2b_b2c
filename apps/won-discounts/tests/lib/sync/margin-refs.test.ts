import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";

import { buildShopFunctionConfig } from "@won/core/discounts/function-payload";
import { productRuleIndex } from "@won/core/discounts/targeting";

import { hasProductTargets, targetScopes } from "../../../app/lib/sync/products.ts";
import { createSync } from "../../../app/lib/sync/sync.server.ts";
import type { ShopConfigBuildOptions } from "../../../app/lib/sync/types.ts";
import { createTestDatabase, type TestDatabase } from "../test-db.ts";
import { FakeShopify } from "./fake-shopify.ts";
import { autoRule, configWith, makeDeps } from "./helpers.ts";

// Margin protection in the product targeting (MVP 2): collections with a
// margin setting are read like targeted collections (only while protection is
// on, on the GATED config — Free folds collections into the global values, so
// a Free shop's products never carry marginRefs), each product metafield
// carries the engine's `marginRefs` (a product in such a collection gets a
// metafield even without any rule), ProductTargetIndex keeps the value, and
// the shop config is built with the shop currency (step 0) so costs are known.

let db: TestDatabase;
let seq = 0;
let shop: string;
before(() => {
  db = createTestDatabase("sync-margin-refs");
});
after(async () => {
  await db.drop();
});
beforeEach(() => {
  seq += 1;
  shop = `margin-refs-${seq}.myshopify.com`;
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

/** Real engine targeting + a recording shop-config builder (the currency it got). */
function realDeps(fake: FakeShopify, plan: "free" | "pro" = "pro") {
  const currencies: (string | undefined)[] = [];
  const deps = makeDeps(fake, db.prisma, {
    plan: async () => plan,
    productRuleIndex: (config, products) => productRuleIndex(config, products),
  });
  const fakeBuild = deps.buildShopFunctionConfig;
  deps.buildShopFunctionConfig = (config, options: ShopConfigBuildOptions) => {
    currencies.push(options.shopCurrency);
    return fakeBuild(config, options);
  };
  return { deps, currencies };
}

test("targetScopes: margin collections count only while protection is on (and only those with a value)", () => {
  assert.deepEqual([...targetScopes(marginConfig()).collectionIds], [COLLECTION]);
  assert.deepEqual([...targetScopes(marginConfig({ enabled: false })).collectionIds], []);
  assert.deepEqual([...targetScopes(marginConfig({ perCollection: [{ collectionId: OTHER }] })).collectionIds], [], "no value set");
  assert.equal(hasProductTargets(marginConfig()), true);
  assert.equal(hasProductTargets(marginConfig({ enabled: false })), false);
});

test("Pro: a product in a margin collection carries marginRefs — also without any rule — and the index keeps the value", async () => {
  const fake = new FakeShopify();
  const inside = fake.addProduct(1);
  const ruled = fake.addProduct(2);
  const outside = fake.addProduct(3);
  fake.addCollection(5, [inside.id, ruled.id]);
  const { deps, currencies } = realDeps(fake);
  const config = marginConfig({
    rules: [autoRule("r", { target: { kind: "products", productIds: [ruled.id, outside.id], variantIds: [] } })],
  });
  const result = await createSync(deps).syncShop(shop, config);
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.deepEqual(fake.productMetafield(inside.id), { ruleIds: [], variantRuleIds: {}, marginRefs: ["5"] });
  assert.deepEqual(fake.productMetafield(ruled.id), { ruleIds: ["r"], variantRuleIds: {}, marginRefs: ["5"] });
  assert.deepEqual(fake.productMetafield(outside.id), { ruleIds: ["r"], variantRuleIds: {} }, "no key when not in a margin collection");
  const index = await db.prisma.productTargetIndex.findMany({ where: { shop }, orderBy: { productId: "asc" } });
  assert.deepEqual(
    index.map((row) => [row.productId, row.value === null ? null : JSON.parse(row.value)]),
    [
      [inside.id, { ruleIds: [], variantRuleIds: {}, marginRefs: ["5"] }],
      [ruled.id, { ruleIds: ["r"], variantRuleIds: {}, marginRefs: ["5"] }],
      [outside.id, { ruleIds: ["r"], variantRuleIds: {} }],
    ],
  );
  assert.ok(currencies.length > 0 && currencies.every((c) => c === "CZK"), `shop currency from step 0: ${currencies.join(",")}`);
});

test("switching protection off clears a product that only carried marginRefs, and drops the key elsewhere", async () => {
  const fake = new FakeShopify();
  const inside = fake.addProduct(1);
  const ruled = fake.addProduct(2);
  fake.addCollection(5, [inside.id, ruled.id]);
  const { deps } = realDeps(fake);
  const sync = createSync(deps);
  const rules = [autoRule("r", { target: { kind: "products", productIds: [ruled.id], variantIds: [] } })];
  await sync.syncShop(shop, marginConfig({ rules }));
  const off = await sync.syncShop(shop, marginConfig({ rules, enabled: false }));
  assert.equal(off.ok, true, JSON.stringify(off.errors));
  assert.equal(fake.productMetafield(inside.id), undefined);
  assert.deepEqual(fake.productMetafield(ruled.id), { ruleIds: ["r"], variantRuleIds: {} });
  assert.equal(fake.callsOf("WonSyncCollectionProducts").filter((c) => (c.variables as { id: string }).id === COLLECTION).length, 1, "the collection is not read while off");
});

test("Free (BILL-1): collections fold into the global values — no marginRefs, the margin collection is never read", async () => {
  const fake = new FakeShopify();
  const inside = fake.addProduct(1);
  fake.addCollection(5, [inside.id]);
  const { deps } = realDeps(fake, "free");
  const result = await createSync(deps).syncShop(shop, marginConfig());
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.equal(fake.productMetafield(inside.id), undefined);
  assert.equal(fake.callsOf("WonSyncCollectionProducts").length, 0);
  const shopConfig = deps.log.shopConfigs.at(-1)!;
  assert.deepEqual(shopConfig.modules.margin.perCollection, [], "gated");
  assert.equal(shopConfig.modules.margin.global.minMarginPercent, 30, "folded: the strictest value");
});

test("an index row written before MVP 2 (no value) gets its value recorded without a Shopify write", async () => {
  const fake = new FakeShopify();
  const product = fake.addProduct(1);
  const { deps } = realDeps(fake);
  const sync = createSync(deps);
  const config = configWith([autoRule("r", { target: { kind: "products", productIds: [product.id], variantIds: [] } })]);
  await sync.syncShop(shop, config);
  await db.prisma.productTargetIndex.updateMany({ where: { shop }, data: { value: null } });
  fake.calls = [];
  await sync.syncShop(shop, config);
  assert.equal(fake.mutations().filter((c) => c.op === "WonSyncMetafieldsSet" && JSON.stringify(c.variables).includes('"product"')).length, 0);
  const row = await db.prisma.productTargetIndex.findFirst({ where: { shop } });
  assert.deepEqual(JSON.parse(row!.value!), { ruleIds: ["r"], variantRuleIds: {} });
});

test("the real shop config carries the margin's currency (`cur`) from step 0", () => {
  const encoded = buildShopFunctionConfig(marginConfig(), { now: "2026-09-29T12:00:00", shopTimezone: "Europe/Prague", shopCurrency: "CZK" });
  const margin = (JSON.parse(encoded.json) as { modules: { margin: { cur?: string } } }).modules.margin;
  assert.equal(margin.cur, "CZK");
});

test("a margin collection too large to read is left out with a failed step (its products keep the global setting), nothing else held", async () => {
  const fake = new FakeShopify();
  fake.countLimit = 1; // Shopify counts "at least 1": Won does not read it
  const a = fake.addProduct(1);
  const b = fake.addProduct(2);
  fake.addCollection(5, [a.id, b.id]);
  const { deps } = realDeps(fake);
  const result = await createSync(deps).syncShop(shop, marginConfig());
  const step = result.steps.find((s) => s.step === "margin.too_large");
  assert.ok(step && !step.ok, JSON.stringify(result.steps));
  assert.match(step!.detail, /gid:\/\/shopify\/Collection\/5/);
  assert.equal(fake.callsOf("WonSyncCollectionProducts").length, 0, "never paged");
  assert.equal(fake.productMetafield(a.id), undefined);
  assert.ok(fake.shopMetafieldValue("function_config"), "the shop config is still written");
});
