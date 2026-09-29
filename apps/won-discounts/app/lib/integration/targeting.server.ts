// Collection / product targeting freshness (audit P1-2, drift P1, item 2).
//
// The discount function reads each product's `$app:won_discounts/product`
// refs, which the sync computes from collection membership at sync time. So a
// product that joins a targeted collection has no ref yet, and one that left
// it still carries one, until the targeting is refreshed. The refresh model:
//
//   1. Webhooks (shopify.app.toml → /webhooks/targeting, HMAC checked by
//      authenticate.webhook):
//        collections/update, collections/delete  a TARGETED collection changed
//            (Shopify fires update when products are added/removed by hand or
//            the rules change — NOT when a product's own attributes make it
//            join/leave a smart collection);
//        products/update  any product changed — it may have joined/left a
//            smart collection; relevant only while some rule targets a
//            collection;
//        products/delete  the product's index row is dropped (its metafield is
//            gone with it).
//      A relevant delivery marks the shop's targeting stale (ShopSyncState,
//      idempotent: a repeated or late delivery only keeps it stale) and
//      schedules ONE refresh per shop after TARGETING_REFRESH_DEBOUNCE_MS
//      (in-process, under the shop's config lock). The handler answers 2xx at
//      once (WBH-2: idempotent, nothing slow before the answer).
//   2. The refresh (app/lib/sync/save-and-sync.server.ts refreshTargeting): the product
//      step only — or a full resync when the stored config is not the one
//      Shopify runs. A product pass that finished clears the stale mark.
//   3. Safety nets on Přehled: "Obnovit cílení" (now), and an automatic
//      refresh when the last product pass is older than TARGETING_MAX_AGE_MS
//      or a stale mark outlived its scheduled refresh (a restart lost it).
// Until a refresh ran, checkout may give a joined product no discount and a
// product that left the collection the old one; the admin says the targeting
// is being refreshed, and Vyzkoušet košík reads the refs checkout reads.
// Single instance assumption (MVP 7 note): the debounce timer lives in this
// process; with several instances each schedules its own (harmless: the
// refresh is idempotent).

import type { PrismaClient } from "../../generated/prisma/client";
import { adminClientFromApp, type AdminClient, type AppAdminGraphql } from "../admin-client.server";
import { loadConfig } from "../config.server";
import { targetScopes } from "../sync/products";
import { refreshTargeting, type ResyncResult } from "../sync/save-and-sync.server";
import { markTargetingStale } from "../sync/sync-state.server";
import type { Sync } from "../sync/sync.server";
import { errorText } from "../sync/transport";
import type { SyncLogger } from "../sync/types";
import { withConfigLock } from "./lock.server";

/** One refresh per shop at most this long after the first relevant webhook. */
export const TARGETING_REFRESH_DEBOUNCE_MS = 60_000;
/** Přehled refreshes the targeting when the last product pass is older than this. */
export const TARGETING_MAX_AGE_MS = 24 * 60 * 60_000;

export const TARGETING_TOPICS = ["products/update", "products/delete", "collections/update", "collections/delete"] as const;
export type TargetingTopic = (typeof TARGETING_TOPICS)[number];

/** "PRODUCTS_UPDATE" (what authenticate.webhook reports) or "products/update" → the topic; anything else → null. */
export function targetingTopic(topic: string): TargetingTopic | null {
  const normalized = topic.trim().toLowerCase().replace("_", "/");
  return (TARGETING_TOPICS as readonly string[]).includes(normalized) ? (normalized as TargetingTopic) : null;
}

/** The GID of the product / collection a delivery is about (admin_graphql_api_id, else the numeric id). */
export function resourceGid(topic: TargetingTopic, payload: unknown): string | null {
  const kind = topic.startsWith("products/") ? "Product" : "Collection";
  const p = (payload ?? {}) as { admin_graphql_api_id?: unknown; id?: unknown };
  if (typeof p.admin_graphql_api_id === "string" && p.admin_graphql_api_id.startsWith(`gid://shopify/${kind}/`)) return p.admin_graphql_api_id;
  if ((typeof p.id === "number" && Number.isSafeInteger(p.id) && p.id > 0) || (typeof p.id === "string" && /^\d+$/.test(p.id))) {
    return `gid://shopify/${kind}/${p.id}`;
  }
  return null;
}

export interface TargetingWebhookDeps {
  db: PrismaClient;
  /** Schedule the shop's debounced refresh. */
  schedule: (shop: string) => void;
  now?: () => Date;
}

export type TargetingWebhookOutcome =
  | { handled: "stale"; note: string }
  | { handled: "index_row"; productId: string }
  | { handled: "ignored"; reason: string };

/**
 * One delivery: mark the targeting stale (and schedule the refresh) when it
 * can change what a targeted rule covers; nothing else. Fast and idempotent.
 */
export async function handleTargetingWebhook(
  deps: TargetingWebhookDeps,
  delivery: { shop: string; topic: string; payload: unknown },
): Promise<TargetingWebhookOutcome> {
  const topic = targetingTopic(delivery.topic);
  if (!topic) return { handled: "ignored", reason: `not a targeting topic: ${delivery.topic}` };
  const gid = resourceGid(topic, delivery.payload);
  if (!gid) return { handled: "ignored", reason: "no resource id in the payload" };
  const { db, shop } = { db: deps.db, shop: delivery.shop };

  if (topic === "products/delete") {
    // Its metafield is gone with the product: stop tracking it (idempotent).
    await db.productTargetIndex.deleteMany({ where: { shop, productId: gid } });
    return { handled: "index_row", productId: gid };
  }

  const loaded = await loadConfig(db, shop);
  if (!loaded.exists || loaded.unreadable || loaded.readOnly) return { handled: "ignored", reason: "no syncable config" };
  const scopes = targetScopes(loaded.config);
  const relevant =
    topic === "products/update"
      ? scopes.collectionIds.size > 0 // smart-collection membership follows product attributes
      : scopes.collectionIds.has(gid);
  if (!relevant) return { handled: "ignored", reason: topic === "products/update" ? "no rule targets a collection" : "collection not targeted" };
  const note = `${topic} ${gid}`;
  await markTargetingStale(db, shop, note, (deps.now ?? (() => new Date()))());
  deps.schedule(shop);
  return { handled: "stale", note };
}

export interface TargetingRefresherDeps {
  db: PrismaClient;
  /** The shop's Admin API client (offline session), or null when the shop has none (uninstalled). */
  clientFor: (shop: string) => Promise<AdminClient | null>;
  createSync?: (client: AdminClient, db: PrismaClient) => Sync;
  delayMs?: number;
  logger?: SyncLogger;
  now?: () => Date;
}

export interface TargetingRefresher {
  /** Debounced: the first call starts the window, later ones fold into it. */
  schedule(shop: string): void;
  /** Is a refresh of `shop` scheduled (not run yet)? */
  scheduled(shop: string): boolean;
  /** Run the refresh now, under the shop's config lock. */
  runNow(shop: string): Promise<ResyncResult | null>;
  /** Test hook: drop every pending timer. */
  cancelAll(): void;
}

const quiet: SyncLogger = { info() {}, warn() {}, error() {} };

export function createTargetingRefresher(deps: TargetingRefresherDeps): TargetingRefresher {
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  const logger = deps.logger ?? quiet;
  const runNow = async (shop: string): Promise<ResyncResult | null> => {
    const client = await deps.clientFor(shop);
    if (!client) {
      logger.warn(`targeting refresh ${shop}: no Admin API session, skipped`);
      return null;
    }
    return withConfigLock(shop, () =>
      refreshTargeting({ client, db: deps.db, shop, createSync: deps.createSync, logger: deps.logger, now: deps.now }),
    );
  };
  return {
    schedule(shop) {
      if (timers.has(shop)) return;
      const timer = setTimeout(() => {
        timers.delete(shop);
        runNow(shop).catch((error: unknown) => logger.error(`targeting refresh ${shop}: ${errorText(error)}`));
      }, deps.delayMs ?? TARGETING_REFRESH_DEBOUNCE_MS);
      (timer as { unref?: () => void }).unref?.();
      timers.set(shop, timer);
      if (timers.size > 10_000) {
        const [oldest, pending] = timers.entries().next().value as [string, ReturnType<typeof setTimeout>];
        clearTimeout(pending);
        timers.delete(oldest);
      }
    },
    scheduled: (shop) => timers.has(shop),
    runNow,
    cancelAll() {
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
    },
  };
}

// --- The app's refresher (routes) --------------------------------------------------------------

let appRefresher: TargetingRefresher | null = null;

/**
 * The process-wide refresher of the running app: the app DB (the first
 * caller's) and the shop's offline Admin API session (`unauthenticated.admin`,
 * loaded on first use so importing this module never loads the Shopify app).
 */
export function appTargetingRefresher(db: PrismaClient): TargetingRefresher {
  if (!appRefresher) {
    appRefresher = createTargetingRefresher({
      db,
      clientFor: async (shop) => {
        try {
          const { unauthenticated } = await import("../../shopify.server");
          const { admin } = await unauthenticated.admin(shop);
          return adminClientFromApp(admin as unknown as AppAdminGraphql);
        } catch {
          return null;
        }
      },
      logger: {
        info: (message) => console.info(`[won-targeting] ${message}`),
        warn: (message) => console.warn(`[won-targeting] ${message}`),
        error: (message) => console.error(`[won-targeting] ${message}`),
      },
    });
  }
  return appRefresher;
}

/** Is a webhook-driven refresh of `shop` waiting in this process? (false when none was ever created) */
export function targetingRefreshScheduled(shop: string): boolean {
  return appRefresher?.scheduled(shop) ?? false;
}
