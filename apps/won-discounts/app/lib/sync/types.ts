// Public types of the sync layer. The engine payload builders are INJECTED
// (SyncDeps) so the sync is testable with fakes and does not care which
// engine build it runs against; wiring.server.ts plugs in the real ones from
// @won/core/discounts. The structural types below match @won/core's
// NodeRole / NodeVars / ProductTargetingInput / ShopFunctionConfigCheck.

import type { ReadonlyDeep, WonDiscountsConfig } from "@won/core/discounts/config";
import type { ShopPlan } from "@won/core/discounts/plan-gate";
import type { StorefrontConfigV1 } from "@won/core/discounts/storefront-config";

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
  /** Variant numeric id → rule refs for rules targeting single variants (only variants with refs). */
  variantRuleIds?: Readonly<Record<string, readonly string[]>>;
  /** Numeric ids of the product's collections with a margin setting (MVP 2; absent/empty = none). */
  marginRefs?: readonly string[];
  /** The Pro tier set that applies to the product (MVP 3, contract K1/K3; absent = the global set). */
  tierRef?: string;
  /** The engine shrank the value to fit the product budget (never written; surfaced as a warning step). */
  oversized?: { bytes: number; collapsedRefs: readonly string[]; droppedRefs: readonly string[] };
}

export interface ShopConfigBuildOptions {
  /** Shop-local `YYYY-MM-DDTHH:MM:SS` (selects the current-or-next campaign). */
  now: string;
  /** Shopify `shop.ianaTimezone` (rule schedules become shop days). */
  shopTimezone: string;
  /** Phase 1 of a campaign switch: ship no campaign and no version. */
  forceNoCampaign?: boolean;
  /**
   * Shopify `shop.currencyCode` (step 0): the currency of the variants' costs,
   * shipped as the margin's `cur`. Without it every cost is unknown at
   * checkout (the maximum discount % applies).
   */
  shopCurrency?: string;
}

/** The encoded shop config (core EncodedShopFunctionConfig's part the sync uses). */
export interface ShopConfigBuild {
  json: string;
  bytes: number;
  fits: boolean;
  /** MVP 3 audit: UTF-8 bytes of `modules.tiers` against their cap (core CONFIG_LIMITS.tierPayloadBytes). */
  tiers?: { bytes: number; budget: number; fits: boolean };
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
  /**
   * The shop's plan (BILL-1): the sync runs gateConfigForPlan(config, plan)
   * before the function payload, the nodes and the product index, so a Free
   * shop's checkout never sees Pro data. Production: app/lib/plan.server.ts.
   */
  plan: (shop: string) => Promise<ShopPlan>;
  /**
   * Shared function config for the shop metafield (JSON carries `campaignVarsVersion`). `fits` = within the
   * 9 000 B budget AND (MVP 3) the quantity tiers within their own cap, whose figures are `tiers`.
   */
  buildShopFunctionConfig: (config: ConfigView, options: ShopConfigBuildOptions) => ShopConfigBuild;
  /** `now` = shop-local `YYYY-MM-DDTHH:MM:SS`. */
  buildNodeVars: (role: SyncNodeRole, config: ConfigView, now: string) => SyncNodeVars;
  productRuleIndex: (config: ConfigView, products: readonly SyncProductInput[]) => Map<string, SyncProductEntry>;
  /** Engine check of the shop config as read back (C7: > 10 000 B reaches the function as null). */
  verifyShopFunctionConfig: (json: string) => ShopConfigCheck;
  /**
   * The storefront config (MVP 3, contract K5: core buildStorefrontConfig) from
   * the SAME gated config as the shop payload; `configVersion` = its `cv`;
   * `shopCurrency` gives its margin the K4 v2 key `k` and `cur` (the same
   * string the cost mirror's pdp keys are built with); `campaignId` (MVP 6.1) =
   * the campaign whose tier sets the product page shows right now.
   */
  buildStorefrontConfig: (
    config: ConfigView,
    options: { configVersion: string; shopCurrency?: string; variantHandles?: Readonly<Record<string, string>>; campaignId?: string | null },
  ) => StorefrontConfigV1;
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
  /** ok, but the merchant should know (e.g. a product reduced to fit its budget). */
  warning?: boolean;
  /**
   * The values the admin words the step with (sync-copy.ts), when `detail`
   * alone would need parsing — e.g. `margin.too_large:<collectionId>`:
   * {collection: title, count: products or null when Shopify only said "at least"}.
   */
  params?: Record<string, string | number | null>;
}

/**
 * Work a run left for the next one (SyncRun.pending): the Přehled calls
 * resyncIfPending (save-and-sync.server.ts) on load when the last run has any.
 */
export type PendingWork =
  | "failed_steps"
  | "campaign_switch_held"
  | "stale_product_refs"
  | "codes_in_progress"
  /** Products that only gain rules are still being written after the flip (background lane, item 7). */
  | "products_in_progress";

export interface SyncResult {
  ok: boolean;
  steps: SyncStep[];
  /** Details of the failed steps (what the Přehled shows). */
  errors: string[];
  /** What the next sync still has to do ([] = nothing). */
  pending: PendingWork[];
  /** The persisted SyncRun row (null when it could not be written). */
  runId: string | null;
  /**
   * Product work still running in the background after this run (item 7):
   * `products` = products that only gain rules and are being written; absent
   * for a queued targeting refresh (its size is not known yet).
   */
  background?: { products?: number };
}
