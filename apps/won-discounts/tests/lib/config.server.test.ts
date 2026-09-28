import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { DEFAULT_CONFIG } from "@won/core/discounts/config";

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

test("a shop with no row yet reads back DEFAULT_CONFIG", async () => {
  const config = await loadConfig(db.prisma, "new-shop.myshopify.com");
  assert.deepEqual(config, DEFAULT_CONFIG);
});

test("saveConfig persists the sanitized config and a ConfigVersion snapshot", async () => {
  const shop = "save-shop.myshopify.com";
  const result = await saveConfig(db.prisma, shop, {
    modules: { codes: { rules: [{ id: "r1", value: { kind: "percentage", percent: 10 }, target: { kind: "order" } }] } },
  });

  assert.equal(result.issues.length, 0);
  assert.equal(result.config.modules.codes.rules.length, 1);
  assert.equal(result.config.modules.codes.rules[0].id, "r1");
  assert.ok(result.versionId);

  const reloaded = await loadConfig(db.prisma, shop);
  assert.equal(reloaded.modules.codes.rules.length, 1);

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
  assert.equal(a.storefront.appearancePreset, "shop-a-preset");
  assert.equal(b.storefront.appearancePreset, "shop-b-preset");
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

test("corrupted JSON in the stored row falls back to DEFAULT_CONFIG, never throws", async () => {
  const shop = "corrupted.myshopify.com";
  await db.prisma.shopConfig.create({
    data: { shop, schemaVersion: 1, data: "{not valid json" },
  });

  const config = await loadConfig(db.prisma, shop);
  assert.deepEqual(config, DEFAULT_CONFIG);
});
