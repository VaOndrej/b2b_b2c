// The admin's one config-write path (moved out of ui-actions.server.ts so the
// margin screen, MVP 2, saves exactly like a rule does): the shop's config
// lock with a bounded wait (`busy`), saveAndSync on top of the version the
// change builds on (F12), the request waiting at most ACTION_SYNC_DEADLINE_MS
// with products that only gain rules written in the background (item 7), and
// the result banner built from what reached Shopify.

import type { WonDiscountsConfig } from "@won/core/discounts/config";

import type { UiResult } from "../../components/model/types";
import type { Locale } from "../../i18n";
import { saveAndSync, type SaveAndSyncResult } from "../sync/save-and-sync.server";
import type { ShopCtx } from "./context.server";
import { CONFIG_LOCK_WAIT_MS, ConfigLockBusy, withConfigLock } from "./lock.server";
import { cachedNativeCodes, forgetDetection } from "./native.server";
import { wordIssues } from "./issue-copy";
import { ruleNames, syncOutcome } from "./sync-copy";
import { refreshMarginImpact } from "./margin-impact.server";
import { ACTION_SYNC_DEADLINE_MS, ctxPlan } from "./sync-status.server";


/** Save attempts on top of another instance's write (F12): the first, and one retry. */
export const SAVE_ATTEMPTS = 2;

export interface WriteOptions {
  replaceUnreadable: boolean;
  /** The stored version the change builds on (F12). */
  expectedVersion: string | null;
  /** Native codes for the hash check (default: the cached detection). */
  otherCodes?: readonly string[];
  warnings?: string[];
}

/**
 * Save `next` and write it into Shopify (canonical saveAndSync) on top of
 * `expectedVersion` only. The request waits at most ACTION_SYNC_DEADLINE_MS;
 * products that only gain rules are written in the background (item 7).
 */
export async function writeAndSync(ctx: ShopCtx, next: WonDiscountsConfig, opts: WriteOptions): Promise<SaveAndSyncResult> {
  const result = await saveAndSync({
    client: ctx.client,
    db: ctx.db,
    shop: ctx.shop,
    input: next,
    otherCodes: opts.otherCodes ?? cachedNativeCodes(ctx.shop),
    replaceUnreadable: opts.replaceUnreadable,
    expectedVersion: opts.expectedVersion,
    grantedScopes: ctx.scopes,
    productWrites: "background",
    deadlineMs: ACTION_SYNC_DEADLINE_MS,
    createSync: ctx.createSync,
    now: ctx.now,
    logger: ctx.logger,
  });
  // A rule change can start or end a conflict with a native discount.
  if (result.save.ok) forgetDetection(ctx.shop);
  // The margin impact overview / editor note follow the saved config: recomputed in the background (P3-5).
  if (result.save.ok) void refreshMarginImpact(ctx.shop, { db: ctx.db, client: ctx.client, plan: () => ctxPlan(ctx) });
  return opts.warnings && opts.warnings.length > 0 ? { ...result, warnings: [...opts.warnings, ...result.warnings] } : result;
}

/**
 * The success result of a save: what the sanitizer adjusted under `prefix`,
 * worded in the admin language (`locale`; integration/issue-copy.ts: from the
 * issue codes + params, never the core's English messages — an issue without
 * its own sentence is logged), + what reached Shopify (or that it still runs).
 */
export function savedResult(
  res: SaveAndSyncResult & { save: { ok: true } },
  message: "saved" | "deleted",
  prefix: string | null,
  locale: Locale,
): UiResult {
  const fixes =
    prefix === null
      ? []
      : wordIssues(
          res.save.issues.filter((i) => i.path === prefix || i.path.startsWith(`${prefix}.`)),
          locale,
        );
  const syncing = res.running ? { syncing: {} } : res.sync?.background ? { syncing: { products: res.sync.background.products } } : {};
  return {
    ok: true,
    message,
    ...(fixes.length > 0 ? { fixes } : {}),
    ...(res.sync ? { sync: syncOutcome(res.sync, res.warnings, ruleNames(res.save.config)) } : {}),
    ...syncing,
  };
}

/**
 * An admin write under the shop's config lock, waiting at most
 * CONFIG_LOCK_WAIT_MS for it (F2 re-review I-1): another writer still at work
 * → `busy` ("Nastavení se právě zapisuje, zkus to za chvíli"), nothing ran.
 */
export async function lockedWrite<T>(ctx: Pick<ShopCtx, "shop" | "lockWaitMs">, busy: T, run: () => Promise<T>): Promise<T> {
  try {
    return await withConfigLock(ctx.shop, run, { waitMs: ctx.lockWaitMs ?? CONFIG_LOCK_WAIT_MS });
  } catch (error) {
    if (error instanceof ConfigLockBusy) return busy;
    throw error;
  }
}
