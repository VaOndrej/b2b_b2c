import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";

import { PrismaClient } from "../../app/generated/prisma/client.ts";
import { createToastConfigService } from "../../app/services/toast-config.server";

const testDirectory = mkdtempSync(path.join(tmpdir(), "won-toasts-service-"));
const databasePath = path.join(testDirectory, "service.sqlite");
const prisma = new PrismaClient({ datasourceUrl: `file:${databasePath}` });
const service = createToastConfigService(prisma);

before(async () => {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE "ToastAppConfig" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "shop" TEXT NOT NULL,
      "version" INTEGER NOT NULL DEFAULT 1,
      "enabled" BOOLEAN NOT NULL DEFAULT false,
      "plan" TEXT NOT NULL DEFAULT 'free',
      "global" TEXT,
      "theme" TEXT,
      "messages" TEXT,
      "milestones" TEXT,
      "targeting" TEXT,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" DATETIME NOT NULL
    )
  `);
  await prisma.$executeRawUnsafe(
    'CREATE UNIQUE INDEX "ToastAppConfig_shop_key" ON "ToastAppConfig"("shop")',
  );
});

after(async () => {
  await prisma.$disconnect();
  await rm(testDirectory, { recursive: true, force: true });
});

test("fresh shop resolves to the complete spec default config", async () => {
  const config = await service.getToastConfig("fresh.myshopify.com");
  // Installing the app (which lands a row here) opts the shop in — the merchant
  // already opted in by enabling the theme app embed. Only the unknown-shop
  // path (resolveToastConfig(null)) stays disabled.
  assert.equal(config.enabled, true);
  assert.equal(config.plan, "free");
  assert.equal(config.global.position, "top-right");
  assert.equal(config.global.durationMs, 3500);
  assert.equal(config.global.maxVisible, 3);
  assert.equal(config.global.grouping.burstWindowMs, 600);
  assert.equal(config.theme.mode, "system");
  // MVP4: default messages + empty milestones present
  assert.equal(typeof config.messages.added?.en, "string");
  assert.deepEqual(config.milestones, []);
});

test("message overrides and milestone rules persist and merge", async () => {
  const shop = "messages.myshopify.com";
  await service.updateToastConfig(shop, {
    messages: { added: { cs: "Máš to v košíku!" } },
    milestones: [
      {
        id: "ship",
        kind: "free_shipping",
        enabled: true,
        thresholdCents: 150000,
        label: "free shipping",
      },
    ],
  });
  const config = await service.getToastConfig(shop);
  assert.equal(config.messages.added?.cs, "Máš to v košíku!");
  // default locales for the same type survive the merge
  assert.equal(typeof config.messages.added?.en, "string");
  assert.equal(config.milestones.length, 1);
  assert.equal(config.milestones[0].kind, "free_shipping");
  assert.equal(config.milestones[0].thresholdCents, 150000);
});

test("configuration is isolated by authenticated shop", async () => {
  await service.updateToastConfig("alpha.myshopify.com", { enabled: true });
  await service.updateToastConfig("beta.myshopify.com", { enabled: false });

  assert.equal(
    (await service.getToastConfig("alpha.myshopify.com")).enabled,
    true,
  );
  assert.equal(
    (await service.getToastConfig("beta.myshopify.com")).enabled,
    false,
  );
});

test("partial global override persists and merges over defaults", async () => {
  const shop = "override.myshopify.com";
  const saved = await service.updateToastConfig(shop, {
    enabled: true,
    global: { position: "bottom-left", grouping: { burstWindowMs: 900 } },
  });

  // overridden values
  assert.equal(saved.global.position, "bottom-left");
  assert.equal(saved.global.grouping.burstWindowMs, 900);
  // untouched siblings keep their defaults (no magic numbers lost)
  assert.equal(saved.global.durationMs, 3500);
  assert.equal(saved.global.grouping.mergeDeltas, true);

  // survives a reload from the DB
  const reloaded = await service.getToastConfig(shop);
  assert.equal(reloaded.global.position, "bottom-left");
  assert.equal(reloaded.global.grouping.burstWindowMs, 900);
  assert.equal(reloaded.global.durationMs, 3500);
});

test("plan is persisted and gates nothing unless explicitly set", async () => {
  const shop = "plan.myshopify.com";
  assert.equal((await service.getToastConfig(shop)).plan, "free");
  await service.updateToastConfig(shop, { plan: "pro" });
  assert.equal((await service.getToastConfig(shop)).plan, "pro");
});

test("uninstall cleanup deletes only the selected shop", async () => {
  const removed = "removed.myshopify.com";
  const retained = "retained.myshopify.com";
  await service.updateToastConfig(removed, { enabled: true });
  await service.updateToastConfig(retained, { enabled: true });

  await service.deleteShopData(removed);

  assert.equal(
    await prisma.toastAppConfig.count({ where: { shop: removed } }),
    0,
  );
  assert.equal(
    await prisma.toastAppConfig.count({ where: { shop: retained } }),
    1,
  );
});
