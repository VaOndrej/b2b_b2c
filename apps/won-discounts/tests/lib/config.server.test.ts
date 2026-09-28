import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { DEFAULT_CONFIG, SCHEMA_VERSION } from "@won/core/discounts/config";
import { FUNCTION_CONFIG_BUDGET_BYTES } from "@won/core/discounts/function-config";

import { deleteShopData, loadConfig, saveConfig } from "../../app/lib/config.server.ts";
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
