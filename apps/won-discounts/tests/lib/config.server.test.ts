import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { CONFIG_LIMITS, DEFAULT_CONFIG, sanitizeConfig, SCHEMA_VERSION } from "@won/core/discounts/config";
import { encodeFunctionConfig, FUNCTION_CONFIG_BUDGET_BYTES } from "@won/core/discounts/function-config";

import {
  CONFIG_HISTORY_RETENTION_DAYS,
  deleteShopData,
  loadConfig,
  pruneExpiredConfigHistory,
  saveConfig,
} from "../../app/lib/config.server.ts";
import { createTestDatabase, type TestDatabase } from "./test-db.ts";

// DATA-2/DATA-3/DATA-4: admin, storefront and the discount function must all
// agree on exactly one interpretation of a stored config, read through this
// one module. SEC-2: shop data is strictly shop-scoped, never cross-visible.

let db: TestDatabase;

before(() => {
  db = createTestDatabase("config-server");
});

after(async () => {
  await db.drop();
});

function rule(id: string) {
  return {
    id,
    name: `Discount rule ${id} with a reasonably descriptive name`,
    method: "automatic",
    value: { kind: "percentage", percent: 10 },
    target: { kind: "order" },
  };
}

test("a shop with no row yet reads back the defaults, writable", async () => {
  const loaded = await loadConfig(db.prisma, "new-shop.myshopify.com");
  assert.deepEqual(loaded.config, DEFAULT_CONFIG);
  assert.equal(loaded.readOnly, false);
});

test("SEC-2 / audit P1-1: mutating shop A's default config never leaks into shop B (no row)", async () => {
  const a = await loadConfig(db.prisma, "fresh-a.myshopify.com");
  assert.notStrictEqual(a.config, DEFAULT_CONFIG);
  a.config.modules.codes.rules.push({
    id: "shop-a-secret",
    enabled: true,
    name: "Shop A only",
    method: "code",
    codes: ["SHOPA"],
    value: { kind: "percentage", percent: 50 },
    target: { kind: "order" },
  });
  a.config.engine.combination.outletWithAnything = true;
  a.config.locales.cs.banner = "Shop A text";

  const b = await loadConfig(db.prisma, "fresh-b.myshopify.com");
  assert.deepEqual(b.config, DEFAULT_CONFIG);
  assert.equal(b.config.modules.codes.rules.length, 0);
  assert.notStrictEqual(b.config, a.config);
});

test("saveConfig persists the sanitized config and a ConfigVersion snapshot", async () => {
  const shop = "save-shop.myshopify.com";
  const result = await saveConfig(db.prisma, shop, {
    modules: { codes: { rules: [{ id: "r1", value: { kind: "percentage", percent: 10 }, target: { kind: "order" } }] } },
  });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.issues.length, 0);
  assert.equal(result.config.modules.codes.rules.length, 1);
  assert.equal(result.config.modules.codes.rules[0].id, "r1");
  assert.ok(result.versionId);
  assert.ok(result.functionConfigBytes > 0 && result.functionConfigBytes <= FUNCTION_CONFIG_BUDGET_BYTES);

  const reloaded = await loadConfig(db.prisma, shop);
  assert.equal(reloaded.config.modules.codes.rules.length, 1);

  const versions = await db.prisma.configVersion.findMany({ where: { shop } });
  assert.equal(versions.length, 1);
  assert.equal(versions[0].id, result.versionId);
  assert.equal(JSON.parse(versions[0].data).modules.codes.rules[0].id, "r1");
});

test("SEC-2: shop A never sees shop B's config", async () => {
  await saveConfig(db.prisma, "shop-a.myshopify.com", {
    storefront: { appearancePreset: "shop-a-preset" },
  });
  await saveConfig(db.prisma, "shop-b.myshopify.com", {
    storefront: { appearancePreset: "shop-b-preset" },
  });

  const a = await loadConfig(db.prisma, "shop-a.myshopify.com");
  const b = await loadConfig(db.prisma, "shop-b.myshopify.com");
  assert.equal(a.config.storefront.appearancePreset, "shop-a-preset");
  assert.equal(b.config.storefront.appearancePreset, "shop-b-preset");
});

test("audit P2-1 / C3: a config whose function payload is over budget is refused, nothing is written", async () => {
  const shop = "too-big.myshopify.com";
  const first = await saveConfig(db.prisma, shop, { modules: { codes: { rules: [rule("keep")] } } });
  assert.equal(first.ok, true);

  const result = await saveConfig(db.prisma, shop, {
    modules: { codes: { rules: Array.from({ length: 150 }, (_, i) => rule(`r${i}`)) } },
  });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.reason, "function_config_too_large");
  if (result.reason !== "function_config_too_large") return;
  assert.ok(result.bytes > FUNCTION_CONFIG_BUDGET_BYTES, `bytes ${result.bytes}`);
  assert.equal(result.budget, FUNCTION_CONFIG_BUDGET_BYTES);

  const row = await db.prisma.shopConfig.findUnique({ where: { shop } });
  assert.deepEqual(
    JSON.parse(row?.data ?? "{}").modules.codes.rules.map((r: { id: string }) => r.id),
    ["keep"],
    "the previous config must stay untouched",
  );
  assert.equal((await db.prisma.configVersion.findMany({ where: { shop } })).length, 1, "no history row");

  const brandNew = "too-big-new.myshopify.com";
  const refused = await saveConfig(db.prisma, brandNew, {
    modules: { codes: { rules: Array.from({ length: 150 }, (_, i) => rule(`r${i}`)) } },
  });
  assert.equal(refused.ok, false);
  assert.equal(await db.prisma.shopConfig.findUnique({ where: { shop: brandNew } }), null);
  assert.equal((await db.prisma.configVersion.findMany({ where: { shop: brandNew } })).length, 0);
});

const V2_DATA = {
  schemaVersion: SCHEMA_VERSION + 1,
  modules: {
    codes: { rules: [rule("v2-rule")] },
    bundles: { sets: [{ id: "b1", items: ["p1", "p2"] }] }, // a module v1 does not know
  },
};

test("DATA-3: a newer-schema row loads as a usable, read-only config", async () => {
  const shop = "newer-schema.myshopify.com";
  await db.prisma.shopConfig.create({
    data: { shop, schemaVersion: SCHEMA_VERSION + 1, data: JSON.stringify(V2_DATA) },
  });

  const loaded = await loadConfig(db.prisma, shop);
  assert.equal(loaded.readOnly, true);
  assert.deepEqual(
    loaded.config.modules.codes.rules.map((r) => r.id),
    ["v2-rule"],
  );
});

test("DATA-3: saveConfig refuses to overwrite a newer-schema row (no write, no history)", async () => {
  const shop = "newer-schema-save.myshopify.com";
  await db.prisma.shopConfig.create({
    data: { shop, schemaVersion: SCHEMA_VERSION + 1, data: JSON.stringify(V2_DATA) },
  });

  const loaded = await loadConfig(db.prisma, shop);
  const result = await saveConfig(db.prisma, shop, loaded.config);
  assert.deepEqual(result, { ok: false, reason: "newer_schema", storedSchemaVersion: SCHEMA_VERSION + 1 });

  const row = await db.prisma.shopConfig.findUnique({ where: { shop } });
  assert.equal(row?.schemaVersion, SCHEMA_VERSION + 1);
  assert.ok(JSON.parse(row?.data ?? "{}").modules.bundles, "the v2-only module must survive");
  assert.equal((await db.prisma.configVersion.findMany({ where: { shop } })).length, 0);
});

test("DATA-3: a row whose JSON says newer schema (column not bumped) is also read-only", async () => {
  const shop = "newer-json.myshopify.com";
  await db.prisma.shopConfig.create({
    data: { shop, schemaVersion: SCHEMA_VERSION, data: JSON.stringify(V2_DATA) },
  });
  assert.equal((await loadConfig(db.prisma, shop)).readOnly, true);
  const result = await saveConfig(db.prisma, shop, {});
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, "newer_schema");
});

test("deleteShopData removes ShopConfig + ConfigVersion for that shop only", async () => {
  const target = "delete-me.myshopify.com";
  const keep = "keep-me.myshopify.com";
  await saveConfig(db.prisma, target, {});
  await saveConfig(db.prisma, keep, {});

  await deleteShopData(db.prisma, target);

  assert.equal(await db.prisma.shopConfig.findUnique({ where: { shop: target } }), null);
  assert.equal((await db.prisma.configVersion.findMany({ where: { shop: target } })).length, 0);

  assert.ok(await db.prisma.shopConfig.findUnique({ where: { shop: keep } }));
  assert.equal((await db.prisma.configVersion.findMany({ where: { shop: keep } })).length, 1);
});

test("deleteShopData is idempotent (no rows for the shop is a no-op, not an error)", async () => {
  await assert.doesNotReject(() => deleteShopData(db.prisma, "never-existed.myshopify.com"));
});

test("corrupted JSON in the stored row falls back to a fresh default config, never throws", async () => {
  const shop = "corrupted.myshopify.com";
  await db.prisma.shopConfig.create({
    data: { shop, schemaVersion: 1, data: "{not valid json" },
  });

  const loaded = await loadConfig(db.prisma, shop);
  assert.deepEqual(loaded.config, DEFAULT_CONFIG);
  assert.notStrictEqual(loaded.config, DEFAULT_CONFIG);
  assert.equal(loaded.readOnly, false);
});

// --- Audit fix round 2 --------------------------------------------------------------------

const DAY_MS = 24 * 60 * 60 * 1000;

test("PRIV-2 / P3-11: pruneExpiredConfigHistory drops history older than the retention window for ALL shops", async () => {
  // Real "now": the other tests' fresh history rows in this DB must survive too.
  const now = new Date();
  const cutoff = new Date(now.getTime() - CONFIG_HISTORY_RETENTION_DAYS * DAY_MS);
  const rows = [
    { shop: "prune-a.myshopify.com", createdAt: new Date(cutoff.getTime() - DAY_MS), expired: true },
    { shop: "prune-a.myshopify.com", createdAt: new Date(cutoff.getTime() - 1), expired: true },
    { shop: "prune-a.myshopify.com", createdAt: cutoff, expired: false }, // exactly at the edge: kept
    { shop: "prune-a.myshopify.com", createdAt: new Date(now.getTime() - DAY_MS), expired: false },
    // An inactive shop that never saves again still loses its old history.
    { shop: "prune-b-inactive.myshopify.com", createdAt: new Date(cutoff.getTime() - 400 * DAY_MS), expired: true },
    { shop: "prune-b-inactive.myshopify.com", createdAt: new Date(now.getTime() - 10 * DAY_MS), expired: false },
  ];
  for (const row of rows) {
    await db.prisma.configVersion.create({ data: { shop: row.shop, schemaVersion: 1, data: "{}", createdAt: row.createdAt } });
  }
  await db.prisma.shopConfig.create({ data: { shop: "prune-b-inactive.myshopify.com", schemaVersion: 1, data: "{}" } });

  const deleted = await pruneExpiredConfigHistory(db.prisma, now);
  assert.equal(deleted, rows.filter((r) => r.expired).length);

  const left = await db.prisma.configVersion.findMany({
    where: { shop: { in: ["prune-a.myshopify.com", "prune-b-inactive.myshopify.com"] } },
    orderBy: { createdAt: "asc" },
  });
  assert.deepEqual(
    left.map((r) => [r.shop, r.createdAt.toISOString()]),
    rows
      .filter((r) => !r.expired)
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
      .map((r) => [r.shop, r.createdAt.toISOString()]),
  );
  assert.ok(
    await db.prisma.shopConfig.findUnique({ where: { shop: "prune-b-inactive.myshopify.com" } }),
    "the current config is never pruned",
  );
  assert.equal(await pruneExpiredConfigHistory(db.prisma, now), 0, "idempotent");
});

function hugeLocales() {
  // Every locale cap at its maximum: 3 x 200 texts x 500 characters, ~330 KB,
  // none of it in the function payload.
  const texts = Object.fromEntries(
    Array.from({ length: CONFIG_LIMITS.localeKeysPerLanguage }, (_, i) => [`text${i}`, "x".repeat(CONFIG_LIMITS.localeStringLength)]),
  );
  return { cs: texts, sk: texts, en: texts };
}

test("P2-1 backstop: a sanitized config over 256 KiB is refused (config_too_large), nothing is written", async () => {
  const shop = "stored-too-big.myshopify.com";
  const first = await saveConfig(db.prisma, shop, { modules: { codes: { rules: [rule("keep")] } } });
  assert.equal(first.ok, true);

  const result = await saveConfig(db.prisma, shop, { modules: { codes: { rules: [rule("keep")] } }, locales: hugeLocales() });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.reason, "config_too_large");
  if (result.reason !== "config_too_large") return;
  assert.equal(result.limit, CONFIG_LIMITS.storedConfigBytes);
  assert.ok(result.bytes > result.limit, `bytes ${result.bytes}`);

  const row = await db.prisma.shopConfig.findUnique({ where: { shop } });
  assert.deepEqual(JSON.parse(row?.data ?? "{}").locales, { cs: {}, sk: {}, en: {} }, "previous config untouched");
  assert.equal((await db.prisma.configVersion.findMany({ where: { shop } })).length, 1, "no history row");

  const brandNew = "stored-too-big-new.myshopify.com";
  const refused = await saveConfig(db.prisma, brandNew, { locales: hugeLocales() });
  assert.equal(refused.ok, false);
  assert.equal(await db.prisma.shopConfig.findUnique({ where: { shop: brandNew } }), null);
  assert.equal((await db.prisma.configVersion.findMany({ where: { shop: brandNew } })).length, 0);
});

test("concurrent first saves for a new shop all succeed (race-safe create)", async () => {
  // One PrismaClient per "app instance": separate connections, like two
  // processes behind a load balancer saving the same new shop at once. Within
  // one client Prisma serialises SQLite transactions, which would hide the race.
  const clients = Array.from({ length: 4 }, () => db.connect());
  try {
    for (let round = 0; round < 5; round++) {
      const shop = `concurrent-first-${round}.myshopify.com`;
      const results = await Promise.all(
        clients.map((client, i) => saveConfig(client, shop, { storefront: { appearancePreset: `instance-${i}` } })),
      );
      assert.deepEqual(
        results.map((r) => r.ok),
        clients.map(() => true),
        `round ${round}: ${JSON.stringify(results.map((r) => (r.ok ? "ok" : r.reason)))}`,
      );
      assert.equal(await db.prisma.shopConfig.count({ where: { shop } }), 1);
      assert.equal(await db.prisma.configVersion.count({ where: { shop } }), clients.length, "every save is in the history");
      const stored = (await loadConfig(db.prisma, shop)).config.storefront.appearancePreset;
      assert.match(stored, /^instance-\d$/);
    }
  } finally {
    await Promise.all(clients.map((client) => client.$disconnect()));
  }
});

/**
 * The exact interleaving of two instances saving a new shop at once (what
 * Postgres READ COMMITTED allows in production): this save reads "no row", the
 * other instance commits its insert, this save's insert then hits the unique
 * key. SQLite serialises write transactions, so the interleaving is injected:
 * the first ShopConfig read inside the transaction reports the row as missing
 * although it already exists.
 */
function staleFirstRead(real: typeof db.prisma): typeof db.prisma {
  let stale = true;
  const wrapTx = (tx: object) =>
    new Proxy(tx, {
      get(target, prop, receiver) {
        const value = Reflect.get(target, prop, receiver);
        if (prop !== "shopConfig") return value;
        return new Proxy(value as object, {
          get(delegate, method, r) {
            const fn = Reflect.get(delegate, method, r);
            if (method === "findUnique" && stale) {
              stale = false;
              return async () => null;
            }
            return typeof fn === "function" ? fn.bind(delegate) : fn;
          },
        });
      },
    });
  return new Proxy(real, {
    get(target, prop, receiver) {
      if (prop === "$transaction") {
        return (fn: (tx: object) => Promise<unknown>, options?: object) =>
          target.$transaction((tx) => fn(wrapTx(tx)), options);
      }
      const value = Reflect.get(target, prop, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

test("a first save that loses the create race to another instance retries as an update (P2002)", async () => {
  const shop = "lost-create-race.myshopify.com";
  const other = await saveConfig(db.prisma, shop, { storefront: { appearancePreset: "other-instance" } });
  assert.equal(other.ok, true);

  const result = await saveConfig(staleFirstRead(db.prisma), shop, { storefront: { appearancePreset: "this-instance" } });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(await db.prisma.shopConfig.count({ where: { shop } }), 1);
  assert.equal((await loadConfig(db.prisma, shop)).config.storefront.appearancePreset, "this-instance");
  assert.equal(await db.prisma.configVersion.count({ where: { shop } }), 2);
});

/**
 * A config whose payload fits while the short-id campaign is the one encoded
 * (what the old save-time check measured) but not when the 64-character-id
 * campaign becomes the live one later: the sync would then fail on the platform.
 */
function configOverBudgetOnlyForLaterCampaign() {
  const longId = "b".repeat(CONFIG_LIMITS.idLength);
  const campaigns = [
    { id: "a", name: "A", window: { start: "2027-01-01T00:00:00", end: "2027-01-02T00:00:00" }, overrides: [], killed: false },
    { id: longId, name: "B", window: { start: "2027-06-01T00:00:00", end: "2027-06-02T00:00:00" }, overrides: [], killed: false },
  ];
  // A fixed number of rules; the extra name characters are spread over them, so
  // every added character adds exactly one byte (no jump when a rule is added).
  const RULES = 40;
  const build = (nameLength: number) => ({
    modules: {
      codes: {
        rules: Array.from({ length: RULES }, (_, i) => ({
          ...rule(`r${i}`),
          name: "n".repeat(Math.floor(nameLength / RULES) + (i < nameLength % RULES ? 1 : 0)),
        })),
      },
    },
    campaigns,
  });
  const bytesFor = (input: unknown, campaignId: string) =>
    encodeFunctionConfig(sanitizeConfig(input).config, { campaignId }).bytes;
  // Grow the rule names until the long-id state is just over the budget.
  let nameLength = 0;
  while (bytesFor(build(nameLength), longId) <= FUNCTION_CONFIG_BUDGET_BYTES) nameLength += 20;
  while (bytesFor(build(nameLength - 1), longId) > FUNCTION_CONFIG_BUDGET_BYTES) nameLength -= 1;
  const input = build(nameLength);
  assert.ok(bytesFor(input, longId) > FUNCTION_CONFIG_BUDGET_BYTES);
  assert.ok(bytesFor(input, "a") <= FUNCTION_CONFIG_BUDGET_BYTES, "the state at save time fits");
  assert.equal(encodeFunctionConfig(sanitizeConfig(input).config).fits, true, "the old check would accept it");
  return input;
}

test("re-review K: the save-time budget covers every campaign state over time, not only the current one", async () => {
  const shop = "budget-over-time.myshopify.com";
  const result = await saveConfig(db.prisma, shop, configOverBudgetOnlyForLaterCampaign());
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.reason, "function_config_too_large");
  if (result.reason !== "function_config_too_large") return;
  assert.ok(result.bytes > FUNCTION_CONFIG_BUDGET_BYTES);
  assert.equal(await db.prisma.shopConfig.findUnique({ where: { shop } }), null);
  assert.equal(await db.prisma.configVersion.count({ where: { shop } }), 0);
});
