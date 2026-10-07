import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";

import type { PrismaClient } from "../../../app/generated/prisma/client.ts";
import type { AdminClient } from "../../../app/lib/admin-client.server.ts";
import { loadConfig, saveConfig } from "../../../app/lib/config.server.ts";
import {
  canReadMarkets,
  loadSyncStatus,
  refreshTargeting,
  resyncIfPending,
  resyncShop,
  saveAndSync,
} from "../../../app/lib/sync/save-and-sync.server.ts";
import { storedConfigNotApplied } from "../../../app/lib/sync/runs.ts";
import { createSync, syncIdle, type Sync } from "../../../app/lib/sync/sync.server.ts";
import { productionSyncDeps } from "../../../app/lib/sync/wiring.server.ts";
import { createTestDatabase, type TestDatabase } from "../test-db.ts";
import { FakeShopify } from "./fake-shopify.ts";
import { autoRule } from "./helpers.ts";

// F2 at the save / resync level:
//   item 4  a crash between the save and its SyncRun: resyncIfPending resyncs a
//           stored config no applying run synced (onboarding-only saves never);
//   item 12 a changed shop zone or Shopify market countries trigger a resync;
//   item 7  saveAndSync waits at most `deadlineMs`, the sync goes on after;
//   item 13 saves name the version they build on (`base_changed` otherwise);
//           the market-countries re-save retries on top of the new version;
//   item 9  read_markets is optional: without it markets are not read.

let db: TestDatabase;
let seq = 0;
let shop: string;
before(() => {
  db = createTestDatabase("f2-resync");
});
after(async () => {
  await db.drop();
});
beforeEach(() => {
  seq += 1;
  shop = `f2-resync-${seq}.myshopify.com`;
});

const quiet = { info: () => {}, warn: () => {}, error: () => {} };
const NOW = new Date("2026-09-28T12:00:00Z");
const realSync =
  (plan: "free" | "pro" = "pro", now: () => Date = () => NOW) =>
  (client: AdminClient, prisma: PrismaClient) =>
    createSync({ ...productionSyncDeps(client, prisma, quiet), now, sleep: async () => {}, plan: async () => plan });

const base = { modules: { codes: { rules: [autoRule("a1")] } } };

test("P2-2: a save whose sync never ran (process died) is resynced by resyncIfPending even though the last run was ok", async () => {
  const fake = new FakeShopify();
  const first = await saveAndSync({ client: fake, db: db.prisma, shop, input: base, createSync: realSync() });
  assert.equal(first.sync?.ok, true);
  // The crash: saved (a new ConfigVersion) but no sync, no SyncRun.
  const { config } = await loadConfig(db.prisma, shop);
  const next = { ...config, modules: { ...config.modules, codes: { rules: [...config.modules.codes.rules, autoRule("a2")] } } };
  assert.equal((await saveConfig(db.prisma, shop, next)).ok, true);
  assert.equal((await loadSyncStatus(db.prisma, shop))?.ok, true, "the last run is ok");
  assert.equal(await storedConfigNotApplied(db.prisma, shop), true);

  const result = await resyncIfPending({ client: fake, db: db.prisma, shop, createSync: realSync() });
  assert.equal(result.resynced, true);
  assert.equal(result.resynced && result.why, "not_applied");
  assert.equal(result.resynced && result.result.ok, true);
  assert.deepEqual(JSON.parse(fake.shopMetafieldValue("function_config")!).modules.codes.rules.map((r: { id: string }) => r.id), ["a1", "a2"]);
  assert.equal(await storedConfigNotApplied(db.prisma, shop), false);
  assert.deepEqual(await resyncIfPending({ client: fake, db: db.prisma, shop, createSync: realSync() }), { resynced: false, reason: "up_to_date" });
});

test("P2-2: an onboarding-only save (nothing that runs changed) is not a reason to resync", async () => {
  const fake = new FakeShopify();
  await saveAndSync({ client: fake, db: db.prisma, shop, input: base, createSync: realSync() });
  const { config } = await loadConfig(db.prisma, shop);
  assert.equal((await saveConfig(db.prisma, shop, { ...config, onboarding: { goals: ["rewards"], step: 3 } })).ok, true);
  assert.equal(await storedConfigNotApplied(db.prisma, shop), false);
  assert.deepEqual(await resyncIfPending({ client: fake, db: db.prisma, shop, createSync: realSync() }), { resynced: false, reason: "up_to_date" });
});

test("item 12: a shop zone different from the one the last sync used triggers a resync (rule days move)", async () => {
  const fake = new FakeShopify();
  await saveAndSync({ client: fake, db: db.prisma, shop, input: base, createSync: realSync() });
  assert.deepEqual(await resyncIfPending({ client: fake, db: db.prisma, shop, createSync: realSync(), timezone: "Europe/Prague" }), {
    resynced: false,
    reason: "up_to_date",
  });
  fake.ianaTimezone = "Europe/London";
  const result = await resyncIfPending({ client: fake, db: db.prisma, shop, createSync: realSync(), timezone: "Europe/London" });
  assert.equal(result.resynced && result.why, "timezone");
  assert.deepEqual(await resyncIfPending({ client: fake, db: db.prisma, shop, createSync: realSync(), timezone: "Europe/London" }), {
    resynced: false,
    reason: "up_to_date",
  });
});

test("item 12: changed Shopify market countries trigger a resync that saves them (checked at most hourly)", async () => {
  const fake = new FakeShopify();
  fake.markets = [{ handle: "cz", name: "Česko", status: "ACTIVE", currency: "CZK", countries: ["CZ"] }];
  const input = {
    markets: [{ handle: "cz", currency: "CZK", enabled: true }],
    modules: { codes: { rules: [autoRule("m", { targeting: { markets: ["cz"] } })] } },
  };
  let clock = NOW.getTime();
  const now = () => new Date(clock);
  await saveAndSync({ client: fake, db: db.prisma, shop, input, createSync: realSync("pro", now), now });
  const quietCheck = await resyncIfPending({ client: fake, db: db.prisma, shop, createSync: realSync("pro", now), now, checkMarkets: true });
  assert.deepEqual(quietCheck, { resynced: false, reason: "up_to_date" });

  fake.markets[0]!.countries = ["CZ", "SK"];
  clock += 10 * 60_000;
  assert.deepEqual(
    await resyncIfPending({ client: fake, db: db.prisma, shop, createSync: realSync("pro", now), now, checkMarkets: true }),
    { resynced: false, reason: "up_to_date" },
    "checked less than an hour ago: not read again",
  );
  clock += 60 * 60_000;
  const result = await resyncIfPending({ client: fake, db: db.prisma, shop, createSync: realSync("pro", now), now, checkMarkets: true });
  assert.equal(result.resynced && result.why, "markets");
  assert.deepEqual((await loadConfig(db.prisma, shop)).config.markets[0]!.countries, ["CZ", "SK"]);
});

test("T1: a shop that saved nothing gets its Shopify markets on the first Přehled check; a market added later is picked up within the hour", async () => {
  const fake = new FakeShopify();
  fake.markets = [
    { handle: "cz", name: "Česko", status: "ACTIVE", currency: "CZK", countries: ["CZ"] },
    { handle: "sk", name: "Slovensko", status: "ACTIVE", currency: "EUR", countries: ["SK"] },
  ];
  let clock = NOW.getTime();
  const now = () => new Date(clock);
  const args = () => ({ client: fake, db: db.prisma, shop, createSync: realSync("free", now), now });

  // Without the check (any page but the Přehled) and without the scope nothing is read or saved.
  assert.deepEqual(await resyncIfPending(args()), { resynced: false, reason: "nothing_saved" });
  assert.deepEqual(await resyncIfPending({ ...args(), checkMarkets: true, grantedScopes: "read_products" }), { resynced: false, reason: "nothing_saved" });
  assert.equal(fake.callsOf("WonSyncMarkets").length, 0);
  assert.equal((await loadConfig(db.prisma, shop)).exists, false);

  const first = await resyncIfPending({ ...args(), checkMarkets: true });
  assert.equal(first.resynced && first.why, "markets");
  assert.equal(first.resynced && first.result.ok, true);
  const stored = await loadConfig(db.prisma, shop);
  assert.deepEqual(stored.config.markets, [
    { handle: "cz", currency: "CZK", enabled: true, countries: ["CZ"] },
    { handle: "sk", currency: "EUR", enabled: true, countries: ["SK"] },
  ]);
  assert.deepEqual(stored.config.modules.codes.rules, [], "nothing but the markets was added to the defaults");

  // Hungary is added in Shopify and Slovakia switched off: the next hourly check saves both, although no rule targets a market.
  fake.markets.push({ handle: "hu", name: "Maďarsko", status: "ACTIVE", currency: "HUF", countries: ["HU"] });
  fake.markets[1]!.status = "DRAFT";
  clock += 10 * 60_000;
  assert.deepEqual(await resyncIfPending({ ...args(), checkMarkets: true }), { resynced: false, reason: "up_to_date" }, "checked less than an hour ago");
  clock += 60 * 60_000;
  const later = await resyncIfPending({ ...args(), checkMarkets: true });
  assert.equal(later.resynced && later.why, "markets");
  assert.deepEqual(
    (await loadConfig(db.prisma, shop)).config.markets.map((m) => [m.handle, m.currency, m.enabled]),
    [
      ["cz", "CZK", true],
      ["sk", "EUR", false],
      ["hu", "HUF", true],
    ],
  );
  clock += 61 * 60_000;
  assert.deepEqual(await resyncIfPending({ ...args(), checkMarkets: true }), { resynced: false, reason: "up_to_date" }, "nothing changed: no save");
});

test("T1: a shop whose Shopify has no market (or cannot be read) still saves nothing on the check", async () => {
  const fake = new FakeShopify();
  const args = { client: fake, db: db.prisma, shop, createSync: realSync("free"), now: () => NOW, checkMarkets: true };
  assert.deepEqual(await resyncIfPending(args), { resynced: false, reason: "nothing_saved" });
  assert.equal((await loadConfig(db.prisma, shop)).exists, false);
});

test("item 9: without read_markets (known from the session) markets are never read; the save says so", async () => {
  const fake = new FakeShopify();
  fake.markets = [{ handle: "cz", name: "Česko", status: "ACTIVE", currency: "CZK", countries: ["CZ"] }];
  const input = {
    markets: [{ handle: "cz", currency: "CZK", enabled: true, countries: ["CZ"] }],
    modules: { codes: { rules: [autoRule("m", { targeting: { markets: ["cz"] } })] } },
  };
  const result = await saveAndSync({
    client: fake,
    db: db.prisma,
    shop,
    input,
    createSync: realSync(),
    grantedScopes: "write_discounts,read_products,write_products,read_themes",
  });
  assert.equal(result.save.ok, true);
  assert.equal(fake.callsOf("WonSyncMarkets").length, 0);
  assert.ok(result.warnings.some((w) => /read_markets scope is not granted/.test(w)), JSON.stringify(result.warnings));
  assert.equal(canReadMarkets(undefined), true, "unknown scopes: try");
  assert.equal(canReadMarkets("read_products, read_markets"), true);
  assert.equal(canReadMarkets("read_products"), false);
});

test("item 7: saveAndSync waits at most deadlineMs; the save is in and the sync finishes in the background", async () => {
  const fake = new FakeShopify();
  const slow = fake.graphql.bind(fake);
  fake.graphql = async (query, variables) => {
    await new Promise((resolve) => setTimeout(resolve, 15));
    return slow(query, variables);
  };
  const started = Date.now();
  const result = await saveAndSync({ client: fake, db: db.prisma, shop, input: base, createSync: realSync(), deadlineMs: 30 });
  assert.ok(Date.now() - started < 1000, `answered in ${Date.now() - started} ms`);
  assert.equal(result.save.ok, true);
  assert.equal(result.sync, null);
  assert.equal(result.running, true);
  await syncIdle(shop);
  assert.equal((await loadSyncStatus(db.prisma, shop))?.ok, true, "the background sync recorded its run");
});

test("item 13: a save on top of a version that is no longer stored is refused (base_changed); nothing reaches Shopify", async () => {
  const fake = new FakeShopify();
  await saveAndSync({ client: fake, db: db.prisma, shop, input: base, createSync: realSync() });
  const { version } = await loadConfig(db.prisma, shop);
  // Another instance saves meanwhile.
  const { config } = await loadConfig(db.prisma, shop);
  assert.equal((await saveConfig(db.prisma, shop, { ...config, modules: { ...config.modules, codes: { rules: [autoRule("other")] } } })).ok, true);
  const mutations = fake.mutations().length;
  const refused = await saveAndSync({ client: fake, db: db.prisma, shop, input: base, createSync: realSync(), expectedVersion: version });
  assert.equal(refused.save.ok, false);
  assert.equal(!refused.save.ok && refused.save.reason, "base_changed");
  assert.equal(refused.sync, null);
  assert.equal(fake.mutations().length, mutations);
});

test("item 13: the market-countries re-save of a resync builds on the version it read, and reads again after another write", async () => {
  const fake = new FakeShopify();
  fake.markets = [{ handle: "cz", name: "Česko", status: "ACTIVE", currency: "CZK", countries: ["CZ"] }];
  const input = {
    markets: [{ handle: "cz", currency: "CZK", enabled: true }],
    modules: { codes: { rules: [autoRule("m", { targeting: { markets: ["cz"] } })] } },
  };
  await saveAndSync({ client: fake, db: db.prisma, shop, input, createSync: realSync() });
  fake.markets[0]!.countries = ["CZ", "PL"];
  // Another instance writes right after the resync read the config (first save attempt only).
  let raced = false;
  const racing = (client: AdminClient, prisma: PrismaClient): Sync => realSync()(client, prisma);
  const original = fake.graphql.bind(fake);
  fake.graphql = async (query, variables) => {
    if (!raced && query.includes("WonSyncMarketRegions")) {
      raced = true;
      const { config } = await loadConfig(db.prisma, shop);
      await saveConfig(db.prisma, shop, { ...config, modules: { ...config.modules, codes: { rules: [...config.modules.codes.rules, autoRule("x")] } } });
    }
    return original(query, variables);
  };
  const result = await resyncShop({ client: fake, db: db.prisma, shop, createSync: racing });
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  const stored = (await loadConfig(db.prisma, shop)).config;
  assert.deepEqual(stored.modules.codes.rules.map((r) => r.id), ["m", "x"], "the other write is kept");
  assert.deepEqual(stored.markets[0]!.countries, ["CZ", "PL"], "and the new countries are saved on top of it");
});

test("item 2: refreshTargeting does a full resync when the stored config is not the one Shopify runs", async () => {
  const fake = new FakeShopify();
  await saveConfig(db.prisma, shop, base);
  const result = await refreshTargeting({ client: fake, db: db.prisma, shop, createSync: realSync() });
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.ok(fake.shopMetafieldValue("function_config"), "the full sync wrote the shop config");
});
