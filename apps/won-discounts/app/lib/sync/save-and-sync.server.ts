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
//       Options: `expectedVersion` (F12: save only on top of the config the
//       caller read — `base_changed` otherwise), `grantedScopes` (markets are
//       read only with read_markets), `productWrites:
//       "background"` + `deadlineMs` (item 7: the request waits for the save,
//       the nodes and the shop config; products that only gain rules are
//       written in the background, and a sync still running at the deadline
//       goes on in the background — the result says `running`).
//   resyncShop({ client, db, shop })      "Synchronizovat znovu" (no save)
//   resyncIfPending({ client, db, shop }) the retry trigger (M3): the Přehled
//       loader calls it on every load; it resyncs when the last run failed or
//       left pending work (SyncRun.pending; at most once per
//       RESYNC_MIN_INTERVAL_MS), when a saved config was never synced, when
//       the stored config is not the one the last applying run synced (audit
//       P2-2: a crash between save and SyncRun), when the shop's time zone
//       differs from the one the last sync used, or when Shopify's market
//       countries changed (item 12).
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
import { withinDeadline } from "../integration/deadline";
import { loadShopMarkets, targetsMarkets, withShopMarkets, type ShopMarket } from "./markets";
import { appliedPlanMismatch, appliedRun, storedConfigNotApplied } from "./runs";
import { storefrontOutcome } from "./storefront";
import { loadShopSyncFacts, recordMarketsChecked } from "./sync-state.server";
import { shopLocalDateTime, type Sync } from "./sync.server";
import { errorText, Transport } from "./transport";
import type { ConfigView, PendingWork, SyncLogger, SyncResult, SyncStep } from "./types";
import { consoleSyncLogger, createProductionSync } from "./wiring.server";

/** How often the Přehled compares the Shopify markets with the config (item 12; audit 6 Oct 2026, T1: for every shop). */
export const MARKETS_CHECK_INTERVAL_MS = 60 * 60_000;

/** False only when the granted scopes are KNOWN and lack read_markets (required since the audit of 6 Oct 2026; an older install may not have granted it yet). */
export function canReadMarkets(grantedScopes: string | null | undefined): boolean {
  if (grantedScopes === null || grantedScopes === undefined) return true;
  return grantedScopes
    .split(",")
    .map((scope) => scope.trim())
    .includes("read_markets");
}

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
  /**
   * The session's granted scopes (comma list). Markets are read only with
   * read_markets (optional scope, item 9). Absent = unknown → try.
   */
  grantedScopes?: string | null;
}

export interface SaveAndSyncArgs extends Common {
  input: unknown;
  /** Codes of the shop's native discounts, when the caller knows them (hash-collision guard). */
  otherCodes?: readonly string[];
  /** Overwrite a stored row that cannot be read — only after the merchant confirmed (I3). */
  replaceUnreadable?: boolean;
  /** Save only on top of this stored version (LoadedConfig.version, F12); `base_changed` otherwise. */
  expectedVersion?: string | null;
  /** "background": products that only gain rules are written after the request (item 7). */
  productWrites?: "inline" | "background";
  /** Wait at most this long for the sync; it goes on in the background after (item 7). Absent = wait. */
  deadlineMs?: number;
  /** The shop's Shopify markets when the caller has just read them (a resync that found them changed): merged instead of reading again. */
  shopMarkets?: readonly ShopMarket[];
}

export interface SaveAndSyncResult {
  save: SaveConfigResult;
  /** Null when the save was refused (nothing was written anywhere), or when the sync is still `running`. */
  sync: SyncResult | null;
  /** Non-fatal notes (e.g. Shopify markets could not be read; saved countries were kept). */
  warnings: string[];
  /** The save went through and its sync is still running in the background (the deadline passed). */
  running?: true;
}

interface ShopContext {
  shopLocalNow?: string;
  markets?: ShopMarket[];
  warnings: string[];
}

/**
 * The config needs the Shopify markets read at save time: it targets one (the
 * countries are measured with the save, I2) or it knows no market yet (T1: the
 * first save brings them in; later changes come from the Přehled's check).
 */
function needsShopMarkets(config: ConfigView): boolean {
  return targetsMarkets(config) || config.markets.length === 0;
}

/** Time zone always; markets when the config needs them (read_markets). */
async function readShopContext(args: Common, config: ConfigView, opts: { markets?: "always" | "given" } = {}): Promise<ShopContext> {
  const transport = new Transport(args.client, undefined, undefined, args.logger ?? consoleSyncLogger);
  const out: ShopContext = { warnings: [] };
  try {
    const data: { shop: { ianaTimezone: string } } = await transport.call("shop");
    out.shopLocalNow = shopLocalDateTime((args.now ?? (() => new Date()))(), data.shop.ianaTimezone);
  } catch (error) {
    if (error instanceof Response) throw error;
    out.warnings.push(`could not read the shop's time zone (${errorText(error)}); campaign windows were judged conservatively`);
  }
  if (opts.markets === "given") return out;
  if (!canReadMarkets(args.grantedScopes)) {
    if (targetsMarkets(config)) {
      out.warnings.push("Shopify markets are not read: the read_markets scope is not granted; market-targeted rules keep the countries saved in the config");
    }
  } else if (opts.markets === "always" || needsShopMarkets(config)) {
    try {
      out.markets = await loadShopMarkets(transport);
    } catch (error) {
      if (error instanceof Response) throw error;
      // A config that only lacks its market list saves without it; the Přehled's check brings the markets in later.
      if (targetsMarkets(config)) {
        out.warnings.push(
          `could not read Shopify markets (${errorText(error)}); market-targeted rules keep the countries saved in the config (needs the read_markets scope)`,
        );
      }
    }
  }
  return out;
}

export async function saveAndSync(args: SaveAndSyncArgs): Promise<SaveAndSyncResult> {
  const { client, db, shop, input } = args;
  const context = await readShopContext(args, sanitizeConfig(input).config, args.shopMarkets ? { markets: "given" } : {});
  const save = await saveConfig(db, shop, input, {
    otherCodes: args.otherCodes,
    shopMarkets: args.shopMarkets ?? context.markets,
    shopLocalNow: context.shopLocalNow,
    replaceUnreadable: args.replaceUnreadable,
    ...(args.expectedVersion !== undefined ? { expectedVersion: args.expectedVersion } : {}),
  });
  if (!save.ok) return { save, sync: null, warnings: context.warnings };
  const sync = (args.createSync ?? createProductionSync)(client, db);
  const running = sync.syncShop(shop, save.config, { configVersionId: save.versionId, productWrites: args.productWrites });
  if (args.deadlineMs === undefined) return { save, sync: await running, warnings: context.warnings };
  const outcome = await withinDeadline(running, args.deadlineMs);
  if (!outcome.done) {
    // The save is in; the sync finishes in the background and records its SyncRun.
    running.catch((error: unknown) => (args.logger ?? consoleSyncLogger).error(`sync ${shop}: background sync failed: ${errorText(error)}`));
    return { save, sync: null, warnings: context.warnings, running: true };
  }
  if ("error" in outcome) throw outcome.error;
  return { save, sync: outcome.value, warnings: context.warnings };
}

/**
 * The ConfigVersion the stored config was saved as: saveConfig writes the
 * ShopConfig row and its ConfigVersion in one transaction, so it is the
 * newest version of the shop (null when history was pruned).
 */
async function storedVersionId(db: PrismaClient, shop: string): Promise<string | null> {
  const version = await db.configVersion.findFirst({
    where: { shop },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: { id: true },
  });
  return version?.id ?? null;
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

/**
 * Sync the stored config again (no save), refreshing the markets through the save path when Shopify's changed.
 * `markets: "always"` reads them even for a config that neither targets a market nor lacks its list (the Přehled's check found a change).
 */
export async function resyncShop(args: Common & { productWrites?: "inline" | "background"; markets?: "always" }): Promise<ResyncResult> {
  return resyncStored(args, 1);
}

async function resyncStored(args: Common & { productWrites?: "inline" | "background"; markets?: "always" }, retries: number): Promise<ResyncResult> {
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
  if (args.markets === "always" || needsShopMarkets(loaded.config)) {
    const context = await readShopContext(args, loaded.config, { markets: args.markets });
    warnings.push(...context.warnings);
    if (context.markets && withShopMarkets(loaded.config, context.markets).changed) {
      // F12: re-saved only on top of the config just read; another writer in between → read again.
      const saved = await saveAndSync({ ...args, input: loaded.config, expectedVersion: loaded.version, shopMarkets: context.markets });
      if (saved.sync) return { ...saved.sync, warnings: [...warnings, "Shopify markets changed; the config was saved again with them"] };
      if (!saved.save.ok && saved.save.reason === "base_changed" && retries > 0) return resyncStored(args, retries - 1);
      warnings.push(
        `Shopify markets changed but the updated config could not be saved (${saved.save.ok ? "" : saved.save.reason}); synced with the saved markets`,
      );
    }
  }
  const configVersionId = await storedVersionId(db, shop);
  return { ...(await sync.syncShop(shop, loaded.config, { configVersionId, productWrites: args.productWrites })), warnings };
}

/**
 * The product targeting only ("Obnovit cílení", the webhook-driven refresh,
 * the Přehled's 24 h refresh — item 2): the stored config's product refs are
 * re-read from Shopify (collection members) and rewritten; the shop config is
 * not touched. When the stored config is not the one Shopify runs, a full
 * resync is done instead (it writes the product refs too, in the right order).
 */
export async function refreshTargeting(args: Common & { productWrites?: "inline" | "background" }): Promise<ResyncResult> {
  const { client, db, shop } = args;
  const sync = (args.createSync ?? createProductionSync)(client, db);
  const loaded = await loadConfig(db, shop);
  if (!loaded.exists) return refusal("no_config", "nothing has been saved yet, so there is nothing to sync");
  if (loaded.unreadable) {
    return refusal("unreadable_config", "the saved configuration cannot be read; it is not synced (that would remove every Won discount)");
  }
  if (loaded.readOnly) {
    return refusal("newer_schema", "the saved configuration was written by a newer app version; this instance does not sync it");
  }
  // Another config, or another plan, than the live one: the product refs follow a full resync (right order, M1).
  if (await storedConfigNotApplied(db, shop, { plan: await sync.plan(shop) })) return resyncShop(args);
  const configVersionId = await storedVersionId(db, shop);
  return { ...(await sync.refreshProducts(shop, loaded.config, { configVersionId, productWrites: args.productWrites })), warnings: [] };
}

export interface SyncStatus {
  runId: string;
  ok: boolean;
  startedAt: Date;
  finishedAt: Date | null;
  errorCount: number;
  steps: SyncStep[];
  pending: PendingWork[];
  /** The ConfigVersion the run synced (null = unknown). */
  configVersionId: string | null;
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
    configVersionId: run.configVersionId ?? null,
  };
}

/** Why resyncIfPending resynced. */
export type ResyncReason = "never_synced" | "retry" | "not_applied" | "plan" | "storefront" | "timezone" | "markets";

export type ResyncIfPendingResult =
  | { resynced: false; reason: "up_to_date" | "too_soon" | "nothing_saved" }
  | { resynced: true; why: ResyncReason; result: ResyncResult };

export interface ResyncIfPendingArgs extends Common {
  minIntervalMs?: number;
  /** The shop's IANA zone as the page just read it: a different zone than the last sync used → resync (item 12). */
  timezone?: string | null;
  /** Compare the Shopify markets with the config (at most every MARKETS_CHECK_INTERVAL_MS; needs read_markets). */
  checkMarkets?: boolean;
  productWrites?: "inline" | "background";
}

/**
 * The retry trigger (M3): resync when
 *   - a saved config was never synced;
 *   - the last run failed or left pending work (a held campaign switch, stale
 *     product refs, a code job still running…) — at most once per `minIntervalMs`;
 *   - the stored config is not the one the last APPLYING run synced (a crash
 *     between the save and its SyncRun, audit P2-2);
 *   - the live config was built for another plan than the shop has now
 *     (BILL-1, F2 re-review I-2: Pro may still run for a Free shop);
 *   - the run that applied the live config did not leave the storefront
 *     config in place (MVP 3): at once when it predates the storefront
 *     config (no storefront step), at most once per `minIntervalMs` when its
 *     write failed (a later run — a products-only refresh — may be ok);
 *   - the shop's time zone changed since the last sync (rule days move);
 *   - the shop's Shopify markets changed: a market was added, switched on or
 *     off, changed its currency or its countries (T1). A shop that has saved
 *     nothing yet gets its first config here, the defaults with its markets,
 *     so the very first form already asks for every market currency.
 */
export async function resyncIfPending(args: ResyncIfPendingArgs): Promise<ResyncIfPendingResult> {
  const now = (args.now ?? (() => new Date()))();
  const resync = async (why: ResyncReason): Promise<ResyncIfPendingResult> => ({
    resynced: true,
    why,
    result: await resyncShop(why === "markets" ? { ...args, markets: "always" } : args),
  });
  const status = await loadSyncStatus(args.db, args.shop);
  if (!status) {
    const loaded = await loadConfig(args.db, args.shop);
    if (!loaded.exists) {
      if (args.checkMarkets && canReadMarkets(args.grantedScopes)) {
        const first = await saveFirstMarkets(args, loaded, now);
        if (first) return { resynced: true, why: "markets", result: first };
      }
      return { resynced: false, reason: "nothing_saved" };
    }
    return resync("never_synced");
  }
  if (!status.ok || status.pending.length > 0) {
    const last = (status.finishedAt ?? status.startedAt).getTime();
    if (now.getTime() - last < (args.minIntervalMs ?? RESYNC_MIN_INTERVAL_MS)) return { resynced: false, reason: "too_soon" };
    return resync("retry");
  }
  if (await storedConfigNotApplied(args.db, args.shop)) return resync("not_applied");
  // I-2: the live config was built for another plan (written before the sync gated for plans, or a downgrade / upgrade since).
  const sync = (args.createSync ?? createProductionSync)(args.client, args.db);
  if (await appliedPlanMismatch(args.db, args.shop, await sync.plan(args.shop))) return resync("plan");
  // MVP 3: the live config was applied by a run that did not leave the storefront config in place. A run from before
  // the storefront config existed: resynced once. A failed write: throttled like a retry (fix round 1) — a later ok run
  // (a products-only refresh) must not turn every Přehled load into a full resync while the write keeps failing.
  const applied = await appliedRun(args.db, args.shop);
  const storefront = applied ? storefrontOutcome(applied.steps) : "written";
  if (storefront === "none") return resync("storefront");
  if (storefront === "failed") {
    const last = (status.finishedAt ?? status.startedAt).getTime();
    if (now.getTime() - last < (args.minIntervalMs ?? RESYNC_MIN_INTERVAL_MS)) return { resynced: false, reason: "too_soon" };
    return resync("storefront");
  }
  const facts = await loadShopSyncFacts(args.db, args.shop);
  if (args.timezone && facts.timezone && args.timezone !== facts.timezone) return resync("timezone");
  if (args.checkMarkets && canReadMarkets(args.grantedScopes)) {
    const due = !facts.marketsCheckedAt || now.getTime() - facts.marketsCheckedAt.getTime() >= MARKETS_CHECK_INTERVAL_MS;
    if (due && (await shopMarketsChanged(args, now))) return resync("markets");
  }
  return { resynced: false, reason: "up_to_date" };
}

/**
 * A shop that has saved nothing yet (T1): at most once per MARKETS_CHECK_INTERVAL_MS its
 * Shopify markets are read and, when there are any, the default config is saved with them
 * (and synced like any first save). Null = nothing was saved (no markets, unreadable, raced).
 */
async function saveFirstMarkets(
  args: ResyncIfPendingArgs,
  loaded: { config: ConfigView; version: string | null; unreadable: boolean; readOnly: boolean },
  now: Date,
): Promise<ResyncResult | null> {
  if (loaded.unreadable || loaded.readOnly) return null;
  const facts = await loadShopSyncFacts(args.db, args.shop);
  if (facts.marketsCheckedAt && now.getTime() - facts.marketsCheckedAt.getTime() < MARKETS_CHECK_INTERVAL_MS) return null;
  let markets: ShopMarket[];
  try {
    markets = await loadShopMarkets(new Transport(args.client, undefined, undefined, args.logger ?? consoleSyncLogger));
  } catch (error) {
    if (error instanceof Response) throw error;
    return null;
  }
  try {
    await recordMarketsChecked(args.db, args.shop, now);
  } catch {
    // bookkeeping only
  }
  const merged = withShopMarkets(loaded.config, markets);
  if (merged.added.length === 0) return null;
  const saved = await saveAndSync({ ...args, input: merged.config, expectedVersion: loaded.version, shopMarkets: markets });
  return saved.sync ? { ...saved.sync, warnings: saved.warnings } : null;
}

/** The shop's Shopify markets differ from the stored config's (handles, currency, status, countries). */
async function shopMarketsChanged(args: Common, now: Date): Promise<boolean> {
  const loaded = await loadConfig(args.db, args.shop);
  if (!loaded.exists || loaded.unreadable || loaded.readOnly) return false;
  let markets: ShopMarket[];
  try {
    markets = await loadShopMarkets(new Transport(args.client, undefined, undefined, args.logger ?? consoleSyncLogger));
  } catch (error) {
    if (error instanceof Response) throw error;
    return false;
  }
  try {
    await recordMarketsChecked(args.db, args.shop, now);
  } catch {
    // bookkeeping only
  }
  return withShopMarkets(loaded.config, markets).changed;
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
  options: FromAdminOptions & { otherCodes?: readonly string[]; replaceUnreadable?: boolean; expectedVersion?: string | null } = {},
): Promise<SaveAndSyncResult> {
  return saveAndSync({
    client: adminClientFromApp(admin, shop),
    db: await appDb(options),
    shop,
    input,
    otherCodes: options.otherCodes,
    replaceUnreadable: options.replaceUnreadable,
    ...(options.expectedVersion !== undefined ? { expectedVersion: options.expectedVersion } : {}),
    createSync: options.createSync,
  });
}

export async function resyncShopFromAdmin(admin: AppAdminGraphql, shop: string, options: FromAdminOptions = {}): Promise<ResyncResult> {
  return resyncShop({ client: adminClientFromApp(admin, shop), db: await appDb(options), shop, createSync: options.createSync });
}

export async function resyncIfPendingFromAdmin(
  admin: AppAdminGraphql,
  shop: string,
  options: FromAdminOptions = {},
): Promise<ResyncIfPendingResult> {
  return resyncIfPending({ client: adminClientFromApp(admin, shop), db: await appDb(options), shop, createSync: options.createSync });
}
