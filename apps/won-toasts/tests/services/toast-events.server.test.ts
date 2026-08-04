import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";

import { countWithinWindow } from "@won/core/toasts/aggregates";

import { PrismaClient } from "../../app/generated/prisma/client.ts";
import { createToastEventService } from "../../app/services/toast-events.server";

const testDirectory = mkdtempSync(path.join(tmpdir(), "won-toasts-events-"));
const databasePath = path.join(testDirectory, "events.sqlite");
const prisma = new PrismaClient({ datasourceUrl: `file:${databasePath}` });
const service = createToastEventService(prisma);

before(async () => {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE "ToastEvent" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "shop" TEXT NOT NULL,
      "kind" TEXT NOT NULL,
      "quantity" INTEGER NOT NULL DEFAULT 1,
      "at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
});

after(async () => {
  await prisma.$disconnect();
  await rm(testDirectory, { recursive: true, force: true });
});

test("records real events and counts only those inside the window", async () => {
  const shop = "counter.myshopify.com";
  const now = Date.now();
  await service.record(shop, "cart_add", 1, new Date(now - 10 * 60_000)); // 10m
  await service.record(shop, "cart_add", 1, new Date(now - 30 * 60_000)); // 30m
  await service.record(shop, "cart_add", 1, new Date(now - 5 * 3_600_000)); // 5h
  await service.record(shop, "order", 3, new Date(now - 2 * 3_600_000)); // 2h

  const cartAdds = await service.recentTimestamps(shop, "cart_add", 3_600_000, now);
  // exactly the two within the last hour
  assert.equal(cartAdds.length, 2);
  assert.equal(countWithinWindow(cartAdds, now, 3_600_000), 2);

  const orders = await service.recentTimestamps(shop, "order", 24 * 3_600_000, now);
  assert.equal(orders.length, 1);
});

test("is isolated per shop and honest on an empty store", async () => {
  const now = Date.now();
  await service.record("a.myshopify.com", "cart_add", 1, new Date(now));
  const other = await service.recentTimestamps("b.myshopify.com", "cart_add", 3_600_000, now);
  assert.deepEqual(other, []); // cold-start: nothing to show
});

test("deleteShopEvents clears only the given shop", async () => {
  const now = Date.now();
  await service.record("keep.myshopify.com", "order", 1, new Date(now));
  await service.record("drop.myshopify.com", "order", 1, new Date(now));
  await service.deleteShopEvents("drop.myshopify.com");
  assert.equal((await service.recentTimestamps("drop.myshopify.com", "order", 3_600_000, now)).length, 0);
  assert.ok((await service.recentTimestamps("keep.myshopify.com", "order", 3_600_000, now)).length >= 1);
});
