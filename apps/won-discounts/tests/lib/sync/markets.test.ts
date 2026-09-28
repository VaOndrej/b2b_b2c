import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";

import { loadShopMarkets, withMarketCountries } from "../../../app/lib/sync/markets.ts";
import { createSync } from "../../../app/lib/sync/sync.server.ts";
import { Transport } from "../../../app/lib/sync/transport.ts";
import { createTestDatabase, type TestDatabase } from "../test-db.ts";
import { FakeShopify } from "./fake-shopify.ts";
import { autoRule, configWith, makeDeps } from "./helpers.ts";

// Pro market targeting (T1 fix round): the engine matches the cart country
// against `config.markets[].countries`, shipped as `marketCountries`. Countries
// live in Shopify Markets (read_markets), so the sync reads them fresh whenever
// a rule targets a market and builds the shop payload with them (markets.ts).

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

const MARKETS = [
  { handle: "cz", currency: "CZK", enabled: true },
  { handle: "sk", currency: "EUR", enabled: true },
];

function seedMarkets(fake: FakeShopify) {
  fake.markets = [
    { handle: "cz", name: "Česko", status: "ACTIVE", currency: "CZK", countries: ["CZ"] },
    { handle: "sk", name: "Slovensko", status: "ACTIVE", currency: "EUR", countries: ["SK"] },
    { handle: "eu", name: "EU", status: "DRAFT", currency: "EUR", countries: ["DE", "AT"] },
  ];
}

test("a rule targeting a market: the shop payload is built with each market's countries from Shopify", async () => {
  const fake = new FakeShopify();
  seedMarkets(fake);
  const deps = makeDeps(fake, db.prisma);
  const config = configWith([autoRule("czonly", { targeting: { markets: ["cz"] } })], { markets: MARKETS });
  const result = await createSync(deps).syncShop(shop, config);
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  const built = deps.log.shopConfigs.at(-1)!;
  assert.deepEqual(
    built.markets.map((m) => [m.handle, m.countries]),
    [
      ["cz", ["CZ"]],
      ["sk", ["SK"]],
    ],
  );
  assert.ok(result.steps.some((s) => s.step === "markets.read" && s.ok));
  assert.equal(config.markets[0]!.countries, undefined, "the caller's config is not mutated");
});

test("no rule targets a market: markets are not read (no read_markets needed)", async () => {
  const fake = new FakeShopify();
  seedMarkets(fake);
  const deps = makeDeps(fake, db.prisma);
  const result = await createSync(deps).syncShop(shop, configWith([autoRule("all")], { markets: MARKETS }));
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.equal(fake.callsOf("WonSyncMarkets").length, 0);
});

test("read_markets not granted: recorded, the sync continues with the saved countries", async () => {
  const fake = new FakeShopify();
  fake.fail("WonSyncMarkets", { graphqlError: "Access denied for markets field. Required access: `read_markets` access scope." });
  const deps = makeDeps(fake, db.prisma);
  const saved = MARKETS.map((m) => (m.handle === "cz" ? { ...m, countries: ["CZ"] } : m));
  const result = await createSync(deps).syncShop(shop, configWith([autoRule("czonly", { targeting: { markets: ["cz"] } })], { markets: saved }));
  assert.equal(result.ok, false);
  assert.ok(result.steps.some((s) => s.step === "markets.read" && !s.ok && /read_markets/.test(s.detail)));
  assert.deepEqual(deps.log.shopConfigs.at(-1)!.markets[0]!.countries, ["CZ"]);
  assert.ok(fake.shopMetafieldValue("function_config"), "the rest of the sync still ran");
});

test("loadShopMarkets pages through every market; withMarketCountries reports handles Shopify does not have", async () => {
  const fake = new FakeShopify();
  seedMarkets(fake);
  fake.pageSize = 2;
  const transport = new Transport(fake, { attempts: 1 }, async () => {}, { info() {}, warn() {}, error() {} });
  const markets = await loadShopMarkets(transport);
  assert.deepEqual(
    markets.map((m) => [m.handle, m.active, m.currency, m.countries]),
    [
      ["cz", true, "CZK", ["CZ"]],
      ["sk", true, "EUR", ["SK"]],
      ["eu", false, "EUR", ["DE", "AT"]],
    ],
  );
  const config = configWith([], { markets: [...MARKETS, { handle: "hu", currency: "HUF", enabled: true }] });
  const merged = withMarketCountries(config, markets);
  assert.deepEqual(merged.missing, ["hu"]);
  assert.deepEqual(merged.config.markets.map((m) => m.countries ?? null), [["CZ"], ["SK"], null]);
});
