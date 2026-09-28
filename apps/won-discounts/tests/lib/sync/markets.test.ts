import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";

import type { PrismaClient } from "../../../app/generated/prisma/client.ts";
import type { AdminClient } from "../../../app/lib/admin-client.server.ts";
import { loadConfig } from "../../../app/lib/config.server.ts";
import { loadShopMarkets, withMarketCountries } from "../../../app/lib/sync/markets.ts";
import { resyncShop, saveAndSync } from "../../../app/lib/sync/save-and-sync.server.ts";
import { createSync } from "../../../app/lib/sync/sync.server.ts";
import { Transport } from "../../../app/lib/sync/transport.ts";
import { productionSyncDeps } from "../../../app/lib/sync/wiring.server.ts";
import { createTestDatabase, type TestDatabase } from "../test-db.ts";
import { FakeShopify } from "./fake-shopify.ts";
import { autoRule, configWith, makeDeps } from "./helpers.ts";

// Pro market targeting: countries come from Shopify Markets (read_markets) and
// are resolved at SAVE time (I2) — merged into the config before the budget is
// measured and saved with it; the sync ships the saved config and never swaps.
// The markets read is paged so no query requests more than 1 000 points (I1).

let db: TestDatabase;
let seq = 0;
let shop: string;
before(() => {
  db = createTestDatabase("sync-markets");
});
after(async () => {
  await db.drop();
});
beforeEach(() => {
  seq += 1;
  shop = `markets-${seq}.myshopify.com`;
});

const quiet = { info() {}, warn() {}, error() {} };
const MARKETS = [
  { handle: "cz", currency: "CZK", enabled: true },
  { handle: "sk", currency: "EUR", enabled: true },
];

function seedMarkets(fake: FakeShopify) {
  fake.markets = [
    { handle: "cz", name: "Česko", status: "ACTIVE", currency: "CZK", countries: ["CZ"] },
    { handle: "sk", name: "Slovensko", status: "ACTIVE", currency: "EUR", countries: ["SK"] },
    { handle: "eu", name: "EU", status: "DRAFT", currency: "EUR", countries: ["DE", "AT", "FR"] },
  ];
}

const realSync = (client: AdminClient, prisma: PrismaClient) =>
  createSync({ ...productionSyncDeps(client, prisma, quiet), now: () => new Date("2026-09-28T12:00:00Z"), sleep: async () => {} });

test("loadShopMarkets pages markets (without regions) and each market's countries separately", async () => {
  const fake = new FakeShopify();
  seedMarkets(fake);
  fake.pageSize = 2;
  const transport = new Transport(fake, { attempts: 1 }, async () => {}, quiet);
  const markets = await loadShopMarkets(transport);
  assert.deepEqual(
    markets.map((m) => [m.handle, m.active, m.currency, m.countries]),
    [
      ["cz", true, "CZK", ["CZ"]],
      ["sk", true, "EUR", ["SK"]],
      ["eu", false, "EUR", ["DE", "AT", "FR"]],
    ],
  );
  assert.equal(fake.callsOf("WonSyncMarkets").length, 2, "2 pages of markets");
  assert.equal(fake.callsOf("WonSyncMarketRegions").length, 4, "eu's 3 countries need 2 pages");
  const merged = withMarketCountries(configWith([], { markets: [...MARKETS, { handle: "hu", currency: "HUF", enabled: true }] }), markets);
  assert.deepEqual(merged.missing, ["hu"]);
  assert.equal(merged.changed, true);
  assert.deepEqual(merged.config.markets.map((m) => m.countries ?? null), [["CZ"], ["SK"], null]);
});

test("the sync itself never reads or swaps market countries: it ships the config as saved", async () => {
  const fake = new FakeShopify();
  seedMarkets(fake);
  const deps = makeDeps(fake, db.prisma);
  const saved = MARKETS.map((m) => (m.handle === "cz" ? { ...m, countries: ["CZ"] } : m));
  const result = await createSync(deps).syncShop(shop, configWith([autoRule("czonly", { targeting: { markets: ["cz"] } })], { markets: saved }));
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.equal(fake.callsOf("WonSyncMarkets").length, 0);
  assert.deepEqual(deps.log.shopConfigs.at(-1)!.markets.map((m) => m.countries ?? null), [["CZ"], null]);
});

test("saveAndSync resolves Shopify countries BEFORE saving and saves them; no market target → no markets read", async () => {
  const fake = new FakeShopify();
  seedMarkets(fake);
  const result = await saveAndSync({
    client: fake,
    db: db.prisma,
    shop,
    input: { markets: MARKETS, modules: { codes: { rules: [autoRule("czonly", { targeting: { markets: ["cz"] } })] } } },
    createSync: realSync,
  });
  assert.equal(result.save.ok, true, JSON.stringify(result.save));
  assert.equal(result.sync?.ok, true, JSON.stringify(result.sync?.errors));
  const stored = await loadConfig(db.prisma, shop);
  assert.deepEqual(stored.config.markets.map((m) => [m.handle, m.countries]), [
    ["cz", ["CZ"]],
    ["sk", ["SK"]],
  ]);
  assert.deepEqual(JSON.parse(fake.shopMetafieldValue("function_config")!).marketCountries, { cz: ["CZ"] });

  const plain = new FakeShopify();
  seedMarkets(plain);
  await saveAndSync({ client: plain, db: db.prisma, shop: `${shop}-plain`, input: { modules: { codes: { rules: [autoRule("all")] } } }, createSync: realSync });
  assert.equal(plain.callsOf("WonSyncMarkets").length, 0);
});

test("M11/I2: the save-time budget is measured WITH Shopify's countries — an accepted save never fails the sync budget", async () => {
  // 10 markets targeted by one rule; in Shopify each has 200 countries (~1 000 B each in marketCountries).
  const handles = Array.from({ length: 10 }, (_, i) => `m${i}`);
  const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const countries = (offset: number) =>
    Array.from({ length: 200 }, (_, i) => `${letters[(i + offset) % 26]}${letters[Math.floor(i / 26) % 26]}`);
  const input = {
    markets: handles.map((handle) => ({ handle, currency: "EUR", enabled: true })),
    modules: { codes: { rules: [autoRule("wide", { targeting: { markets: handles } })] } },
  };

  const fake = new FakeShopify();
  fake.markets = handles.map((handle, i) => ({ handle, name: handle, status: "ACTIVE" as const, currency: "EUR", countries: countries(i) }));
  const refused = await saveAndSync({ client: fake, db: db.prisma, shop, input, createSync: realSync });
  assert.equal(refused.save.ok, false);
  if (refused.save.ok) return;
  assert.equal(refused.save.reason, "function_config_too_large");
  assert.equal(refused.sync, null);
  assert.equal(fake.mutations().length, 0, "nothing reached Shopify");

  // The same input with Shopify's small real markets saves, and its sync never stops on the budget.
  const small = new FakeShopify();
  small.markets = handles.map((handle) => ({ handle, name: handle, status: "ACTIVE" as const, currency: "EUR", countries: ["CZ"] }));
  const ok = await saveAndSync({ client: small, db: db.prisma, shop: `${shop}-small`, input, createSync: realSync });
  assert.equal(ok.save.ok, true);
  assert.equal(ok.sync?.ok, true, JSON.stringify(ok.sync?.errors));
  assert.ok(!ok.sync?.steps.some((s) => s.step === "shop_config.build"));
});

test("read_markets not granted: the save goes on with the countries in the input, and says so", async () => {
  const fake = new FakeShopify();
  fake.fail("WonSyncMarkets", { graphqlError: "Access denied for markets field. Required access: `read_markets` access scope." });
  const saved = MARKETS.map((m) => (m.handle === "cz" ? { ...m, countries: ["CZ"] } : m));
  const result = await saveAndSync({
    client: fake,
    db: db.prisma,
    shop,
    input: { markets: saved, modules: { codes: { rules: [autoRule("czonly", { targeting: { markets: ["cz"] } })] } } },
    createSync: realSync,
  });
  assert.equal(result.save.ok, true);
  assert.ok(result.warnings.some((w) => /read_markets/.test(w)), JSON.stringify(result.warnings));
  assert.deepEqual(JSON.parse(fake.shopMetafieldValue("function_config")!).marketCountries, { cz: ["CZ"] });
});

test("resyncShop refreshes changed Shopify countries through the save path (new version, budget-checked)", async () => {
  const fake = new FakeShopify();
  seedMarkets(fake);
  const input = { markets: MARKETS, modules: { codes: { rules: [autoRule("czonly", { targeting: { markets: ["cz"] } })] } } };
  await saveAndSync({ client: fake, db: db.prisma, shop, input, createSync: realSync });
  const versionsBefore = await db.prisma.configVersion.count({ where: { shop } });

  fake.markets[0]!.countries = ["CZ", "PL"];
  const result = await resyncShop({ client: fake, db: db.prisma, shop, createSync: realSync });
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.equal(await db.prisma.configVersion.count({ where: { shop } }), versionsBefore + 1);
  assert.deepEqual(JSON.parse(fake.shopMetafieldValue("function_config")!).marketCountries, { cz: ["CZ", "PL"] });

  // Unchanged countries: no new version.
  await resyncShop({ client: fake, db: db.prisma, shop, createSync: realSync });
  assert.equal(await db.prisma.configVersion.count({ where: { shop } }), versionsBefore + 1);
});
