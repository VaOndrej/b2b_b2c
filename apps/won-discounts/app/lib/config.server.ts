// Won Discounts config persistence (doctrine DATA-2/DATA-3/DATA-4, spec §2).
// This is the ONLY place that touches ShopConfig/ConfigVersion — admin routes
// and webhooks call through here so every reader/writer agrees on exactly one
// interpretation of a stored config. Shape validation (sanitize/migrate) lives
// in @won/core/discounts/config; this module only owns the Prisma I/O.

import {
  DEFAULT_CONFIG,
  readStoredConfig,
  sanitizeConfig,
  SCHEMA_VERSION,
  type ConfigIssue,
  type WonDiscountsConfig,
} from "@won/core/discounts/config";

import type { PrismaClient } from "../generated/prisma/client";

/** How long ConfigVersion rows are kept before being pruned (support/rollback window). */
export const CONFIG_HISTORY_RETENTION_DAYS = 90;

/**
 * Read a shop's config. A shop with no row yet gets `DEFAULT_CONFIG`; corrupted
 * JSON (should never happen, but disks and manual edits exist) also falls back
 * to the default rather than throwing (DATA-2 — never crash on bad stored data).
 */
export async function loadConfig(db: PrismaClient, shop: string): Promise<WonDiscountsConfig> {
  const row = await db.shopConfig.findUnique({ where: { shop } });
  if (!row) return DEFAULT_CONFIG;

  let parsed: unknown;
  try {
    parsed = JSON.parse(row.data);
  } catch {
    return DEFAULT_CONFIG;
  }
  return readStoredConfig(parsed);
}

/**
 * Sanitize `input` and persist it as the shop's current config, recording a
 * ConfigVersion snapshot in the same transaction. Returns the sanitized config
 * plus any issues found (§4c — surfaced to the admin, never silently dropped)
 * and the id of the version row just written.
 */
export async function saveConfig(
  db: PrismaClient,
  shop: string,
  input: unknown,
): Promise<{ config: WonDiscountsConfig; issues: ConfigIssue[]; versionId: string }> {
  const { config, issues } = sanitizeConfig(input);
  const data = JSON.stringify(config);

  const [, version] = await db.$transaction([
    db.shopConfig.upsert({
      where: { shop },
      create: { shop, schemaVersion: SCHEMA_VERSION, data },
      update: { schemaVersion: SCHEMA_VERSION, data },
    }),
    db.configVersion.create({
      data: { shop, schemaVersion: SCHEMA_VERSION, data },
    }),
  ]);

  await pruneConfigHistory(db, shop);

  return { config, issues, versionId: version.id };
}

/** Drops ConfigVersion rows for `shop` older than the retention window. */
async function pruneConfigHistory(db: PrismaClient, shop: string): Promise<void> {
  const cutoff = new Date(Date.now() - CONFIG_HISTORY_RETENTION_DAYS * 24 * 60 * 60 * 1000);
  await db.configVersion.deleteMany({ where: { shop, createdAt: { lt: cutoff } } });
}

/**
 * Erase all Won Discounts data owned by `shop` (PRIV-2, GDPR shop/redact).
 * Idempotent — deleteMany on a shop with no rows is a no-op, not an error.
 */
export async function deleteShopData(db: PrismaClient, shop: string): Promise<void> {
  await db.$transaction([
    db.shopConfig.deleteMany({ where: { shop } }),
    db.configVersion.deleteMany({ where: { shop } }),
  ]);
}
