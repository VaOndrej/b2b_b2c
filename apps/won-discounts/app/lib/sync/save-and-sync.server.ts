// Admin entry points of the sync layer (the UI calls these from route actions):
//   saveAndSync  — save the config (sanitize, guards, budget, history), then,
//                  only when the save succeeded, write it into Shopify;
//   resyncShop   — "sync again" for the stored config (Přehled), no save;
//   loadSyncStatus — the latest SyncRun for the Přehled.
// `admin` is `(await authenticate.admin(request)).admin`; every Shopify write
// goes through app/lib/sync (spec §9 "Všechny zápisy do Shopify jdou přes sync vrstvu").

import type { PrismaClient } from "../../generated/prisma/client";
import { adminClientFromApp, type AdminClient, type AppAdminGraphql } from "../admin-client.server";
import { loadConfig, saveConfig, type SaveConfigResult } from "../config.server";
import type { Sync } from "./sync.server";
import type { SyncResult, SyncStep } from "./types";
import { createProductionSync } from "./wiring.server";

export interface SaveAndSyncOptions {
  /** Default: the app's Prisma client (app/db.server). */
  db?: PrismaClient;
  /** Default: the production sync (real engine builders). */
  createSync?: (client: AdminClient, db: PrismaClient) => Sync;
  /** Codes of the shop's native discounts, when the caller knows them (hash-collision guard). */
  otherCodes?: readonly string[];
}

export interface SaveAndSyncResult {
  save: SaveConfigResult;
  /** Null when the save was refused (nothing was written anywhere). */
  sync: SyncResult | null;
}

async function appDb(options: SaveAndSyncOptions): Promise<PrismaClient> {
  return options.db ?? (await import("../../db.server")).default;
}

export async function saveAndSync(
  admin: AppAdminGraphql,
  shop: string,
  input: unknown,
  options: SaveAndSyncOptions = {},
): Promise<SaveAndSyncResult> {
  const db = await appDb(options);
  const save = await saveConfig(db, shop, input, { otherCodes: options.otherCodes });
  if (!save.ok) return { save, sync: null };
  const sync = (options.createSync ?? createProductionSync)(adminClientFromApp(admin), db);
  return { save, sync: await sync.syncShop(shop, save.config) };
}

export type ResyncResult = SyncResult | { ok: false; reason: "newer_schema"; steps: SyncStep[]; errors: string[]; runId: null };

/** Sync the stored config again (no save). Refused for a newer-schema row (DATA-3: this code would drop its fields). */
export async function resyncShop(admin: AppAdminGraphql, shop: string, options: SaveAndSyncOptions = {}): Promise<ResyncResult> {
  const db = await appDb(options);
  const { config, readOnly } = await loadConfig(db, shop);
  if (readOnly) {
    const detail = "the stored config was written by a newer app version; this instance does not sync it";
    return { ok: false, reason: "newer_schema", steps: [{ step: "config.load", ok: false, detail }], errors: [detail], runId: null };
  }
  return (options.createSync ?? createProductionSync)(adminClientFromApp(admin), db).syncShop(shop, config);
}

export interface SyncStatus {
  runId: string;
  ok: boolean;
  startedAt: Date;
  finishedAt: Date | null;
  errorCount: number;
  steps: SyncStep[];
}

/** The latest sync run of `shop` (null = never synced). Steps that cannot be parsed read as []. */
export async function loadSyncStatus(db: PrismaClient, shop: string): Promise<SyncStatus | null> {
  const run = await db.syncRun.findFirst({ where: { shop }, orderBy: [{ startedAt: "desc" }, { id: "desc" }] });
  if (!run) return null;
  let steps: SyncStep[] = [];
  try {
    const parsed = JSON.parse(run.steps) as unknown;
    if (Array.isArray(parsed)) steps = parsed as SyncStep[];
  } catch {
    steps = [];
  }
  return { runId: run.id, ok: run.ok, startedAt: run.startedAt, finishedAt: run.finishedAt, errorCount: run.errorCount, steps };
}
