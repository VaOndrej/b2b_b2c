import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";

import { PrismaClient } from "../../app/generated/prisma/client.ts";
import { createAnalyticsService } from "../../app/services/analytics.server";

const testDirectory = mkdtempSync(path.join(tmpdir(), "won-toasts-analytics-"));
const databasePath = path.join(testDirectory, "analytics.sqlite");
const prisma = new PrismaClient({ datasourceUrl: `file:${databasePath}` });
const service = createAnalyticsService(prisma);

before(async () => {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE "AnalyticsEvent" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "shop" TEXT NOT NULL,
      "ruleId" TEXT NOT NULL,
      "variant" INTEGER NOT NULL DEFAULT 0,
      "type" TEXT NOT NULL,
      "dims" JSONB,
      "dwellMs" INTEGER,
      "at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await prisma.$executeRawUnsafe(`
    CREATE TABLE "ToastRollup" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "shop" TEXT NOT NULL,
      "date" TEXT NOT NULL,
      "type" TEXT NOT NULL,
      "device" TEXT NOT NULL DEFAULT 'unknown',
      "pageType" TEXT NOT NULL DEFAULT 'unknown',
      "customerState" TEXT NOT NULL DEFAULT 'unknown',
      "abVariant" INTEGER NOT NULL DEFAULT 0,
      "counters" JSONB NOT NULL,
      "updatedAt" DATETIME NOT NULL
    )
  `);
  await prisma.$executeRawUnsafe(
    `CREATE UNIQUE INDEX "ToastRollup_key" ON "ToastRollup"("shop","date","type","device","pageType","customerState","abVariant")`,
  );
});

after(async () => {
  await prisma.$disconnect();
  await rm(testDirectory, { recursive: true, force: true });
});

const at = Date.UTC(2026, 7, 10, 12, 0);

test("recordAtoms scrubs, stores raw rows, and rolls up per type/segment", async () => {
  const shop = "roll.myshopify.com";
  await service.recordAtoms(
    shop,
    [
      { atom: "shown", ruleId: "cart:added", dims: { type: "cart", device: "mobile", pageType: "product", customerState: "guest" } },
      { atom: "visible", ruleId: "cart:added", dims: { type: "cart", device: "mobile", pageType: "product", customerState: "guest" } },
      { atom: "click", clickTarget: "cta", ruleId: "cart:added", dims: { type: "cart", device: "mobile", pageType: "product", customerState: "guest" } },
      // PII that must be dropped by the scrub:
      { atom: "auto_fade", dwellMs: 4000, ruleId: "cart:added", dims: { type: "cart", device: "mobile", pageType: "product", customerState: "guest", email: "a@b.com" } } as never,
    ],
    at,
  );

  const rollups = await service.readRollups(shop, "2026-08-01");
  assert.equal(rollups.length, 1);
  assert.equal(rollups[0].dims.type, "cart");
  assert.equal(rollups[0].counters.shown, 1);
  assert.equal(rollups[0].counters.ctaClicks, 1);
  assert.equal(rollups[0].counters.dwellMsTotal, 4000);

  // raw rows exist and carry NO PII in their dims
  const raw = await prisma.analyticsEvent.findMany({ where: { shop } });
  assert.equal(raw.length, 4);
  for (const r of raw) {
    const dims = r.dims as Record<string, unknown> | null;
    if (dims) assert.ok(!("email" in dims), "PII leaked into raw dims");
  }
});

test("recordAtoms upserts — a second batch merges into the same rollup row", async () => {
  const shop = "merge.myshopify.com";
  const dims = { type: "countdown", device: "desktop", pageType: "product", customerState: "guest" };
  await service.recordAtoms(shop, [{ atom: "shown", dims }], at);
  await service.recordAtoms(shop, [{ atom: "shown", dims }, { atom: "suppressed", suppressReason: "cap", dims }], at);

  const rollups = await service.readRollups(shop, "2026-08-01");
  assert.equal(rollups.length, 1);
  assert.equal(rollups[0].counters.shown, 2);
  assert.equal(rollups[0].counters.suppressed, 1);
  assert.equal(rollups[0].counters.suppressedByReason.cap, 1);
});

test("deleteShopAnalytics purges both raw events and rollups", async () => {
  const shop = "wipe.myshopify.com";
  await service.recordAtoms(shop, [{ atom: "shown", dims: { type: "cart" } }], at);
  await service.deleteShopAnalytics(shop);
  assert.equal((await service.readRollups(shop, "2026-08-01")).length, 0);
  assert.equal((await prisma.analyticsEvent.findMany({ where: { shop } })).length, 0);
});
