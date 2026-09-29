-- F2 (MVP 1 audit): per-shop sync bookkeeping — the zone the last sync used,
-- the product-targeting freshness (webhooks mark it stale, a product sync
-- clears it) and the last market-country check (app/lib/sync/sync-state.server.ts).
-- CreateTable
CREATE TABLE "ShopSyncState" (
    "shop" TEXT NOT NULL PRIMARY KEY,
    "timezone" TEXT,
    "productsSyncedAt" DATETIME,
    "targetingStaleAt" DATETIME,
    "targetingStaleNote" TEXT,
    "marketsCheckedAt" DATETIME,
    "updatedAt" DATETIME NOT NULL
);
