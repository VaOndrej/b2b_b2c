import assert from "node:assert/strict";
import { after, test } from "node:test";

import { createAnalyticsService } from "../../app/services/analytics.server";
import { createTestDatabase } from "../lib/test-db.ts";

// The schema is built from schema.prisma by `prisma db push` (tests/lib/test-db.ts),
// so this fixture can never drift from the real model the service writes to.
const db = createTestDatabase("analytics");
const prisma = db.prisma;
const service = createAnalyticsService(prisma);

after(async () => {
  await db.drop();
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
