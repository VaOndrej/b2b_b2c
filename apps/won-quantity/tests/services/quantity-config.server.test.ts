import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";

import { PrismaClient } from "../../app/generated/prisma/client.ts";
import { createQuantityConfigService } from "../../app/services/quantity-config.server";

const testDirectory = mkdtempSync(path.join(tmpdir(), "won-quantity-service-"));
const databasePath = path.join(testDirectory, "service.sqlite");
const prisma = new PrismaClient({ datasourceUrl: `file:${databasePath}` });
const service = createQuantityConfigService(prisma);

before(async () => {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE "QuantityConfig" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "shop" TEXT NOT NULL,
      "enabled" BOOLEAN NOT NULL DEFAULT false,
      "minimum" INTEGER NOT NULL DEFAULT 1,
      "step" INTEGER NOT NULL DEFAULT 1,
      "maximum" INTEGER,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" DATETIME NOT NULL
    )
  `);
  await prisma.$executeRawUnsafe(
    'CREATE UNIQUE INDEX "QuantityConfig_shop_key" ON "QuantityConfig"("shop")',
  );
  await prisma.$executeRawUnsafe(`
    CREATE TABLE "QuantityRule" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "shop" TEXT NOT NULL,
      "targetKey" TEXT NOT NULL,
      "minimum" INTEGER,
      "step" INTEGER,
      "maximum" INTEGER,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" DATETIME NOT NULL,
      CONSTRAINT "QuantityRule_shop_fkey"
        FOREIGN KEY ("shop") REFERENCES "QuantityConfig" ("shop")
        ON DELETE CASCADE ON UPDATE CASCADE
    )
  `);
  await prisma.$executeRawUnsafe(
    'CREATE UNIQUE INDEX "QuantityRule_shop_targetKey_key" ON "QuantityRule"("shop", "targetKey")',
  );
});

after(async () => {
  await prisma.$disconnect();
  await rm(testDirectory, { recursive: true, force: true });
});

test("configuration is isolated by authenticated shop", async () => {
  await service.updateQuantityConfig("alpha.myshopify.com", {
    enabled: true,
    minimum: 3,
    step: 3,
    maximum: 30,
  });
  await service.updateQuantityConfig("beta.myshopify.com", {
    enabled: false,
    minimum: 2,
    step: 2,
    maximum: null,
  });

  const alpha = await service.getQuantityConfig("alpha.myshopify.com");
  const beta = await service.getQuantityConfig("beta.myshopify.com");

  assert.equal(alpha.enabled, true);
  assert.deepEqual(
    { minimum: alpha.minimum, step: alpha.step, maximum: alpha.maximum },
    { minimum: 3, step: 3, maximum: 30 },
  );
  assert.equal(beta.enabled, false);
  assert.deepEqual(
    { minimum: beta.minimum, step: beta.step, maximum: beta.maximum },
    { minimum: 2, step: 2, maximum: null },
  );
});

test("minimum, step and maximum are validated", async () => {
  await assert.rejects(
    service.updateQuantityConfig("invalid.myshopify.com", {
      enabled: true,
      minimum: 0,
      step: 1,
      maximum: null,
    }),
    /minimum must be an integer greater than or equal to 1/i,
  );
  await assert.rejects(
    service.updateQuantityConfig("invalid.myshopify.com", {
      enabled: true,
      minimum: 1,
      step: 1.5,
      maximum: null,
    }),
    /step must be an integer greater than or equal to 1/i,
  );
  await assert.rejects(
    service.updateQuantityConfig("invalid.myshopify.com", {
      enabled: true,
      minimum: 5,
      step: 1,
      maximum: 4,
    }),
    /maximum must be null or greater than or equal to minimum/i,
  );
});

test("variant and product overrides inherit the shop fallback", async () => {
  const shop = "inheritance.myshopify.com";
  const productGid = "gid://shopify/Product/101";
  const variantGid = "gid://shopify/ProductVariant/202";

  await service.updateQuantityConfig(shop, {
    enabled: true,
    minimum: 2,
    step: 2,
    maximum: 20,
  });
  await service.upsertQuantityRule(shop, {
    targetKey: `product:${productGid}`,
    minimum: 4,
  });
  await service.upsertQuantityRule(shop, {
    targetKey: `variant:${variantGid}`,
    step: 4,
    maximum: 12,
  });

  assert.deepEqual(await service.resolveQuantityRule(shop, productGid, null), {
    enabled: true,
    minimum: 4,
    step: 2,
    maximum: 20,
  });
  assert.deepEqual(
    await service.resolveQuantityRule(shop, productGid, variantGid),
    {
      enabled: true,
      minimum: 4,
      step: 4,
      maximum: 12,
    },
  );
});

test("uninstall cleanup deletes only the selected shop", async () => {
  const removedShop = "removed.myshopify.com";
  const retainedShop = "retained.myshopify.com";

  for (const shop of [removedShop, retainedShop]) {
    await service.updateQuantityConfig(shop, {
      enabled: true,
      minimum: 2,
      step: 2,
      maximum: 10,
    });
    await service.upsertQuantityRule(shop, {
      targetKey: "product:gid://shopify/Product/1",
      minimum: 4,
    });
  }

  await service.deleteShopData(removedShop);

  assert.equal(
    await prisma.quantityConfig.count({ where: { shop: removedShop } }),
    0,
  );
  assert.equal(
    await prisma.quantityRule.count({ where: { shop: removedShop } }),
    0,
  );
  assert.equal(
    await prisma.quantityConfig.count({ where: { shop: retainedShop } }),
    1,
  );
  assert.equal(
    await prisma.quantityRule.count({ where: { shop: retainedShop } }),
    1,
  );
});
