// One-click move of a native Shopify discount into Won, and its undo
// (spec §4.1, decision C6: backup → delete native → create in Won; undo =
// restore the native from the backup and remove the Won rule).
//
// REL-3, "what if this request dies mid-way?":
//   before the claim         nothing changed; a retry starts over.
//   claimed, no delete       the native is still live; the row is released.
//   delete outcome unknown   (transport error AND the existence check failed)
//                            status "backed_up", snapshot intact, the merchant
//                            is told we do not know. A retried move re-checks
//                            and continues; undo restores if the native is gone.
//   deleted, Won step fails  the Won rule is rolled back FIRST (checked), then
//   (or any refusal after    the native restored at once from the snapshot
//    a resumed delete)       (same code). If the rule cannot be removed, the
//                            native is NOT recreated (an automatic one would
//                            apply twice): status "failed", undo finishes.
//                            Codes that did not come back are counted and kept
//                            in the snapshot; the next undo adds them.
//   undo: Won rule removed, restore fails
//                            the rule is put back (the discount keeps running
//                            through Won); if that fails too, status "failed"
//                            and a later undo retries from the snapshot.
// Concurrency: per shop, operations run one at a time in this process, and
// across app instances every move / undo first CLAIMS its backup row with a
// compare-and-set (status → "moving" / "undoing"; a fresh row loses to an older
// live claim). A claim older than CLAIM_STALE_MS (the process died) is taken
// over. Idempotent: moving an already moved nativeId returns the existing
// result; undoing an already restored backup does nothing.

import type { DiscountRule, WonDiscountsConfig } from "@won/core/discounts/config";

import type { PrismaClient } from "../../generated/prisma/client";
import { loadConfig } from "../config.server";
import { checkActiveCodeRuleLimit } from "../config-guards.server";
import { classifyNative, incompleteSnapshot } from "./classify.ts";
import {
  type MoveErrorItem,
  moveErrorText,
  type MoveState,
  type NotRestoredItem,
  notMovableReasonText,
  notRestoredText,
  type UndoErrorItem,
  undoErrorText,
} from "./copy.ts";
import { readShopContext } from "./detect.server.ts";
import { NotMovableError, planMove } from "./map.server.ts";
import { readNativeDiscount } from "./read.server.ts";
import { describeUserErrors, type RequestOptions, runGql, userErrorsOf } from "./request.server.ts";
import {
  finishRestoredCodes,
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

/** A move / undo claim older than this belongs to a process that died: it may be taken over. */
export const CLAIM_STALE_MS = 10 * 60_000;

export interface NativeOpOptions extends RequestOptions {
  locale?: NativeLocale;
  /** Clock for snapshots and plans (tests). Claims always use the wall clock (Prisma's updatedAt). */
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
      /** Where the discount is now (see copy.ts MoveState). */
      state: MoveState;
      /** Human sentence for the merchant (§4c): why, where the discount is, what to do. */
      error: string;
      backupId?: string;
      /** Set when the move failed after the delete: was the native put back? */
      nativeRestored?: boolean;
      restoredNativeId?: string;
      /** Codes of the backup not (yet) on the restored discount. */
      codesMissing?: number;
      codesPending?: boolean;
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

type BackupRow = NonNullable<Awaited<ReturnType<PrismaClient["nativeDiscountBackup"]["findFirst"]>>>;

// --- Per-shop queue (this process) --------------------------------------------------------

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

// --- Claims (all instances) ---------------------------------------------------------------

function isClaim(status: string): boolean {
  return status === BACKUP_STATUS.moving || status === BACKUP_STATUS.undoing;
}

function isLiveClaim(row: BackupRow): boolean {
  return isClaim(row.status) && Date.now() - row.updatedAt.getTime() < CLAIM_STALE_MS;
}

/**
 * The database's claim guard (migration 20260928184219): a partial unique index
 * allows one `moving`/`undoing` row per shop + nativeId. Its violation means
 * another instance holds the claim.
 */
function isClaimConflict(error: unknown): boolean {
  return (error as { code?: unknown } | null)?.code === "P2002";
}

/** Compare-and-set on (status, updatedAt): true when this caller now owns the row. */
async function claim(db: PrismaClient, row: BackupRow, data: Record<string, unknown>): Promise<boolean> {
  try {
    const { count } = await db.nativeDiscountBackup.updateMany({
      where: { id: row.id, status: row.status, updatedAt: row.updatedAt },
      data,
    });
    return count === 1;
  } catch (error) {
    if (isClaimConflict(error)) return false; // another row of this native is claimed
    throw error;
  }
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

type DeleteOutcome = { outcome: "deleted" } | { outcome: "not_deleted"; message: string } | { outcome: "unknown"; message: string };

async function deleteNative(client: AdminClient, native: NativeDiscount, options: RequestOptions): Promise<DeleteOutcome> {
  const code = native.method === "code";
  const result = await runGql(client, code ? "codeDelete" : "automaticDelete", { id: native.id }, options);
  let message: string;
  if (result.ok) {
    const payload = result.data?.[code ? "discountCodeDelete" : "discountAutomaticDelete"];
    const errors = userErrorsOf(payload);
    if (errors.length === 0 && payload) return { outcome: "deleted" };
    message = errors.length > 0 ? describeUserErrors(errors) : (result.partialErrors ?? ["no answer"]).join("; ");
  } else if (result.kind === "throttled") {
    // Rate limited before execution, even after the retries: nothing happened.
    return { outcome: "not_deleted", message: result.message };
  } else {
    message = result.message;
  }
  // Every other answer may hide a delete that landed: the store decides.
  const exists = await nativeExists(client, native.id, options);
  if (exists === false) return { outcome: "deleted" };
  if (exists === true) return { outcome: "not_deleted", message };
  return { outcome: "unknown", message };
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

/** A restore that left codes missing is not finished: the next undo adds them. */
function codesStillMissing(envelope: SnapshotEnvelope): boolean {
  return (envelope.restoredAs?.codesMissing ?? 0) > 0;
}

// --- Move -----------------------------------------------------------------------------

export interface MoveNativeInput extends Common {
  nativeId: string;
}

export function moveNative(input: MoveNativeInput): Promise<MoveResult> {
  return withShopLock(input.shop, () => moveLocked(input));
}

type Fail = (item: MoveErrorItem, state?: MoveState, extra?: Partial<Extract<MoveResult, { ok: false }>>) => MoveResult;

async function moveLocked(input: MoveNativeInput): Promise<MoveResult> {
  const { client, db, shop, nativeId } = input;
  const locale = input.locale ?? "cs";
  const now = input.now ?? (() => new Date());
  const fail: Fail = (item, state = "unchanged", extra = {}) => ({
    ok: false,
    code: item.code,
    state,
    error: moveErrorText(item, locale, state, { missing: extra.codesMissing, pending: extra.codesPending }),
    ...extra,
  });

  // 0. Idempotency, running claims, resume.
  const previous = await db.nativeDiscountBackup.findFirst({ where: { shop, nativeId }, orderBy: { createdAt: "desc" } });
  if (previous?.status === BACKUP_STATUS.moved) {
    return { ok: true, backupId: previous.id, ruleId: previous.wonRuleId ?? "", alreadyMoved: true, losses: [], warnings: [] };
  }
  if (previous && isLiveClaim(previous)) return fail({ code: "in_progress" }, "in_progress", { backupId: previous.id });
  const previousEnvelope = previous ? parseSnapshot(previous.snapshot) : null;
  const resumable =
    previous !== null &&
    previousEnvelope !== null &&
    (previous.status === BACKUP_STATUS.backedUp ||
      isClaim(previous.status) || // stale claim: its process died
      (previous.status === BACKUP_STATUS.failed && !previousEnvelope.restoredAs));
  // With a resumable row the native may already be deleted: a failed read proves nothing.
  const unknownFail = (detail: string) =>
    fail({ code: "outcome_unknown", detail }, "unknown", { backupId: previous?.id });

  // 1. Read everything first.
  const shopContext = await readShopContext(client, input);
  if (!shopContext.ok) return resumable ? unknownFail(shopContext.message) : fail({ code: "read_failed", detail: shopContext.message });
  const read = await readNativeDiscount(client, nativeId, shopContext.shop, input);

  let native: NativeDiscount;
  let envelope: SnapshotEnvelope;
  let deleted = false;
  if (!read.ok && read.notFound && resumable && previousEnvelope) {
    // An earlier attempt deleted it: the snapshot is the discount now.
    const fromSnapshot = nativeFromSnapshot(previousEnvelope);
    if (!fromSnapshot) return fail({ code: "not_found" });
    native = fromSnapshot;
    envelope = previousEnvelope;
    deleted = true;
  } else if (!read.ok) {
    if (read.notFound) return fail({ code: "not_found" });
    return resumable ? unknownFail(read.message) : fail({ code: "read_failed", detail: read.message });
  } else if (!read.movableType) {
    return fail({ code: "not_movable", reason: notMovableReasonText(reasonForNonBasic(read.kind), locale) });
  } else {
    native = read.native;
    envelope = makeSnapshot(read.raw, shopContext.shop, now());
    const reason: NotMovableReason | null =
      native.status === "EXPIRED" ? { code: "expired" } : (classifyNative(native) ?? incompleteSnapshot(native));
    // Still live in Shopify, nothing deleted: a refusal changes nothing.
    if (reason) return fail({ code: "not_movable", reason: notMovableReasonText(reason, locale) });
  }

  // 2. Claim the backup row (the backup itself, before anything destructive, §14c).
  let rowId: string;
  const claimData = { status: BACKUP_STATUS.moving, snapshot: JSON.stringify(envelope), error: null, kind: native.kind, title: native.title };
  if (resumable && previous) {
    if (!(await claim(db, previous, claimData))) return fail({ code: "in_progress" }, "in_progress", { backupId: previous.id });
    rowId = previous.id;
  } else {
    try {
      const row = await db.nativeDiscountBackup.create({ data: { shop, nativeId, wonRuleId: null, ...claimData } });
      rowId = row.id;
    } catch (error) {
      if (!isClaimConflict(error)) return fail({ code: "backup_failed" });
      // Another instance claimed this native first (the DB guard): nothing was changed here.
      const holder = await db.nativeDiscountBackup.findFirst({
        where: { shop, nativeId, status: { in: [BACKUP_STATUS.moving, BACKUP_STATUS.undoing] } },
      });
      return fail({ code: "in_progress" }, "in_progress", holder ? { backupId: holder.id } : {});
    }
    // Another instance may have claimed the same native at the same time: the oldest live claim wins.
    const rivals = await db.nativeDiscountBackup.findMany({
      where: { shop, nativeId, status: { in: [BACKUP_STATUS.moving, BACKUP_STATUS.moved] } },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });
    const winner = rivals.find((r) => r.status === BACKUP_STATUS.moved) ?? rivals.find((r) => r.id === rowId || isLiveClaim(r));
    if (winner && winner.id !== rowId) {
      await db.nativeDiscountBackup.delete({ where: { id: rowId } });
      if (winner.status === BACKUP_STATUS.moved) {
        return { ok: true, backupId: winner.id, ruleId: winner.wonRuleId ?? "", alreadyMoved: true, losses: [], warnings: [] };
      }
      return fail({ code: "in_progress" }, "in_progress", { backupId: winner.id });
    }
  }

  const ctx: AbortContext = { input, locale, now, fail, rowId, nativeId, envelope, ruleId: previous?.wonRuleId ?? null };

  /** A refusal after the claim: put the discount back if it is gone, else release the row. */
  const refuse = async (item: MoveErrorItem): Promise<MoveResult> => {
    if (deleted) return abortAfterDelete(ctx, item);
    if (resumable) {
      // The native is live (just read): record where it is, so undo has nothing to do.
      await updateRow(db, rowId, {
        status: BACKUP_STATUS.failed,
        error: moveErrorText(item, locale),
        snapshot: { ...envelope, restoredAs: { nativeId, at: now().toISOString() } },
      });
    } else {
      await db.nativeDiscountBackup.delete({ where: { id: rowId } });
    }
    return fail(item, "unchanged", resumable ? { backupId: rowId } : {});
  };

  // 3. Plan against the current config; refuse early what the save would refuse.
  const loaded = await loadConfig(db, shop);
  if (loaded.readOnly) return refuse({ code: "config_read_only" });
  let plan: MovePlan;
  try {
    plan = planMove(native, loaded.config, { locale, now: now() });
  } catch (error) {
    const reason = error instanceof NotMovableError ? error.message : String(error);
    return refuse({ code: "not_movable", reason });
  }
  ctx.ruleId = plan.rule.id;
  const planCodes = new Set(plan.rule.codes ?? []);
  const holder = loaded.config.modules.codes.rules.find(
    (r) => r.origin?.nativeId !== nativeId && (r.codes ?? []).some((c) => planCodes.has(c)),
  );
  if (holder) {
    const codes = (holder.codes ?? []).filter((c) => planCodes.has(c));
    return refuse({ code: "code_taken", codes, ruleName: holder.name || holder.id });
  }
  const limit = checkActiveCodeRuleLimit(withRule(loaded.config, plan.rule, nativeId));
  if (!limit.ok) {
    return refuse({ code: "code_rule_limit", count: checkActiveCodeRuleLimit(loaded.config).count, limit: limit.limit });
  }
  await updateRow(db, rowId, { wonRuleId: plan.rule.id });

  // 4. Delete the native discount (frees its code for the Won node).
  if (!deleted) {
    const removed = await deleteNative(client, native, input);
    if (removed.outcome === "not_deleted") {
      // Confirmed still in Shopify under its own id: undo has nothing to do.
      const item: MoveErrorItem = { code: "delete_failed", detail: removed.message };
      await updateRow(db, rowId, {
        status: BACKUP_STATUS.failed,
        error: moveErrorText(item, locale),
        snapshot: { ...envelope, restoredAs: { nativeId, at: now().toISOString() } },
      });
      return fail(item, "unchanged", { backupId: rowId });
    }
    if (removed.outcome === "unknown") {
      // Maybe deleted, maybe not: keep the backup open; retry and undo both re-check the store.
      const item: MoveErrorItem = { code: "outcome_unknown", detail: removed.message };
      await updateRow(db, rowId, { status: BACKUP_STATUS.backedUp, error: moveErrorText(item, locale, "unknown") });
      return fail(item, "unknown", { backupId: rowId });
    }
    deleted = true;
  }

  // 5. Add the rule and sync. Re-read the config: it may have changed meanwhile.
  const fresh = await loadConfig(db, shop);
  if (fresh.readOnly) return abortAfterDelete(ctx, { code: "config_read_only" });
  const synced = await safeSaveAndSync(input.saveAndSync, shop, withRule(fresh.config, plan.rule, nativeId));
  if (!synced.ok) return abortAfterDelete(ctx, { code: "sync_failed", detail: synced.message });
  await updateRow(db, rowId, { status: BACKUP_STATUS.moved, error: null, wonRuleId: plan.rule.id });
  return { ok: true, backupId: rowId, ruleId: plan.rule.id, alreadyMoved: false, losses: plan.losses, warnings: plan.warnings };
}

interface AbortContext {
  input: MoveNativeInput;
  locale: NativeLocale;
  now: () => Date;
  fail: Fail;
  rowId: string;
  nativeId: string;
  envelope: SnapshotEnvelope;
  ruleId: string | null;
}

/**
 * REL-3: the native is deleted and Won has no working rule for it. Take the Won
 * rule out first (checked: if it stays, recreating the native would make the
 * discount apply twice), then put the native back from the snapshot at once.
 */
async function abortAfterDelete(ctx: AbortContext, item: MoveErrorItem): Promise<MoveResult> {
  const { input, locale, now, fail, rowId, nativeId, envelope } = ctx;
  const { client, db, shop, saveAndSync } = input;
  const inBackup = async (state: "in_backup" | "rule_stuck"): Promise<MoveResult> => {
    await updateRow(db, rowId, { status: BACKUP_STATUS.failed, error: moveErrorText(item, locale, state) });
    return fail(item, state, { backupId: rowId, nativeRestored: false });
  };

  // 1. Won back to "no rule for this discount".
  const current = await loadConfig(db, shop);
  const saved = current.config.modules.codes.rules.some((r) => isRuleOf(r, ctx.ruleId, nativeId));
  if (saved) {
    if (current.readOnly) return inBackup("rule_stuck");
    const rolledBack = await safeSaveAndSync(saveAndSync, shop, withoutRule(current.config, ctx.ruleId, nativeId));
    if (!rolledBack.ok) return inBackup("rule_stuck");
  }

  // 2. The native back from the snapshot.
  let restored = await restoreNative(client, envelope, { ...input, now });
  if (!restored.ok && restored.codeTaken && !saved && !current.readOnly) {
    // A Won node may hold the code without its rule in the saved config (a sync
    // that died half-way): sync the saved config once, then try again.
    const resynced = await safeSaveAndSync(saveAndSync, shop, withoutRule(current.config, ctx.ruleId, nativeId));
    if (resynced.ok) restored = await restoreNative(client, envelope, { ...input, now });
  }
  if (!restored.ok) return inBackup("in_backup");

  const partly = restored.codesMissing > 0;
  const state: MoveState = partly ? "restored_partly" : "restored";
  await updateRow(db, rowId, {
    status: BACKUP_STATUS.failed,
    error: moveErrorText(item, locale, state, { missing: restored.codesMissing, pending: restored.codesPending }),
    snapshot: {
      ...envelope,
      restoredAs: {
        nativeId: restored.nativeId,
        at: now().toISOString(),
        ...(partly ? { codesMissing: restored.codesMissing, codesPending: restored.codesPending } : {}),
      },
    },
  });
  return fail(item, state, {
    backupId: rowId,
    nativeRestored: true,
    restoredNativeId: restored.nativeId,
    ...(partly ? { codesMissing: restored.codesMissing, codesPending: restored.codesPending } : {}),
  });
}

// --- Undo -----------------------------------------------------------------------------

export interface UndoMoveInput extends Common {
  backupId: string;
}

export function undoMove(input: UndoMoveInput): Promise<UndoResult> {
  return withShopLock(input.shop, () => undoLocked(input));
}

function codeItems(missing: number, pending: boolean): NotRestoredItem[] {
  if (missing <= 0) return [];
  return [pending ? { code: "codes_pending", count: missing } : { code: "codes_failed", count: missing }];
}

function notRestoredFor(native: NativeDiscount | null, missing: number, pending: boolean, locale: NativeLocale): string[] {
  const items: NotRestoredItem[] = [{ code: "usage_count" }];
  if (native?.oncePerCustomer) items.push({ code: "once_per_customer" });
  if (native && native.usageLimit !== null && native.usageCount > 0) items.push({ code: "usage_limit_full", limit: native.usageLimit });
  items.push(...codeItems(missing, pending));
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
  if (isLiveClaim(row)) return fail({ code: "in_progress" });
  if (envelope.restoredAs && !codesStillMissing(envelope)) {
    return { ok: true, alreadyRestored: true, nativeId: envelope.restoredAs.nativeId, notRestored: [] };
  }
  const native = nativeFromSnapshot(envelope);
  if (!native) return fail({ code: "backup_unreadable" });

  // Claim the row; a stale claim ("moving"/"undoing" of a dead process) is an unknown state.
  const unknownState = row.status === BACKUP_STATUS.backedUp || isClaim(row.status);
  const releaseStatus = isClaim(row.status) ? BACKUP_STATUS.backedUp : row.status;
  if (!(await claim(db, row, { status: BACKUP_STATUS.undoing }))) return fail({ code: "in_progress" });
  const release = (extra: Parameters<typeof updateRow>[2] = {}) => updateRow(db, row.id, { status: releaseStatus, ...extra });

  // A partial restore: add the codes that are still missing, from the snapshot.
  if (envelope.restoredAs && codesStillMissing(envelope)) {
    const finished = await finishRestoredCodes(client, envelope, { ...input, now });
    if (!finished.ok) {
      await release();
      return fail({ code: "backup_unreadable" });
    }
    const done = finished.missing === 0;
    await updateRow(db, row.id, {
      status: done ? BACKUP_STATUS.restored : releaseStatus,
      error: done ? null : undefined,
      snapshot: {
        ...envelope,
        restoredAs: {
          nativeId: envelope.restoredAs.nativeId,
          at: now().toISOString(),
          ...(done ? {} : { codesMissing: finished.missing, codesPending: finished.pending }),
        },
      },
    });
    return {
      ok: true,
      alreadyRestored: false,
      nativeId: envelope.restoredAs.nativeId,
      notRestored: codeItems(finished.missing, finished.pending).map((item) => notRestoredText(item, locale)),
    };
  }

  if (unknownState) {
    // A move stopped part-way (or its delete outcome was unknown): is the native still there?
    const exists = await nativeExists(client, row.nativeId, input);
    if (exists === null) {
      await release();
      return fail({ code: "check_failed", detail: "discountNode" });
    }
    if (exists) {
      const loaded = await loadConfig(db, shop);
      if (loaded.config.modules.codes.rules.some((r) => isRuleOf(r, row.wonRuleId, row.nativeId))) {
        if (loaded.readOnly) {
          await release();
          return fail({ code: "config_read_only" });
        }
        const removed = await safeSaveAndSync(input.saveAndSync, shop, withoutRule(loaded.config, row.wonRuleId, row.nativeId));
        if (!removed.ok) {
          await release();
          return fail({ code: "remove_rule_failed", detail: removed.message });
        }
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
    if (loaded.readOnly) {
      await release();
      return fail({ code: "config_read_only" });
    }
    const removed = await safeSaveAndSync(input.saveAndSync, shop, withoutRule(loaded.config, row.wonRuleId, row.nativeId));
    if (!removed.ok) {
      // It may have saved or synced part of it: put the rule back as it was.
      await safeSaveAndSync(input.saveAndSync, shop, loaded.config);
      await release();
      return fail({ code: "remove_rule_failed", detail: removed.message });
    }
  }

  // 2. Recreate the native discount from the snapshot.
  const restored = await restoreNative(client, envelope, { ...input, now });
  if (!restored.ok) {
    if (hadRule) {
      const back = await safeSaveAndSync(input.saveAndSync, shop, loaded.config);
      if (back.ok) {
        await release();
        return fail({ code: "restore_failed_rule_back", detail: restored.message });
      }
    }
    const item: UndoErrorItem = { code: "restore_failed_nowhere", detail: restored.message };
    await updateRow(db, row.id, { status: BACKUP_STATUS.failed, error: undoErrorText(item, locale) });
    return fail(item);
  }

  const partly = restored.codesMissing > 0;
  await updateRow(db, row.id, {
    status: BACKUP_STATUS.restored,
    error: null,
    snapshot: {
      ...envelope,
      restoredAs: {
        nativeId: restored.nativeId,
        at: now().toISOString(),
        ...(partly ? { codesMissing: restored.codesMissing, codesPending: restored.codesPending } : {}),
      },
    },
  });
  return {
    ok: true,
    alreadyRestored: false,
    nativeId: restored.nativeId,
    notRestored: notRestoredFor(native, restored.codesMissing, restored.codesPending, locale),
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
  const reason: NotMovableReason | null =
    read.native.status === "EXPIRED" ? { code: "expired" } : (classifyNative(read.native) ?? incompleteSnapshot(read.native));
  if (reason) return fail({ code: "not_movable", reason: notMovableReasonText(reason, locale) });
  const loaded = await loadConfig(input.db, input.shop);
  try {
    const plan = planMove(read.native, loaded.config, { locale, now: (input.now ?? (() => new Date()))() });
    return { ok: true, native: read.native, plan };
  } catch (error) {
    return fail({ code: "not_movable", reason: error instanceof Error ? error.message : String(error) });
  }
}
