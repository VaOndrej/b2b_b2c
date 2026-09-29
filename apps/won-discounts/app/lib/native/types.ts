// Native Shopify discounts: detection, move into Won, undo (spec §4.1, C6,
// docs/won-discounts/rozhodnuti.md "Nativní slevy Shopify" + "Přesun nativních slev").
// Shared types only. Nothing here touches Prisma or the network, so the admin UI
// can import it next to ./copy.ts.

import type { DiscountRule, WonDiscountsConfig } from "@won/core/discounts/config";

import type { AdminClient as SharedAdminClient } from "../admin-client.server";

/**
 * The app's one Admin GraphQL client contract (app/lib/admin-client.server.ts,
 * sync layer): GraphQL-level failures resolve with `errors`, transport failures
 * reject (AdminTransportError with the HTTP status). Type-only import: nothing
 * server-side reaches a client bundle through this file.
 */
export type AdminClient = SharedAdminClient;

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

/** Shopify's discount classes (product, order, shipping), as Won's combination categories. */
export type DiscountClass = "product" | "order" | "shipping";

/**
 * How a discount that stays in Shopify combines (F4): after a move the Won
 * discount combines with every class, so whether they add up is decided only
 * by this discount's own `combinesWith`.
 */
export interface NativeStacking {
  classes: DiscountClass[];
  combinesWith: NativeCombinesWith;
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
  /** False when Shopify reports the count only as a lower bound (precision AT_LEAST). */
  codesCountExact: boolean;
  /** Subscriptions: on how many recurring orders it applies (0 / null = every one). */
  recurringCycleLimit: number | null;
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
  /**
   * Fields Shopify returned in a shape this reader does not know (e.g. an
   * unknown or missing shipping destination). Such a discount never moves:
   * the conservative reading keeps it in Shopify (F13).
   */
  unreadable?: string[];
  shop: ShopContext;
}

/** Why a native discount stays in Shopify (machine key; ./copy.ts turns it into a sentence). */
export type NotMovableReason =
  | { code: "bxgy" }
  | { code: "other_app"; appTitle: string | null }
  | { code: "specific_buyers" }
  | { code: "subscription_only" }
  | { code: "fixed_once_per_order" }
  | { code: "fixed_each_item_on_order" }
  | { code: "shipping_countries" }
  | { code: "shipping_price_cap" }
  | { code: "too_many_items"; count: number; limit: number }
  | { code: "too_many_codes_to_back_up"; count: number; limit: number; atLeast: boolean }
  | { code: "no_codes" }
  | { code: "incomplete_read" }
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
  /** How it combines, when Shopify said so (F4: the move dialog warns about new stacking). */
  stacking?: NativeStacking;
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
export type SaveAndSync = (input: {
  shop: string;
  config: WonDiscountsConfig;
  /**
   * F12: the stored config version (LoadedConfig.version) `config` was built
   * on. The save refuses when another writer changed the config meanwhile and
   * answers `{ ok: false, conflict: true }`: nothing saved, nothing synced;
   * the caller reads the config again and retries.
   */
  baseVersion?: string | null;
}) => Promise<SaveAndSyncResult>;

export type SaveAndSyncResult = { ok: true } | { ok: false; message: string; conflict?: boolean };

/**
 * Extra facts about a backup with an undo, carried next to a MovedDiscountView
 * (components/model/types.ts) on Přehled:
 *   undoCosts  what an undo will change, shown BEFORE the merchant confirms it (F11, §14c);
 *   stacking   how the moved discount now stacks with discounts that stayed in Shopify (F4).
 */
export interface MovedBackupExtras {
  undoCosts?: string[];
  stacking?: string[];
}

/**
 * NativeDiscountBackup.status values (a plain string column, no schema change):
 *   backed_up  snapshot taken; the native may or may not still be in Shopify
 *              (a move stopped before finishing, or the delete outcome is
 *              unknown). A retried move or an undo checks and converges.
 *   moving     claimed by a running move (compare-and-set, all instances)
 *   undoing    claimed by a running undo
 *   moved      the rule is in Won, the native is deleted
 *   restored   the native is back in Shopify (snapshot.restoredAs)
 *   failed     the move failed; snapshot.restoredAs says whether the native is
 *              back (and which codes are still missing), otherwise it is only
 *              in the backup and undo puts it back
 * A `moving`/`undoing` claim older than CLAIM_STALE_MS (process died) is taken over.
 */
export const BACKUP_STATUS = Object.freeze({
  backedUp: "backed_up",
  moving: "moving",
  undoing: "undoing",
  moved: "moved",
  restored: "restored",
  failed: "failed",
} as const);
export type BackupStatus = (typeof BACKUP_STATUS)[keyof typeof BACKUP_STATUS];
