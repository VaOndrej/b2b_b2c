import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";

import { gateConfigForPlan } from "@won/core/discounts/plan-gate";
import { buildStorefrontConfig } from "@won/core/discounts/storefront-config";

import type { PrismaClient } from "../../app/generated/prisma/client.ts";
import { CATALOGUES } from "../../app/i18n/index.ts";
import type { AdminClient } from "../../app/lib/admin-client.server.ts";
import { configVersionToken, loadConfig } from "../../app/lib/config.server.ts";
import { syncProblems } from "../../app/lib/integration/sync-copy.ts";
import { resyncIfPending, resyncShop, saveAndSync } from "../../app/lib/sync/save-and-sync.server.ts";
import { tierProductCounts } from "../../app/lib/sync/storefront.ts";
import { createSync, syncIdle } from "../../app/lib/sync/sync.server.ts";
import { productionSyncDeps } from "../../app/lib/sync/wiring.server.ts";
import { createTestDatabase, type TestDatabase } from "../lib/test-db.ts";
import { FakeStore, quiet } from "./helpers.ts";

// The storefront config (MVP 3, contract K5): an APP-DATA metafield (owner =
// the app's AppInstallation, plain namespace `won_discounts`, key
// `storefront_config`, type json) the theme block reads as
// `app.metafields.won_discounts.storefront_config.value`. Built by core
// buildStorefrontConfig from the SAME gated config as the function payload
// (BILL-1), `cv` = the F12 version token of the stored config the run synced;
// written right after the shop config is in place (never ahead of it, never
// when it is held), read back and verified; a failure is a failed sync step
// the admin words (cs + en) and the next sync retries — never fatal to the
// discount sync.

let db: TestDatabase;
let seq = 0;
let shop: string;
before(() => {
  db = createTestDatabase("int-storefront-sync");
});
after(async () => {
  await db.drop();
});
beforeEach(() => {
  seq += 1;
  shop = `storefront-${seq}.myshopify.com`;
});

type Plan = "free" | "pro";

function syncFor(plan: { current: Plan }) {
  return (client: AdminClient, prisma: PrismaClient) =>
    createSync({ ...productionSyncDeps(client, prisma, quiet), sleep: async () => {}, plan: async () => plan.current });
}

const globalSet = { id: "g", scope: "global", countAcross: "product", breaks: [{ minQty: 3, percent: 10 }, { minQty: 5, amountOff: { CZK: 5000 } }] };

function input(extra: { sets?: unknown[]; rules?: unknown[]; preset?: string; margin?: unknown } = {}) {
  return {
    modules: {
      codes: { rules: extra.rules ?? [] },
      tiers: { sets: extra.sets ?? [globalSet] },
      ...(extra.margin ? { margin: extra.margin } : {}),
    },
    storefront: { appearancePreset: extra.preset ?? "highlight" },
    locales: { cs: { "tiers.heading": "Množstevní sleva" } },
  };
}

async function save(store: FakeStore, plan: { current: Plan }, config: unknown) {
  const result = await saveAndSync({ client: store, db: db.prisma, shop, input: config, createSync: syncFor(plan), logger: quiet });
  assert.equal(result.save.ok, true, JSON.stringify(result.save));
  await syncIdle(shop);
  return result;
}

/** What the storefront config must be: core's builder over the gated stored config, `cv` = its F12 token. */
async function expected(plan: Plan) {
  const loaded = await loadConfig(db.prisma, shop);
  return buildStorefrontConfig(gateConfigForPlan(loaded.config, plan).config, { configVersion: loaded.version! });
}

const storefrontWrites = (store: FakeStore) => store.sync.callsOf("WonSyncStorefrontConfigSet");

test("a save writes the storefront config on the app installation (app-data, json), from the gated config, cv = the stored version", async () => {
  const store = new FakeStore();
  const plan = { current: "pro" as Plan };
  const result = await save(store, plan, input());
  assert.equal(result.sync?.ok, true, JSON.stringify(result.sync?.errors));
  const writes = storefrontWrites(store);
  assert.equal(writes.length, 1);
  const [mf] = (writes[0]!.variables as { metafields: { ownerId: string; namespace: string; key: string; type: string; value: string }[] }).metafields;
  assert.deepEqual(
    { ownerId: mf!.ownerId, namespace: mf!.namespace, key: mf!.key, type: mf!.type },
    { ownerId: store.sync.appInstallationId, namespace: "won_discounts", key: "storefront_config", type: "json" },
  );
  assert.deepEqual(store.sync.storefrontConfig(), await expected("pro"));
  const loaded = await loadConfig(db.prisma, shop);
  const stored = (await db.prisma.shopConfig.findUnique({ where: { shop } }))!;
  assert.equal((store.sync.storefrontConfig() as { cv: string }).cv, configVersionToken(stored.data), "the admin's F12 token");
  assert.equal(loaded.version, configVersionToken(stored.data));
  // After the shop config is in place (written and read back), then read back itself.
  const ops = store.ops;
  const configWrite = store.calls.findIndex((c) => c.op === "WonSyncMetafieldsSet" && JSON.stringify(c.variables).includes('"function_config"'));
  const configReadBack = ops.indexOf("WonSyncShopConfigReadBack");
  const storefrontWrite = ops.indexOf("WonSyncStorefrontConfigSet");
  assert.ok(configWrite !== -1 && configWrite < configReadBack && configReadBack < storefrontWrite, ops.join(", "));
  assert.equal(ops.lastIndexOf("WonSyncStorefrontConfig") > storefrontWrite, true, "read back after the write");
  const steps = result.sync!.steps.filter((s) => s.step.startsWith("storefront_config."));
  assert.deepEqual(
    steps.map((s) => [s.step, s.ok]),
    [
      ["storefront_config.write", true],
      ["storefront_config.verify", true],
    ],
  );
});

test("unchanged: a resync of the same config does not write the storefront config again", async () => {
  const store = new FakeStore();
  const plan = { current: "pro" as Plan };
  await save(store, plan, input());
  const again = await resyncShop({ client: store, db: db.prisma, shop, createSync: syncFor(plan), logger: quiet });
  assert.equal(again.ok, true, JSON.stringify(again.errors));
  assert.equal(storefrontWrites(store).length, 1);
  assert.ok(again.steps.some((s) => s.step === "storefront_config.write" && s.ok && /unchanged/.test(s.detail)));
});

test("an appearance-only change rewrites the storefront config (the shop config stays as it is)", async () => {
  const store = new FakeStore();
  const plan = { current: "pro" as Plan };
  await save(store, plan, input());
  const functionConfig = store.sync.shopMetafieldValue("function_config");
  await save(store, plan, input({ preset: "tiles" }));
  assert.equal(store.sync.shopMetafieldValue("function_config"), functionConfig);
  assert.equal((store.sync.storefrontConfig() as { appearance: { preset: string } }).appearance.preset, "tiles");
  assert.deepEqual(store.sync.storefrontConfig(), await expected("pro"));
});

test("BILL-1: on Free a Pro set ships inert (no breaks: its products show no table), exactly like the function payload's gate", async () => {
  const store = new FakeStore();
  const product = store.sync.addProduct(1);
  const plan = { current: "free" as Plan };
  await save(store, plan, input({ sets: [globalSet, { id: "t1", scope: { productIds: [product.id] }, countAcross: "cart", breaks: [{ minQty: 2, percent: 20 }] }] }));
  const config = store.sync.storefrontConfig() as { tiers: { global: string; sets: Record<string, { count: string; breaks: unknown[] }> } };
  assert.equal(config.tiers.global, "g");
  assert.deepEqual(config.tiers.sets.t1?.breaks, []);
  assert.deepEqual(store.sync.storefrontConfig(), await expected("free"));
  const payload = JSON.parse(store.sync.shopMetafieldValue("function_config")!) as { modules: { tiers: { sets: [string, string, string[], unknown[]][] } } };
  assert.deepEqual(payload.modules.tiers.sets.find((set) => set[0] === "t1")?.[3], [], "the payload ships the same inert set");
});

test("a plan change (Free → Pro) resyncs (resyncIfPending: plan) and rewrites the storefront config", async () => {
  const store = new FakeStore();
  const product = store.sync.addProduct(1);
  const plan = { current: "free" as Plan };
  await save(store, plan, input({ sets: [globalSet, { id: "t1", scope: { productIds: [product.id] }, countAcross: "cart", breaks: [{ minQty: 2, percent: 20 }] }] }));
  plan.current = "pro";
  const outcome = await resyncIfPending({ client: store, db: db.prisma, shop, createSync: syncFor(plan), logger: quiet, minIntervalMs: 0 });
  assert.equal(outcome.resynced && outcome.why, "plan");
  const config = store.sync.storefrontConfig() as { tiers: { sets: Record<string, { count: string; breaks: unknown[] }> } };
  assert.deepEqual(config.tiers.sets.t1, { count: "cart", breaks: [{ min: 2, pct: 20 }] });
  assert.deepEqual(store.sync.storefrontConfig(), await expected("pro"));
});

test("a refused storefront write is a failed step (worded in cs + en), never fatal: the shop config and the product refs are in place; the next sync retries", async () => {
  const store = new FakeStore();
  const product = store.sync.addProduct(1);
  const plan = { current: "pro" as Plan };
  store.sync.fail("WonSyncStorefrontConfigSet", { userErrors: [{ field: ["metafields", "0", "value"], message: "Value is too big" }] }, 1);
  const result = await save(store, plan, input({ sets: [globalSet, { id: "t1", scope: { productIds: [product.id] }, countAcross: "product", breaks: [{ minQty: 2, percent: 5 }] }] }));
  const sync = result.sync!;
  assert.equal(sync.ok, false);
  assert.ok(sync.pending.includes("failed_steps"));
  assert.ok(sync.steps.some((s) => s.step === "shop_config.write" && s.ok), "the discount sync went through");
  assert.deepEqual(store.sync.productMetafield(product.id), { ruleIds: [], variantRuleIds: {}, tierRef: "t1" }, "the AFTER lane still ran");
  assert.equal(store.sync.storefrontConfig(), undefined);
  const failed = sync.steps.filter((s) => !s.ok);
  assert.deepEqual(failed.map((s) => s.step), ["storefront_config.write"]);
  const [problem] = syncProblems(failed, new Map());
  assert.ok(problem && CATALOGUES.cs[problem.key] && CATALOGUES.en[problem.key], JSON.stringify(problem));
  assert.match(String(problem.params?.detail), /storefront|web/i);
  // The Přehled's retry trigger resyncs the failed run; the storefront config then lands.
  const retry = await resyncIfPending({ client: store, db: db.prisma, shop, createSync: syncFor(plan), logger: quiet, minIntervalMs: 0 });
  assert.equal(retry.resynced && retry.why, "retry");
  assert.deepEqual(store.sync.storefrontConfig(), await expected("pro"));
});

test("a read-back that differs from the value written is a failed verify step", async () => {
  const store = new FakeStore();
  const plan = { current: "pro" as Plan };
  let reads = 0;
  store.overrides.set("WonSyncStorefrontConfig", async (variables) => {
    reads += 1;
    const real = await store.sync.graphql("query WonSyncStorefrontConfig { x }", variables);
    if (reads === 2) {
      const data = real.data as { currentAppInstallation: { id: string; metafield: { id: string; value: string } | null } };
      return { data: { currentAppInstallation: { ...data.currentAppInstallation, metafield: { id: "x", value: '{"v":1}' } } } };
    }
    return real;
  });
  const result = await save(store, plan, input());
  const verify = result.sync!.steps.find((s) => s.step === "storefront_config.verify");
  assert.equal(verify?.ok, false, JSON.stringify(result.sync!.steps));
  assert.ok(result.sync!.pending.includes("failed_steps"));
});

test("a held shop config (stale product refs) holds the storefront config too: the page never runs ahead of checkout", async () => {
  const store = new FakeStore();
  const product = store.sync.addProduct(1);
  const plan = { current: "pro" as Plan };
  const rule = { id: "r", name: "R", method: "automatic", value: { kind: "percentage", percent: 10 }, target: { kind: "products", productIds: [product.id], variantIds: [] } };
  await save(store, plan, input({ rules: [rule] }));
  const before = storefrontWrites(store).length;
  // The product must LOSE rule r before the flip; its clear fails → the new shop config is held.
  store.sync.fail("WonSyncMetafieldsDelete", { graphqlError: "Internal error" }, 50);
  const result = await save(store, plan, input({ rules: [{ ...rule, target: { kind: "order" } }], preset: "chips" }));
  assert.ok(result.sync!.pending.includes("stale_product_refs"), JSON.stringify(result.sync!.steps));
  assert.equal(storefrontWrites(store).length, before);
  assert.equal((store.sync.storefrontConfig() as { appearance: { preset: string } }).appearance.preset, "highlight");
});

test("a shop whose live config was applied before the storefront config existed is resynced by resyncIfPending (reason storefront)", async () => {
  const store = new FakeStore();
  const plan = { current: "pro" as Plan };
  await save(store, plan, input());
  // As if the applying run predated MVP 3: no storefront step recorded, no metafield.
  const run = (await db.prisma.syncRun.findFirst({ where: { shop }, orderBy: { startedAt: "desc" } }))!;
  const steps = (JSON.parse(run.steps) as { step: string }[]).filter((s) => !s.step.startsWith("storefront_config."));
  await db.prisma.syncRun.update({ where: { id: run.id }, data: { steps: JSON.stringify(steps) } });
  store.sync.appMetafields.clear();
  const outcome = await resyncIfPending({ client: store, db: db.prisma, shop, createSync: syncFor(plan), logger: quiet });
  assert.equal(outcome.resynced && outcome.why, "storefront");
  assert.deepEqual(store.sync.storefrontConfig(), await expected("pro"));
  const quietNow = await resyncIfPending({ client: store, db: db.prisma, shop, createSync: syncFor(plan), logger: quiet });
  assert.deepEqual(quietNow, { resynced: false, reason: "up_to_date" });
});

test("a margin collection too large to read is folded into the storefront caps exactly like the payload", async () => {
  const store = new FakeStore();
  const product = store.sync.addProduct(1);
  const huge = store.sync.addCollection(5, [product.id]);
  store.sync.collectionCounts.set(huge, 20_000);
  const plan = { current: "pro" as Plan };
  await save(
    store,
    plan,
    input({ margin: { enabled: true, global: { minMarginPercent: 10, maxDiscountPercent: 40 }, perCollection: [{ collectionId: huge, maxDiscountPercent: 20 }] } }),
  );
  assert.deepEqual((store.sync.storefrontConfig() as { margin: unknown }).margin, { on: true, max: 20 });
  const payload = JSON.parse(store.sync.shopMetafieldValue("function_config")!) as { modules: { margin: { max: number; col?: unknown } } };
  assert.equal(payload.modules.margin.max, 20);
  assert.equal(payload.modules.margin.col, undefined);
});

test("tierProductCounts: products carrying a Pro set, in all and per set (from the product index, no Shopify read)", async () => {
  const store = new FakeStore();
  const a = store.sync.addProduct(1);
  const b = store.sync.addProduct(2);
  const c = store.sync.addProduct(3);
  store.sync.addProduct(4);
  const collection = store.sync.addCollection(7, [b.id, c.id]);
  const plan = { current: "pro" as Plan };
  await save(
    store,
    plan,
    input({
      sets: [
        globalSet,
        { id: "t1", scope: { productIds: [a.id] }, countAcross: "product", breaks: [{ minQty: 2, percent: 5 }] },
        { id: "t2", scope: { collectionIds: [collection] }, countAcross: "line", breaks: [{ minQty: 2, percent: 7 }] },
      ],
    }),
  );
  const calls = store.calls.length;
  assert.deepEqual(await tierProductCounts(db.prisma, shop), { total: 3, bySet: { t1: 1, t2: 2 } });
  assert.equal(store.calls.length, calls);
});
