// Won Discounts config persistence (doctrine DATA-2/DATA-3/DATA-4, spec §2).
// This is the ONLY place that touches ShopConfig/ConfigVersion — admin routes
// and webhooks call through here so every reader/writer agrees on exactly one
// interpretation of a stored config. Shape validation (sanitize/migrate) lives
// in @won/core/discounts/config; this module only owns the Prisma I/O.

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
      /** The stored row belongs to a newer schema (DATA-3): nothing was written. */
      ok: false;
      reason: "newer_schema";
      storedSchemaVersion: number;
    };

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
  if (!row) return { config: createDefaultConfig(), readOnly: false };

  const readOnly = storedSchemaVersion(row) > SCHEMA_VERSION;
  const parsed = parseStoredData(row.data);
  if (!parsed.ok) return { config: createDefaultConfig(), readOnly };
  return { config: readStoredConfig(parsed.value), readOnly };
}

/** Prisma error codes worth one more attempt: unique violation (lost create race), write conflict. */
const RETRYABLE_WRITE_ERRORS = new Set(["P2002", "P2034"]);
const SAVE_ATTEMPTS = 3;

function isRetryableWriteError(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === "string" && RETRYABLE_WRITE_ERRORS.has(code);
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
 *     would silently drop fields this code does not know.
 * Issues (§4c — surfaced to the admin, never silently dropped) are returned
 * either way the sanitizer ran.
 *
 * Race-safe: two instances saving a shop that has no row yet both read "no
 * row"; the loser's insert hits the unique key (P2002). The whole transaction
 * is then retried and takes the guarded-update path (same for a write
 * conflict, P2034), so concurrent saves are last-write-wins, never an error.
 */
export interface SaveConfigOptions {
  /** Codes of the shop's other (native) discounts, when known: checked for hash collisions too. */
  otherCodes?: readonly string[];
}

export async function saveConfig(
  db: PrismaClient,
  shop: string,
  input: unknown,
  options: SaveConfigOptions = {},
): Promise<SaveConfigResult> {
  const { config, issues } = sanitizeConfig(input);
  const codeRules = checkActiveCodeRuleLimit(config);
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

  type Outcome = { kind: "newer_schema"; version: number } | { kind: "saved"; versionId: string };
  const write = () => db.$transaction(async (tx): Promise<Outcome> => {
    const existing = await tx.shopConfig.findUnique({ where: { shop } });
    if (existing) {
      const version = storedSchemaVersion(existing);
      if (version > SCHEMA_VERSION) return { kind: "newer_schema", version };
      // Guarded on the column too, so a newer instance's write that lands
      // between the read above and this update is never overwritten.
      const updated = await tx.shopConfig.updateMany({
        where: { shop, schemaVersion: { lte: SCHEMA_VERSION } },
        data: { schemaVersion: SCHEMA_VERSION, data },
      });
      if (updated.count === 0) return { kind: "newer_schema", version: SCHEMA_VERSION + 1 };
    } else {
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

  await pruneConfigHistory(db, shop);

  return { ok: true, config, issues, versionId: outcome.versionId, functionConfigBytes: encoded.bytes };
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
  ]);
}
