// Per-shop sync bookkeeping (Prisma ShopSyncState, F2). Small facts the sync
// and the Přehled keep between runs:
//   timezone          the zone the last sync built the payload with (item 12:
//                     a different zone on Přehled → resync, rule days move);
//   productsSyncedAt  the last product-targeting pass without errors (item 2:
//                     Přehled refreshes the targeting when it is > 24 h old);
//   targetingStaleAt  set by the products/collections webhooks (item 2):
//                     membership changed since the last product sync; a
//                     product sync that STARTED after it clears it;
//   marketsCheckedAt  the last comparison of Shopify market countries (item 12).
// Every write is an idempotent upsert keyed by the shop (SEC-2).

import type { PrismaClient } from "../../generated/prisma/client";

export interface ShopSyncFacts {
  timezone: string | null;
  productsSyncedAt: Date | null;
  targetingStaleAt: Date | null;
  targetingStaleNote: string | null;
  marketsCheckedAt: Date | null;
}

const EMPTY: ShopSyncFacts = {
  timezone: null,
  productsSyncedAt: null,
  targetingStaleAt: null,
  targetingStaleNote: null,
  marketsCheckedAt: null,
};

/** The shop's facts (all null for a shop that never synced). */
export async function loadShopSyncFacts(db: PrismaClient, shop: string): Promise<ShopSyncFacts> {
  const row = await db.shopSyncState.findUnique({ where: { shop } });
  if (!row) return { ...EMPTY };
  return {
    timezone: row.timezone,
    productsSyncedAt: row.productsSyncedAt,
    targetingStaleAt: row.targetingStaleAt,
    targetingStaleNote: row.targetingStaleNote,
    marketsCheckedAt: row.marketsCheckedAt,
  };
}

async function upsert(db: PrismaClient, shop: string, data: Partial<ShopSyncFacts>): Promise<void> {
  await db.shopSyncState.upsert({ where: { shop }, create: { shop, ...data }, update: data });
}

export function recordShopTimezone(db: PrismaClient, shop: string, timezone: string): Promise<void> {
  return upsert(db, shop, { timezone });
}

export function recordMarketsChecked(db: PrismaClient, shop: string, at: Date): Promise<void> {
  return upsert(db, shop, { marketsCheckedAt: at });
}

/** Stale from `at` (the earliest unhandled change wins: a later mark never moves it forward). */
export async function markTargetingStale(db: PrismaClient, shop: string, note: string, at: Date): Promise<void> {
  const short = note.slice(0, 300);
  await db.shopSyncState.upsert({
    where: { shop },
    create: { shop, targetingStaleAt: at, targetingStaleNote: short },
    update: {},
  });
  // Only when not stale yet (idempotent for repeated webhook deliveries).
  await db.shopSyncState.updateMany({ where: { shop, targetingStaleAt: null }, data: { targetingStaleAt: at, targetingStaleNote: short } });
}

/**
 * A product pass that started at `startedAt` finished without errors: the
 * targeting is fresh as of then. A mark made AFTER the pass started stays (that
 * change may not have been read).
 */
export async function recordProductsSynced(db: PrismaClient, shop: string, startedAt: Date): Promise<void> {
  await upsert(db, shop, { productsSyncedAt: startedAt });
  await db.shopSyncState.updateMany({
    where: { shop, targetingStaleAt: { lte: startedAt } },
    data: { targetingStaleAt: null, targetingStaleNote: null },
  });
}

/**
 * app/uninstalled (audit P2-4): Shopify removes this app's discounts and its
 * app-owned metafields with the app, so what the app DB says about them no
 * longer proves anything:
 *   - WonNode rows are deleted (the next sync re-creates the nodes, or adopts
 *     them by this app's function / by code if they still exist, node-sync.ts);
 *   - ProductTargetIndex rows are KEPT but their hashes cleared (payloadHash =
 *     null = "unknown"): the next sync reads and rewrites every indexed
 *     product, and a product that carries a ref still gets cleared — safe in
 *     both orders, also when a delayed webhook arrives after a reinstall;
 *   - the targeting freshness is forgotten (productsSyncedAt = null).
 * ShopConfig, history and native-discount backups stay until shop/redact (A7).
 * Idempotent.
 */
export async function forgetShopifyState(db: PrismaClient, shop: string): Promise<void> {
  await db.$transaction([
    db.wonNode.deleteMany({ where: { shop } }),
    db.productTargetIndex.updateMany({ where: { shop }, data: { payloadHash: null } }),
    db.shopSyncState.updateMany({ where: { shop }, data: { productsSyncedAt: null } }),
  ]);
}
