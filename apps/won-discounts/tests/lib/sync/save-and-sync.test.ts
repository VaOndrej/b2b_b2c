import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";

import { verifyShopFunctionConfig } from "@won/core/discounts/function-payload";

import type { PrismaClient } from "../../../app/generated/prisma/client.ts";
import type { AdminClient, AppAdminGraphql } from "../../../app/lib/admin-client.server.ts";
import { MAX_ACTIVE_CODE_RULES } from "../../../app/lib/config-guards.server.ts";
import { deleteShopData, loadConfig, saveConfig } from "../../../app/lib/config.server.ts";
import {
  loadSyncStatus,
  RESYNC_MIN_INTERVAL_MS,
  resyncIfPending,
  resyncShop,
  saveAndSync,
  saveAndSyncFromAdmin,
} from "../../../app/lib/sync/save-and-sync.server.ts";
import { createSync, type Sync } from "../../../app/lib/sync/sync.server.ts";
import { productionSyncDeps } from "../../../app/lib/sync/wiring.server.ts";
import { createTestDatabase, type TestDatabase } from "../test-db.ts";
import { FakeShopify } from "./fake-shopify.ts";
import { autoRule, codeRule } from "./helpers.ts";

// The admin hook: save first (sanitize, guards, budget, history), and only a
// successful save is written into Shopify. Canonical API:
// saveAndSync({ client, db, shop, input, otherCodes? }).

let db: TestDatabase;
let seq = 0;
let shop: string;
before(() => {
  db = createTestDatabase("save-and-sync");
});
after(async () => {
  await db.drop();
});
beforeEach(() => {
  seq += 1;
  shop = `save-sync-${seq}.myshopify.com`;
});

const quietLogger = { info: () => {}, warn: () => {}, error: () => {} };
const NOW = new Date("2026-09-28T12:00:00Z");
const realSync = (client: AdminClient, prisma: PrismaClient) =>
  createSync({ ...productionSyncDeps(client, prisma, quietLogger), now: () => NOW, sleep: async () => {} });

test("a refused save never reaches Shopify", async () => {
  const fake = new FakeShopify();
  let created = 0;
  const result = await saveAndSync({
    client: fake,
    db: db.prisma,
    shop,
    input: { modules: { codes: { rules: Array.from({ length: MAX_ACTIVE_CODE_RULES + 1 }, (_, i) => codeRule(`r${i}`)) } } },
    createSync: () => {
      created += 1;
      return { syncShop: async () => assert.fail("must not sync"), refreshProducts: async () => assert.fail("must not sync") } as unknown as Sync;
    },
  });
  assert.equal(result.save.ok, false);
  assert.equal(result.sync, null);
  assert.equal(created, 0);
  assert.equal(fake.mutations().length, 0);
});

test("a successful save syncs exactly the sanitized, saved config; saveAndSyncFromAdmin wraps the embedded admin", async () => {
  const fake = new FakeShopify();
  const seen: unknown[] = [];
  const result = await saveAndSync({
    client: fake,
    db: db.prisma,
    shop,
    input: { modules: { codes: { rules: [codeRule("c", { codes: [" lower "] })] } } },
    createSync: () => ({
      async syncShop(syncShopDomain, config) {
        seen.push({ shop: syncShopDomain, codes: config.modules.codes.rules[0]!.codes });
        return { ok: true, steps: [], errors: [], pending: [], runId: null };
      },
      refreshProducts: async () => assert.fail("not a products refresh"),
    }),
  });
  assert.equal(result.save.ok, true);
  assert.deepEqual(seen, [{ shop, codes: ["LOWER"] }]);

  // The route wrapper: the app's admin object (Response-returning graphql) becomes the client.
  const viaAdmin = new FakeShopify();
  let adminCalls = 0;
  const admin = {
    graphql: async (query: string, options?: { variables?: Record<string, unknown> }) => {
      adminCalls += 1;
      return new Response(JSON.stringify(await viaAdmin.graphql(query, options?.variables)));
    },
  } as unknown as AppAdminGraphql;
  const wrapped = await saveAndSyncFromAdmin(admin, `${shop}-admin`, { modules: { codes: { rules: [codeRule("w")] } } }, {
    db: db.prisma,
    createSync: realSync,
  });
  assert.equal(wrapped.sync?.ok, true, JSON.stringify(wrapped.sync?.errors));
  assert.ok(adminCalls > 0);
  assert.equal(viaAdmin.wonNodes().length, 2, "automatic + code node created through the admin object");
});

test("integration with the REAL engine builders: payload verifies, nodes in place, resync is a no-op", async () => {
  const fake = new FakeShopify();
  const product = fake.addProduct(1);
  const result = await saveAndSync({
    client: fake,
    db: db.prisma,
    shop,
    input: {
      modules: {
        codes: {
          rules: [
            autoRule("auto10", { target: { kind: "products", productIds: [product.id], variantIds: [] } }),
            codeRule("news", { codes: ["NEWS10", "NEWS-B"] }),
          ],
        },
      },
    },
    createSync: realSync,
  });
  assert.equal(result.save.ok, true);
  assert.equal(result.sync?.ok, true, JSON.stringify(result.sync?.errors));
  const stored = fake.shopMetafieldValue("function_config")!;
  assert.deepEqual(verifyShopFunctionConfig(stored), { ok: true, bytes: Buffer.byteLength(stored) });
  assert.deepEqual(JSON.parse(stored).modules.codes.rules.map((rule: { id: string }) => rule.id), ["auto10", "news"]);
  for (const node of fake.wonNodes()) {
    const vars = JSON.parse(node.metafields.get("$app:won_discounts/function_vars")!.value);
    assert.equal(typeof vars.campaignStart, "string");
    assert.equal(typeof vars.campaignEnd, "string");
  }
  assert.deepEqual(fake.productMetafield(product.id), { ruleIds: ["auto10"], variantRuleIds: {} });

  const status = await loadSyncStatus(db.prisma, shop);
  assert.equal(status?.ok, true);
  assert.deepEqual(status?.pending, []);
  const before = fake.mutations().length;
  const again = await resyncShop({ client: fake, db: db.prisma, shop, createSync: realSync });
  assert.equal(again.ok, true, JSON.stringify(again.errors));
  assert.equal(fake.mutations().length, before);
});

test("M11: the 3-phase campaign switch with the REAL builders (version key coupling included)", async () => {
  const fake = new FakeShopify();
  // Campaigns are Pro (BILL-1): the sync runs as a Pro shop here.
  const realSync = (client: AdminClient, prisma: PrismaClient) =>
    createSync({ ...productionSyncDeps(client, prisma, quietLogger), now: () => NOW, sleep: async () => {}, plan: async () => "pro" });
  const campaign = {
    id: "bf",
    name: "Black Friday",
    window: { start: "2026-09-28T00:00:00", end: "2026-09-29T00:00:00" },
    overrides: [{ ruleId: "c", patch: { value: { kind: "percentage", percent: 30 } } }],
    killed: false,
  };
  const base = { modules: { codes: { rules: [codeRule("c")] } } };
  await saveAndSync({ client: fake, db: db.prisma, shop, input: base, createSync: realSync });
  const moved = { ...campaign, window: { start: "2026-09-28T06:00:00", end: "2026-09-30T00:00:00" } };
  await saveAndSync({ client: fake, db: db.prisma, shop, input: { ...base, campaigns: [campaign] }, createSync: realSync });
  fake.calls = [];

  const result = await saveAndSync({ client: fake, db: db.prisma, shop, input: { ...base, campaigns: [moved] }, createSync: realSync });
  assert.equal(result.sync?.ok, true, JSON.stringify(result.sync?.errors));
  const writes = fake.callsOf("WonSyncMetafieldsSet").map((call) => {
    const [m] = (call.variables as { metafields: { key: string; value: string }[] }).metafields;
    return m!.key === "function_config" ? `config(${JSON.parse(m!.value).campaignId ?? "none"})` : m!.key;
  });
  assert.deepEqual(writes, ["config(none)", "function_vars", "config(bf)"]);
  const shopConfig = JSON.parse(fake.shopMetafieldValue("function_config")!);
  for (const node of fake.wonNodes()) {
    const vars = JSON.parse(node.metafields.get("$app:won_discounts/function_vars")!.value);
    assert.equal(vars.varsVersion, shopConfig.campaignVarsVersion, "every node matches the shop config's campaign version");
    assert.equal(vars.campaignStart, "2026-09-28T06:00:00");
  }
});

test("I3: a missing, unreadable or newer-schema row is never synced; saving over an unreadable row needs confirmation", async () => {
  const fake = new FakeShopify();
  const noRow = await resyncShop({ client: fake, db: db.prisma, shop, createSync: realSync });
  assert.equal(noRow.ok, false);
  assert.equal("reason" in noRow && noRow.reason, "no_config");

  await db.prisma.shopConfig.create({ data: { shop, schemaVersion: 1, data: "{not json" } });
  const loaded = await loadConfig(db.prisma, shop);
  assert.equal(loaded.unreadable, true);
  assert.equal(loaded.exists, true);
  const resync = await resyncShop({ client: fake, db: db.prisma, shop, createSync: realSync });
  assert.equal("reason" in resync && resync.reason, "unreadable_config");
  assert.equal(fake.calls.length, 0, "not a single Shopify call");

  const refused = await saveAndSync({ client: fake, db: db.prisma, shop, input: { modules: { codes: { rules: [] } } }, createSync: realSync });
  assert.equal(refused.save.ok, false);
  assert.equal(!refused.save.ok && refused.save.reason, "unreadable_config");
  assert.equal(refused.sync, null);
  assert.equal(fake.mutations().length, 0);

  const confirmed = await saveAndSync({
    client: fake,
    db: db.prisma,
    shop,
    input: { modules: { codes: { rules: [codeRule("c")] } } },
    replaceUnreadable: true,
    createSync: realSync,
  });
  assert.equal(confirmed.save.ok, true);

  // A JSON value that is not a config object is unreadable too.
  const other = `${shop}-array`;
  await db.prisma.shopConfig.create({ data: { shop: other, schemaVersion: 1, data: "[]" } });
  assert.equal((await loadConfig(db.prisma, other)).unreadable, true);
  assert.equal((await saveConfig(db.prisma, other, {})).ok, false);
});

test("M3: resyncIfPending retries a failed or pending run (not too often), leaves a clean one alone", async () => {
  const fake = new FakeShopify();
  let clock = NOW.getTime();
  const now = () => new Date(clock);
  const sync = (client: AdminClient, prisma: PrismaClient) =>
    createSync({ ...productionSyncDeps(client, prisma, quietLogger), now, sleep: async () => {} });

  assert.deepEqual(await resyncIfPending({ client: fake, db: db.prisma, shop, createSync: sync, now }), { resynced: false, reason: "nothing_saved" });

  fake.fail("WonSyncCodeCreate", { userErrors: [{ message: "temporarily refused" }] }, 1);
  const saved = await saveAndSync({ client: fake, db: db.prisma, shop, input: { modules: { codes: { rules: [codeRule("c")] } } }, createSync: sync, now });
  assert.equal(saved.sync?.ok, false);
  assert.deepEqual(saved.sync?.pending, ["failed_steps"]);
  assert.deepEqual((await loadSyncStatus(db.prisma, shop))?.pending, ["failed_steps"]);

  clock += 60_000;
  assert.deepEqual(await resyncIfPending({ client: fake, db: db.prisma, shop, createSync: sync, now }), { resynced: false, reason: "too_soon" });

  clock += RESYNC_MIN_INTERVAL_MS;
  const retried = await resyncIfPending({ client: fake, db: db.prisma, shop, createSync: sync, now });
  assert.equal(retried.resynced, true);
  assert.equal(retried.resynced && retried.result.ok, true);
  assert.equal(fake.wonNodes().filter((n) => n.kind === "code").length, 1, "the code node exists now");

  clock += RESYNC_MIN_INTERVAL_MS;
  assert.deepEqual(await resyncIfPending({ client: fake, db: db.prisma, shop, createSync: sync, now }), { resynced: false, reason: "up_to_date" });
});

test("PRIV-2: deleteShopData also erases the shop's ProductTargetIndex rows (and only that shop's)", async () => {
  const other = `${shop}-other`;
  await db.prisma.productTargetIndex.createMany({
    data: [
      { shop, productId: "gid://shopify/Product/1", payloadHash: "a" },
      { shop: other, productId: "gid://shopify/Product/1", payloadHash: "b" },
    ],
  });
  await deleteShopData(db.prisma, shop);
  assert.equal(await db.prisma.productTargetIndex.count({ where: { shop } }), 0);
  assert.equal(await db.prisma.productTargetIndex.count({ where: { shop: other } }), 1);
});

test("the version link: a save's sync run records the saved ConfigVersion; a resync records the stored config's version", async () => {
  const fake = new FakeShopify();
  const saved = await saveAndSync({
    client: fake,
    db: db.prisma,
    shop,
    input: { modules: { codes: { rules: [autoRule("a1")] } } },
    createSync: realSync,
  });
  assert.ok(saved.save.ok && saved.sync?.ok, JSON.stringify(saved.sync?.errors));
  assert.equal((await loadSyncStatus(db.prisma, shop))?.configVersionId, saved.save.versionId);

  // A resync syncs the STORED config: its run links the newest ConfigVersion (the one that row was saved with).
  const resynced = await resyncShop({ client: fake, db: db.prisma, shop, createSync: realSync });
  assert.equal(resynced.ok, true);
  assert.equal((await loadSyncStatus(db.prisma, shop))?.configVersionId, saved.save.versionId);

  const second = await saveAndSync({ client: fake, db: db.prisma, shop, input: { modules: { codes: { rules: [autoRule("a2")] } } }, createSync: realSync });
  assert.ok(second.save.ok);
  assert.notEqual(second.save.versionId, saved.save.versionId);
  assert.equal((await loadSyncStatus(db.prisma, shop))?.configVersionId, second.save.versionId);
});
