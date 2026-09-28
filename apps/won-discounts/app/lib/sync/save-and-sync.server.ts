// Admin entry points of the sync layer. Every Shopify write goes through
// app/lib/sync (spec §9 "Všechny zápisy do Shopify jdou přes sync vrstvu").
//
// CANONICAL API (T4/T5 call these; `client` = any AdminClient):
//   saveAndSync({ client, db, shop, input, otherCodes? })
//       save the config (sanitize, guards, budget, history) and, only when the
//       save succeeded, write it into Shopify. The shop's time zone and — when
//       the config targets a market — its Shopify market countries are read
//       FIRST and handed to the save (I2): the budget is measured on exactly
//       the payload the sync will ship.
//   resyncShop({ client, db, shop })      "Synchronizovat znovu" (no save)
//   resyncIfPending({ client, db, shop }) the retry trigger (M3): the Přehled
//       loader calls it on every load; it resyncs only when the last run
//       failed or left pending work (SyncRun.pending), at most once per
//       RESYNC_MIN_INTERVAL_MS, or when a saved config was never synced.
//   loadSyncStatus(db, shop)              the latest SyncRun for the Přehled.
// Thin route wrappers take the embedded admin (`authenticate.admin(request).admin`):
//   saveAndSyncFromAdmin(admin, shop, input), resyncShopFromAdmin(admin, shop),
//   resyncIfPendingFromAdmin(admin, shop).
//
// A stored row that is missing, unreadable (I3) or from a newer schema is never
// synced: resync would otherwise turn a read error into deleting every Won
// discount. saveConfig refuses to overwrite an unreadable row unless
// `replaceUnreadable` (the merchant confirmed).

import { sanitizeConfig } from "@won/core/discounts/config";

import type { PrismaClient } from "../../generated/prisma/client";
import { adminClientFromApp, type AdminClient, type AppAdminGraphql } from "../admin-client.server";
import { loadConfig, saveConfig, type SaveConfigResult } from "../config.server";
import { loadShopMarkets, targetsMarkets, withMarketCountries, type ShopMarket } from "./markets";
import { shopLocalDateTime, type Sync } from "./sync.server";
import { errorText, Transport } from "./transport";
import type { ConfigView, PendingWork, SyncLogger, SyncResult, SyncStep } from "./types";
import { consoleSyncLogger, createProductionSync } from "./wiring.server";

/** resyncIfPending never retries more often than this per shop. */
export const RESYNC_MIN_INTERVAL_MS = 5 * 60_000;

interface Common {
  client: AdminClient;
  db: PrismaClient;
  shop: string;
  /** Default: the production sync (real engine builders). */
  createSync?: (client: AdminClient, db: PrismaClient) => Sync;
  now?: () => Date;
  logger?: SyncLogger;
}

export interface SaveAndSyncArgs extends Common {
  input: unknown;
  /** Codes of the shop's native discounts, when the caller knows them (hash-collision guard). */
  otherCodes?: readonly string[];
  /** Overwrite a stored row that cannot be read — only after the merchant confirmed (I3). */
  replaceUnreadable?: boolean;
}

export interface SaveAndSyncResult {
  save: SaveConfigResult;
  /** Null when the save was refused (nothing was written anywhere). */
  sync: SyncResult | null;
  /** Non-fatal notes (e.g. Shopify markets could not be read; saved countries were kept). */
  warnings: string[];
}

interface ShopContext {
  shopLocalNow?: string;
  markets?: ShopMarket[];
  warnings: string[];
}

/** Time zone always; markets only when the config targets one (read_markets). */
async function readShopContext(args: Common, config: ConfigView): Promise<ShopContext> {
  const transport = new Transport(args.client, undefined, undefined, args.logger ?? consoleSyncLogger);
  const out: ShopContext = { warnings: [] };
  try {
    const data: { shop: { ianaTimezone: string } } = await transport.call("shop");
    out.shopLocalNow = shopLocalDateTime((args.now ?? (() => new Date()))(), data.shop.ianaTimezone);
  } catch (error) {
    if (error instanceof Response) throw error;
    out.warnings.push(`could not read the shop's time zone (${errorText(error)}); campaign windows were judged conservatively`);
  }
  if (targetsMarkets(config)) {
    try {
      out.markets = await loadShopMarkets(transport);
    } catch (error) {
      if (error instanceof Response) throw error;
      out.warnings.push(
        `could not read Shopify markets (${errorText(error)}); market-targeted rules keep the countries saved in the config (needs the read_markets scope)`,
      );
    }
  }
  return out;
}

export async function saveAndSync(args: SaveAndSyncArgs): Promise<SaveAndSyncResult> {
  const { client, db, shop, input } = args;
  const context = await readShopContext(args, sanitizeConfig(input).config);
  const save = await saveConfig(db, shop, input, {
    otherCodes: args.otherCodes,
    shopMarkets: context.markets,
    shopLocalNow: context.shopLocalNow,
    replaceUnreadable: args.replaceUnreadable,
  });
  if (!save.ok) return { save, sync: null, warnings: context.warnings };
  const sync = (args.createSync ?? createProductionSync)(client, db);
  return { save, sync: await sync.syncShop(shop, save.config), warnings: context.warnings };
}

export type ResyncRefusal = {
  ok: false;
  reason: "no_config" | "unreadable_config" | "newer_schema";
  steps: SyncStep[];
  errors: string[];
  pending: PendingWork[];
  runId: null;
};

export type ResyncResult = (SyncResult & { warnings: string[] }) | ResyncRefusal;

function refusal(reason: ResyncRefusal["reason"], detail: string): ResyncRefusal {
  return { ok: false, reason, steps: [{ step: "config.load", ok: false, detail }], errors: [detail], pending: [], runId: null };
}

/** Sync the stored config again (no save), refreshing market countries through the save path when Shopify's changed. */
export async function resyncShop(args: Common): Promise<ResyncResult> {
  const { client, db, shop } = args;
  const loaded = await loadConfig(db, shop);
  if (!loaded.exists) return refusal("no_config", "nothing has been saved yet, so there is nothing to sync");
  if (loaded.unreadable) {
    return refusal("unreadable_config", "the saved configuration cannot be read; it is not synced (that would remove every Won discount)");
  }
  if (loaded.readOnly) {
    return refusal("newer_schema", "the saved configuration was written by a newer app version; this instance does not sync it");
  }
  const sync = (args.createSync ?? createProductionSync)(client, db);
  const warnings: string[] = [];
  if (targetsMarkets(loaded.config)) {
    const context = await readShopContext(args, loaded.config);
    warnings.push(...context.warnings);
    if (context.markets && withMarketCountries(loaded.config, context.markets).changed) {
      const saved = await saveAndSync({ ...args, input: loaded.config });
      if (saved.sync) return { ...saved.sync, warnings: [...warnings, "Shopify market countries changed; the config was saved again with them"] };
      warnings.push(
        `Shopify market countries changed but the updated config could not be saved (${saved.save.ok ? "" : saved.save.reason}); synced with the saved countries`,
      );
    }
  }
  return { ...(await sync.syncShop(shop, loaded.config)), warnings };
}

export interface SyncStatus {
  runId: string;
  ok: boolean;
  startedAt: Date;
  finishedAt: Date | null;
  errorCount: number;
  steps: SyncStep[];
  pending: PendingWork[];
}

function parseJsonArray<T>(text: string | null): T[] {
  if (!text) return [];
  try {
    const parsed = JSON.parse(text) as unknown;
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

/** The latest sync run of `shop` (null = never synced). Unparseable JSON reads as []. */
export async function loadSyncStatus(db: PrismaClient, shop: string): Promise<SyncStatus | null> {
  const run = await db.syncRun.findFirst({ where: { shop }, orderBy: [{ startedAt: "desc" }, { id: "desc" }] });
  if (!run) return null;
  return {
    runId: run.id,
    ok: run.ok,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    errorCount: run.errorCount,
    steps: parseJsonArray<SyncStep>(run.steps),
    pending: parseJsonArray<PendingWork>(run.pending),
  };
}

export type ResyncIfPendingResult =
  | { resynced: false; reason: "up_to_date" | "too_soon" | "nothing_saved" }
  | { resynced: true; result: ResyncResult };

/**
 * The retry trigger (M3): resync when the last run failed or left pending work
 * (a held campaign switch, stale product refs, a code job still running…) or a
 * saved config was never synced — at most once per `minIntervalMs`.
 */
export async function resyncIfPending(args: Common & { minIntervalMs?: number }): Promise<ResyncIfPendingResult> {
  const now = (args.now ?? (() => new Date()))();
  const status = await loadSyncStatus(args.db, args.shop);
  if (!status) {
    const loaded = await loadConfig(args.db, args.shop);
    if (!loaded.exists) return { resynced: false, reason: "nothing_saved" };
    return { resynced: true, result: await resyncShop(args) };
  }
  if (status.ok && status.pending.length === 0) return { resynced: false, reason: "up_to_date" };
  const last = (status.finishedAt ?? status.startedAt).getTime();
  if (now.getTime() - last < (args.minIntervalMs ?? RESYNC_MIN_INTERVAL_MS)) return { resynced: false, reason: "too_soon" };
  return { resynced: true, result: await resyncShop(args) };
}

// --- Thin wrappers for routes (the embedded admin object) -----------------------

interface FromAdminOptions {
  /** Default: the app's Prisma client (app/db.server). */
  db?: PrismaClient;
  createSync?: Common["createSync"];
}

async function appDb(options: FromAdminOptions): Promise<PrismaClient> {
  return options.db ?? (await import("../../db.server")).default;
}

export async function saveAndSyncFromAdmin(
  admin: AppAdminGraphql,
  shop: string,
  input: unknown,
  options: FromAdminOptions & { otherCodes?: readonly string[]; replaceUnreadable?: boolean } = {},
): Promise<SaveAndSyncResult> {
  return saveAndSync({
    client: adminClientFromApp(admin),
    db: await appDb(options),
    shop,
    input,
    otherCodes: options.otherCodes,
    replaceUnreadable: options.replaceUnreadable,
    createSync: options.createSync,
  });
}

export async function resyncShopFromAdmin(admin: AppAdminGraphql, shop: string, options: FromAdminOptions = {}): Promise<ResyncResult> {
  return resyncShop({ client: adminClientFromApp(admin), db: await appDb(options), shop, createSync: options.createSync });
}

export async function resyncIfPendingFromAdmin(
  admin: AppAdminGraphql,
  shop: string,
  options: FromAdminOptions = {},
): Promise<ResyncIfPendingResult> {
  return resyncIfPending({ client: adminClientFromApp(admin), db: await appDb(options), shop, createSync: options.createSync });
}
