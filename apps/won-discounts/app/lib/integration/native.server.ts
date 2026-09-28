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
//     shop's native codes passed for the code-hash collision check.

import { describeRuleParts } from "@won/core/discounts/describe";
import type { WonDiscountsConfig } from "@won/core/discounts/config";

import type { PrismaClient } from "../../generated/prisma/client";
import { t, translator, type Locale } from "../../i18n";
import type { AdminClient } from "../admin-client.server";
import { loadConfig } from "../config.server";
import { detectNativeDiscounts, NativeDetectError } from "../native/detect.server";
import { planMove } from "../native/map.server";
import { moveNative as moveNativeDiscount, undoMove as undoNativeMove, type MoveResult } from "../native/move.server";
import { parseSnapshot } from "../native/restore.server";
import { BACKUP_STATUS, type NativeDetection, type SaveAndSync } from "../native/types";
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
import { withConfigLock } from "./lock.server";
import { uiFailureFromSave } from "./results";
import { ruleIdOfKey, ruleNames, shopConfigApplied, stepNodeKey, stepProblem } from "./sync-copy";

export const NATIVE_DETECTION_TTL_MS = 60_000;
/** How long Přehled / onboarding wait for a detection that is not cached. */
export const NATIVE_DETECTION_DEADLINE_MS = 4_000;
/** A move waits this long for the detection that supplies the shop's native codes. */
const MOVE_DETECTION_DEADLINE_MS = 10_000;
/** Backups listed with an undo. */
const MOVED_SHOWN = 50;

// --- Detection cache ------------------------------------------------------------------

interface CacheEntry {
  at: number;
  promise: Promise<NativeDetection>;
  value?: NativeDetection;
}

const detections = new Map<string, CacheEntry>();

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
}

/** Test hook. */
export function clearDetectionCache(): void {
  detections.clear();
}

/** Codes of the shop's native discounts from a fresh cached detection, if one is at hand (no Shopify call). */
export function cachedNativeCodes(shop: string, exceptId?: string): string[] | undefined {
  const now = Date.now();
  for (const [key, entry] of detections) {
    if (!key.startsWith(`${shop}|`) || !entry.value || now - entry.at >= NATIVE_DETECTION_TTL_MS) continue;
    return nativeCodes(entry.value, exceptId);
  }
  return undefined;
}

/** Codes the detection saw on native discounts (movable ones; the first page of each). */
export function nativeCodes(detection: NativeDetection, exceptId?: string): string[] {
  return detection.movable.filter((n) => n.id !== exceptId).flatMap((n) => n.codes);
}

// --- View ---------------------------------------------------------------------------------

const BLOCKED: Record<string, NativeBlockedReason> = { bxgy: "bxgy", other_app: "app" };

/** Detection → the discounts and conflicts the admin lists (pure). */
export function nativeViews(
  detection: NativeDetection,
  config: WonDiscountsConfig,
  locale: Locale,
  now: Date,
): { discounts: NativeDiscountView[]; conflicts: NativeConflictView[] } {
  const discounts: NativeDiscountView[] = [];
  for (const native of detection.movable) {
    try {
      const plan = planMove(native, config, { locale, now });
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
 */
export async function movedBackups(
  ctx: Pick<ShopCtx, "db" | "shop">,
  timezone: string | null,
): Promise<MovedDiscountView[]> {
  const rows = await ctx.db.nativeDiscountBackup.findMany({
    where: { shop: ctx.shop },
    orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
    take: MOVED_SHOWN * 4,
  });
  const seen = new Set<string>();
  const out: MovedDiscountView[] = [];
  for (const row of rows) {
    if (seen.has(row.nativeId)) continue;
    seen.add(row.nativeId);
    const restoredAs = parseSnapshot(row.snapshot)?.restoredAs;
    const partly = (restoredAs?.codesMissing ?? 0) > 0;
    const view: MovedDiscountView = {
      backupId: row.id,
      title: row.title,
      movedAt: shopLocalDateTime(row.updatedAt, timezone ?? "UTC"),
    };
    if (row.status === BACKUP_STATUS.moved) out.push({ ...view, state: "moved" });
    else if (row.status === BACKUP_STATUS.restored || row.status === BACKUP_STATUS.failed) {
      if (restoredAs && !partly) continue;
      out.push({ ...view, state: "attention", ...(row.error ? { note: row.error } : {}) });
    } else {
      // backed_up (outcome unknown) or a claim (moving / undoing): the undo re-checks and finishes.
      out.push({ ...view, state: "attention", ...(row.error ? { note: row.error } : {}) });
    }
    if (out.length >= MOVED_SHOWN) break;
  }
  return out;
}

/** Přehled / onboarding: the native discounts block. */
export async function loadNativeView(
  ctx: ShopCtx,
  config: WonDiscountsConfig,
  opts: { timezone: string | null; deadlineMs?: number; fresh?: boolean },
): Promise<NativeView> {
  const [outcome, moved] = await Promise.all([
    withinDeadline(detectNative(ctx, config, { fresh: opts.fresh }), opts.deadlineMs ?? NATIVE_DETECTION_DEADLINE_MS),
    movedBackups(ctx, opts.timezone),
  ]);
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
  return async ({ shop, config }) => {
    const before = await loadConfig(opts.db, shop);
    const res = await saveAndSync({
      client: opts.client,
      db: opts.db,
      shop,
      input: config,
      otherCodes: opts.otherCodes,
      createSync: opts.createSync,
      now: opts.now,
      logger: opts.logger,
    });
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
    otherCodes,
    createSync: ctx.createSync,
    now: ctx.now,
    logger: ctx.logger,
    locale: ctx.locale,
  };
}

/** "Přesunout" / "Přesunout vše": one discount after another, under the config lock. */
export async function moveNativeDiscounts(ctx: ShopCtx, nativeIds: readonly string[]): Promise<UiResult> {
  if (nativeIds.length === 0) return { ok: false, reason: "nothing_selected" };
  const results = await withConfigLock(ctx.shop, async () => {
    const loaded = await loadConfig(ctx.db, ctx.shop);
    const detected = await withinDeadline(detectNative(ctx, loaded.config), MOVE_DETECTION_DEADLINE_MS);
    const detection = detected.done && "value" in detected ? detected.value : null;
    const titles = new Map(detection ? detection.movable.map((n) => [n.id, n.title]) : []);
    const out: { nativeId: string; title: string | null; result: MoveResult }[] = [];
    for (const nativeId of nativeIds) {
      const otherCodes = detection ? nativeCodes(detection, nativeId) : undefined;
      const result = await moveNativeDiscount({
        client: ctx.client,
        db: ctx.db,
        shop: ctx.shop,
        nativeId,
        saveAndSync: createSaveAndSync(nativeCtxOptions(ctx, otherCodes)),
        locale: ctx.locale,
        now: ctx.now,
      });
      out.push({ nativeId, title: titles.get(nativeId) ?? null, result });
    }
    return out;
  });
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
  const result = await withConfigLock(ctx.shop, () =>
    undoNativeMove({
      client: ctx.client,
      db: ctx.db,
      shop: ctx.shop,
      backupId,
      saveAndSync: createSaveAndSync(nativeCtxOptions(ctx)),
      locale: ctx.locale,
      now: ctx.now,
    }),
  );
  forgetDetection(ctx.shop);
  if (!result.ok) return { ok: false, reason: "native_failed", op: "undo", messages: [result.error], done: 0 };
  return { ok: true, message: "undone", ...(result.notRestored.length > 0 ? { notes: result.notRestored } : {}) };
}
