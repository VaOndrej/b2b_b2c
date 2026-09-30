// Storefront config (MVP 3, docs/plans/2026-09-30-won-discounts-mvp3.md, contracts K4–K6).
//
// The theme app extension reads it in Liquid from an APP-DATA metafield (owner
// AppInstallation; app-data metafields use a plain namespace, not `$app`):
//   {{ app.metafields.won_discounts.storefront_config.value }}
// It is built from the GATED config (plan-gate.ts, BILL-1), so nothing a Free
// shop may not run ever reaches a page, and it never carries purchase costs.
// Per product the block reads the product metafield's `tierRef` (targeting.ts)
// and per variant the `pdp` metafield (`PdpMetafieldValue`).
//
// This file holds the contract types and keys; the builder lands in MVP 3 T1a.

import type { AppearancePreset, LocaleCode, TierCountAcross } from "./config.ts";

/** App-data metafield (AppInstallation) the storefront reads. */
export const STOREFRONT_CONFIG_NAMESPACE = "won_discounts";
export const STOREFRONT_CONFIG_KEY = "storefront_config";

/** Variant metafield `$app:won_discounts`/`pdp` (json): see PdpMetafieldValue. */
export const PDP_METAFIELD_KEY = "pdp";

export const STOREFRONT_CONFIG_VERSION = 1;

/**
 * One quantity break as the storefront shows it: a percent, or an amount off
 * per item per ISO currency in Liquid money units (major unit × 100, whatever
 * the currency's exponent — the builder converts from minor units). A currency
 * missing from `off` = the break is not offered in that currency (MKT-1).
 */
export type StorefrontTierBreak = { min: number; pct: number } | { min: number; off: Record<string, number> };

export interface StorefrontTierSet {
  count: TierCountAcross;
  /** Ascending `min`; [] = an inert set (a Pro set on Free, K1): its products show no table. */
  breaks: StorefrontTierBreak[];
}

export type StorefrontMargin =
  | { on: false }
  | {
      on: true;
      /** The maximum discount % for a variant without a known purchase cost (global setting). */
      max: number;
      /** Numeric collection id → that collection's maximum discount % (a product with several of its `marginRefs` takes the lowest). */
      col?: Record<string, number>;
    };

export interface StorefrontConfigV1 {
  v: 1;
  /** The ShopConfig version it was built from (debugging, E2E). */
  cv: string;
  tiers: {
    /** The global set's id (K1 step 3), null when there is none. */
    global: string | null;
    /** Every set a product can reach, by id. */
    sets: Record<string, StorefrontTierSet>;
  };
  margin: StorefrontMargin;
  appearance: { preset: AppearancePreset };
  /** Texts the merchant changed, per locale; the extension's own locales are the fallback. */
  texts: Partial<Record<LocaleCode, Record<string, string>>>;
}

/**
 * Variant metafield `$app:won_discounts`/`pdp`: the largest discount % margin
 * protection allows on the variant at its price in the shop currency, one
 * decimal, rounded DOWN. Written only for variants with a known purchase cost
 * while margin protection is on (absent otherwise). The function never reads it.
 */
export interface PdpMetafieldValue {
  max: number;
}
