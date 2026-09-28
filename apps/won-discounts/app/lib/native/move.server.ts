// One-click move of a native Shopify discount into Won, and its undo
// (spec §4.1, decision C6: backup → delete native → create in Won; undo =
// restore the native from the backup and remove the Won rule).
//
// REL-3, "what if this request dies mid-way?":
//   before the backup row   nothing changed; a retry starts over.
//   backup row, no delete   status "backed_up", native still live. A retry
//                           re-reads it, refreshes the snapshot, continues.
//   deleted, no Won rule    status "backed_up", native gone. A retry resumes at
//                           the Won step from the snapshot; undo restores it.
//   Won step fails          the native is restored AT ONCE from the snapshot
//                           (same code), the config rolled back if it was
//                           saved, status "failed" + human error. When even the
//                           restore fails, the row keeps the only copy; undo
//                           (or another move) finishes the job.
//   undo: Won rule removed, restore fails
//                           the rule is put back (the discount keeps running
//                           through Won); if that fails too, status "failed"
//                           and a later undo retries from the snapshot.
// Concurrency: every native operation of a shop runs one at a time in this
// process (a per-shop queue), so two clicks never delete twice or lose each
// other's rule in the config's read-modify-write. The app runs as one instance
// (SQLite); a multi-instance deploy needs a DB lock here instead.
// Idempotent: moving an already moved nativeId returns the existing result;
// undoing an already restored backup does nothing.

import type { DiscountRule, WonDiscountsConfig } from "@won/core/discounts/config";

import type { PrismaClient } from "../../generated/prisma/client";
import { loadConfig } from "../config.server";
import { checkActiveCodeRuleLimit } from "../config-guards.server";
import { classifyNative } from "./classify.ts";
import {
  type MoveErrorItem,
  moveErrorText,
  type NotRestoredItem,
  notMovableReasonText,
  notRestoredText,
  type UndoErrorItem,
  undoErrorText,
} from "./copy.ts";
import { readShopContext } from "./detect.server.ts";
import { planMove } from "./map.server.ts";
import { readNativeDiscount } from "./read.server.ts";
import { describeUserErrors, type RequestOptions, runGql, userErrorsOf } from "./request.server.ts";
import {
  makeSnapshot,
  nativeFromSnapshot,
  parseSnapshot,
  restoreNative,
  type SnapshotEnvelope,
} from "./restore.server.ts";
import {
  type AdminClient,
  BACKUP_STATUS,
  type MovePlan,
  type NativeDiscount,
  type NativeLocale,
  type NotMovableReason,
  type SaveAndSync,
  type SaveAndSyncResult,
} from "./types.ts";

export interface NativeOpOptions extends RequestOptions {
  locale?: NativeLocale;
  /** Clock (tests). */
  now?: () => Date;
  /** Polls of a bulk code creation during a restore. */
  bulkPolls?: number;
}

interface Common extends NativeOpOptions {
  client: AdminClient;
  db: PrismaClient;
  shop: string;
  saveAndSync: SaveAndSync;
}

export type MoveResult =
  | {
      ok: true;
      backupId: string;
      ruleId: string;
      /** True when this nativeId had already been moved: nothing was done now. */
      alreadyMoved: boolean;
      losses: string[];
      warnings: string[];
    }
  | {
      ok: false;
      code: MoveErrorItem["code"];
      /** Human sentence for the merchant (§4c). */
      error: string;
      backupId?: string;
      /** Set when the move failed after the delete: was the native put back? */
      nativeRestored?: boolean;
      restoredNativeId?: string;
    };

export type UndoResult =
  | {
      ok: true;
      /** True when there was nothing left to undo. */
      alreadyRestored: boolean;
      /** Id of the native discount in Shopify now (new id after a restore). */
      nativeId: string | null;
      /** What the undo could not bring back (human sentences). */
      notRestored: string[];
    }
  | { ok: false; code: UndoErrorItem["code"]; error: string };

// --- Per-shop queue -------------------------------------------------------------------

const queues = new Map<string, Promise<unknown>>();

function withShopLock<T>(shop: string, run: () => Promise<T>): Promise<T> {
  const previous = queues.get(shop) ?? Promise.resolve();
  const next = previous.then(run, run);
  const settled = next.then(
    () => undefined,
    () => undefined,
  );
  queues.set(shop, settled);
  void settled.then(() => {
    if (queues.get(shop) === settled) queues.delete(shop);
  });
  return next;
}

// --- Config helpers -------------------------------------------------------------------

function isRuleOf(rule: DiscountRule, ruleId: string | null, nativeId: string): boolean {
  return (ruleId !== null && rule.id === ruleId) || rule.origin?.nativeId === nativeId;
}

function withRule(config: WonDiscountsConfig, rule: DiscountRule, nativeId: string): WonDiscountsConfig {
  const rules = config.modules.codes.rules.filter((r) => !isRuleOf(r, rule.id, nativeId));
  return { ...config, modules: { ...config.modules, codes: { ...config.modules.codes, rules: [...rules, rule] } } };
}

function withoutRule(config: WonDiscountsConfig, ruleId: string | null, nativeId: string): WonDiscountsConfig {
  const rules = config.modules.codes.rules.filter((r) => !isRuleOf(r, ruleId, nativeId));
  return { ...config, modules: { ...config.modules, codes: { ...config.modules.codes, rules } } };
}

async function safeSaveAndSync(
  saveAndSync: SaveAndSync,
  shop: string,
  config: WonDiscountsConfig,
): Promise<SaveAndSyncResult> {
  try {
    const result = await saveAndSync({ shop, config });
    if (result && result.ok === true) return { ok: true };
    return { ok: false, message: result && "message" in result && result.message ? result.message : "sync failed" };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  }
}

// --- Shopify helpers ------------------------------------------------------------------

/** true / false, or null when it could not be checked. */
async function nativeExists(client: AdminClient, id: string, options: RequestOptions): Promise<boolean | null> {
  const result = await runGql(client, "exists", { id }, options);
  if (!result.ok) return null;
  return Boolean(result.data?.discountNode?.id);
}

async function deleteNative(
  client: AdminClient,
  native: NativeDiscount,
  options: RequestOptions,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const code = native.method === "code";
  const result = await runGql(client, code ? "codeDelete" : "automaticDelete", { id: native.id }, options);
  if (result.ok) {
    const payload = result.data?.[code ? "discountCodeDelete" : "discountAutomaticDelete"];
    const errors = userErrorsOf(payload);
    if (errors.length === 0) return { ok: true };
    // Already gone (deleted meanwhile) is what we wanted.
    if ((await nativeExists(client, native.id, options)) === false) return { ok: true };
    return { ok: false, message: describeUserErrors(errors) };
  }
  if (result.kind === "transport") {
    // The delete may have landed: look before calling it a failure.
    if ((await nativeExists(client, native.id, options)) === false) return { ok: true };
  }
  return { ok: false, message: result.message };
}

// --- Backup rows ----------------------------------------------------------------------

async function updateRow(
  db: PrismaClient,
  id: string,
  data: { status?: string; error?: string | null; snapshot?: SnapshotEnvelope; wonRuleId?: string | null },
): Promise<void> {
  await db.nativeDiscountBackup.update({
    where: { id },
    data: {
      ...(data.status !== undefined ? { status: data.status } : {}),
      ...(data.error !== undefined ? { error: data.error } : {}),
      ...(data.snapshot !== undefined ? { snapshot: JSON.stringify(data.snapshot) } : {}),
      ...(data.wonRuleId !== undefined ? { wonRuleId: data.wonRuleId } : {}),
    },
  });
}

function reasonForNonBasic(kind: string): NotMovableReason {
  if (kind === "code_bxgy" || kind === "automatic_bxgy") return { code: "bxgy" };
  if (kind === "code_app" || kind === "automatic_app") return { code: "other_app", appTitle: null };
  return { code: "unknown_type" };
}

// --- Move -----------------------------------------------------------------------------

export interface MoveNativeInput extends Common {
  nativeId: string;
}

export function moveNative(input: MoveNativeInput): Promise<MoveResult> {
  return withShopLock(input.shop, () => moveLocked(input));
}

async function moveLocked(input: MoveNativeInput): Promise<MoveResult> {
  const { client, db, shop, nativeId } = input;
  const locale = input.locale ?? "cs";
  const now = input.now ?? (() => new Date());
  const fail = (item: MoveErrorItem, extra: Partial<Extract<MoveResult, { ok: false }>> = {}): MoveResult => ({
    ok: false,
    code: item.code,
    error: moveErrorText(item, locale),
    ...extra,
  });

  // 0. Idempotency / resume.
  const previous = await db.nativeDiscountBackup.findFirst({ where: { shop, nativeId }, orderBy: { createdAt: "desc" } });
  if (previous?.status === BACKUP_STATUS.moved) {
    return { ok: true, backupId: previous.id, ruleId: previous.wonRuleId ?? "", alreadyMoved: true, losses: [], warnings: [] };
  }
  const previousEnvelope = previous ? parseSnapshot(previous.snapshot) : null;
  const resumable =
    previous !== null &&
    previousEnvelope !== null &&
    (previous.status === BACKUP_STATUS.backedUp || (previous.status === BACKUP_STATUS.failed && !previousEnvelope.restoredAs));

  // 1. Read everything first; nothing changes until the backup exists.
  const shopContext = await readShopContext(client, input);
  if (!shopContext.ok) return fail({ code: "read_failed", detail: shopContext.message });
  const read = await readNativeDiscount(client, nativeId, shopContext.shop, input);

  let native: NativeDiscount;
  let envelope: SnapshotEnvelope;
  let deleted = false;
  if (!read.ok && read.notFound && resumable && previous && previousEnvelope) {
    // An earlier attempt deleted it: the snapshot is the discount now.
    const fromSnapshot = nativeFromSnapshot(previousEnvelope);
    if (!fromSnapshot) return fail({ code: "not_found" });
    native = fromSnapshot;
    envelope = previousEnvelope;
    deleted = true;
  } else if (!read.ok) {
    return read.notFound ? fail({ code: "not_found" }) : fail({ code: "read_failed", detail: read.message });
  } else if (!read.movableType) {
    return fail({ code: "not_movable", reason: notMovableReasonText(reasonForNonBasic(read.kind), locale) });
  } else {
    native = read.native;
    envelope = makeSnapshot(read.raw, shopContext.shop, now());
    if (native.status === "EXPIRED") return fail({ code: "not_movable", reason: notMovableReasonText({ code: "expired" }, locale) });
    const reason = classifyNative(native);
    if (reason) return fail({ code: "not_movable", reason: notMovableReasonText(reason, locale) });
  }

  // 2. Plan against the current config and refuse early what the save would refuse.
  const loaded = await loadConfig(db, shop);
  if (loaded.readOnly) return fail({ code: "config_read_only" });
  let plan: MovePlan;
  try {
    plan = planMove(native, loaded.config, { locale, now: now() });
  } catch (error) {
    return fail({ code: "not_movable", reason: error instanceof Error ? error.message : String(error) });
  }
  const planCodes = new Set(plan.rule.codes ?? []);
  const holder = loaded.config.modules.codes.rules.find(
    (r) => r.origin?.nativeId !== nativeId && (r.codes ?? []).some((c) => planCodes.has(c)),
  );
  if (holder) {
    const codes = (holder.codes ?? []).filter((c) => planCodes.has(c));
    return fail({ code: "code_taken", codes, ruleName: holder.name || holder.id });
  }
  const limit = checkActiveCodeRuleLimit(withRule(loaded.config, plan.rule, nativeId));
  if (!limit.ok) {
    return fail({ code: "code_rule_limit", count: checkActiveCodeRuleLimit(loaded.config).count, limit: limit.limit });
  }

  // 3. Backup (before anything destructive, §14c).
  let rowId: string;
  try {
    if (resumable && previous) {
      await updateRow(db, previous.id, { status: BACKUP_STATUS.backedUp, error: null, snapshot: envelope, wonRuleId: plan.rule.id });
      rowId = previous.id;
    } else {
      const row = await db.nativeDiscountBackup.create({
        data: {
          shop,
          nativeId,
          kind: native.kind,
          title: native.title,
          snapshot: JSON.stringify(envelope),
          wonRuleId: plan.rule.id,
          status: BACKUP_STATUS.backedUp,
        },
      });
      rowId = row.id;
    }
  } catch {
    return fail({ code: "backup_failed" });
  }

  // 4. Delete the native discount (frees its code for the Won node).
  if (!deleted) {
    const removed = await deleteNative(client, native, input);
    if (!removed.ok) {
      // Still in Shopify under its own id: record that, so undo has nothing to do.
      const item: MoveErrorItem = { code: "delete_failed", detail: removed.message };
      await updateRow(db, rowId, {
        status: BACKUP_STATUS.failed,
        error: moveErrorText(item, locale),
        snapshot: { ...envelope, restoredAs: { nativeId, at: now().toISOString() } },
      });
      return fail(item, { backupId: rowId });
    }
  }

  // 5. Add the rule and sync. Re-read the config: it may have changed meanwhile.
  const fresh = await loadConfig(db, shop);
  const synced = fresh.readOnly
    ? ({ ok: false, message: moveErrorText({ code: "config_read_only" }, locale) } as const)
    : await safeSaveAndSync(input.saveAndSync, shop, withRule(fresh.config, plan.rule, nativeId));
  if (synced.ok) {
    await updateRow(db, rowId, { status: BACKUP_STATUS.moved, error: null, wonRuleId: plan.rule.id });
    return { ok: true, backupId: rowId, ruleId: plan.rule.id, alreadyMoved: false, losses: plan.losses, warnings: plan.warnings };
  }

  // 6. REL-3: the native is gone and Won has no working rule → put it back now.
  const detail = synced.message;
  let restored = await restoreNative(client, envelope, { ...input, now });
  const current = await loadConfig(db, shop);
  const saved = current.config.modules.codes.rules.some((r) => isRuleOf(r, plan.rule.id, nativeId));
  if (saved && !current.readOnly) {
    await safeSaveAndSync(input.saveAndSync, shop, withoutRule(current.config, plan.rule.id, nativeId));
  }
  if (!restored.ok) restored = await restoreNative(client, envelope, { ...input, now });

  if (restored.ok) {
    const item: MoveErrorItem = { code: "sync_failed_restored", detail };
    await updateRow(db, rowId, {
      status: BACKUP_STATUS.failed,
      error: moveErrorText(item, locale),
      snapshot: { ...envelope, restoredAs: { nativeId: restored.nativeId, at: now().toISOString() } },
    });
    return fail(item, { backupId: rowId, nativeRestored: true, restoredNativeId: restored.nativeId });
  }
  const item: MoveErrorItem = { code: "sync_failed_not_restored", detail: `${detail}; ${restored.message}` };
  await updateRow(db, rowId, { status: BACKUP_STATUS.failed, error: moveErrorText(item, locale) });
  return fail(item, { backupId: rowId, nativeRestored: false });
}

// --- Undo -----------------------------------------------------------------------------

export interface UndoMoveInput extends Common {
  backupId: string;
}

export function undoMove(input: UndoMoveInput): Promise<UndoResult> {
  return withShopLock(input.shop, () => undoLocked(input));
}

function notRestoredFor(native: NativeDiscount | null, codesFailed: number, locale: NativeLocale): string[] {
  const items: NotRestoredItem[] = [{ code: "usage_count" }];
  if (native?.oncePerCustomer) items.push({ code: "once_per_customer" });
  if (native && native.usageLimit !== null && native.usageCount > 0) items.push({ code: "usage_limit_full", limit: native.usageLimit });
  if (codesFailed > 0) items.push({ code: "codes_failed", count: codesFailed });
  return items.map((item) => notRestoredText(item, locale));
}

async function undoLocked(input: UndoMoveInput): Promise<UndoResult> {
  const { client, db, shop, backupId } = input;
  const locale = input.locale ?? "cs";
  const now = input.now ?? (() => new Date());
  const fail = (item: UndoErrorItem): UndoResult => ({ ok: false, code: item.code, error: undoErrorText(item, locale) });

  // SEC-2: the backup must belong to this shop.
  const row = await db.nativeDiscountBackup.findFirst({ where: { id: backupId, shop } });
  if (!row) return fail({ code: "backup_not_found" });
  const envelope = parseSnapshot(row.snapshot);
  if (!envelope) return fail({ code: "backup_unreadable" });
  if (row.status === BACKUP_STATUS.restored || envelope.restoredAs) {
    return { ok: true, alreadyRestored: true, nativeId: envelope.restoredAs?.nativeId ?? null, notRestored: [] };
  }
  const native = nativeFromSnapshot(envelope);
  if (!native) return fail({ code: "backup_unreadable" });

  if (row.status === BACKUP_STATUS.backedUp) {
    // A move is unfinished: if it never deleted the native, there is nothing to put back.
    const exists = await nativeExists(client, row.nativeId, input);
    if (exists === null) return fail({ code: "check_failed", detail: "discountNode" });
    if (exists) {
      const loaded = await loadConfig(db, shop);
      if (loaded.config.modules.codes.rules.some((r) => isRuleOf(r, row.wonRuleId, row.nativeId))) {
        if (loaded.readOnly) return fail({ code: "config_read_only" });
        const removed = await safeSaveAndSync(input.saveAndSync, shop, withoutRule(loaded.config, row.wonRuleId, row.nativeId));
        if (!removed.ok) return fail({ code: "remove_rule_failed", detail: removed.message });
      }
      await updateRow(db, row.id, {
        status: BACKUP_STATUS.restored,
        error: null,
        snapshot: { ...envelope, restoredAs: { nativeId: row.nativeId, at: now().toISOString() } },
      });
      return { ok: true, alreadyRestored: true, nativeId: row.nativeId, notRestored: [] };
    }
  }

  // 1. Remove the Won rule first: its code node holds the code the native needs back.
  const loaded = await loadConfig(db, shop);
  const hadRule = loaded.config.modules.codes.rules.some((r) => isRuleOf(r, row.wonRuleId, row.nativeId));
  if (hadRule) {
    if (loaded.readOnly) return fail({ code: "config_read_only" });
    const removed = await safeSaveAndSync(input.saveAndSync, shop, withoutRule(loaded.config, row.wonRuleId, row.nativeId));
    if (!removed.ok) {
      // It may have saved or synced part of it: put the rule back as it was.
      await safeSaveAndSync(input.saveAndSync, shop, loaded.config);
      return fail({ code: "remove_rule_failed", detail: removed.message });
    }
  }

  // 2. Recreate the native discount from the snapshot.
  const restored = await restoreNative(client, envelope, { ...input, now });
  if (!restored.ok) {
    if (hadRule) {
      const back = await safeSaveAndSync(input.saveAndSync, shop, loaded.config);
      if (back.ok) return fail({ code: "restore_failed_rule_back", detail: restored.message });
    }
    const item: UndoErrorItem = { code: "restore_failed_nowhere", detail: restored.message };
    await updateRow(db, row.id, { status: BACKUP_STATUS.failed, error: undoErrorText(item, locale) });
    return fail(item);
  }

  await updateRow(db, row.id, {
    status: BACKUP_STATUS.restored,
    error: null,
    snapshot: { ...envelope, restoredAs: { nativeId: restored.nativeId, at: now().toISOString() } },
  });
  return {
    ok: true,
    alreadyRestored: false,
    nativeId: restored.nativeId,
    notRestored: notRestoredFor(native, restored.codesFailed, locale),
  };
}

// --- Preview for the dialog -------------------------------------------------------------

export type PreviewResult =
  | { ok: true; native: NativeDiscount; plan: MovePlan }
  | { ok: false; code: MoveErrorItem["code"]; error: string };

/**
 * Full read + plan without changing anything: what the "Přesunout" dialog shows
 * (losses and warnings from the complete discount, not the detection page).
 */
export async function previewMove(input: Omit<MoveNativeInput, "saveAndSync">): Promise<PreviewResult> {
  const locale = input.locale ?? "cs";
  const fail = (item: MoveErrorItem): PreviewResult => ({ ok: false, code: item.code, error: moveErrorText(item, locale) });
  const shopContext = await readShopContext(input.client, input);
  if (!shopContext.ok) return fail({ code: "read_failed", detail: shopContext.message });
  const read = await readNativeDiscount(input.client, input.nativeId, shopContext.shop, input);
  if (!read.ok) return read.notFound ? fail({ code: "not_found" }) : fail({ code: "read_failed", detail: read.message });
  if (!read.movableType) return fail({ code: "not_movable", reason: notMovableReasonText(reasonForNonBasic(read.kind), locale) });
  if (read.native.status === "EXPIRED") return fail({ code: "not_movable", reason: notMovableReasonText({ code: "expired" }, locale) });
  const reason = classifyNative(read.native);
  if (reason) return fail({ code: "not_movable", reason: notMovableReasonText(reason, locale) });
  const loaded = await loadConfig(input.db, input.shop);
  const plan = planMove(read.native, loaded.config, { locale, now: (input.now ?? (() => new Date()))() });
  return { ok: true, native: read.native, plan };
}
