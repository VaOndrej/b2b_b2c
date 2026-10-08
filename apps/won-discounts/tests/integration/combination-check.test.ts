// Kontrola kombinací (feedback 2026-10-06, bod 16), with the database: the products come from what the app has
// stored, Free gets the counts and nothing else, a scenario opens in the manual cart — and none of it asks
// Shopify anything the page did not ask before.

import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";

import { milestoneRule } from "@won/core/discounts/milestones";

import type { PrismaClient } from "../../app/generated/prisma/client.ts";
import type { AdminClient } from "../../app/lib/admin-client.server.ts";
import { loadConfig, saveConfig } from "../../app/lib/config.server.ts";
import { combinationCheck, loadScenarioProducts } from "../../app/lib/integration/combination-check.server.ts";
import type { ShopCtx } from "../../app/lib/integration/context.server.ts";
import { overviewPage, tryCartPage } from "../../app/lib/integration/pages.server.ts";
import { createSync } from "../../app/lib/sync/sync.server.ts";
import { productionSyncDeps } from "../../app/lib/sync/wiring.server.ts";
import { clearSignalCache } from "../../app/lib/ui-actions.server.ts";
import { createTestDatabase, type TestDatabase } from "../lib/test-db.ts";
import { FakeStore, quiet, testCtx } from "./helpers.ts";

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
      { title: "Bunda", role: "exception", unitPrice: 2000_00, unitCost: 900, refs: { ruleIds: [], variantRuleIds: {}, tierRef: "vip" } },
      { title: "Šála", role: "outlet", unitPrice: 250_00, unitCost: 100, refs: undefined },
    ],
  );
  // Another shop's rows are never read (SEC-2).
  assert.deepEqual(await loadScenarioProducts(db.prisma, "someone-else.myshopify.com", "CZK"), []);
});

test("Free gets the number of warnings and nothing else; Pro gets which scenarios and why", async () => {
  const store = new FakeStore();
  await storeDiscounts(true);
  await storeProducts();
  const facts = { config: (await loadConfig(db.prisma, shop)).config, shopCurrency: "CZK", timezone: "Europe/Prague", marketNames: { cz: "Česko" } };
  const pro = (await combinationCheck(ctxFor(store, "pro"), { ...facts, plan: "pro" }))!;
  assert.equal(pro.sample, false);
  assert.ok(pro.warnings >= 2, JSON.stringify(pro.scenarios?.map((s) => [s.id, s.status])));
  const byId = new Map(pro.scenarios!.map((s) => [s.id, s]));
  // The product with the lowest margin (350 of 400 Kč): the tier's 10 % would go under the 20 % margin.
  assert.deepEqual(byId.get("tiers")!.findings.map((f) => [f.kind, f.href]), [["margin", "/app/margin"]]);
  assert.ok(byId.get("steps")!.findings.some((f) => f.kind === "step_superseded" && f.href === "/app/rewards#steps"));
  assert.equal(byId.get("tiers")!.open, "/app/try-cart?scenario=tiers");

  const free = (await combinationCheck(ctxFor(store, "free"), { ...facts, plan: "free" }))!;
  assert.deepEqual(Object.keys(free).sort(), ["ok", "sample", "warnings"]);
  assert.ok(free.warnings >= 1);
  assert.doesNotMatch(JSON.stringify(free), /Tričko|LETO10|margin|scenario/);
  // Nothing runs → no check at all; the shop's currency unknown → none either (never a guess).
  await saveConfig(db.prisma, shop, { ...facts.config, modules: { ...facts.config.modules, tiers: { sets: [] }, codes: { rules: [] } } });
  assert.equal(await combinationCheck(ctxFor(store, "pro"), { ...facts, config: (await loadConfig(db.prisma, shop)).config, plan: "pro" }), null);
  assert.equal(await combinationCheck(ctxFor(store, "pro"), { ...facts, plan: "pro", shopCurrency: null }), null);
});

test("the check asks Shopify nothing: it is planned from the database alone, and the pages make exactly the reads they made without it", async () => {
  // 1) The check itself with a client that fails on any request.
  await storeDiscounts(true);
  await storeProducts();
  const config = (await loadConfig(db.prisma, shop)).config;
  const offline: AdminClient = { graphql: async () => assert.fail("the combination check called Shopify") };
  const check = await combinationCheck({ ...ctxFor(new FakeStore(), "pro"), client: offline }, { config, plan: "pro", shopCurrency: "CZK", timezone: "Europe/Prague" });
  assert.ok(check && check.scenarios!.length >= 3);

  // 2) The pages: the same operations for a shop with scenarios as for the same shop with none to build.
  const reads = async (page: "try-cart" | "overview") => {
    clearSignalCache();
    const store = new FakeStore();
    const ctx = ctxFor(store, "pro");
    const props = page === "try-cart" ? await tryCartPage(ctx, PAGE) : await overviewPage(ctx, PAGE);
    return { ops: [...store.ops].sort(), combos: "combos" in props ? props.combos : undefined };
  };
  const withTry = await reads("try-cart");
  const withHome = await reads("overview");
  assert.ok(withTry.combos && withHome.combos, "both pages carry the check");
  await saveConfig(db.prisma, shop, { ...config, modules: { ...config.modules, tiers: { sets: [] }, codes: { rules: [] } } });
  const withoutTry = await reads("try-cart");
  assert.equal(withoutTry.combos, undefined);
  assert.deepEqual(withTry.ops, withoutTry.ops, "Vyzkoušet košík: no Shopify read more for the check");
  assert.ok(withTry.ops.every((op) => !op.startsWith("WonSync") && !op.startsWith("WonTryCart")), withTry.ops.join(", "));
});

test("Přehled carries the two counts on every plan; Vyzkoušet košík the list on Pro and the counts on Free", async () => {
  await storeDiscounts();
  await storeProducts();
  const home = await overviewPage(ctxFor(new FakeStore(), "free"), PAGE);
  assert.deepEqual(Object.keys(home.combos ?? {}).sort(), ["ok", "warnings"]);
  assert.equal((home.combos?.ok ?? 0) + (home.combos?.warnings ?? 0) >= 3, true);
  clearSignalCache();
  const free = await tryCartPage(ctxFor(new FakeStore(), "free"), PAGE);
  assert.equal(free.pro, false);
  assert.equal(free.combos?.scenarios, undefined);
  assert.deepEqual({ ok: free.combos?.ok, warnings: free.combos?.warnings }, home.combos);
  clearSignalCache();
  const pro = await tryCartPage(ctxFor(new FakeStore(), "pro"), PAGE);
  assert.ok((pro.combos?.scenarios ?? []).length >= 3);
});

test("a scenario opens in the manual cart (Pro): its products with the stored prices, its code ticked, its market — Free gets no prepared cart", async () => {
  await storeDiscounts();
  await storeProducts();
  const pro = await tryCartPage(ctxFor(new FakeStore(), "pro"), { ...PAGE, scenario: "steps-code" });
  // 4 000 Kč of the 400 Kč product reach the higher step; the code is the rule's.
  assert.deepEqual(pro.lines, [{ variantId: V(2), productId: P(2), title: "Tričko", quantity: 10, unitPrice: { CZK: 400_00 } }]);
  assert.deepEqual([pro.ruleIds, pro.currency, pro.date, pro.time, pro.opened], [["code"], "CZK:cz", "2026-10-08", "12:00", "Stupeň se slevou + kód LETO10"]);
  assert.equal(pro.plan, null, "prepared, not calculated: the merchant runs it with the store's current prices");
  clearSignalCache();
  const unknown = await tryCartPage(ctxFor(new FakeStore(), "pro"), { ...PAGE, scenario: "nope" });
  assert.deepEqual([unknown.lines, unknown.opened], [[], undefined]);
  clearSignalCache();
  const free = await tryCartPage(ctxFor(new FakeStore(), "free"), { ...PAGE, scenario: "steps-code" });
  assert.deepEqual([free.lines, free.opened], [[], undefined]);
});
