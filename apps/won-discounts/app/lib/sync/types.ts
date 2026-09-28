// Public types of the sync layer. The engine payload builders are INJECTED
// (SyncDeps) so the sync is testable with fakes and does not care which
// engine build it runs against; wiring.server.ts plugs in the real ones from
// @won/core/discounts. The structural types below match @won/core's
// NodeRole / NodeVars / ProductTargetingInput / ShopFunctionConfigCheck.

import type { ReadonlyDeep, WonDiscountsConfig } from "@won/core/discounts/config";

import type { PrismaClient } from "../../generated/prisma/client";
import type { AdminClient } from "../admin-client.server";

export type ConfigView = ReadonlyDeep<WonDiscountsConfig>;

export type SyncNodeRole = { kind: "automatic" } | { kind: "code"; ruleId: string };

/** The node's `function_vars` (input-query variables; campaignStart/End ALWAYS present, C4). */
export interface SyncNodeVars {
  role: "automatic" | "code";
  ruleId?: string;
  campaignId: string | null;
  campaignStart: string;
  campaignEnd: string;
  varsVersion: string | null;
}

export interface SyncProductInput {
  productId: string;
  variantIds: readonly string[];
  collectionIds: readonly string[];
}

/** What a product's `$app:won_discounts`/`product` metafield carries (engine ProductRuleEntry). */
export interface SyncProductEntry {
  ruleIds: readonly string[];
  /** Variant GID → rule refs for rules targeting single variants (only variants with refs). */
  variantRuleIds?: Readonly<Record<string, readonly string[]>>;
}

export interface ShopConfigBuildOptions {
  /** Shop-local `YYYY-MM-DDTHH:MM:SS` (selects the current-or-next campaign). */
  now: string;
  /** Shopify `shop.ianaTimezone` (rule schedules become shop days). */
  shopTimezone: string;
  /** Phase 1 of a campaign switch: ship no campaign and no version. */
  forceNoCampaign?: boolean;
}

export type ShopConfigCheck = { ok: true; bytes: number } | { ok: false; bytes: number; reason: string };

export interface SyncLogger {
  info(message: string, context?: Record<string, unknown>): void;
  warn(message: string, context?: Record<string, unknown>): void;
  error(message: string, context?: Record<string, unknown>): void;
}

export interface RetryOptions {
  /** Total tries per request (1 = no retry). */
  attempts: number;
  /** First backoff; doubles per attempt (API-3). */
  baseDelayMs: number;
  maxDelayMs: number;
  /** Polls of an async Shopify job (redeem-code bulk add/delete) before giving up for this run. */
  pollAttempts: number;
  pollDelayMs: number;
}

export interface SyncDeps {
  client: AdminClient;
  db: PrismaClient;
  /** Shared function config for the shop metafield (JSON carries `campaignVarsVersion`). */
  buildShopFunctionConfig: (config: ConfigView, options: ShopConfigBuildOptions) => { json: string; bytes: number; fits: boolean };
  /** `now` = shop-local `YYYY-MM-DDTHH:MM:SS`. */
  buildNodeVars: (role: SyncNodeRole, config: ConfigView, now: string) => SyncNodeVars;
  productRuleIndex: (config: ConfigView, products: readonly SyncProductInput[]) => Map<string, SyncProductEntry>;
  /** Engine check of the shop config as read back (C7: > 10 000 B reaches the function as null). */
  verifyShopFunctionConfig: (json: string) => ShopConfigCheck;
  now: () => Date;
  logger: SyncLogger;
  /** Injectable for tests (default: setTimeout). */
  sleep?: (ms: number) => Promise<void>;
  retry?: Partial<RetryOptions>;
}

export interface SyncStep {
  /** Stable machine key, e.g. "shop_config.write", "node.create:code:<ruleId>". */
  step: string;
  ok: boolean;
  /** Human-readable, one line. */
  detail: string;
}

export interface SyncResult {
  ok: boolean;
  steps: SyncStep[];
  /** Details of the failed steps (what the Přehled shows). */
  errors: string[];
  /** The persisted SyncRun row (null when it could not be written). */
  runId: string | null;
}
