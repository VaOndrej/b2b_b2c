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
// buildStorefrontConfig builds it (sync, T3); pdpMaxDiscountPercent computes the
// variant `pdp` metafield (K4) with the SAME floor math as checkout (margin.ts).

import { variantKey } from "./cart.ts";
import {
  APPEARANCE_PRESETS,
  LOCALE_CODES,
  type AppearancePreset,
  type LocaleCode,
  type MarginModule,
  type ReadonlyDeep,
  type TierCountAcross,
  type WonDiscountsConfig,
} from "./config.ts";
import { buildMarginPayload, costMinorUnits, marginFloorUnit, resolveMargin } from "./margin.ts";
import { currencyExponent, moneyFor } from "./money.ts";
import { globalTierSet, reachableTierSets } from "./tiers.ts";

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

// --- Builder (K5) -----------------------------------------------------------------------------

export interface StorefrontConfigOptions {
  /** The ShopConfig version the config was read from (`cv`). */
  configVersion: string;
  /**
   * Minor-unit digits of a currency (the shop's own currency data when the
   * caller has it); default money.ts currencyExponent (ISO 4217). A result that
   * is not a whole number 0–4 falls back to currencyExponent.
   */
  exponentOf?: (currency: string) => number;
}

/** A value under a key that may be an Object.prototype name ("__proto__"): always an own, enumerable entry. */
function setOwn<T>(target: Record<string, T>, key: string, value: T): void {
  Object.defineProperty(target, key, { value, enumerable: true, writable: true, configurable: true });
}

/**
 * Minor units → Liquid money units (major × 100, K5), rounded DOWN for a
 * currency with more than 2 digits (the page never shows more than checkout
 * gives). Integer math: exact for every amount the config allows.
 */
function liquidUnits(minor: number, exponent: number): number {
  return exponent <= 2 ? minor * 10 ** (2 - exponent) : Math.floor(minor / 10 ** (exponent - 2));
}

function exponentFor(currency: string, exponentOf: StorefrontConfigOptions["exponentOf"]): number {
  const e = exponentOf ? exponentOf(currency) : Number.NaN;
  return Number.isInteger(e) && e >= 0 && e <= 4 ? e : currencyExponent(currency);
}

type SetLike = ReadonlyDeep<WonDiscountsConfig>["modules"]["tiers"]["sets"][number];

function storefrontSet(set: SetLike, exponentOf: StorefrontConfigOptions["exponentOf"]): StorefrontTierSet {
  const breaks: StorefrontTierBreak[] = [];
  for (const b of [...set.breaks].sort((x, y) => x.minQty - y.minQty)) {
    if (typeof b.percent === "number") {
      breaks.push({ min: b.minQty, pct: b.percent });
      continue;
    }
    const off: Record<string, number> = {};
    let any = false;
    for (const currency of Object.keys(b.amountOff ?? {}).sort()) {
      const minor = moneyFor(b.amountOff, currency);
      if (minor === null) continue;
      setOwn(off, currency, liquidUnits(minor, exponentFor(currency, exponentOf)));
      any = true;
    }
    if (any) breaks.push({ min: b.minQty, off });
  }
  return { count: set.countAcross, breaks };
}

function storefrontMargin(margin: ReadonlyDeep<MarginModule>): StorefrontMargin {
  const payload = buildMarginPayload(margin);
  if (!payload.enabled) return { on: false };
  const out: StorefrontMargin = { on: true, max: payload.max };
  if (payload.col) {
    const col: Record<string, number> = {};
    // Every margin collection with its EFFECTIVE maximum (empty = the global
    // value): the lowest over a product's refs is then exactly resolveMargin's.
    for (const key of Object.keys(payload.col)) setOwn(col, key, payload.col[key][1] ?? payload.max);
    out.col = col;
  }
  return out;
}

function storefrontTexts(locales: ReadonlyDeep<WonDiscountsConfig>["locales"]): StorefrontConfigV1["texts"] {
  const texts: StorefrontConfigV1["texts"] = {};
  for (const locale of LOCALE_CODES) {
    const changed: Record<string, string> = {};
    let any = false;
    for (const [key, text] of Object.entries(locales[locale] ?? {})) {
      if (typeof text !== "string" || text === "") continue;
      setOwn(changed, key, text);
      any = true;
    }
    if (any) texts[locale] = changed;
  }
  return texts;
}

/**
 * The storefront config (K5) from the GATED config (plan-gate.ts, BILL-1): the
 * sets a product can reach (tiers.ts reachableTierSets) keyed by id, amounts in
 * Liquid money units per currency, the margin caps (never a cost), the
 * appearance preset (K7) and the texts the merchant changed (non-empty ones).
 * Pure; never throws.
 */
export function buildStorefrontConfig(gated: ReadonlyDeep<WonDiscountsConfig>, opts: StorefrontConfigOptions): StorefrontConfigV1 {
  const reachable = reachableTierSets(gated.modules.tiers.sets);
  const sets: Record<string, StorefrontTierSet> = {};
  for (const set of reachable) setOwn(sets, set.id, storefrontSet(set, opts.exponentOf));
  const preset = gated.storefront.appearancePreset;
  return {
    v: STOREFRONT_CONFIG_VERSION,
    cv: opts.configVersion,
    tiers: { global: globalTierSet(reachable)?.id ?? null, sets },
    margin: storefrontMargin(gated.modules.margin),
    appearance: { preset: (APPEARANCE_PRESETS as readonly string[]).includes(preset) ? preset : "default" },
    texts: storefrontTexts(gated.locales),
  };
}

// --- K4: the variant `pdp` metafield ------------------------------------------------------------

export interface PdpMaxDiscountInput {
  /** Price of one item, minor units of the SHOP currency. */
  unitPrice: number;
  /** The variant's cost as the cost mirror has it (variant metafield `cost`: MAJOR units); absent = unknown. */
  unitCost?: number | null;
  /** The cost's currency (metafield `cur`); must equal `shopCurrency` exactly. */
  costCurrency?: string | null;
  /** The shop currency (Admin `shop.currencyCode`). */
  shopCurrency: string;
  /** The GATED config's margin module. */
  margin: ReadonlyDeep<MarginModule>;
  /** The product's collections (GIDs or numeric ids); those with a margin setting decide, as at checkout. */
  collectionIds: readonly string[];
}

/**
 * The largest discount % margin protection allows on the variant at its price
 * in the shop currency (K4): (price − floor) / price, in tenths of a percent
 * ROUNDED DOWN, where the floor is margin.ts marginFloorUnit with the cost
 * (costMinorUnits) and the product's settings (resolveMargin over its
 * collections) — the same math checkout runs. null when protection is off or
 * the cost is unknown (the storefront then uses the config's `margin` caps).
 * A price at or below its floor → 0.
 */
export function pdpMaxDiscountPercent(input: PdpMaxDiscountInput): number | null {
  const payload = buildMarginPayload(input.margin, input.shopCurrency);
  if (!payload.enabled) return null;
  const shopCurrency = input.shopCurrency;
  const costMinor = costMinorUnits(input.unitCost ?? undefined, input.costCurrency ?? undefined, 1, shopCurrency, shopCurrency);
  if (costMinor === null) return null;
  const settings = resolveMargin(payload, input.collectionIds.map(variantKey));
  if (!settings) return null;
  const unitPrice = Number.isFinite(input.unitPrice) ? Math.max(0, Math.floor(input.unitPrice)) : 0;
  if (unitPrice === 0) return 0;
  const { floorUnit } = marginFloorUnit({ unitPrice, costMinor, ...settings });
  const allowed = unitPrice - floorUnit;
  if (allowed <= 0) return 0;
  // Integer division (exact below 2^53): tenths of a percent, rounded down.
  const scaled = allowed * 1000;
  const tenths = (scaled - (scaled % unitPrice)) / unitPrice;
  return Math.min(1000, tenths) / 10;
}
