// One-click move of a native Shopify discount into Won, and its undo
// (spec §4.1, docs/won-discounts/rozhodnuti.md "Přesun nativních slev":
// backup → create in Won → delete the native; undo = restore the native from
// the backup and remove the Won rule). The order depends on the discount:
//   automatic   backup → Won rule saved, synced and confirmed LIVE → delete the
//               native. Both may apply for a moment; if the delete fails (or
//               its outcome is unknown) the Won rule is rolled back, checked
//               live, so a double discount never lasts.
//   code        backup → delete the native → Won rule. The exception the
//               decision allows: Shopify refuses a code text that another
//               discount holds, even an expired or deactivated one (verified
//               live), so the native must release its code first.
//
// REL-3, "what if this request dies mid-way?":
//   before the claim         nothing changed; a retry starts over.
//   claimed, no delete       the native is still live; the row is released.
//   refusals                 every check the config save would make (code
//                            limit, code hashes, function-config budget,
//                            stored size, unreadable / newer config) runs as a
//                            dry run BEFORE the delete (F1): a move that is
//                            certain to fail never deletes anything.
//   delete unanswered        the store is re-checked with backoff (F3, ~20 s):
//                            gone → the move goes on; still there after every
//                            check → "backed_up" with the backup listed (never
//                            recorded as "not deleted" without an answer);
//                            checks failed → "backed_up", outcome unknown. A
//                            retried move or an undo re-checks and converges.
//   deleted, Won step fails  the Won rule is rolled back FIRST (checked), then
//   (or any refusal after    Shopify is read LIVE (F2: the shop function config
//    a resumed delete)       and the code's holder) and resynced once if it
//                            still runs the rule; only then is the native
//                            restored from the snapshot (same code, the usage
//                            limit set to what is left, F1). If the rule cannot
//                            be removed or its absence cannot be confirmed,
//                            the native is NOT recreated (it would apply
//                            twice): status "failed", undo finishes.
//   restore answer lost      a restore marker is written before the create
//                            (F8); an automatic discount is looked up BEFORE
//                            any create; a look-up that cannot be read never
//                            creates ("restore_unknown", the Won rule is not put
//                            back on top) and a later attempt looks again.
//   any exception after the  (F7) the claim is released; if the native was
//   claim                    deleted, the REL-3 restore above runs at once.
//                            A claim left by a dead process is resolved from
//                            the live state by resolveStaleClaims (Přehled).
//   undo: Won rule removed, restore fails
//                            the rule is put back (checked, F9: "still runs
//                            through Won" only when it is); if that fails too,
//                            status "failed" and a later undo retries.
// Concurrency: per shop, operations run one at a time in this process, and
// across app instances every move / undo first CLAIMS its backup row with a
// compare-and-set (status → "moving" / "undoing"; a fresh row loses to an older
// live claim). Every config write names the config version it was built on
// and is retried on a conflict (F12), so another instance's write is never
// dropped. Idempotent: moving an already moved nativeId returns the existing
// result; undoing an already restored backup does nothing.

import type { DiscountRule, WonDiscountsConfig } from "@won/core/discounts/config";

import type { PrismaClient } from "../../generated/prisma/client";
import { type ConfigValidationFailure, loadConfig, validateConfigForSave } from "../config.server";
import { checkActiveCodeRuleLimit } from "../config-guards.server";
import { classifyNative, incompleteSnapshot } from "./classify.ts";
import {
  type MoveErrorItem,
  moveErrorText,
  type MoveState,
  type MoveStateDetails,
  type NotRestoredItem,
  notMovableReasonText,
  notRestoredText,
  staleClaimText,
  type UndoErrorItem,
  undoErrorText,
} from "./copy.ts";
import { readShopContext } from "./detect.server.ts";
import { NotMovableError, planMove } from "./map.server.ts";
import { readNativeDiscount } from "./read.server.ts";
import { describeUserErrors, type RequestOptions, runGql, userErrorsOf } from "./request.server.ts";
import {
  findRestoredCopy,
  finishRestoredCodes,
  makeSnapshot,
  nativeFromSnapshot,
  parseSnapshot,
  restoreNative,
  type RestoreResult,
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
/** F3: waits (ms) before each existence re-check after an unanswered delete (~20 s in all). */
export const DELETE_RECHECK_DELAYS_MS: readonly number[] = [2_000, 6_000, 12_000];
/** F12: attempts of one config write when another writer changed the config meanwhile. */
const CONFIG_WRITE_ATTEMPTS = 3;
/** Stale claims resolved per sweep (each costs a Shopify read). */
const STALE_SWEEP_BATCH = 10;

/**
 * Heartbeat of a running claim: its timestamp is refreshed at every step that
 * may take long (each bulk code chunk of a restore, before and after a sync),
 * so a long restore (up to 10 000 codes) is never taken over as stale.
 * Best effort: a failed refresh never stops the operation.
 */
async function heartbeat(db: PrismaClient, rowId: string): Promise<void> {
  try {
    await db.nativeDiscountBackup.updateMany({
      where: { id: rowId, status: { in: [BACKUP_STATUS.moving, BACKUP_STATUS.undoing] } },
      data: { updatedAt: new Date() },
    });
  } catch {
    // The next step's own write (or the stale-claim sweep) settles the row.
  }
}

export interface NativeOpOptions extends RequestOptions {
  locale?: NativeLocale;
  /** Clock for snapshots and plans (tests). Claims always use the wall clock (Prisma's updatedAt). */
  now?: () => Date;
  /** Polls of a bulk code creation during a restore. */
  bulkPolls?: number;
  /** Delays of the existence re-checks after an unanswered delete. Default DELETE_RECHECK_DELAYS_MS. */
  deleteRecheckDelaysMs?: readonly number[];
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

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error)).slice(0, 300);

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
  baseVersion: string | null,
): Promise<SaveAndSyncResult> {
  try {
    const result = await saveAndSync({ shop, config, baseVersion });
    if (result && result.ok === true) return { ok: true };
    const message = result && "message" in result && result.message ? result.message : "sync failed";
    return { ok: false, message, ...(result && "conflict" in result && result.conflict ? { conflict: true } : {}) };
  } catch (error) {
    return { ok: false, message: errorText(error) };
  }
}

type WriteResult = { ok: true } | { ok: false; message: string; blocked?: "read_only" | "unreadable" };

/**
 * Read the config, apply `change`, save + sync it on top of exactly the version
 * read (F12). Another writer's change in between is never overwritten: the
 * write is retried on the fresh config.
 */
async function writeConfig(input: Common, change: (config: WonDiscountsConfig) => WonDiscountsConfig): Promise<WriteResult> {
  let last: WriteResult = { ok: false, message: "not written" };
  for (let attempt = 1; attempt <= CONFIG_WRITE_ATTEMPTS; attempt++) {
    const loaded = await loadConfig(input.db, input.shop);
    if (loaded.readOnly) return { ok: false, message: "the settings belong to a newer app version", blocked: "read_only" };
    if (loaded.unreadable) return { ok: false, message: "the saved settings cannot be read", blocked: "unreadable" };
    const result = await safeSaveAndSync(input.saveAndSync, input.shop, change(loaded.config), loaded.version);
    if (result.ok) return result;
    last = { ok: false, message: result.message };
    if (!result.conflict) return last;
  }
  return last;
}

// --- Shopify helpers ------------------------------------------------------------------

/** true / false, or null when it could not be checked. */
async function nativeExists(client: AdminClient, id: string, options: RequestOptions): Promise<boolean | null> {
  const result = await runGql(client, "exists", { id }, options);
  if (!result.ok) return null;
  return Boolean(result.data?.discountNode?.id);
}

type DeleteOutcome =
  | { outcome: "deleted" }
  /** Shopify answered and refused (or throttled before running): the native is live. */
  | { outcome: "not_deleted"; message: string }
  /** No answer, and every re-check still saw it: most likely not deleted, but never recorded as proof. */
  | { outcome: "still_there"; message: string }
  | { outcome: "unknown"; message: string };

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function deleteNative(client: AdminClient, native: NativeDiscount, options: NativeOpOptions): Promise<DeleteOutcome> {
  const code = native.method === "code";
  const result = await runGql(client, code ? "codeDelete" : "automaticDelete", { id: native.id }, options);
  let message: string;
  if (result.ok) {
    const payload = result.data?.[code ? "discountCodeDelete" : "discountAutomaticDelete"];
    const errors = userErrorsOf(payload);
    if (errors.length === 0 && payload) return { outcome: "deleted" };
    if (errors.length > 0) return { outcome: "not_deleted", message: describeUserErrors(errors) };
    message = (result.partialErrors ?? ["no answer"]).join("; ");
  } else if (result.kind === "throttled") {
    // Rate limited before execution, even after the retries: nothing happened.
    return { outcome: "not_deleted", message: result.message };
  } else {
    message = result.message;
  }
  // No usable answer: the delete may land late (an abandoned request is not
  // cancelled). The store decides, looked at several times with backoff (F3).
  const sleep = options.sleep ?? defaultSleep;
  let alwaysThere = true;
  for (const delay of options.deleteRecheckDelaysMs ?? DELETE_RECHECK_DELAYS_MS) {
    await sleep(delay);
    const exists = await nativeExists(client, native.id, options);
    if (exists === false) return { outcome: "deleted" };
    if (exists === null) alwaysThere = false;
  }
  return alwaysThere ? { outcome: "still_there", message } : { outcome: "unknown", message };
}

type LiveCheck = { clean: true } | { clean: false; unknown: boolean; detail: string };

/**
 * F2: does Shopify still run the Won rule for this discount? Read LIVE, never
 * from the database: the shop function config must not list `ruleId`, and for
 * a code discount its first code must not sit on an app (Won) discount.
 */
async function wonRuleLive(client: AdminClient, ruleId: string | null, native: NativeDiscount | null, options: RequestOptions): Promise<LiveCheck> {
  if (ruleId !== null) {
    const result = await runGql(client, "shopFunctionConfig", undefined, options);
    if (!result.ok) return { clean: false, unknown: true, detail: result.message };
    const shop = result.data?.shop;
    if (!shop || typeof shop !== "object") return { clean: false, unknown: true, detail: "no shop in the answer" };
    const value = shop.metafield?.value;
    if (typeof value === "string") {
      let rules: unknown;
      try {
        rules = JSON.parse(value)?.modules?.codes?.rules;
      } catch {
        return { clean: false, unknown: true, detail: "the shop function config is not JSON" };
      }
      if (Array.isArray(rules) && rules.some((r) => (r as { id?: unknown } | null)?.id === ruleId)) {
        return { clean: false, unknown: false, detail: "the shop function config still has the rule" };
      }
    } else if (shop.metafield !== null && shop.metafield !== undefined) {
      return { clean: false, unknown: true, detail: "the shop function config has no value" };
    }
  }
  const code = native?.method === "code" ? native.codes[0] : undefined;
  if (code) {
    const found = await runGql(client, "codeLookup", { code }, options);
    if (!found.ok) return { clean: false, unknown: true, detail: found.message };
    if (found.data?.codeDiscountNodeByCode?.codeDiscount?.__typename === "DiscountCodeApp") {
      return { clean: false, unknown: false, detail: `the code ${code} is still on an app discount` };
    }
  }
  return { clean: true };
}

/** F2: the rule must be gone LIVE before the native comes back; a stuck one is resynced once. */
async function ensureNotLive(
  input: Common,
  ruleId: string | null,
  nativeId: string,
  native: NativeDiscount | null,
): Promise<{ ok: true } | { ok: false; unknown: boolean; detail: string }> {
  let live = await wonRuleLive(input.client, ruleId, native, input);
  if (live.clean) return { ok: true };
  if (live.unknown) return { ok: false, unknown: true, detail: live.detail };
  // A sync that died half-way left it running: sync the saved config (without the rule) once.
  const resynced = await writeConfig(input, (config) => withoutRule(config, ruleId, nativeId));
  if (!resynced.ok) return { ok: false, unknown: false, detail: `${live.detail}; ${resynced.message}` };
  live = await wonRuleLive(input.client, ruleId, native, input);
  return live.clean ? { ok: true } : { ok: false, unknown: live.unknown, detail: live.detail };
}

/** F1: uses of the Won code node so far (read before it is removed), null when unreadable. */
async function readWonUses(client: AdminClient, native: NativeDiscount, options: RequestOptions): Promise<number | null> {
  const code = native.codes[0];
  if (!code) return null;
  const result = await runGql(client, "codeLookup", { code }, options);
  if (!result.ok) return null;
  const discount = result.data?.codeDiscountNodeByCode?.codeDiscount;
  if (discount?.__typename !== "DiscountCodeApp") return null;
  const used = discount.asyncUsageCount;
  return typeof used === "number" && Number.isSafeInteger(used) && used >= 0 ? used : null;
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

/** The envelope without its restore marker (the restore settled one way or the other). */
function withoutMarker(envelope: SnapshotEnvelope): SnapshotEnvelope {
  const rest = { ...envelope };
  delete rest.restoring;
  return rest;
}

/** The envelope recording where the discount is back, marker cleared. */
function settled(envelope: SnapshotEnvelope, restoredAs: NonNullable<SnapshotEnvelope["restoredAs"]>): SnapshotEnvelope {
  return { ...withoutMarker(envelope), restoredAs };
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

/**
 * Restore with the marker written first (F8) and one resync when a Won node
 * still holds the code (F10).
 */
async function restoreChecked(
  input: Common,
  envelope: SnapshotEnvelope,
  rowId: string,
  ruleId: string | null,
  nativeId: string,
  now: () => Date,
  usedSoFar: number,
): Promise<RestoreResult> {
  const options = {
    ...input,
    now,
    usedSoFar,
    onProgress: () => heartbeat(input.db, rowId),
    onBeforeCreate: async () => {
      envelope.restoring = { at: now().toISOString() };
      await updateRow(input.db, rowId, { snapshot: envelope });
    },
  };
  let restored = await restoreNative(input.client, envelope, options);
  if (!restored.ok && restored.codeTaken) {
    // A Won node may hold the code without its rule in the saved config (a sync
    // that died half-way): sync the saved config once, then try again.
    const resynced = await writeConfig(input, (config) => withoutRule(config, ruleId, nativeId));
    if (resynced.ok) restored = await restoreNative(input.client, envelope, options);
  }
  return restored;
}

// --- Move -----------------------------------------------------------------------------

export interface MoveNativeInput extends Common {
  nativeId: string;
  /** Codes of the shop's other native discounts (the dry run's hash-collision check, F1). */
  otherCodes?: readonly string[];
}

export function moveNative(input: MoveNativeInput): Promise<MoveResult> {
  return withShopLock(input.shop, () => moveLocked(input));
}

type Fail = (
  item: MoveErrorItem,
  state?: MoveState,
  extra?: Partial<Extract<MoveResult, { ok: false }>>,
  details?: MoveStateDetails,
) => MoveResult;

function validationItem(check: ConfigValidationFailure, current: WonDiscountsConfig): MoveErrorItem {
  switch (check.reason) {
    case "too_many_code_rules":
      return { code: "code_rule_limit", count: checkActiveCodeRuleLimit(current).count, limit: check.limit };
    case "code_hash_collision":
      return { code: "code_hash_collision", codes: check.collisions };
    case "function_config_too_large":
      return { code: "config_budget", bytes: check.bytes, budget: check.budget };
    case "config_too_large":
      return { code: "config_too_large" };
  }
}

async function moveLocked(input: MoveNativeInput): Promise<MoveResult> {
  const { client, db, shop, nativeId } = input;
  const locale = input.locale ?? "cs";
  const now = input.now ?? (() => new Date());
  const fail: Fail = (item, state = "unchanged", extra = {}, details = {}) => ({
    ok: false,
    code: item.code,
    state,
    error: moveErrorText(item, locale, state, { missing: extra.codesMissing, pending: extra.codesPending, ...details }),
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
  const unknownFail = (detail: string) => fail({ code: "outcome_unknown", detail }, "unknown", { backupId: previous?.id });

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

  const ctx: AbortContext = {
    input,
    locale,
    now,
    fail,
    rowId,
    nativeId,
    native,
    envelope,
    ruleId: previous?.wonRuleId ?? null,
    deleted,
    resumable,
    ruleMayBeLive: false,
  };

  // F7: whatever throws from here on, the claim is released and a deleted native restored.
  try {
    return await moveClaimed(ctx);
  } catch (error) {
    const item: MoveErrorItem = { code: "internal_error", detail: errorText(error) };
    try {
      if (ctx.deleted) return await abortAfterDelete(ctx, item);
      return await refuse(ctx, item);
    } catch {
      // The database itself is gone: resolveStaleClaims settles the row later.
      return fail(item, "unknown", { backupId: rowId });
    }
  }
}

interface AbortContext {
  input: MoveNativeInput;
  locale: NativeLocale;
  now: () => Date;
  fail: Fail;
  rowId: string;
  nativeId: string;
  native: NativeDiscount;
  envelope: SnapshotEnvelope;
  ruleId: string | null;
  /** True once the native is (known to be) deleted in Shopify. */
  deleted: boolean;
  resumable: boolean;
  /** Automatic, create-first: the Won rule may run next to the live native until rolled back. */
  ruleMayBeLive: boolean;
}

/**
 * A refusal after the claim: put the discount back if it is gone, else take a
 * Won rule that may run next to it out again (create-first), then release the row.
 */
async function refuse(ctx: AbortContext, item: MoveErrorItem): Promise<MoveResult> {
  const { input, locale, now, fail, rowId, nativeId, envelope } = ctx;
  if (ctx.deleted) return abortAfterDelete(ctx, item);
  if (ctx.ruleMayBeLive) {
    if (!(await rollbackRule(ctx))) return bothLive(ctx, item);
    ctx.ruleMayBeLive = false;
  }
  if (ctx.resumable) {
    // The native is live (just read): record where it is, so undo has nothing to do.
    await updateRow(input.db, rowId, {
      status: BACKUP_STATUS.failed,
      error: moveErrorText(item, locale),
      snapshot: settled(envelope, { nativeId, at: now().toISOString() }),
    });
  } else {
    await input.db.nativeDiscountBackup.delete({ where: { id: rowId } });
  }
  return fail(item, "unchanged", ctx.resumable ? { backupId: rowId } : {});
}

/**
 * The Won rule of a create-first move out again, checked in the saved config
 * AND live (the shop function config). False when that cannot be confirmed.
 */
async function rollbackRule(ctx: AbortContext): Promise<boolean> {
  const { input, nativeId } = ctx;
  const current = await loadConfig(input.db, input.shop);
  if (current.config.modules.codes.rules.some((r) => isRuleOf(r, ctx.ruleId, nativeId))) {
    const removed = await writeConfig(input, (config) => withoutRule(config, ctx.ruleId, nativeId));
    if (!removed.ok) return false;
  }
  return (await ensureNotLive(input, ctx.ruleId, nativeId, null)).ok;
}

/** The native is live and its Won rule could not be taken out: both may apply until an undo. */
async function bothLive(ctx: AbortContext, item: MoveErrorItem): Promise<MoveResult> {
  await updateRow(ctx.input.db, ctx.rowId, { status: BACKUP_STATUS.backedUp, error: moveErrorText(item, ctx.locale, "both_live") });
  return ctx.fail(item, "both_live", { backupId: ctx.rowId });
}

/** Does Shopify run `ruleId` (the shop function config lists it)? Null when unreadable. */
async function ruleRunsLive(client: AdminClient, ruleId: string, options: RequestOptions): Promise<boolean | null> {
  const result = await runGql(client, "shopFunctionConfig", undefined, options);
  if (!result.ok) return null;
  const value = result.data?.shop?.metafield?.value;
  if (typeof value !== "string") return result.data?.shop ? false : null;
  try {
    const rules = JSON.parse(value)?.modules?.codes?.rules;
    return Array.isArray(rules) && rules.some((r) => (r as { id?: unknown } | null)?.id === ruleId);
  } catch {
    return null;
  }
}

function writeFailureItem(result: Extract<WriteResult, { ok: false }>): MoveErrorItem {
  if (result.blocked === "read_only") return { code: "config_read_only" };
  if (result.blocked === "unreadable") return { code: "config_unreadable" };
  return { code: "sync_failed", detail: result.message };
}

/**
 * Automatic discounts (rozhodnuti.md order): the Won rule first — saved,
 * synced and confirmed live — while the native still runs; then the native is
 * deleted. A delete that fails or cannot be confirmed takes the Won rule out
 * again (checked live), so the two never keep applying together.
 */
async function moveCreateFirst(ctx: AbortContext, plan: MovePlan): Promise<MoveResult> {
  const { input, locale, now, fail, rowId, nativeId, native, envelope } = ctx;
  const { client, db } = input;

  // 4. The Won rule, on top of the config as it is NOW (F12: retried on a conflict).
  ctx.ruleMayBeLive = true;
  await heartbeat(db, rowId);
  const synced = await writeConfig(input, (config) => withRule(config, plan.rule, nativeId));
  await heartbeat(db, rowId);
  if (!synced.ok) return refuse(ctx, writeFailureItem(synced));
  const live = await ruleRunsLive(client, plan.rule.id, input);
  if (live !== true) {
    const detail = live === null ? "could not confirm that Shopify runs the Won rule" : "Shopify does not run the Won rule yet";
    return refuse(ctx, { code: "sync_failed", detail });
  }

  // 5. Now the native goes (until here both could apply for a moment; the dialog says so).
  const removed = await deleteNative(client, native, input);
  if (removed.outcome === "deleted") {
    ctx.deleted = true;
    ctx.ruleMayBeLive = false;
    await updateRow(db, rowId, { status: BACKUP_STATUS.moved, error: null, wonRuleId: plan.rule.id });
    return { ok: true, backupId: rowId, ruleId: plan.rule.id, alreadyMoved: false, losses: plan.losses, warnings: plan.warnings };
  }
  // Not deleted, or not sure: the Won rule goes again — never a lasting double discount.
  const item: MoveErrorItem =
    removed.outcome === "not_deleted" ? { code: "delete_failed", detail: removed.message } : { code: "outcome_unknown", detail: removed.message };
  if (!(await rollbackRule(ctx))) return bothLive(ctx, item);
  ctx.ruleMayBeLive = false;
  if (removed.outcome === "not_deleted") {
    // Shopify answered: the native is live under its own id, undo has nothing to do.
    await updateRow(db, rowId, {
      status: BACKUP_STATUS.failed,
      error: moveErrorText(item, locale),
      snapshot: settled(envelope, { nativeId, at: now().toISOString() }),
    });
    return fail(item, "unchanged", { backupId: rowId });
  }
  // The delete may land late: the backup stays listed (F3); a retry and undo both re-check the store.
  await updateRow(db, rowId, { status: BACKUP_STATUS.backedUp, error: moveErrorText(item, locale, "rolled_back_unknown") });
  return fail(item, "rolled_back_unknown", { backupId: rowId });
}

async function moveClaimed(ctx: AbortContext): Promise<MoveResult> {
  const { input, locale, now, fail, rowId, nativeId, native, envelope } = ctx;
  const { client, db, shop } = input;

  // F8: a resumed move whose earlier restore may have landed: look for that copy first.
  if (ctx.deleted && envelope.restoring) {
    const copy = await findRestoredCopy(client, envelope, input);
    if (!copy.ok) {
      const item: MoveErrorItem = { code: "outcome_unknown", detail: copy.message };
      await updateRow(db, rowId, { status: BACKUP_STATUS.backedUp, error: moveErrorText(item, locale, "unknown") });
      return fail(item, "unknown", { backupId: rowId });
    }
    if (copy.id) {
      const item: MoveErrorItem = { code: "restored_earlier" };
      const details = { oncePerCustomer: native.oncePerCustomer };
      await updateRow(db, rowId, {
        status: BACKUP_STATUS.failed,
        error: moveErrorText(item, locale, "restored", details),
        snapshot: settled(envelope, { nativeId: copy.id, at: now().toISOString() }),
      });
      return fail(item, "restored", { backupId: rowId, nativeRestored: true, restoredNativeId: copy.id }, details);
    }
  }

  // 3. Plan against the current config and dry-run every check the save makes (F1):
  //    a move that the save would refuse is refused while the native is live.
  const loaded = await loadConfig(db, shop);
  if (loaded.readOnly) return refuse(ctx, { code: "config_read_only" });
  if (loaded.unreadable) return refuse(ctx, { code: "config_unreadable" });
  let plan: MovePlan;
  try {
    plan = planMove(native, loaded.config, { locale, now: now() });
  } catch (error) {
    const reason = error instanceof NotMovableError ? error.message : String(error);
    return refuse(ctx, { code: "not_movable", reason });
  }
  ctx.ruleId = plan.rule.id;
  const planCodes = new Set(plan.rule.codes ?? []);
  const holder = loaded.config.modules.codes.rules.find(
    (r) => r.origin?.nativeId !== nativeId && (r.codes ?? []).some((c) => planCodes.has(c)),
  );
  if (holder) {
    const codes = (holder.codes ?? []).filter((c) => planCodes.has(c));
    return refuse(ctx, { code: "code_taken", codes, ruleName: holder.name || holder.id });
  }
  const check = validateConfigForSave(withRule(loaded.config, plan.rule, nativeId), { otherCodes: input.otherCodes });
  if (!check.ok) return refuse(ctx, validationItem(check, loaded.config));
  await updateRow(db, rowId, { wonRuleId: plan.rule.id });

  // Automatic discounts: create first, delete after (the decision's order).
  if (!ctx.deleted && native.method === "automatic") return moveCreateFirst(ctx, plan);

  // 4. Code discounts: delete the native first — Shopify refuses a code text
  //    another discount holds, even an expired or deactivated one (verified
  //    live), so its code must be free before the Won node can take it.
  if (!ctx.deleted) {
    const removed = await deleteNative(client, native, input);
    if (removed.outcome === "not_deleted") {
      // Shopify answered: still there under its own id, undo has nothing to do.
      const item: MoveErrorItem = { code: "delete_failed", detail: removed.message };
      await updateRow(db, rowId, {
        status: BACKUP_STATUS.failed,
        error: moveErrorText(item, locale),
        snapshot: settled(envelope, { nativeId, at: now().toISOString() }),
      });
      return fail(item, "unchanged", { backupId: rowId });
    }
    if (removed.outcome === "still_there" || removed.outcome === "unknown") {
      // No answer: keep the backup open and listed (F3); a retry and undo both re-check the store.
      const state: MoveState = removed.outcome === "still_there" ? "still_there" : "unknown";
      const item: MoveErrorItem = { code: "outcome_unknown", detail: removed.message };
      await updateRow(db, rowId, { status: BACKUP_STATUS.backedUp, error: moveErrorText(item, locale, state) });
      return fail(item, state, { backupId: rowId });
    }
    ctx.deleted = true;
  }

  // 5. Add the rule and sync, on top of the config as it is NOW (F12: retried on a conflict).
  await heartbeat(db, rowId);
  const synced = await writeConfig(input, (config) => withRule(config, plan.rule, nativeId));
  await heartbeat(db, rowId);
  if (!synced.ok) return abortAfterDelete(ctx, writeFailureItem(synced));
  await updateRow(db, rowId, { status: BACKUP_STATUS.moved, error: null, wonRuleId: plan.rule.id });
  return { ok: true, backupId: rowId, ruleId: plan.rule.id, alreadyMoved: false, losses: plan.losses, warnings: plan.warnings };
}

/**
 * REL-3: the native is deleted and Won has no working rule for it. Take the Won
 * rule out first (checked: if it stays, recreating the native would make the
 * discount apply twice), confirm LIVE that Shopify no longer runs it (F2), then
 * put the native back from the snapshot at once, with what is left of its
 * usage limit (F1).
 */
async function abortAfterDelete(ctx: AbortContext, item: MoveErrorItem): Promise<MoveResult> {
  const { input, locale, now, fail, rowId, nativeId, native, envelope } = ctx;
  const { db, shop } = input;
  const inBackup = async (state: MoveState): Promise<MoveResult> => {
    await updateRow(db, rowId, { status: BACKUP_STATUS.failed, error: moveErrorText(item, locale, state) });
    return fail(item, state, { backupId: rowId, nativeRestored: false });
  };

  // 1. Won back to "no rule for this discount" (the database).
  const current = await loadConfig(db, shop);
  if (current.config.modules.codes.rules.some((r) => isRuleOf(r, ctx.ruleId, nativeId))) {
    const rolledBack = await writeConfig(input, (config) => withoutRule(config, ctx.ruleId, nativeId));
    if (!rolledBack.ok) return inBackup("rule_stuck");
  }

  // 2. …and in Shopify, read live (F2).
  const gone = await ensureNotLive(input, ctx.ruleId, nativeId, native);
  if (!gone.ok) return inBackup(gone.unknown ? "rule_unverified" : "rule_stuck");

  // 3. The native back from the snapshot.
  const restored = await restoreChecked(input, envelope, rowId, ctx.ruleId, nativeId, now, native.usageCount);
  if (!restored.ok) {
    if (restored.unknown) return inBackup("restore_unknown");
    await updateRow(db, rowId, { snapshot: withoutMarker(envelope) });
    return inBackup("in_backup");
  }

  const partly = restored.codesMissing > 0;
  const state: MoveState = partly ? "restored_partly" : "restored";
  const details: MoveStateDetails = {
    missing: restored.codesMissing,
    pending: restored.codesPending,
    remaining: restored.usageLimit,
    oncePerCustomer: native.oncePerCustomer,
  };
  await updateRow(db, rowId, {
    status: BACKUP_STATUS.failed,
    error: moveErrorText(item, locale, state, details),
    snapshot: settled(envelope, {
      nativeId: restored.nativeId,
      at: now().toISOString(),
      ...(partly ? { codesMissing: restored.codesMissing, codesPending: restored.codesPending } : {}),
    }),
  });
  return fail(
    item,
    state,
    {
      backupId: rowId,
      nativeRestored: true,
      restoredNativeId: restored.nativeId,
      ...(partly ? { codesMissing: restored.codesMissing, codesPending: restored.codesPending } : {}),
    },
    details,
  );
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

function notRestoredFor(
  native: NativeDiscount,
  restored: Extract<RestoreResult, { ok: true }>,
  wonUses: number | null,
  locale: NativeLocale,
): string[] {
  const items: NotRestoredItem[] = [{ code: "new_id" }, { code: "usage_count" }];
  if (native.oncePerCustomer) items.push({ code: "once_per_customer" });
  if (native.method === "code" && native.usageLimit !== null) {
    if (restored.ended) items.push({ code: "usage_limit_spent", limit: native.usageLimit });
    else if (restored.usageLimit !== null) {
      items.push({ code: "usage_limit_remaining", limit: native.usageLimit, remaining: restored.usageLimit, wonUses });
    }
  }
  items.push(...codeItems(restored.codesMissing, restored.codesPending));
  return items.map((item) => notRestoredText(item, locale));
}

type UndoFail = (item: UndoErrorItem) => UndoResult;

async function undoLocked(input: UndoMoveInput): Promise<UndoResult> {
  const { db, shop, backupId } = input;
  const locale = input.locale ?? "cs";
  const now = input.now ?? (() => new Date());
  const fail: UndoFail = (item) => ({ ok: false, code: item.code, error: undoErrorText(item, locale) });

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

  const undo: UndoContext = { input, locale, now, fail, row, envelope, native, unknownState, releaseStatus, ruleRemoved: false };
  // F7: whatever throws from here on, the claim is released.
  try {
    return await undoClaimed(undo);
  } catch (error) {
    const item: UndoErrorItem = { code: "internal_error", detail: errorText(error) };
    try {
      // With the rule removed and the native not back, the row must say so (listed, undo again).
      await updateRow(db, row.id, undo.ruleRemoved ? { status: BACKUP_STATUS.failed, error: undoErrorText(item, locale) } : { status: releaseStatus });
    } catch {
      // The database itself is gone: resolveStaleClaims settles the row later.
    }
    return fail(item);
  }
}

interface UndoContext {
  input: UndoMoveInput;
  locale: NativeLocale;
  now: () => Date;
  fail: UndoFail;
  row: BackupRow;
  envelope: SnapshotEnvelope;
  native: NativeDiscount;
  unknownState: boolean;
  releaseStatus: string;
  /** True while the Won rule is out of the saved config and the native is not back. */
  ruleRemoved: boolean;
}

async function undoClaimed(undo: UndoContext): Promise<UndoResult> {
  const { input, locale, now, fail, row, envelope, native, releaseStatus } = undo;
  const { client, db, shop } = input;
  const release = (extra: Parameters<typeof updateRow>[2] = {}) => updateRow(db, row.id, { status: releaseStatus, ...extra });

  // A partial restore: add the codes that are still missing, from the snapshot.
  if (envelope.restoredAs && codesStillMissing(envelope)) {
    const finished = await finishRestoredCodes(client, envelope, { ...input, now, onProgress: () => heartbeat(db, row.id) });
    if (!finished.ok) {
      await release();
      return fail({ code: "backup_unreadable" });
    }
    const done = finished.missing === 0;
    await updateRow(db, row.id, {
      status: done ? BACKUP_STATUS.restored : releaseStatus,
      error: done ? null : undefined,
      snapshot: settled(envelope, {
        nativeId: envelope.restoredAs.nativeId,
        at: now().toISOString(),
        ...(done ? {} : { codesMissing: finished.missing, codesPending: finished.pending }),
      }),
    });
    return {
      ok: true,
      alreadyRestored: false,
      nativeId: envelope.restoredAs.nativeId,
      notRestored: codeItems(finished.missing, finished.pending).map((item) => notRestoredText(item, locale)),
    };
  }

  if (undo.unknownState) {
    // A move stopped part-way (or its delete outcome was unknown): is the native still there?
    const exists = await nativeExists(client, row.nativeId, input);
    if (exists === null) {
      await release();
      return fail({ code: "check_failed", detail: "discountNode" });
    }
    if (exists) {
      // It is live: no Won rule may run next to it.
      const loaded = await loadConfig(db, shop);
      if (loaded.config.modules.codes.rules.some((r) => isRuleOf(r, row.wonRuleId, row.nativeId))) {
        const removed = await writeConfig(input, (config) => withoutRule(config, row.wonRuleId, row.nativeId));
        if (!removed.ok) {
          await release();
          return fail(removed.blocked === "read_only" ? { code: "config_read_only" } : { code: "remove_rule_failed_both", detail: removed.message });
        }
      }
      const gone = await ensureNotLive(input, row.wonRuleId, row.nativeId, null);
      if (!gone.ok) {
        await release();
        return fail(gone.unknown ? { code: "check_failed", detail: gone.detail } : { code: "remove_rule_failed_both", detail: gone.detail });
      }
      await updateRow(db, row.id, {
        status: BACKUP_STATUS.restored,
        error: null,
        snapshot: settled(envelope, { nativeId: row.nativeId, at: now().toISOString() }),
      });
      return { ok: true, alreadyRestored: true, nativeId: row.nativeId, notRestored: [] };
    }
  }

  // 1. Uses through Won so far (F1), read before its node is removed.
  const wonUses = native.method === "code" && native.usageLimit !== null ? await readWonUses(client, native, input) : 0;

  // 2. Remove the Won rule first: its code node holds the code the native needs back.
  const loaded = await loadConfig(db, shop);
  const rule = loaded.config.modules.codes.rules.find((r) => isRuleOf(r, row.wonRuleId, row.nativeId)) ?? null;
  if (rule) {
    if (loaded.readOnly) {
      await release();
      return fail({ code: "config_read_only" });
    }
    undo.ruleRemoved = true;
    const removed = await writeConfig(input, (config) => withoutRule(config, row.wonRuleId, row.nativeId));
    if (!removed.ok) {
      // It may have saved or synced part of it: put the rule back, and SAY only what is confirmed (F9).
      const back = await writeConfig(input, (config) => withRule(config, rule, row.nativeId));
      if (back.ok) {
        undo.ruleRemoved = false;
        await release();
        return fail({ code: "remove_rule_failed", detail: removed.message });
      }
      const item: UndoErrorItem = { code: "remove_rule_failed_unverified", detail: removed.message };
      await updateRow(db, row.id, { status: BACKUP_STATUS.failed, error: undoErrorText(item, locale) });
      return fail(item);
    }
  }

  // 3. Shopify must no longer run it, read live (F2; a stuck rule is resynced once).
  const gone = await ensureNotLive(input, row.wonRuleId, row.nativeId, native);
  if (!gone.ok) {
    const item: UndoErrorItem = gone.unknown ? { code: "check_failed", detail: gone.detail } : { code: "rule_still_live", detail: gone.detail };
    await updateRow(db, row.id, rule ? { status: BACKUP_STATUS.failed, error: undoErrorText(item, locale) } : { status: releaseStatus });
    return fail(item);
  }

  // 4. Recreate the native discount from the snapshot, with what is left of its limit.
  const usedSoFar = native.usageCount + (wonUses ?? 0);
  const restored = await restoreChecked(input, envelope, row.id, row.wonRuleId, row.nativeId, now, usedSoFar);
  if (!restored.ok) {
    if (restored.unknown) {
      // It may have landed: putting the rule back could make it apply twice (F8).
      const item: UndoErrorItem = { code: "restore_unknown", detail: restored.message };
      await updateRow(db, row.id, { status: BACKUP_STATUS.failed, error: undoErrorText(item, locale) });
      return fail(item);
    }
    if (rule) {
      const back = await writeConfig(input, (config) => withRule(config, rule, row.nativeId));
      if (back.ok) {
        undo.ruleRemoved = false;
        await release({ snapshot: withoutMarker(envelope) });
        return fail({ code: "restore_failed_rule_back", detail: restored.message });
      }
    }
    const item: UndoErrorItem = { code: "restore_failed_nowhere", detail: restored.message };
    await updateRow(db, row.id, { status: BACKUP_STATUS.failed, error: undoErrorText(item, locale), snapshot: withoutMarker(envelope) });
    return fail(item);
  }

  const partly = restored.codesMissing > 0;
  await updateRow(db, row.id, {
    status: BACKUP_STATUS.restored,
    error: null,
    snapshot: settled(envelope, {
      nativeId: restored.nativeId,
      at: now().toISOString(),
      ...(partly ? { codesMissing: restored.codesMissing, codesPending: restored.codesPending } : {}),
    }),
  });
  undo.ruleRemoved = false;
  return {
    ok: true,
    alreadyRestored: false,
    nativeId: restored.nativeId,
    notRestored: notRestoredFor(native, restored, wonUses, locale),
  };
}

// --- Stale claims (F7) -------------------------------------------------------------------

export interface StaleSweepInput extends NativeOpOptions {
  client: AdminClient;
  db: PrismaClient;
  shop: string;
}

/**
 * Settle `moving` / `undoing` claims older than CLAIM_STALE_MS (their process
 * died: a crash, a deploy) from the LIVE state, so no row hangs as "in
 * progress": a native that is still in Shopify with no Won rule for it had
 * nothing changed (failed, restoredAs = itself); anything else becomes
 * `backed_up` with a note, which a retried move and an undo both converge
 * from. Compare-and-set, so a process that is alive after all wins. Returns
 * how many rows it settled.
 */
export function resolveStaleClaims(input: StaleSweepInput): Promise<number> {
  return withShopLock(input.shop, () => sweepStaleClaims(input));
}

async function sweepStaleClaims(input: StaleSweepInput): Promise<number> {
  const { client, db, shop } = input;
  const locale = input.locale ?? "cs";
  const stale = await db.nativeDiscountBackup.findMany({
    where: { shop, status: { in: [BACKUP_STATUS.moving, BACKUP_STATUS.undoing] }, updatedAt: { lt: new Date(Date.now() - CLAIM_STALE_MS) } },
    orderBy: { updatedAt: "asc" },
    take: STALE_SWEEP_BATCH,
  });
  let resolved = 0;
  for (const row of stale) {
    const envelope = parseSnapshot(row.snapshot);
    const exists = await nativeExists(client, row.nativeId, input);
    if (exists === null) continue; // cannot tell now: the next sweep tries again
    const loaded = await loadConfig(db, shop);
    const ruleSaved = loaded.config.modules.codes.rules.some((r) => isRuleOf(r, row.wonRuleId, row.nativeId));
    const untouched = envelope !== null && exists && !ruleSaved && !envelope.restoring;
    const data = untouched
      ? {
          status: BACKUP_STATUS.failed,
          error: null,
          snapshot: JSON.stringify(settled(envelope, { nativeId: row.nativeId, at: new Date().toISOString() })),
        }
      : { status: BACKUP_STATUS.backedUp, error: staleClaimText(locale) };
    if (await claim(db, row, data)) resolved += 1;
  }
  return resolved;
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
