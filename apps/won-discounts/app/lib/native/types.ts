// Native Shopify discounts: detection, move into Won, undo (spec §4.1, C6,
// docs/won-discounts/rozhodnuti.md "Nativní slevy Shopify" + "Přesun nativních slev").
// Shared types only. Nothing here touches Prisma or the network, so the admin UI
// can import it next to ./copy.ts.

import type { DiscountRule, WonDiscountsConfig } from "@won/core/discounts/config";

/**
 * Minimal Admin GraphQL client, structurally compatible with the sync layer's
 * `app/lib/admin-client.ts` (T3). Local until that file exists; unify then.
 * `data`/`errors` follow the GraphQL response shape. A transport failure
 * (network, CLI, timeout) rejects the promise.
 */
export interface AdminClient {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- raw GraphQL payloads are narrowed by the readers
  graphql(query: string, variables?: Record<string, unknown>): Promise<{ data?: any; errors?: unknown }>;
}

/** Admin language of the merchant (A10). */
export type NativeLocale = "cs" | "en";

/** Shop facts the mapping needs: fixed amounts are in the shop currency, dates in shop time. */
export interface ShopContext {
  currencyCode: string;
  ianaTimezone: string;
}

/** The four native types Won can take over (Basic + Free shipping, code or automatic). */
export type MovableKind = "code_basic" | "automatic_basic" | "code_free_shipping" | "automatic_free_shipping";

/** Every discount type `discountNodes` can return (stored in NativeDiscountBackup.kind). */
export type NativeKind =
  | MovableKind
  | "code_bxgy"
  | "automatic_bxgy"
  | "code_app"
  | "automatic_app"
  | "unknown";

export type NativeStatus = "ACTIVE" | "SCHEDULED" | "EXPIRED";

export type NativeValue =
  | { kind: "percentage"; percent: number }
  /** `amount` is Shopify's decimal string in `currencyCode` (the shop currency). */
  | { kind: "fixed"; amount: string; currencyCode: string; appliesOnEachItem: boolean }
  | { kind: "freeShipping" };

export type NativeTarget =
  | { kind: "order" }
  | { kind: "products"; productIds: string[]; variantIds: string[] }
  | { kind: "collections"; ids: string[] }
  | { kind: "shipping" };

export type NativeMinimum =
  | { kind: "subtotal"; amount: string; currencyCode: string }
  | { kind: "quantity"; quantity: number }
  | null;

export interface NativeCombinesWith {
  productDiscounts: boolean;
  orderDiscounts: boolean;
  shippingDiscounts: boolean;
}

/**
 * A Basic or Free shipping discount, normalized from the Admin API. Detection
 * reads the first page of every list (`complete: false` when a list goes on);
 * the move reads everything (`complete: true`) before it deletes anything.
 */
export interface NativeDiscount {
  /** gid://shopify/DiscountCodeNode/… or gid://shopify/DiscountAutomaticNode/… */
  id: string;
  kind: MovableKind;
  method: "code" | "automatic";
  title: string;
  status: NativeStatus;
  startsAt: string;
  endsAt: string | null;
  /** Null when Shopify returned a value / target shape Won does not know (never guessed). */
  value: NativeValue | null;
  target: NativeTarget | null;
  minimum: NativeMinimum;
  /** Redeem codes read so far (all of them when `complete`). Empty for automatic. */
  codes: string[];
  /** Total redeem codes Shopify reports (may be larger than `codes.length`). */
  codesCount: number;
  /** Shopify's asynchronous usage counter (approximate). */
  usageCount: number;
  usageLimit: number | null;
  oncePerCustomer: boolean;
  combinesWith: NativeCombinesWith;
  appliesOnOneTimePurchase: boolean;
  appliesOnSubscription: boolean;
  /** Buyer eligibility: everyone, specific customers or customer segments. */
  buyers: "all" | "customers" | "segments" | "unknown";
  /** Free shipping only: restricted to some countries / capped shipping price. */
  shippingCountries: { countries: string[]; includeRestOfWorld: boolean } | null;
  maximumShippingPrice: { amount: string; currencyCode: string } | null;
  /** False when a list (products, variants, collections, codes) has more entries than were read. */
  complete: boolean;
  shop: ShopContext;
}

/** Why a native discount stays in Shopify (machine key; ./copy.ts turns it into a sentence). */
export type NotMovableReason =
  | { code: "bxgy" }
  | { code: "other_app"; appTitle: string | null }
  | { code: "specific_buyers" }
  | { code: "subscription_only" }
  | { code: "fixed_once_per_order" }
  | { code: "shipping_countries" }
  | { code: "shipping_price_cap" }
  | { code: "too_many_items"; count: number; limit: number }
  | { code: "too_many_codes_to_back_up"; count: number; limit: number }
  | { code: "usage_exhausted"; used: number; limit: number }
  | { code: "expired" }
  | { code: "unsupported_value" }
  | { code: "unknown_type" };

export interface NotMovableEntry {
  id: string;
  title: string;
  kind: NativeKind;
  status: NativeStatus;
  reasonCode: NotMovableReason["code"];
  /** Human sentence in the requested locale (§4c: never an enum key). */
  reason: string;
}

export interface ExpiredEntry {
  id: string;
  title: string;
  kind: NativeKind;
}

export type ConflictKind = "same_code" | "same_products" | "same_collections" | "both_order" | "both_shipping";

/** A live native discount that fights a Won rule (Přehled, spec §4.1). */
export interface NativeConflict {
  kind: ConflictKind;
  nativeId: string;
  nativeTitle: string;
  ruleId: string;
  ruleName: string;
  /** Codes both use (same_code) — Shopify refuses a code on two discounts. */
  codes?: string[];
  message: string;
}

export interface NativeDetection {
  shop: ShopContext;
  movable: NativeDiscount[];
  notMovable: NotMovableEntry[];
  /** EXPIRED discounts of any type: informational, nothing to move. */
  expired: ExpiredEntry[];
  /** Only computed when a Won config is passed to detection. */
  conflicts: NativeConflict[];
}

/** Result of planMove: the Won rule plus everything the dialog must say first (§14c). */
export interface MovePlan {
  rule: DiscountRule;
  /** What the merchant loses by moving (human sentences). */
  losses: string[];
  /** What changes or needs attention after the move (human sentences). */
  warnings: string[];
}

/**
 * Save the next config and push it to Shopify (sync layer, T3). Injected so the
 * move logic stays testable and the sync agent owns the write path.
 *
 * Contract:
 * - resolves `{ ok: true }` only when the config is saved AND the Won nodes in
 *   Shopify match it (the moved code is live on a Won node);
 * - resolves `{ ok: false, message }` (or throws) on any failure; `message` is a
 *   human sentence. It may have saved the config or synced part of it —
 *   the caller then rolls back by calling it again with the rule removed.
 */
export type SaveAndSync = (input: { shop: string; config: WonDiscountsConfig }) => Promise<SaveAndSyncResult>;

export type SaveAndSyncResult = { ok: true } | { ok: false; message: string };

/** NativeDiscountBackup.status values. */
export const BACKUP_STATUS = Object.freeze({
  backedUp: "backed_up",
  moved: "moved",
  restored: "restored",
  failed: "failed",
} as const);
export type BackupStatus = (typeof BACKUP_STATUS)[keyof typeof BACKUP_STATUS];
