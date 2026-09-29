// Won Discounts config persistence (doctrine DATA-2/DATA-3/DATA-4, spec §2).
// This is the ONLY place that touches ShopConfig/ConfigVersion — admin routes
// and webhooks call through here so every reader/writer agrees on exactly one
// interpretation of a stored config. Shape validation (sanitize/migrate) lives
// in @won/core/discounts/config; this module only owns the Prisma I/O.

import { AsyncLocalStorage } from "node:async_hooks";
import { createHash } from "node:crypto";

import {
  CONFIG_LIMITS,
  createDefaultConfig,
  isNewerSchema,
  readStoredConfig,
  sanitizeConfig,
  SCHEMA_VERSION,
  type ConfigIssue,
  type WonDiscountsConfig,
} from "@won/core/discounts/config";
import { FUNCTION_CONFIG_BUDGET_BYTES } from "@won/core/discounts/function-config";
import { buildShopFunctionConfigWorstCase } from "@won/core/discounts/function-payload";

import type { PrismaClient } from "../generated/prisma/client";
import { checkActiveCodeRuleLimit, checkCodeHashCollisions } from "./config-guards.server";
import { withMarketCountries, type ShopMarket } from "./sync/markets";

/** How long ConfigVersion rows are kept before being pruned (support/rollback window). */
export const CONFIG_HISTORY_RETENTION_DAYS = 90;

export interface LoadedConfig {
  /** Always a freshly allocated object: safe to mutate, never shared between shops. */
  config: WonDiscountsConfig;
  /**
   * True when the stored row was written by a newer schema than this code knows
   * (DATA-3, e.g. mid rolling deploy). `config` is still a usable best-effort view
   * for display, but saving it would drop the newer fields — saveConfig refuses.
   */
  readOnly: boolean;
  /** False when the shop has no stored row yet (`config` = the defaults). */
  exists: boolean;
  /**
   * True when a row EXISTS but cannot be read (not JSON, not a config object):
   * `config` is then the defaults for display only. Never sync it (it would
   * delete every Won discount) and never save over it silently — saveConfig
   * refuses unless `replaceUnreadable` (I3).
   */
  unreadable: boolean;
  /**
   * Opaque token of the stored row (a hash of its content), null when the shop
   * has no row. Pass it back as `SaveConfigOptions.expectedVersion` to save
   * only when nobody else wrote the config since it was read (F12: optimistic
   * concurrency across app instances).
   */
  version: string | null;
}

export type SaveConfigResult =
  | {
      ok: true;
      config: WonDiscountsConfig;
      issues: ConfigIssue[];
      versionId: string;
      /** Size of the function_config payload this config encodes to (C3). */
      functionConfigBytes: number;
    }
  | {
      /**
       * The discount function could not read this config (C3) in at least one of
       * the states the sync writes over time (every live campaign, or none):
       * nothing was written. `bytes` is the largest of those states.
       */
      ok: false;
      reason: "function_config_too_large";
      bytes: number;
      budget: number;
      config: WonDiscountsConfig;
      issues: ConfigIssue[];
    }
  | {
      /**
       * The sanitized config itself is over CONFIG_LIMITS.storedConfigBytes
       * (256 KiB, audit P2-1 backstop): nothing was written, no history row.
       */
      ok: false;
      reason: "config_too_large";
      bytes: number;
      limit: number;
      config: WonDiscountsConfig;
      issues: ConfigIssue[];
    }
  | {
      /**
       * More active code rules than MAX_ACTIVE_CODE_RULES (C2 fallback: one
       * Shopify node per code rule, Shopify caps active discount functions per
       * store): nothing was written. `issues` carries the human-readable reason.
       */
      ok: false;
      reason: "too_many_code_rules";
      count: number;
      limit: number;
      config: WonDiscountsConfig;
      issues: ConfigIssue[];
    }
  | {
      /**
       * Two codes (or a code and a known native code) share the 8-hex hash the
       * discount function matches codes by: nothing was written. `issues`
       * names the codes.
       */
      ok: false;
      reason: "code_hash_collision";
      collisions: string[][];
      config: WonDiscountsConfig;
      issues: ConfigIssue[];
    }
  | {
      /**
       * The stored row exists but cannot be read (I3): saving would silently
       * replace whatever it held with a config built on the defaults. Nothing
       * was written; retry with `replaceUnreadable: true` after the merchant
       * confirmed.
       */
      ok: false;
      reason: "unreadable_config";
      config: WonDiscountsConfig;
      issues: ConfigIssue[];
    }
  | {
      /** The stored row belongs to a newer schema (DATA-3): nothing was written. */
      ok: false;
      reason: "newer_schema";
      storedSchemaVersion: number;
    }
  | {
      /**
       * `expectedVersion` was given and the stored config is no longer that
       * version (another writer saved it meanwhile): nothing was written. Read
       * the config again, re-apply the change and save again.
       */
      ok: false;
      reason: "base_changed";
      config: WonDiscountsConfig;
      issues: ConfigIssue[];
    };

/** The failures validateConfigForSave can give (the save's own checks, without the database). */
export type ConfigValidationFailure = Extract<
  SaveConfigResult,
  { reason: "too_many_code_rules" | "code_hash_collision" | "function_config_too_large" | "config_too_large" }
>;

export type ConfigValidationResult =
  | { ok: true; config: WonDiscountsConfig; issues: ConfigIssue[]; data: string; functionConfigBytes: number }
  | ConfigValidationFailure;

/** The version token of a stored `data` string (see LoadedConfig.version). */
function versionOf(data: string): string {
  return createHash("sha256").update(data).digest("hex").slice(0, 32);
}

function parseStoredData(data: string): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(data) };
  } catch {
    return { ok: false };
  }
}

/** The schema version a row was written with: the column and the JSON must both be honoured. */
function storedSchemaVersion(row: { schemaVersion: number; data: string }): number {
  const parsed = parseStoredData(row.data);
  const jsonVersion =
    parsed.ok && isNewerSchema(parsed.value)
      ? (parsed.value as { schemaVersion: number }).schemaVersion
      : SCHEMA_VERSION;
  return Math.max(row.schemaVersion, jsonVersion);
}

/**
 * Read a shop's config. A shop with no row yet gets a fresh copy of the defaults
 * (never the shared DEFAULT_CONFIG object — audit P1-1); corrupted JSON (should
 * never happen, but disks and manual edits exist) also falls back to the
 * defaults rather than throwing (DATA-2 — never crash on bad stored data).
 */
export async function loadConfig(db: PrismaClient, shop: string): Promise<LoadedConfig> {
  const row = await db.shopConfig.findUnique({ where: { shop } });
  if (!row) return { config: createDefaultConfig(), readOnly: false, exists: false, unreadable: false, version: null };

  const readOnly = storedSchemaVersion(row) > SCHEMA_VERSION;
  const version = versionOf(row.data);
  const parsed = parseStoredData(row.data);
  if (!parsed.ok || !isConfigObject(parsed.value)) {
    return { config: createDefaultConfig(), readOnly, exists: true, unreadable: true, version };
  }
  return { config: readStoredConfig(parsed.value), readOnly, exists: true, unreadable: false, version };
}

/** A stored config is always a sanitized object with `modules`; anything else is unreadable. */
function isConfigObject(value: unknown): boolean {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const modules = (value as { modules?: unknown }).modules;
  return typeof modules === "object" && modules !== null && !Array.isArray(modules);
}

function rowIsUnreadable(row: { data: string }): boolean {
  const parsed = parseStoredData(row.data);
  return !parsed.ok || !isConfigObject(parsed.value);
}

/** Prisma error codes worth one more attempt: unique violation (lost create race), write conflict. */
const RETRYABLE_WRITE_ERRORS = new Set(["P2002", "P2034"]);
const SAVE_ATTEMPTS = 3;

function isRetryableWriteError(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === "string" && RETRYABLE_WRITE_ERRORS.has(code);
}

export interface SaveConfigOptions {
  /** Codes of the shop's other (native) discounts, when known: checked for hash collisions too. */
  otherCodes?: readonly string[];
  /**
   * The shop's Shopify markets (saveAndSync reads them when the config targets
   * a market): their countries are merged into the config BEFORE the budget is
   * measured and are saved with it, so the sync ships exactly what was
   * measured (I2).
   */
  shopMarkets?: readonly ShopMarket[];
  /** Shop-local now (`YYYY-MM-DDTHH:MM:SS`) for "is this campaign still live" in the code-rule limit. */
  shopLocalNow?: string;
  /** Overwrite a stored row that cannot be read (I3) — only after the merchant confirmed. */
  replaceUnreadable?: boolean;
  /**
   * Save only when the stored config is still this version (LoadedConfig.version;
   * null = "no row yet"). Otherwise nothing is written and the result is
   * `base_changed`. Omitted: last write wins (the behaviour before F12). When
   * omitted, a version set by withExpectedConfigVersion() for this shop applies.
   */
  expectedVersion?: string | null;
}

interface ExpectedVersionScope {
  shop: string;
  version: string | null;
}

const expectedVersionScope = new AsyncLocalStorage<ExpectedVersionScope>();

/**
 * Run `run` with an expected config version for `shop`: every saveConfig of
 * that shop inside it (also through callers that do not forward options, e.g.
 * the sync layer's saveAndSync) saves only on top of that version. After a
 * successful save the scope expects the version just written, so a second save
 * in the same scope builds on the first. F12: two app instances never silently
 * drop each other's write.
 */
export function withExpectedConfigVersion<T>(shop: string, version: string | null, run: () => Promise<T>): Promise<T> {
  return expectedVersionScope.run({ shop, version }, run);
}

/**
 * Every check saveConfig runs before it touches the database, as a pure dry
 * run: sanitize, the code-rule limit, code-hash collisions (with
 * `options.otherCodes`), the function-config budget in its worst case and the
 * stored-size backstop. The native move calls it BEFORE deleting anything
 * (F1): a move that the save would refuse is refused while the native
 * discount is still live. Database-state refusals (unreadable row, newer
 * schema, `base_changed`) are not covered: read them from loadConfig.
 */
export function validateConfigForSave(input: unknown, options: Omit<SaveConfigOptions, "replaceUnreadable" | "expectedVersion"> = {}): ConfigValidationResult {
  const sanitized = sanitizeConfig(input);
  const issues = sanitized.issues;
  const config = options.shopMarkets ? withMarketCountries(sanitized.config, options.shopMarkets).config : sanitized.config;
  const codeRules = checkActiveCodeRuleLimit(config, { shopLocalNow: options.shopLocalNow });
  if (!codeRules.ok) {
    return {
      ok: false,
      reason: "too_many_code_rules",
      count: codeRules.count,
      limit: codeRules.limit,
      config,
      issues: [...issues, codeRules.issue],
    };
  }
  const collisions = checkCodeHashCollisions(config, options.otherCodes);
  if (!collisions.ok) {
    return { ok: false, reason: "code_hash_collision", collisions: collisions.collisions, config, issues: [...issues, collisions.issue] };
  }
  // Measured on the payload the sync actually writes (the MVP 1 shop
  // function_config, C7): rule targets ship as {kind} only — their id lists
  // live in product metafields — so only this builder's size matters.
  const encoded = buildShopFunctionConfigWorstCase(config);
  if (!encoded.fits) {
    return {
      ok: false,
      reason: "function_config_too_large",
      bytes: encoded.bytes,
      budget: FUNCTION_CONFIG_BUDGET_BYTES,
      config,
      issues,
    };
  }

  const data = JSON.stringify(config);
  const storedBytes = Buffer.byteLength(data, "utf8");
  if (storedBytes > CONFIG_LIMITS.storedConfigBytes) {
    return {
      ok: false,
      reason: "config_too_large",
      bytes: storedBytes,
      limit: CONFIG_LIMITS.storedConfigBytes,
      config,
      issues,
    };
  }
  return { ok: true, config, issues, data, functionConfigBytes: encoded.bytes };
}

/**
 * Sanitize `input` and persist it as the shop's current config, recording a
 * ConfigVersion snapshot in the same transaction. Refuses (writes nothing) when
 *   - more code rules are active than MAX_ACTIVE_CODE_RULES (config-guards,
 *     C2 fallback: each is its own Shopify node, Shopify caps them per store),
 *   - two codes (or a code and a known native code, `options.otherCodes`) share
 *     the hash the discount function matches codes by (config-guards),
 *   - the config's function payload is over the C3 budget in ANY state the
 *     sync writes over time (each live campaign as the current one, or none) —
 *     the discount function could not read it and every Won discount would
 *     stop (§9, re-review K: measuring only "now" let a later campaign with a
 *     longer id push the payload over),
 *   - the sanitized config is over CONFIG_LIMITS.storedConfigBytes (256 KiB) —
 *     the backstop that keeps ShopConfig/ConfigVersion rows small whatever the
 *     per-field caps multiply out to (audit P2-1), or
 *   - the stored row was written by a newer schema (DATA-3) — overwriting it
 *     would silently drop fields this code does not know, or
 *   - the stored row cannot be read (I3) and `replaceUnreadable` is not set.
 * Issues (§4c — surfaced to the admin, never silently dropped) are returned
 * either way the sanitizer ran.
 *
 * Race-safe: two instances saving a shop that has no row yet both read "no
 * row"; the loser's insert hits the unique key (P2002). The whole transaction
 * is then retried and takes the guarded-update path (same for a write
 * conflict, P2034), so concurrent saves are last-write-wins, never an error.
 */
export async function saveConfig(
  db: PrismaClient,
  shop: string,
  input: unknown,
  options: SaveConfigOptions = {},
): Promise<SaveConfigResult> {
  const validated = validateConfigForSave(input, options);
  if (!validated.ok) return validated;
  const { config, issues, data } = validated;
  const scope = expectedVersionScope.getStore();
  const scoped = options.expectedVersion === undefined && scope?.shop === shop ? scope : undefined;
  const expected = options.expectedVersion !== undefined ? options.expectedVersion : scoped ? scoped.version : undefined;

  type Outcome =
    | { kind: "newer_schema"; version: number }
    | { kind: "unreadable" }
    | { kind: "base_changed" }
    | { kind: "saved"; versionId: string };
  const write = () => db.$transaction(async (tx): Promise<Outcome> => {
    const existing = await tx.shopConfig.findUnique({ where: { shop } });
    if (expected !== undefined && (existing ? versionOf(existing.data) : null) !== expected) return { kind: "base_changed" };
    if (existing && !options.replaceUnreadable && rowIsUnreadable(existing) && storedSchemaVersion(existing) <= SCHEMA_VERSION) {
      return { kind: "unreadable" };
    }
    if (existing) {
      const version = storedSchemaVersion(existing);
      if (version > SCHEMA_VERSION) return { kind: "newer_schema", version };
      // Guarded on the column too, so a newer instance's write that lands
      // between the read above and this update is never overwritten. With an
      // expected version, also on the content just compared (compare-and-set).
      const updated = await tx.shopConfig.updateMany({
        where: { shop, schemaVersion: { lte: SCHEMA_VERSION }, ...(expected !== undefined ? { data: existing.data } : {}) },
        data: { schemaVersion: SCHEMA_VERSION, data },
      });
      if (updated.count === 0) {
        if (expected !== undefined) return { kind: "base_changed" };
        return { kind: "newer_schema", version: SCHEMA_VERSION + 1 };
      }
    } else {
      // With an expected "no row", a concurrent create makes this insert fail
      // with P2002; the retry then reads the row and answers base_changed.
      await tx.shopConfig.create({ data: { shop, schemaVersion: SCHEMA_VERSION, data } });
    }
    const version = await tx.configVersion.create({
      data: { shop, schemaVersion: SCHEMA_VERSION, data },
    });
    return { kind: "saved", versionId: version.id };
  });

  let outcome: Outcome | undefined;
  for (let attempt = 1; outcome === undefined; attempt++) {
    try {
      outcome = await write();
    } catch (error) {
      if (attempt >= SAVE_ATTEMPTS || !isRetryableWriteError(error)) throw error;
    }
  }

  if (outcome.kind === "newer_schema") {
    return { ok: false, reason: "newer_schema", storedSchemaVersion: outcome.version };
  }
  if (outcome.kind === "base_changed") {
    return {
      ok: false,
      reason: "base_changed",
      config,
      issues: [
        ...issues,
        { path: "", code: "base_changed", message: "The configuration was changed by someone else meanwhile. Nothing was saved; read it again and retry." },
      ],
    };
  }
  if (outcome.kind === "unreadable") {
    return {
      ok: false,
      reason: "unreadable_config",
      config,
      issues: [
        ...issues,
        {
          path: "",
          code: "unreadable_config",
          message:
            "The saved configuration could not be read, so the editor showed the defaults. Saving now would replace the saved configuration; confirm to replace it.",
        },
      ],
    };
  }

  if (scoped) scoped.version = versionOf(data);
  await pruneConfigHistory(db, shop);

  return { ok: true, config, issues, versionId: outcome.versionId, functionConfigBytes: validated.functionConfigBytes };
}

/** Rows created before this instant are past CONFIG_HISTORY_RETENTION_DAYS. */
function historyCutoff(now: Date): Date {
  return new Date(now.getTime() - CONFIG_HISTORY_RETENTION_DAYS * 24 * 60 * 60 * 1000);
}

/** Drops ConfigVersion rows for `shop` older than the retention window (on every save). */
async function pruneConfigHistory(db: PrismaClient, shop: string): Promise<void> {
  await db.configVersion.deleteMany({ where: { shop, createdAt: { lt: historyCutoff(new Date()) } } });
}

/**
 * Retention job (PRIV-2, audit P3-11): drops ConfigVersion rows older than
 * CONFIG_HISTORY_RETENTION_DAYS for ALL shops — including inactive shops that
 * never save again, whose history the per-save prune above never touches. The
 * current config (ShopConfig) is never pruned. Idempotent; returns how many
 * rows were deleted.
 *
 * NOT WIRED YET: it is wired into the app's scheduler (daily) in MVP 5. Until
 * then nothing calls it in production; only the per-save prune runs.
 */
export async function pruneExpiredConfigHistory(db: PrismaClient, now: Date = new Date()): Promise<number> {
  const { count } = await db.configVersion.deleteMany({ where: { createdAt: { lt: historyCutoff(now) } } });
  return count;
}

/**
 * Erase all Won Discounts data owned by `shop` (PRIV-2). Called ONLY from the
 * GDPR `shop/redact` webhook (~48 h after uninstall), never from
 * `app/uninstalled`: a delayed uninstall webhook after a quick reinstall must
 * not wipe the new config, and MVP 1 keeps native-discount backups here that
 * "undo" needs after a reinstall (A7). Idempotent — deleteMany on a shop with
 * no rows is a no-op, not an error. Errors propagate (the webhook answers
 * non-2xx and Shopify retries).
 */
export async function deleteShopData(db: PrismaClient, shop: string): Promise<void> {
  await db.$transaction([
    db.shopConfig.deleteMany({ where: { shop } }),
    db.configVersion.deleteMany({ where: { shop } }),
    db.wonNode.deleteMany({ where: { shop } }),
    db.nativeDiscountBackup.deleteMany({ where: { shop } }),
    db.syncRun.deleteMany({ where: { shop } }),
    db.productTargetIndex.deleteMany({ where: { shop } }),
  ]);
}
