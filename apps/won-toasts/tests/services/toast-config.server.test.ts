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
      "byType" TEXT,
      "cartEvents" TEXT,
      "messages" TEXT,
      "locales" TEXT,
      "milestones" TEXT,
      "targeting" TEXT,
      "notifications" TEXT,
      "exclusions" TEXT,
      "benchmarkOptOut" BOOLEAN NOT NULL DEFAULT false,
      "industry" TEXT,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" DATETIME NOT NULL
    )
  `);
  await prisma.$executeRawUnsafe(
    'CREATE UNIQUE INDEX "ToastAppConfig_shop_key" ON "ToastAppConfig"("shop")',
  );
  await prisma.$executeRawUnsafe(`
    CREATE TABLE "ConfigVersion" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "shop" TEXT NOT NULL,
      "data" TEXT NOT NULL,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await prisma.$executeRawUnsafe(
    'CREATE INDEX "ConfigVersion_shop_createdAt_idx" ON "ConfigVersion"("shop", "createdAt")',
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
  // MVP9: notifications default to none
  assert.deepEqual(config.notifications, []);
});

test("MVP9: notification recipes persist and are re-sanitized on read", async () => {
  const shop = "recipes.myshopify.com";
  await service.updateToastConfig(shop, {
    plan: "pro",
    notifications: [
      {
        id: "sale",
        type: "countdown",
        enabled: true,
        surface: "banner",
        pages: ["product"],
        message: "Ends in {countdown}",
        endsAt: "2026-12-31T23:59:59.000Z",
      },
      {
        id: "few",
        type: "stock.low",
        enabled: true,
        surface: "inline",
        pages: ["product"],
        message: "Only {count} left",
        threshold: 5,
      },
    ],
  });
  const config = await service.getToastConfig(shop);
  assert.equal(config.notifications.length, 2);
  const countdown = config.notifications.find((n) => n.type === "countdown");
  assert.ok(countdown);
  assert.equal(countdown.enabled, true);
  assert.equal((countdown as { endsAt?: string }).endsAt, "2026-12-31T23:59:59.000Z");
});

test("announcement per-locale translations persist and update round-trip", async () => {
  const shop = "announce.myshopify.com";
  await service.updateToastConfig(shop, {
    plan: "pro",
    notifications: [
      {
        id: "announcement",
        type: "announcement",
        enabled: true,
        surface: "banner",
        pages: [],
        message: "Free gift this week!",
        messages: { cs: "Dárek zdarma!", de: "Geschenk!" },
      },
    ],
  });
  const config = await service.getToastConfig(shop);
  const ann = config.notifications.find((n) => n.type === "announcement");
  assert.ok(ann);
  assert.equal(ann.message, "Free gift this week!");
  assert.deepEqual(
    (ann as { messages?: Record<string, string> }).messages,
    { cs: "Dárek zdarma!", de: "Geschenk!" },
  );

  // Mirror the Languages save: re-send notifications with only the announcement's
  // translations changed. They must replace cleanly and survive re-read.
  const merged = config.notifications.map((n) =>
    n.type === "announcement" ? { ...n, messages: { cs: "Nový dárek!" } } : n,
  );
  await service.updateToastConfig(shop, { notifications: merged });
  const reloaded = await service.getToastConfig(shop);
  const ann2 = reloaded.notifications.find((n) => n.type === "announcement");
  assert.ok(ann2);
  assert.equal(ann2.message, "Free gift this week!");
  assert.deepEqual(
    (ann2 as { messages?: Record<string, string> }).messages,
    { cs: "Nový dárek!" },
  );
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

test("per-type overrides and per-event on/off persist", async () => {
  const shop = "pertype.myshopify.com";
  await service.updateToastConfig(shop, {
    byType: { countdown: { theme: { colorBg: "#222222" }, behavior: { durationMs: 9000 } } },
    cartEvents: { removed: false },
  });
  const config = await service.getToastConfig(shop);
  assert.equal(config.byType.countdown?.theme?.colorBg, "#222222");
  assert.equal(config.byType.countdown?.behavior?.durationMs, 9000);
  assert.equal(config.cartEvents.removed, false);
  assert.equal(config.cartEvents.added, undefined); // default on, not stored
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

test("locales persist and re-resolve; every save snapshots a restorable version", async () => {
  const shop = "locales.myshopify.com";

  await service.updateToastConfig(shop, {
    locales: { enabledLocales: ["en", "de", "cs"], defaultLocale: "de" },
  });
  const cfg = await service.getToastConfig(shop);
  assert.equal(cfg.locales.defaultLocale, "de");
  assert.deepEqual(cfg.locales.enabledLocales, ["de", "en", "cs"]);

  // A second save creates another version; the first is restorable.
  await service.updateToastConfig(shop, {
    locales: { enabledLocales: ["en"], defaultLocale: "en" },
  });
  assert.equal((await service.getToastConfig(shop)).locales.defaultLocale, "en");

  const versions = await service.listConfigVersions(shop);
  assert.ok(versions.length >= 2, "each save is snapshotted");

  // Restore the oldest (the "de" state) and confirm it comes back.
  const oldest = versions[versions.length - 1];
  const restored = await service.restoreConfigVersion(shop, oldest.id);
  assert.ok(restored);
  assert.equal(restored?.locales.defaultLocale, "de");
  assert.equal((await service.getToastConfig(shop)).locales.defaultLocale, "de");
});

test("deleteShopData also purges the shop's version history", async () => {
  const shop = "purge.myshopify.com";
  await service.updateToastConfig(shop, { enabled: true });
  await service.updateToastConfig(shop, { plan: "pro" });
  assert.ok((await service.listConfigVersions(shop)).length >= 1);

  await service.deleteShopData(shop);
  assert.equal(
    await prisma.configVersion.count({ where: { shop } }),
    0,
  );
});

test("resolveConfigWithOverlay applies a variant overlay for live A/B serving", async () => {
  const shop = "overlay.myshopify.com";
  await service.updateToastConfig(shop, {
    plan: "pro",
    global: { durationMs: 5000, position: "top-right" },
  });
  const variant = await service.resolveConfigWithOverlay(shop, {
    global: { durationMs: 2000 },
  });
  // Overlaid field changes; sibling + base defaults remain resolved.
  assert.equal(variant.global.durationMs, 2000);
  assert.equal(variant.global.position, "top-right");
  assert.equal(typeof variant.theme.mode, "string");
  // Base config is untouched by the overlay.
  assert.equal((await service.getToastConfig(shop)).global.durationMs, 5000);
});
