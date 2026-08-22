import assert from "node:assert/strict";
import { after, test } from "node:test";

import { countWithinWindow } from "@won/core/toasts/aggregates";

import { createToastEventService } from "../../app/services/toast-events.server";
import { createTestDatabase } from "../lib/test-db.ts";

// The schema is built from schema.prisma by `prisma db push` (tests/lib/test-db.ts),
// so this fixture can never drift from the real model the service writes to.
const db = createTestDatabase("events");
const prisma = db.prisma;
const service = createToastEventService(prisma);

after(async () => {
  await db.drop();
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

test("WBH-2: a duplicate order delivery (same orderId) is counted once", async () => {
  const shop = "idem.myshopify.com";
  const now = Date.now();
  // Same order, delivered twice (at-least-once webhook).
  await service.record(shop, "order", 2, new Date(now), "gid://order/555");
  await service.record(shop, "order", 2, new Date(now), "gid://order/555");
  // A different order still counts separately.
  await service.record(shop, "order", 1, new Date(now), "gid://order/777");

  const orders = await service.recentTimestamps(shop, "order", 3_600_000, now);
  assert.equal(orders.length, 2); // two distinct orders, not three deliveries
});

test("cart_add beacons without an orderId are never deduped away", async () => {
  const shop = "beacon.myshopify.com";
  const now = Date.now();
  await service.record(shop, "cart_add", 1, new Date(now));
  await service.record(shop, "cart_add", 1, new Date(now));
  const adds = await service.recentTimestamps(shop, "cart_add", 3_600_000, now);
  assert.equal(adds.length, 2); // both real, both kept
});

test("deleteShopEvents clears only the given shop", async () => {
  const now = Date.now();
  await service.record("keep.myshopify.com", "order", 1, new Date(now));
  await service.record("drop.myshopify.com", "order", 1, new Date(now));
  await service.deleteShopEvents("drop.myshopify.com");
  assert.equal((await service.recentTimestamps("drop.myshopify.com", "order", 3_600_000, now)).length, 0);
  assert.ok((await service.recentTimestamps("keep.myshopify.com", "order", 3_600_000, now)).length >= 1);
});
