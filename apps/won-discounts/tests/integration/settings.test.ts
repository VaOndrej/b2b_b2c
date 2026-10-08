import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";

import { DEFAULT_CONFIG } from "@won/core/discounts/config";

import type { PrismaClient } from "../../app/generated/prisma/client.ts";
import type { AdminClient } from "../../app/lib/admin-client.server.ts";
import { loadConfig, saveConfig } from "../../app/lib/config.server.ts";
import type { ShopCtx } from "../../app/lib/integration/context.server.ts";
import { withConfigLock } from "../../app/lib/integration/lock.server.ts";
import { loadSettingsScreen, saveCombination, settingsAction } from "../../app/lib/integration/settings.server.ts";
import { createSync, syncIdle } from "../../app/lib/sync/sync.server.ts";
import { productionSyncDeps } from "../../app/lib/sync/wiring.server.ts";
import { clearSignalCache } from "../../app/lib/ui-actions.server.ts";
import type { CombinationView } from "../../app/components/model/types.ts";
import { createTestDatabase, type TestDatabase } from "../lib/test-db.ts";
import { FakeStore, formOf, quiet, testCtx } from "./helpers.ts";

// Nastavení → Kombinování slev (MVP 3, the MVP 1 debt): the Free per-category
// switches (engine.combination) saved exactly like a rule or the margin settings:
// the shop's config lock (`busy`), the F12 version token (`base_changed` only when
// the switches changed meanwhile), the unreadable guard, saveAndSync — and the
// shop config Shopify runs carries the new switches.

let db: TestDatabase;
let seq = 0;
let shop: string;
before(() => {
  db = createTestDatabase("int-settings");
});
after(async () => {
  await db.drop();
});
beforeEach(() => {
  seq += 1;
  shop = `settings-${seq}.myshopify.com`;
  clearSignalCache();
});

function ctxFor(store: FakeStore, plan: "free" | "pro" = "free"): ShopCtx {
  return {
    ...testCtx(db.prisma, shop, store),
    createSync: (client: AdminClient, prisma: PrismaClient) =>
      createSync({ ...productionSyncDeps(client, prisma, quiet), sleep: async () => {}, plan: async () => plan }),
    lockWaitMs: 200,
  };
}

const DEFAULTS: CombinationView = {
  outletWithAnything: DEFAULT_CONFIG.engine.combination.outletWithAnything,
  productWithOrder: DEFAULT_CONFIG.engine.combination.productWithOrder,
  productWithShipping: DEFAULT_CONFIG.engine.combination.productWithShipping,
  orderWithShipping: DEFAULT_CONFIG.engine.combination.orderWithShipping,
};

test("load: the stored switches (defaults on a new shop), the plan, the version token and the market currencies", async () => {
  const store = new FakeStore();
  const data = await loadSettingsScreen(ctxFor(store), { scopes: "write_discounts" });
  // A new shop has no market stored yet (the Přehled's check brings them in, T1): the table is empty.
  assert.deepEqual(data, { plan: "free", configVersion: null, currencies: [{ code: "CZK", markets: [] }], combination: DEFAULTS, unknownMarketLowest: false, unknownMarketHighest: [], markets: [] });
});

test("save: 'a customer from a country in no market gets the lowest amount' is stored only when on, and a save that does not post it leaves it", async () => {
  const store = new FakeStore();
  const ctx = ctxFor(store);
  const on = await saveCombination(ctx, DEFAULTS, { configVersion: null, unknownMarketLowest: true });
  assert.equal(on.ok, true, JSON.stringify(on));
  await syncIdle(shop);
  let data = await loadSettingsScreen(ctx, { scopes: "write_discounts" });
  assert.equal(data.unknownMarketLowest, true);
  // Another caller of the same save (no switch posted) does not switch it off.
  assert.equal((await saveCombination(ctx, { ...DEFAULTS, productWithOrder: false }, { configVersion: data.configVersion })).ok, true);
  await syncIdle(shop);
  data = await loadSettingsScreen(ctx, { scopes: "write_discounts" });
  assert.equal(data.unknownMarketLowest, true);
  assert.equal((await saveCombination(ctx, DEFAULTS, { configVersion: data.configVersion, unknownMarketLowest: false })).ok, true);
  await syncIdle(shop);
  assert.equal((await loadSettingsScreen(ctx, { scopes: "write_discounts" })).unknownMarketLowest, false);
});

test("save: the kinds of amount that take the highest are stored as posted, kept by a save that does not post them, and cleared by an empty choice", async () => {
  const store = new FakeStore();
  const ctx = ctxFor(store);
  assert.equal((await saveCombination(ctx, DEFAULTS, { configVersion: null, unknownMarketLowest: true, unknownMarketHighest: ["shipping", "minimum"] })).ok, true);
  await syncIdle(shop);
  let data = await loadSettingsScreen(ctx, { scopes: "write_discounts" });
  assert.deepEqual(data.unknownMarketHighest, ["minimum", "shipping"]);
  assert.equal((await saveCombination(ctx, DEFAULTS, { configVersion: data.configVersion })).ok, true);
  await syncIdle(shop);
  data = await loadSettingsScreen(ctx, { scopes: "write_discounts" });
  assert.deepEqual([data.unknownMarketLowest, data.unknownMarketHighest], [true, ["minimum", "shipping"]]);
  // The page's own form: every choice back on "lowest".
  const form = new FormData();
  form.set("intent", "save");
  if (data.configVersion) form.set("configVersion", data.configVersion);
  form.set("unknownMarketLowest", "on");
  for (const kind of ["discount", "minimum", "tier", "shipping", "gift"]) form.set(`unknownMarketPick.${kind}`, kind === "gift" ? "highest" : "lowest");
  assert.equal((await settingsAction(ctx, form)).ok, true);
  await syncIdle(shop);
  assert.deepEqual((await loadSettingsScreen(ctx, { scopes: "write_discounts" })).unknownMarketHighest, ["gift"]);
});

test("save: the switches go into the config and into the shop config checkout runs", async () => {
  const store = new FakeStore();
  const ctx = ctxFor(store);
  const result = await saveCombination(ctx, { ...DEFAULTS, productWithOrder: false, orderWithShipping: false }, { configVersion: null });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.ok && result.message, "saved");
  assert.equal(result.ok && result.sync?.ok, true, JSON.stringify(result));
  await syncIdle(shop);
  const stored = (await loadConfig(db.prisma, shop)).config.engine.combination;
  assert.equal(stored.productWithOrder, false);
  assert.equal(stored.orderWithShipping, false);
  assert.equal(stored.productWithShipping, true);
  assert.equal(stored.productWithProduct, "best", "product with product is never switched (A1)");
  const shopConfig = JSON.parse(store.sync.shopMetafieldValue("function_config")!) as { engine: { combination: Record<string, unknown> } };
  assert.equal(shopConfig.engine.combination.productWithOrder, false);
  assert.equal(shopConfig.engine.combination.orderWithShipping, false);
});

test("F12: the switches changed meanwhile → base_changed, nothing overwritten; a change elsewhere → applied on top", async () => {
  const store = new FakeStore();
  const ctx = ctxFor(store);
  await saveCombination(ctx, DEFAULTS, { configVersion: null });
  await syncIdle(shop);
  const version = (await loadConfig(db.prisma, shop)).version;
  const other = (await loadConfig(db.prisma, shop)).config;
  await saveConfig(db.prisma, shop, { ...other, engine: { combination: { ...other.engine.combination, outletWithAnything: true } } });
  assert.deepEqual(await saveCombination(ctx, { ...DEFAULTS, productWithOrder: false }, { configVersion: version }), { ok: false, reason: "base_changed" });
  assert.equal((await loadConfig(db.prisma, shop)).config.engine.combination.outletWithAnything, true, "nothing overwritten");

  const base = (await loadConfig(db.prisma, shop)).version;
  const current = (await loadConfig(db.prisma, shop)).config;
  await saveConfig(db.prisma, shop, { ...current, onboarding: { goals: ["tiers"], step: 2 } });
  const merged = await saveCombination(ctx, { ...DEFAULTS, outletWithAnything: true, productWithShipping: false }, { configVersion: base });
  assert.equal(merged.ok, true, JSON.stringify(merged));
  const after = (await loadConfig(db.prisma, shop)).config;
  assert.deepEqual(after.onboarding.goals, ["tiers"], "the other change kept");
  assert.equal(after.engine.combination.productWithShipping, false);
  await syncIdle(shop);
});

test("an unreadable stored config is replaced only when confirmed; another writer holding the lock → busy", async () => {
  const store = new FakeStore();
  const ctx = ctxFor(store);
  await db.prisma.shopConfig.create({ data: { shop, schemaVersion: 1, data: "{not json" } });
  const version = (await loadConfig(db.prisma, shop)).version;
  assert.deepEqual(await saveCombination(ctx, DEFAULTS, { configVersion: version }), { ok: false, reason: "unreadable_config" });
  const replaced = await saveCombination(ctx, DEFAULTS, { configVersion: version, replaceUnreadable: true });
  assert.equal(replaced.ok, true, JSON.stringify(replaced));
  await syncIdle(shop);

  let release!: () => void;
  const held = withConfigLock(shop, () => new Promise<void>((resolve) => (release = resolve)));
  assert.deepEqual(await saveCombination(ctx, DEFAULTS, { configVersion: (await loadConfig(db.prisma, shop)).version }), { ok: false, reason: "busy" });
  release();
  await held;
});

test("the route action: the switches parsed on the server from the posted form (SEC-1); an unknown intent → bad_request", async () => {
  const store = new FakeStore();
  const ctx = ctxFor(store);
  const saved = await settingsAction(ctx, formOf([["intent", "save"], ["productWithShipping", "on"]]));
  assert.equal(saved.ok, true, JSON.stringify(saved));
  await syncIdle(shop);
  const stored = (await loadConfig(db.prisma, shop)).config.engine.combination;
  assert.deepEqual(
    { o: stored.outletWithAnything, po: stored.productWithOrder, ps: stored.productWithShipping, os: stored.orderWithShipping },
    { o: false, po: false, ps: true, os: false },
  );
  assert.deepEqual(await settingsAction(ctx, formOf([["intent", "nope"]])), { ok: false, reason: "bad_request" });
});
