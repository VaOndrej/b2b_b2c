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

import type { ShopPlan } from "@won/core/discounts/plan-gate";

import type { PrismaClient } from "../../generated/prisma/client";

export interface ShopSyncFacts {
  timezone: string | null;
  /** The plan the live shop config was built for (null = not recorded). */
  appliedPlan: ShopPlan | null;
  productsSyncedAt: Date | null;
  targetingStaleAt: Date | null;
  targetingStaleNote: string | null;
  marketsCheckedAt: Date | null;
  /** MVP 6 K4: when the selected campaign changes (UTC); null = no campaign. */
  campaignBoundaryAt: Date | null;
  /** MVP 6 K3: campaigns running at the Pro → Free downgrade (they finish); null = none. */
  campaignsFinishing: string[] | null;
}

const EMPTY: ShopSyncFacts = {
  timezone: null,
  appliedPlan: null,
  productsSyncedAt: null,
  targetingStaleAt: null,
  targetingStaleNote: null,
  marketsCheckedAt: null,
  campaignBoundaryAt: null,
  campaignsFinishing: null,
};

function idList(text: string | null): string[] | null {
  try {
    const value: unknown = text ? JSON.parse(text) : null;
    return Array.isArray(value) && value.every((v) => typeof v === "string") ? (value as string[]) : null;
  } catch {
    return null;
  }
}

/** The shop's facts (all null for a shop that never synced). */
export async function loadShopSyncFacts(db: PrismaClient, shop: string): Promise<ShopSyncFacts> {
  const row = await db.shopSyncState.findUnique({ where: { shop } });
  if (!row) return { ...EMPTY };
  return {
    timezone: row.timezone,
    appliedPlan: row.appliedPlan === "free" || row.appliedPlan === "pro" ? row.appliedPlan : null,
    productsSyncedAt: row.productsSyncedAt,
    targetingStaleAt: row.targetingStaleAt,
    targetingStaleNote: row.targetingStaleNote,
    marketsCheckedAt: row.marketsCheckedAt,
    campaignBoundaryAt: row.campaignBoundaryAt,
    campaignsFinishing: idList(row.campaignsFinishing),
  };
}

type Row = Partial<Omit<ShopSyncFacts, "campaignsFinishing">> & { campaignsFinishing?: string | null };

async function upsert(db: PrismaClient, shop: string, data: Row): Promise<void> {
  await db.shopSyncState.upsert({ where: { shop }, create: { shop, ...data }, update: data });
}

export function recordShopTimezone(db: PrismaClient, shop: string, timezone: string): Promise<void> {
  return upsert(db, shop, { timezone });
}

/** The shop function config now live in Shopify was built for `plan` (written or verified unchanged). */
export function recordAppliedPlan(db: PrismaClient, shop: string, plan: ShopPlan): Promise<void> {
  return upsert(db, shop, { appliedPlan: plan });
}

/** K4: the next campaign boundary (UTC) the scheduler resyncs at; null = no campaign. */
export function recordCampaignBoundary(db: PrismaClient, shop: string, at: Date | null): Promise<void> {
  return upsert(db, shop, { campaignBoundaryAt: at });
}

/** K3: the campaigns that finish after a downgrade (null clears the list). */
export function recordCampaignsFinishing(db: PrismaClient, shop: string, ids: readonly string[] | null): Promise<void> {
  return upsert(db, shop, { campaignsFinishing: ids && ids.length ? JSON.stringify(ids) : null });
}

export function recordMarketsChecked(db: PrismaClient, shop: string, at: Date): Promise<void> {
  return upsert(db, shop, { marketsCheckedAt: at });
}

/**
 * Stale as of the LATEST unhandled change `at` (F2 re-review M-2): a product
 * pass clears the mark only when it started after every change it covers, so
 * a change that lands while a pass is running keeps the targeting stale.
 * Idempotent: a repeated or late delivery (an older `at`) changes nothing.
 */
export async function markTargetingStale(db: PrismaClient, shop: string, note: string, at: Date): Promise<void> {
  const short = note.slice(0, 300);
  await db.shopSyncState.upsert({
    where: { shop },
    create: { shop, targetingStaleAt: at, targetingStaleNote: short },
    update: {},
  });
  await db.shopSyncState.updateMany({
    where: { shop, OR: [{ targetingStaleAt: null }, { targetingStaleAt: { lt: at } }] },
    data: { targetingStaleAt: at, targetingStaleNote: short },
  });
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
 *   - the targeting freshness is forgotten (productsSyncedAt = null);
 *   - the cost mirror (MVP 2) keeps only cost-free markers: every variant
 *     that may carry the sync's metafield keeps its row with `mayCarry` and
 *     nothing else of value (cost, currency, confirmed value, errors cleared —
 *     Won does not keep purchase costs for an uninstalled shop); the other
 *     rows go. Safe in both orders like the index above: after a normal
 *     uninstall Shopify has removed the metafields (a later clear deletes
 *     nothing); a DELAYED delivery after a quick reinstall keeps the markers
 *     of metafields written since, so a later switch-off still clears them.
 *     The pass bookkeeping is reset (the next full pass re-reads Shopify).
 * ShopConfig, history and native-discount backups stay until shop/redact (A7).
 * Idempotent.
 */
export async function forgetShopifyState(db: PrismaClient, shop: string): Promise<void> {
  await db.$transaction([
    db.wonNode.deleteMany({ where: { shop } }),
    db.productTargetIndex.updateMany({ where: { shop }, data: { payloadHash: null } }),
    db.variantCost.updateMany({ where: { shop, metafieldValue: { not: null } }, data: { mayCarry: true } }),
    db.variantCost.deleteMany({ where: { shop, mayCarry: false } }),
    db.variantCost.updateMany({
      where: { shop },
      data: { cost: null, currency: null, metafieldValue: null, writeError: null, writeFailedAt: null, scanId: null },
    }),
    db.shopSyncState.updateMany({
      where: { shop },
      data: { productsSyncedAt: null, costsScannedAt: null, costsCursor: null, costsPending: null },
    }),
  ]);
}
