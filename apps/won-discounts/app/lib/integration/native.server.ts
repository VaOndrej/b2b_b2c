// Native Shopify discounts in the admin (integration of app/lib/native):
//   - detection for Přehled / onboarding, cached per shop + language for
//     NATIVE_DETECTION_TTL_MS and bounded by a deadline (REL-1: a slow Shopify
//     shows "still loading", the detection finishes into the cache);
//   - the view: movable discounts with what a move LOSES and what to keep in
//     mind (planMove sentences, shown in the dialog before the click, §14c),
//     the ones that stay in Shopify with the detector's reason, conflicts with
//     Won rules, and every backup that has an undo (NativeDiscountBackup);
//   - move / undo through the CANONICAL saveAndSync (app/lib/sync) behind the
//     native layer's SaveAndSync contract (createSaveAndSync below), with the
//     shop's native codes passed for the code-hash collision check and the
//     config version the change was built on (F12: a write by another app
//     instance in between is a conflict the move retries, never lost);
//   - "Přesunout vše" stops after the first limit refusal (F1 circuit breaker);
//   - the Přehled load settles move / undo claims a dead process left (F7).

import { describeRuleParts } from "@won/core/discounts/describe";
import type { WonDiscountsConfig } from "@won/core/discounts/config";

import type { PrismaClient } from "../../generated/prisma/client";
import { t, translator, type Locale } from "../../i18n";
import type { AdminClient } from "../admin-client.server";
import { loadConfig, withExpectedConfigVersion } from "../config.server";
import { detectNativeDiscounts, NativeDetectError } from "../native/detect.server";
import { LIMIT_REFUSALS, moveErrorText, undoCostTexts, warningText } from "../native/copy";
import { planMove, type RemainingNative, stackingNotes, stackingWarnings } from "../native/map.server";
import { classOfTarget } from "../native/normalize";
import {
  CLAIM_STALE_MS,
  moveNative as moveNativeDiscount,
  resolveStaleClaims,
  undoMove as undoNativeMove,
  type MoveResult,
} from "../native/move.server";
import { nativeFromSnapshot, parseSnapshot } from "../native/restore.server";
import {
  BACKUP_STATUS,
  type MovedBackupExtras,
  type NativeDetection,
  type NativeDiscountExtras,
  type SaveAndSync,
} from "../native/types";
import { loadShopMarketsWith, targetsMarkets } from "../sync/markets";
import { saveAndSync } from "../sync/save-and-sync.server";
import type { Sync } from "../sync/sync.server";
import { shopLocalDateTime } from "../sync/sync.server";
import type { SyncLogger, SyncStep } from "../sync/types";
import { canonicalJson } from "../sync/util";
import { failureCopy } from "../../components/model/result-copy";
import type {
  MovedDiscountView,
  NativeBlockedReason,
  NativeConflictView,
  NativeDiscountView,
  NativeView,
  UiResult,
} from "../../components/model/types";
import { nowOf, type ShopCtx } from "./context.server";
import { withinDeadline } from "./deadline";
import { CONFIG_LOCK_WAIT_MS, ConfigLockBusy, withConfigLock } from "./lock.server";
import { uiFailureFromSave } from "./results";
import { ruleIdOfKey, ruleNames, shopConfigApplied, stepNodeKey, stepProblem } from "./sync-copy";

export const NATIVE_DETECTION_TTL_MS = 60_000;
/** How long Přehled / onboarding wait for a detection that is not cached. */
export const NATIVE_DETECTION_DEADLINE_MS = 4_000;
/** A move waits this long for the detection that supplies the shop's native codes. */
const MOVE_DETECTION_DEADLINE_MS = 10_000;
/** Backups listed with an undo. */
const MOVED_SHOWN = 50;
/** Backup rows read per page while looking for those (F13: paged, never just the newest few). */
const MOVED_PAGE = MOVED_SHOWN * 4;
/** Pages read at most (a bound on a shop with a very long history). */
const MOVED_MAX_PAGES = 50;

type BackupRow = NonNullable<Awaited<ReturnType<PrismaClient["nativeDiscountBackup"]["findFirst"]>>>;

/** A backup with an undo, as Přehled lists it (the view model plus F4 / F11 facts). */
export type MovedBackupView = MovedDiscountView & MovedBackupExtras;

// --- Detection cache ------------------------------------------------------------------

interface CacheEntry {
  at: number;
  promise: Promise<NativeDetection>;
  value?: NativeDetection;
}

const detections = new Map<string, CacheEntry>();
/** The shop's native codes from its newest finished detection (codes do not depend on the language). */
const codesByShop = new Map<string, { at: number; detection: NativeDetection }>();

const cacheKey = (shop: string, locale: Locale) => `${shop}|${locale}`;

/** Detection for the shop (cached ≤ NATIVE_DETECTION_TTL_MS, one in flight per shop + language). */
export function detectNative(ctx: ShopCtx, config: WonDiscountsConfig, opts: { fresh?: boolean } = {}): Promise<NativeDetection> {
  const key = cacheKey(ctx.shop, ctx.locale);
  const now = Date.now();
  const hit = detections.get(key);
  if (!opts.fresh && hit && now - hit.at < NATIVE_DETECTION_TTL_MS) return hit.promise;
  const promise = (async () => {
    const rows = await ctx.db.wonNode.findMany({ where: { shop: ctx.shop }, select: { discountNodeId: true } });
    return detectNativeDiscounts(ctx.client, {
      config,
      wonNodeIds: rows.map((row) => row.discountNodeId),
      ownAppKey: ctx.apiKey || null,
      locale: ctx.locale,
    });
  })();
  const entry: CacheEntry = { at: now, promise };
  detections.set(key, entry);
  promise.then(
    (value) => {
      entry.value = value;
      codesByShop.set(ctx.shop, { at: entry.at, detection: value });
      if (codesByShop.size > 5000) codesByShop.delete(codesByShop.keys().next().value as string);
    },
    () => {
      if (detections.get(key) === entry) detections.delete(key);
    },
  );
  if (detections.size > 5000) detections.delete(detections.keys().next().value as string);
  return promise;
}

/** Forget the shop's detections (after a move / undo / rule save: the list or the conflicts changed). */
export function forgetDetection(shop: string): void {
  for (const key of [...detections.keys()]) if (key.startsWith(`${shop}|`)) detections.delete(key);
  codesByShop.delete(shop);
}

/** Test hook. */
export function clearDetectionCache(): void {
  detections.clear();
  codesByShop.clear();
}

/** Codes of the shop's native discounts from a fresh finished detection, if one is at hand (no Shopify call). */
export function cachedNativeCodes(shop: string, exceptId?: string): string[] | undefined {
  const hit = codesByShop.get(shop);
  if (!hit || Date.now() - hit.at >= NATIVE_DETECTION_TTL_MS) return undefined;
  return nativeCodes(hit.detection, exceptId);
}

/**
 * The native codes the code-hash collision check (saveConfig `otherCodes`)
 * gets. What that check covers, exactly:
 *   - Won code vs Won code: every code of every rule, always (the config).
 *   - Won code vs a native code: the codes detection returns — every movable
 *     native (Basic / Free shipping) discount's FIRST DETECT_CODES (= 5,
 *     app/lib/native/documents.ts) codes. Codes past the first page, and codes
 *     of BXGY / other apps' discounts (detection reads them for its own
 *     conflict list but does not return them), are not checked. Reading them
 *     all is not cheap: the detection page would request ~10× more points
 *     (10 discounts × codes(first: N)) and exceed Shopify's 1 000-point cap.
 *   - The SAME text on a native and a Won rule is not a hash question: Shopify
 *     refuses a code on two discounts, so the Won node's create fails with
 *     "Code must be unique" and the sync reports it (sync.problem.codeTaken);
 *     detection lists it as a same_code conflict.
 * A missed collision means two DIFFERENT codes share the 8-hex hash (≈ 1 in
 * 4.3 × 10⁹ per pair): the native code would also trigger the Won rule.
 */
export function nativeCodes(detection: NativeDetection, exceptId?: string): string[] {
  return detection.movable.filter((n) => n.id !== exceptId).flatMap((n) => n.codes);
}

// --- View ---------------------------------------------------------------------------------

const BLOCKED: Record<string, NativeBlockedReason> = { bxgy: "bxgy", other_app: "app" };

/**
 * The discounts that may stay in Shopify, with how they combine (F4): every one
 * Won cannot take over AND every movable one (the merchant may keep it, a
 * batch may skip it). Each carries its id, so a batch moving it leaves it out.
 */
export function remainingNatives(detection: NativeDetection): (RemainingNative & { id: string })[] {
  const notMovable = detection.notMovable.flatMap((entry) =>
    entry.stacking ? [{ id: entry.id, title: entry.title, stacking: entry.stacking }] : [],
  );
  const movable = detection.movable.flatMap((native) =>
    native.target ? [{ id: native.id, title: native.title, stacking: { classes: [classOfTarget(native.target)], combinesWith: native.combinesWith } }] : [],
  );
  return [...notMovable, ...movable];
}

/** A movable discount on Přehled with its F4 stacking notes (NativeDiscountExtras). */
export type NativeDiscountViewWithExtras = NativeDiscountView & NativeDiscountExtras;

/** Detection → the discounts and conflicts the admin lists (pure). */
export function nativeViews(
  detection: NativeDetection,
  config: WonDiscountsConfig,
  locale: Locale,
  now: Date,
): { discounts: NativeDiscountViewWithExtras[]; conflicts: NativeConflictView[] } {
  const discounts: NativeDiscountViewWithExtras[] = [];
  const remaining = remainingNatives(detection);
  for (const native of detection.movable) {
    try {
      // Stacking with the others is per other discount (the dialog drops those moved in the same batch).
      const plan = planMove(native, config, { locale, now });
      const stacking = stackingNotes(native, remaining, locale);
      const parts = describeRuleParts(plan.rule, locale, { currency: detection.shop.currencyCode });
      discounts.push({
        id: native.id,
        title: native.title,
        method: native.method,
        ...(native.method === "code" && native.codes[0] ? { code: native.codes[0] } : {}),
        summary: [parts.value, ...parts.minimum].join(" · "),
        movable: true,
        losses: plan.losses,
        warnings: plan.warnings,
        ...(stacking.length > 0 ? { stacking } : {}),
      });
    } catch (error) {
      // planMove's backstop (e.g. an amount it cannot read): stays in Shopify, with its reason.
      discounts.push({
        id: native.id,
        title: native.title,
        method: native.method,
        movable: false,
        blockedReason: "other",
        reason: error instanceof Error ? error.message : String(error),
        losses: [],
      });
    }
  }
  for (const entry of detection.notMovable) {
    discounts.push({
      id: entry.id,
      title: entry.title,
      method: entry.kind.startsWith("code_") ? "code" : "automatic",
      movable: false,
      blockedReason: BLOCKED[entry.reasonCode] ?? "other",
      reason: entry.reason,
      losses: [],
    });
  }
  const conflicts = detection.conflicts.map((c) => ({ nativeTitle: c.nativeTitle, ruleName: c.ruleName, message: c.message }));
  return { discounts, conflicts };
}

/**
 * Backups with an undo, newest first, one per native discount:
 *   moved                         "Vrátit zpět" undoes the move;
 *   failed without the discount   only in the backup, or the Won rule stuck:
 *   back / backed_up / partly     "Vrátit zpět" finishes it (row.error says where it is).
 * A failed move whose discount is back in Shopify in full has nothing to undo.
 * Every row that still holds the only copy of a discount is listed, however
 * many newer rows there are (paged, F13). Each carries what its undo will
 * change (F11), shown before the merchant confirms it.
 */
export async function movedBackups(
  ctx: Pick<ShopCtx, "db" | "shop">,
  timezone: string | null,
  locale: Locale = "cs",
): Promise<MovedBackupView[]> {
  return (await listBackups(ctx, timezone, locale)).views;
}

/** movedBackups, plus whether a listed row is a claim a dead process left (the sweep settles it). */
async function listBackups(
  ctx: Pick<ShopCtx, "db" | "shop">,
  timezone: string | null,
  locale: Locale,
): Promise<{ views: MovedBackupView[]; staleClaims: boolean }> {
  const seen = new Set<string>();
  const out: MovedBackupView[] = [];
  let staleClaims = false;
  let cursor: string | null = null;
  for (let page = 0; page < MOVED_MAX_PAGES && out.length < MOVED_SHOWN; page++) {
    const rows: BackupRow[] = await ctx.db.nativeDiscountBackup.findMany({
      where: { shop: ctx.shop },
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      take: MOVED_PAGE,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    for (const row of rows) {
      if (seen.has(row.nativeId)) continue;
      seen.add(row.nativeId);
      const claimed = row.status === BACKUP_STATUS.moving || row.status === BACKUP_STATUS.undoing;
      if (claimed && Date.now() - row.updatedAt.getTime() >= CLAIM_STALE_MS) staleClaims = true;
      const envelope = parseSnapshot(row.snapshot);
      const restoredAs = envelope?.restoredAs;
      const partly = (restoredAs?.codesMissing ?? 0) > 0;
      if ((row.status === BACKUP_STATUS.restored || row.status === BACKUP_STATUS.failed) && restoredAs && !partly) continue;
      const native = envelope ? nativeFromSnapshot(envelope) : null;
      const view: MovedBackupView = {
        backupId: row.id,
        title: row.title,
        movedAt: shopLocalDateTime(row.updatedAt, timezone ?? "UTC"),
        ...(native
          ? {
              undoCosts: undoCostTexts(
                native,
                locale,
                restoredAs
                  ? { kind: "add_codes", missing: restoredAs.codesMissing ?? 0 }
                  : row.status === BACKUP_STATUS.backedUp || row.status === BACKUP_STATUS.moving || row.status === BACKUP_STATUS.undoing
                    ? { kind: "maybe_live" }
                    : { kind: "recreate" },
              ),
            }
          : {}),
      };
      if (row.status === BACKUP_STATUS.moved) out.push({ ...view, state: "moved" });
      else {
        // failed without its discount back, partly back, backed_up (outcome unknown) or a
        // claim (moving / undoing): the undo re-checks and finishes.
        out.push({ ...view, state: "attention", ...(row.error ? { note: row.error } : {}) });
      }
      if (out.length >= MOVED_SHOWN) break;
    }
    if (rows.length < MOVED_PAGE) break;
    cursor = rows[rows.length - 1].id;
  }
  return { views: out, staleClaims };
}

/** F4 on Přehled: how each moved discount now stacks with the discounts that stayed in Shopify. */
async function withStacking(
  ctx: Pick<ShopCtx, "db" | "shop">,
  moved: MovedBackupView[],
  detection: NativeDetection,
  locale: Locale,
): Promise<MovedBackupView[]> {
  // What is in Shopify now stays there (a moved discount's own native is gone).
  const remaining = remainingNatives(detection);
  const ids = moved.filter((m) => m.state === "moved").map((m) => m.backupId);
  if (remaining.length === 0 || ids.length === 0) return moved;
  const rows = await ctx.db.nativeDiscountBackup.findMany({ where: { shop: ctx.shop, id: { in: ids } }, select: { id: true, snapshot: true } });
  const notes = new Map<string, string[]>();
  for (const row of rows) {
    const envelope = parseSnapshot(row.snapshot);
    const native = envelope ? nativeFromSnapshot(envelope) : null;
    if (!native) continue;
    const texts = stackingWarnings(native, remaining).map((item) => warningText(item, locale));
    if (texts.length > 0) notes.set(row.id, texts);
  }
  return moved.map((m) => (notes.has(m.backupId) ? { ...m, stacking: notes.get(m.backupId) } : m));
}

/** Přehled / onboarding: the native discounts block. */
export async function loadNativeView(
  ctx: ShopCtx,
  config: WonDiscountsConfig,
  opts: { timezone: string | null; deadlineMs?: number; fresh?: boolean },
): Promise<NativeView> {
  // F7: a move / undo whose process died must not hang as "in progress": settle it from the live state.
  const [outcome, listing] = await Promise.all([
    withinDeadline(detectNative(ctx, config, { fresh: opts.fresh }), opts.deadlineMs ?? NATIVE_DETECTION_DEADLINE_MS),
    listBackups(ctx, opts.timezone, ctx.locale),
  ]);
  const listed = listing.views;
  if (listing.staleClaims) {
    // F7 / N1: a move or undo whose process died is settled from what Shopify
    // runs, in the background under the config lock (it may roll a Won rule
    // back); the row stays listed until then (REL-1: the page never waits).
    void withinDeadline(
      withConfigLock(ctx.shop, () =>
        resolveStaleClaims({
          client: ctx.client,
          db: ctx.db,
          shop: ctx.shop,
          locale: ctx.locale,
          saveAndSync: createSaveAndSync(nativeCtxOptions(ctx)),
        }),
      ),
      0,
    );
  }
  const moved = outcome.done && "value" in outcome ? await withStacking(ctx, listed, outcome.value, ctx.locale) : listed;
  if (!outcome.done) return { state: "loading", moved };
  if ("error" in outcome) {
    if (outcome.error instanceof Response) throw outcome.error;
    return {
      state: "error",
      ...(outcome.error instanceof NativeDetectError ? { message: outcome.error.message } : {}),
      moved,
    };
  }
  const { discounts, conflicts } = nativeViews(outcome.value, config, ctx.locale, nowOf(ctx));
  return { state: "ok", discounts, moved, conflicts };
}

// --- The canonical saveAndSync behind the native layer's contract -----------------------------

export interface NativeSyncOptions {
  client: AdminClient;
  db: PrismaClient;
  /** The session's granted scopes: markets are read only with read_markets (optional scope, F2 re-review M-6). */
  grantedScopes?: string | null;
  /** Codes of the shop's other native discounts (hash-collision check). */
  otherCodes?: readonly string[];
  createSync?: (client: AdminClient, db: PrismaClient) => Sync;
  now?: () => Date;
  logger?: SyncLogger;
  locale?: Locale;
}

/** Rule ids whose content differs between two configs (added, removed or changed). */
export function changedRuleIds(before: WonDiscountsConfig, after: WonDiscountsConfig): Set<string> {
  const a = new Map(before.modules.codes.rules.map((r) => [r.id, canonicalJson(r)]));
  const b = new Map(after.modules.codes.rules.map((r) => [r.id, canonicalJson(r)]));
  const out = new Set<string>();
  for (const [id, json] of a) if (b.get(id) !== json) out.add(id);
  for (const id of b.keys()) if (!a.has(id)) out.add(id);
  return out;
}

const SHOP_LEVEL = new Set(["shop.read", "shop_config.build", "sync", "sync.stopped", "nodes"]);

/**
 * The failed steps that keep the CHANGED rules from working at checkout: the
 * shop function config not applied, a shop-level stop, a changed code rule's
 * node / codes, the automatic node when a changed rule is automatic, product
 * targeting when a changed rule targets products or collections. Other rules'
 * old failures do not block a move.
 */
export function blockingSteps(steps: readonly SyncStep[], changed: ReadonlySet<string>, configs: WonDiscountsConfig[]): SyncStep[] {
  const rules = configs.flatMap((c) => c.modules.codes.rules).filter((r) => changed.has(r.id));
  const automatic = rules.some((r) => r.method === "automatic");
  const productTargeted = rules.some((r) => r.target.kind === "products" || r.target.kind === "collections");
  const out: SyncStep[] = [];
  for (const step of steps) {
    if (step.ok) continue;
    const key = stepNodeKey(step.step);
    if (key !== null) {
      const ruleId = ruleIdOfKey(key);
      if (ruleId === null ? automatic : changed.has(ruleId)) out.push(step);
    } else if (step.step.startsWith("products.too_large:")) {
      // Only that rule's collections did not fit what Won reads per sync (F2 re-review M-5).
      if (changed.has(step.step.slice("products.too_large:".length))) out.push(step);
    } else if (step.step.startsWith("products")) {
      if (productTargeted) out.push(step);
    } else if (SHOP_LEVEL.has(step.step) || step.step.startsWith("shop_config")) {
      out.push(step);
    }
  }
  if (out.length === 0 && !shopConfigApplied(steps)) {
    out.push({ step: "shop_config.write", ok: false, detail: "the shop function config was not applied" });
  }
  return out;
}

/**
 * app/lib/native's SaveAndSync over the canonical saveAndSync: `{ ok: true }`
 * only when the config is saved AND the changed rules are live in Shopify
 * (their nodes, the applied shop config, their product targeting); otherwise a
 * sentence in the admin language (the move then rolls back / restores).
 */
export function createSaveAndSync(opts: NativeSyncOptions): SaveAndSync {
  const locale = opts.locale ?? "cs";
  const tr = translator(locale);
  return async ({ shop, config, baseVersion }) => {
    const before = await loadConfig(opts.db, shop);
    const run = () =>
      saveAndSync({
        client: opts.client,
        db: opts.db,
        shop,
        input: config,
        otherCodes: opts.otherCodes,
        createSync: opts.createSync,
        now: opts.now,
        logger: opts.logger,
        grantedScopes: opts.grantedScopes,
      });
    // F12: the save lands only on top of the version the change was built on.
    const res = baseVersion !== undefined ? await withExpectedConfigVersion(shop, baseVersion, run) : await run();
    if (!res.save.ok && res.save.reason === "base_changed") return { ok: false, conflict: true, message: t(locale, "move.conflict") };
    if (!res.save.ok) {
      const copy = failureCopy(uiFailureFromSave(res.save), tr);
      return { ok: false, message: t(locale, copy.key, copy.params) };
    }
    if (!res.sync) return { ok: false, message: t(locale, "sync.problem.other", { detail: "not synced" }) };
    const names = ruleNames(res.save.config);
    const blocking = blockingSteps(res.sync.steps, changedRuleIds(before.config, res.save.config), [before.config, res.save.config]);
    if (blocking.length === 0) return { ok: true };
    const sentences = [...new Set(blocking.map((step) => stepProblem(step, names)).map((text) => t(locale, text.key, text.params)))];
    return { ok: false, message: sentences.join(" ") };
  };
}

// --- Move / undo ---------------------------------------------------------------------------

function nativeCtxOptions(ctx: ShopCtx, otherCodes?: readonly string[]): NativeSyncOptions {
  return {
    client: ctx.client,
    db: ctx.db,
    grantedScopes: ctx.scopes,
    otherCodes,
    createSync: ctx.createSync,
    now: ctx.now,
    logger: ctx.logger,
    locale: ctx.locale,
  };
}

/**
 * "Přesunout" / "Přesunout vše": one discount after another, under the config
 * lock. Circuit breaker (F1): after the first refusal on a Won limit (code
 * rules, function-config budget, stored size) the rest are not tried; each is
 * reported as skipped, unchanged.
 */
export async function moveNativeDiscounts(ctx: ShopCtx, nativeIds: readonly string[]): Promise<UiResult> {
  if (nativeIds.length === 0) return { ok: false, reason: "nothing_selected" };
  // F2 re-review I-1: another writer holding the config → an honest "busy" after CONFIG_LOCK_WAIT_MS, nothing moved.
  const locked = await withConfigLock(ctx.shop, async () => {
    const loaded = await loadConfig(ctx.db, ctx.shop);
    const detected = await withinDeadline(detectNative(ctx, loaded.config), MOVE_DETECTION_DEADLINE_MS);
    const detection = detected.done && "value" in detected ? detected.value : null;
    const titles = new Map(detection ? detection.movable.map((n) => [n.id, n.title]) : []);
    // The dry run measures the budget with the same market countries the real save merges (F1).
    const shopMarkets = targetsMarkets(loaded.config) ? await loadShopMarketsWith(ctx.client).catch(() => undefined) : undefined;
    const out: { nativeId: string; title: string | null; result: MoveResult }[] = [];
    let stopped = false;
    for (const nativeId of nativeIds) {
      const title = titles.get(nativeId) ?? null;
      if (stopped) {
        const item = { code: "skipped_after_limit" } as const;
        out.push({ nativeId, title, result: { ok: false, code: item.code, state: "unchanged", error: moveErrorText(item, ctx.locale) } });
        continue;
      }
      const otherCodes = detection ? nativeCodes(detection, nativeId) : undefined;
      const result = await moveNativeDiscount({
        client: ctx.client,
        db: ctx.db,
        shop: ctx.shop,
        nativeId,
        otherCodes,
        shopMarkets,
        saveAndSync: createSaveAndSync(nativeCtxOptions(ctx, otherCodes)),
        locale: ctx.locale,
        now: ctx.now,
      });
      out.push({ nativeId, title, result });
      if (!result.ok && LIMIT_REFUSALS.has(result.code)) stopped = true;
    }
    return out;
  }, { waitMs: ctx.lockWaitMs ?? CONFIG_LOCK_WAIT_MS }).catch((error: unknown) => {
    if (error instanceof ConfigLockBusy) return null;
    throw error;
  });
  if (locked === null) return { ok: false, reason: "busy" };
  const results = locked;
  forgetDetection(ctx.shop);

  const moved = results.filter((r) => r.result.ok);
  const failures = results
    .filter((r) => !r.result.ok)
    .map((r) => {
      const error = r.result.ok ? "" : r.result.error;
      return results.length > 1 && r.title ? `${r.title}: ${error}` : error;
    });
  const notes = [
    ...new Set(moved.flatMap((r) => (r.result.ok && !r.result.alreadyMoved ? r.result.warnings : []))),
  ];
  if (moved.length === 0) return { ok: false, reason: "native_failed", op: "move", messages: failures, done: 0 };
  return {
    ok: true,
    message: "moved",
    count: moved.length,
    ...(notes.length > 0 ? { notes } : {}),
    ...(failures.length > 0 ? { failures } : {}),
  };
}

/** "Vrátit zpět": restore the native discount from its backup (this shop's only, SEC-2 in undoMove). */
export async function undoNativeDiscount(ctx: ShopCtx, backupId: string | null): Promise<UiResult> {
  if (!backupId) return { ok: false, reason: "bad_request" };
  const result = await withConfigLock(
    ctx.shop,
    () =>
      undoNativeMove({
        client: ctx.client,
        db: ctx.db,
        shop: ctx.shop,
        backupId,
        saveAndSync: createSaveAndSync(nativeCtxOptions(ctx)),
        locale: ctx.locale,
        now: ctx.now,
      }),
    { waitMs: ctx.lockWaitMs ?? CONFIG_LOCK_WAIT_MS },
  ).catch((error: unknown) => {
    if (error instanceof ConfigLockBusy) return null;
    throw error;
  });
  if (result === null) return { ok: false, reason: "busy" };
  forgetDetection(ctx.shop);
  if (!result.ok) return { ok: false, reason: "native_failed", op: "undo", messages: [result.error], done: 0 };
  return { ok: true, message: "undone", ...(result.notRestored.length > 0 ? { notes: result.notRestored } : {}) };
}
