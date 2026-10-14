import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";

import type { PrismaClient } from "../../app/generated/prisma/client.ts";
import type { AdminClient } from "../../app/lib/admin-client.server.ts";
import { loadConfig, saveConfig } from "../../app/lib/config.server.ts";
import { combineAction, mismatchViews } from "../../app/lib/integration/combine.server.ts";
import type { ShopCtx } from "../../app/lib/integration/context.server.ts";
import { createSync, syncIdle } from "../../app/lib/sync/sync.server.ts";
import { productionSyncDeps } from "../../app/lib/sync/wiring.server.ts";
import { clearSignalCache } from "../../app/lib/ui-actions.server.ts";
import { createTestDatabase, type TestDatabase } from "../lib/test-db.ts";
import { FakeStore, formOf, quiet, testCtx } from "./helpers.ts";

// "Sčítá se s" of a module (14 Oct 2026): Množstevní slevy, Milníky and Výprodej post their one list to
// /app/combine. Parsed on the server (SEC-1), only what the module is offered, saved like any section (F12),
// and it reaches checkout as the head of `engine.cx` ("<tiers>.<rewards>.<outlet>|…").

let db: TestDatabase;
let seq = 0;
let shop: string;
before(() => {
  db = createTestDatabase("int-module-combine");
});
after(async () => {
  await db.drop();
});
beforeEach(() => {
  seq += 1;
  shop = `module-combine-${seq}.myshopify.com`;
  clearSignalCache();
});

function ctxFor(store: FakeStore): ShopCtx {
  return {
    ...testCtx(db.prisma, shop, store),
    createSync: (client: AdminClient, prisma: PrismaClient) => createSync({ ...productionSyncDeps(client, prisma, quiet), sleep: async () => {}, plan: async () => "free" }),
    lockWaitMs: 200,
  };
}

const post = (module: string, types: string[], version?: string | null) =>
  formOf([["intent", "save"], ["combineModule", module], ["combinePosted", "1"], ...types.map((type): [string, string] => ["combineTypes", type]), ...(version ? [["configVersion", version] as [string, string]] : [])]);

const shippedHead = (store: FakeStore) => (JSON.parse(store.sync.shopMetafieldValue("function_config")!) as { engine: { cx: string } }).engine.cx.split("|")[0];

test("each module saves its own list, only the types it is offered; checkout gets it as the head of engine.cx", async () => {
  const store = new FakeStore();
  const ctx = ctxFor(store);
  // A quantity discount never meets another one: "tiers" is not offered there and is dropped.
  const tiers = await combineAction(ctx, post("tiers", ["automatic", "tiers", "outlet", "bogus"]));
  assert.equal(tiers.ok, true, JSON.stringify(tiers));
  await syncIdle(shop);
  let loaded = await loadConfig(db.prisma, shop);
  assert.deepEqual(loaded.config.modules.tiers.combine.types, ["automatic", "outlet"]);
  assert.equal(shippedHead(store), "33.31.0");

  const outlet = await combineAction(ctx, post("outlet", ["code"], loaded.version));
  assert.equal(outlet.ok, true, JSON.stringify(outlet));
  await syncIdle(shop);
  loaded = await loadConfig(db.prisma, shop);
  assert.deepEqual(loaded.config.modules.outlet.combine.types, ["code"]);
  assert.deepEqual(loaded.config.modules.tiers.combine.types, ["automatic", "outlet"], "the other module's list stays");
  assert.equal(shippedHead(store), "33.31.2");

  // Nothing ticked is an empty list.
  assert.equal((await combineAction(ctx, post("rewards", [], loaded.version))).ok, true);
  await syncIdle(shop);
  assert.deepEqual((await loadConfig(db.prisma, shop)).config.modules.rewards.combine.types, []);
  assert.equal(shippedHead(store), "33.0.2");
});

test("a form without the module, with an unknown one, without the list or another intent → bad_request, nothing saved", async () => {
  const store = new FakeStore();
  const ctx = ctxFor(store);
  for (const form of [
    formOf([["intent", "save"], ["combinePosted", "1"], ["combineTypes", "code"]]),
    post("engine", ["code"]),
    formOf([["intent", "save"], ["combineModule", "tiers"]]),
    formOf([["intent", "delete"], ["combineModule", "tiers"], ["combinePosted", "1"]]),
  ]) {
    assert.deepEqual(await combineAction(ctx, form), { ok: false, reason: "bad_request" });
  }
  assert.equal((await loadConfig(db.prisma, shop)).version, null);
});

test("F12: a stale version → base_changed when the list changed meanwhile", async () => {
  const store = new FakeStore();
  const ctx = ctxFor(store);
  assert.equal((await combineAction(ctx, post("tiers", ["code"]))).ok, true);
  await syncIdle(shop);
  const stale = (await loadConfig(db.prisma, shop)).version;
  assert.equal((await combineAction(ctx, post("tiers", ["automatic"], stale))).ok, true);
  await syncIdle(shop);
  const late = await combineAction(ctx, post("tiers", ["shipping"], stale));
  assert.deepEqual(late, { ok: false, reason: "base_changed" });
  assert.deepEqual((await loadConfig(db.prisma, shop)).config.modules.tiers.combine.types, ["automatic"]);
});

test("a mismatch set straight in one save: allow on the other side (Free: by type), or deny here; the page lists what is left", async () => {
  const store = new FakeStore();
  const ctx = ctxFor(store);
  // The sales take automatic discounts; the shop's discounts do not take the sales: one finding, Výprodej allows.
  assert.equal((await combineAction(ctx, post("outlet", ["automatic"]))).ok, true);
  await syncIdle(shop);
  const config = (await loadConfig(db.prisma, shop)).config;
  const withRule = { ...config, modules: { ...config.modules, codes: { ...config.modules.codes, rules: [{ id: "r1", name: "Jaro", enabled: true, method: "automatic" as const, value: { kind: "percentage" as const, percent: 10 }, target: { kind: "products" as const, productIds: ["gid://shopify/Product/1"], variantIds: [] }, combine: { types: [] } }] } } };
  await saveConfig(db.prisma, shop, withRule as unknown as typeof config);
  const loaded = await loadConfig(db.prisma, shop);
  const views = mismatchViews(loaded.config, "free");
  assert.deepEqual(views.map((v) => [v.id, v.refusing.map((r) => r.id)]), [["outlet", ["r1"]]]);
  assert.equal(views[0]!.href, "/app/outlet#combine-types");

  const fix = (mode: string, version: string | null) => combineAction(ctx, formOf([["intent", "fix"], ["mismatchId", "outlet"], ["mismatchMode", mode], ...(version ? [["configVersion", version] as [string, string]] : [])]));
  assert.deepEqual(await fix("sideways", loaded.version), { ok: false, reason: "bad_request" });
  const allowed = await fix("allow", loaded.version);
  assert.equal(allowed.ok, true, JSON.stringify(allowed));
  await syncIdle(shop);
  const after = await loadConfig(db.prisma, shop);
  assert.deepEqual(after.config.modules.codes.rules[0]!.combine, { types: ["outlet"] });
  assert.deepEqual(mismatchViews(after.config, "free"), []);
});
