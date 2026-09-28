// Won Discounts config persistence (doctrine DATA-2/DATA-3/DATA-4, spec §2).
// This is the ONLY place that touches ShopConfig/ConfigVersion — admin routes
// and webhooks call through here so every reader/writer agrees on exactly one
// interpretation of a stored config. Shape validation (sanitize/migrate) lives
// in @won/core/discounts/config; this module only owns the Prisma I/O.

import {
  createDefaultConfig,
  isNewerSchema,
  readStoredConfig,
  sanitizeConfig,
  SCHEMA_VERSION,
  type ConfigIssue,
  type WonDiscountsConfig,
} from "@won/core/discounts/config";
import { encodeFunctionConfig, FUNCTION_CONFIG_BUDGET_BYTES } from "@won/core/discounts/function-config";

import type { PrismaClient } from "../generated/prisma/client";

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
      /** The discount function could not read this config (C3): nothing was written. */
      ok: false;
      reason: "function_config_too_large";
      bytes: number;
      budget: number;
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

/**
 * Sanitize `input` and persist it as the shop's current config, recording a
 * ConfigVersion snapshot in the same transaction. Refuses (writes nothing) when
 *   - the config's function payload is over the C3 budget — the discount
 *     function could not read it and every Won discount would stop (§9), or
 *   - the stored row was written by a newer schema (DATA-3) — overwriting it
 *     would silently drop fields this code does not know.
 * Issues (§4c — surfaced to the admin, never silently dropped) are returned
 * either way the sanitizer ran.
 */
export async function saveConfig(db: PrismaClient, shop: string, input: unknown): Promise<SaveConfigResult> {
  const { config, issues } = sanitizeConfig(input);
  const encoded = encodeFunctionConfig(config);
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
  type Outcome = { kind: "newer_schema"; version: number } | { kind: "saved"; versionId: string };
  const outcome = await db.$transaction(async (tx): Promise<Outcome> => {
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

  if (outcome.kind === "newer_schema") {
    return { ok: false, reason: "newer_schema", storedSchemaVersion: outcome.version };
  }

  await pruneConfigHistory(db, shop);

  return { ok: true, config, issues, versionId: outcome.versionId, functionConfigBytes: encoded.bytes };
}

/** Drops ConfigVersion rows for `shop` older than the retention window. */
async function pruneConfigHistory(db: PrismaClient, shop: string): Promise<void> {
  const cutoff = new Date(Date.now() - CONFIG_HISTORY_RETENTION_DAYS * 24 * 60 * 60 * 1000);
  await db.configVersion.deleteMany({ where: { shop, createdAt: { lt: cutoff } } });
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
  ]);
}
