// Margin protection (MVP 2, spec §3 bod 7, §4.5; A1.7 + A2): the arithmetic
// planCart (plan.ts) and the admin share, and the compact form the settings take
// in the shop config. The Rust function ports this file 1:1 (engine/margin.rs):
// every float expression below is written in the order it must be evaluated,
// with no Intl and no locale anywhere near the math.
//
// Definition [spec, run decision 2026-09-29], as Shopify defines a product's
// margin: margin = (price after discounts − cost) / price after discounts. So
// the lowest price of one item (its "floor", minor units of the cart currency):
//   cost known    floorUnit = ceilTol(costMinor / (1 − m / 100)),  m ∈ [0, 95]
//                 (m absent = 0: never below the cost);
//   cost unknown  floorUnit = ceilTol(unitPrice × (1 − p / 100)),  p ∈ [0, 100]
//                 (p = the maximum discount %, default 50);
//   ceilTol(x) = ceil(x − 1e-6): float noise (999 999.9999999991) never adds a
//   minor unit, and a floor is never negative.
// The cost is "known" only when the variant's cost is a finite number > 0 in the
// SHOP currency (`cur` of its metafield = the payload's `cur`) and it converts
// into the cart currency: costMinor = unitCost × rate × 10^exp(cart currency),
// rate = 1 when the cart is in the shop currency, else `presentmentCurrencyRate`
// (shop → cart), which must then be finite and > 0.
//
// Collections (Pro): a product in collections with their own setting takes the
// strictest across them (max m, min p); a field a collection leaves empty is the
// global value. Free: plan-gate.ts has already folded collections into global.

import { variantKey } from "./cart.ts";
import type { MarginModule, ReadonlyDeep, WonDiscountsConfig } from "./config.ts";
import { CONFIG_LIMITS } from "./config/limits.ts";
import { currencyExponent, moneyFor } from "./money.ts";

// --- The compact payload (shop config, 9 000 B budget) -------------------------------------------

/** [minMarginPercent, maxDiscountPercent] of one collection; null = the global value. */
export type MarginCollectionTuple = [number | null, number | null];

/**
 * `modules.margin` in the shared function config. Off: `{enabled: false}`, the
 * settings never ship. On: `min` (absent = 0), `max`, `cur` = the shop currency
 * (absent when the builder did not know it: every cost is then unknown and the
 * `max` ceiling applies — never a wrong conversion, but the ceiling is only
 * stricter than NO protection, not necessarily than the cost floor: a product
 * whose cost is 70 % of its price keeps a 50 % ceiling, below its cost), `col`
 * keyed by the collection's numeric id (the tail of its GID; product metafields
 * carry the same ids as `marginRefs`).
 */
export type FunctionMarginPayload =
  | { enabled: false }
  | { enabled: true; min?: number; max: number; cur?: string; col?: Record<string, MarginCollectionTuple> };

export type MarginBasis = "cost" | "max_percent";
export type MarginSource = "global" | "collection";

export interface MarginSettings {
  minMarginPercent: number;
  maxDiscountPercent: number;
  /** "collection" when at least one of the product's margin collections has a setting. */
  source: MarginSource;
}

/** ceilTol's tolerance, minor units (the Rust function uses the same constant). */
export const MARGIN_TOLERANCE = 1e-6;

/** Default ceiling for products without a cost (A2), when a hand-made payload has none. */
const DEFAULT_MAX_DISCOUNT_PERCENT = 50;
const CURRENCY_RE = /^[A-Z]{3}$/;

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const clamp = (v: number, max: number) => Math.min(max, Math.max(0, v));
const hasOwn = (o: object, key: string) => Object.prototype.hasOwnProperty.call(o, key);

/** ceil(x − 1e-6): a ceiling that ignores float noise just above a whole minor unit. */
export function ceilTol(x: number): number {
  const up = Math.ceil(x - MARGIN_TOLERANCE);
  return up === 0 ? 0 : up; // never -0 (ceil of a tiny negative)
}

/** The collection GIDs whose margin setting ships (on, and at least one value set), in config order. */
export function marginCollectionIds(margin: ReadonlyDeep<MarginModule> | undefined): string[] {
  if (!margin || margin.enabled !== true) return [];
  const out: string[] = [];
  for (const o of margin.perCollection) {
    if (o.minMarginPercent === undefined && o.maxDiscountPercent === undefined) continue;
    if (!out.includes(o.collectionId)) out.push(o.collectionId);
  }
  return out;
}

/**
 * The compact margin for the shop config (function-payload.ts). Off → the
 * settings do not ship. Two overrides of one collection merge to the stricter
 * values. `shopCurrency` (Admin `shop.currencyCode`) becomes `cur`.
 */
export function buildMarginPayload(margin: ReadonlyDeep<MarginModule> | undefined, shopCurrency?: string): FunctionMarginPayload {
  if (!margin || margin.enabled !== true) return { enabled: false };
  const min = margin.global.minMarginPercent;
  const currency = typeof shopCurrency === "string" ? shopCurrency.toUpperCase() : "";
  const col: Record<string, MarginCollectionTuple> = {};
  let any = false;
  for (const o of margin.perCollection) {
    const m = o.minMarginPercent ?? null;
    const p = o.maxDiscountPercent ?? null;
    const key = variantKey(o.collectionId);
    if ((m === null && p === null) || key === "") continue;
    const seen = hasOwn(col, key) ? col[key] : null;
    col[key] = seen
      ? [
          seen[0] === null ? m : m === null ? seen[0] : Math.max(seen[0], m),
          seen[1] === null ? p : p === null ? seen[1] : Math.min(seen[1], p),
        ]
      : [m, p];
    any = true;
  }
  return {
    enabled: true,
    ...(min !== undefined ? { min } : {}),
    max: margin.global.maxDiscountPercent,
    ...(CURRENCY_RE.test(currency) ? { cur: currency } : {}),
    ...(any ? { col } : {}),
  };
}

function readTuplePart(v: unknown, max: number): number | null | undefined {
  if (v === null) return null;
  return finite(v) ? clamp(v, max) : undefined;
}

/**
 * The margin payload as the engine reads it — the tolerant reader, field by
 * field (amends the plan's resolution #2; the Rust function reads exactly this):
 *   - not an object, `enabled !== true` (a string "true" included), or `max`
 *     not a finite number → OFF (`{enabled: false}`); so is the MVP 1 module
 *     shape (`global` / `perCollection`, no top-level `max`);
 *   - `max`: clamped to 0–100;
 *   - `min`: a finite number is clamped to 0–95; anything else (absent, a
 *     string, NaN, null) is ignored → 0 = never below the cost;
 *   - `cur`: kept only when it is exactly 3 upper-case letters (A–Z); anything
 *     else is dropped → every cost is unknown and the `max` ceiling applies;
 *   - `col`: ignored unless an object; each entry is kept only when it is an
 *     array of exactly 2 elements, each `null` or a finite number (clamped: the
 *     first to 0–95, the second to 0–100); any other entry is ignored (its
 *     collection then has no own setting: the global values apply).
 * Never throws. Protection that is ON never reads as off because of a junk
 * optional field: a junk `min` means "never below the cost", a junk `cur` the
 * `max` ceiling for every line, a junk `col` entry the global values.
 */
export function readMarginPayload(raw: unknown): FunctionMarginPayload {
  if (!isRecord(raw) || raw.enabled !== true || !finite(raw.max)) return { enabled: false };
  const out: { enabled: true; min?: number; max: number; cur?: string; col?: Record<string, MarginCollectionTuple> } = {
    enabled: true,
    max: clamp(raw.max, 100),
  };
  if (finite(raw.min)) out.min = clamp(raw.min, CONFIG_LIMITS.minMarginPercent);
  if (typeof raw.cur === "string" && CURRENCY_RE.test(raw.cur)) out.cur = raw.cur;
  if (isRecord(raw.col)) {
    const col: Record<string, MarginCollectionTuple> = {};
    let any = false;
    for (const key of Object.keys(raw.col)) {
      const v = raw.col[key];
      if (!Array.isArray(v) || v.length !== 2) continue;
      const m = readTuplePart(v[0], CONFIG_LIMITS.minMarginPercent);
      const p = readTuplePart(v[1], 100);
      if (m === undefined || p === undefined) continue;
      col[key] = [m, p];
      any = true;
    }
    if (any) out.col = col;
  }
  return out;
}

/**
 * The settings that apply to a product: null when protection is off; else the
 * global values, or — when some of its `marginRefs` have a setting — the
 * strictest across those collections (max m, min p), an empty field being the
 * global value. Order-independent. Expects a payload from readMarginPayload /
 * buildMarginPayload.
 */
export function resolveMargin(payload: FunctionMarginPayload, marginRefs: readonly string[]): MarginSettings | null {
  if (!payload.enabled) return null;
  const globalMin = payload.min ?? 0;
  const globalMax = payload.max;
  let minMarginPercent = globalMin;
  let maxDiscountPercent = globalMax;
  let matched = false;
  const col = payload.col;
  if (col) {
    for (const ref of marginRefs) {
      if (!hasOwn(col, ref)) continue;
      const [m, p] = col[ref];
      const collectionMin = m ?? globalMin;
      const collectionMax = p ?? globalMax;
      if (!matched) {
        minMarginPercent = collectionMin;
        maxDiscountPercent = collectionMax;
        matched = true;
      } else {
        minMarginPercent = Math.max(minMarginPercent, collectionMin);
        maxDiscountPercent = Math.min(maxDiscountPercent, collectionMax);
      }
    }
  }
  return { minMarginPercent, maxDiscountPercent, source: matched ? "collection" : "global" };
}

/** Minor units per major unit of a currency: exactly 1, 100 or 1000 (money.ts exponents 0, 2, 3). */
function minorScale(currency: string): number {
  const exponent = currencyExponent(currency);
  return exponent === 0 ? 1 : exponent === 3 ? 1000 : 100;
}

/**
 * One item's cost in minor units of the CART currency, or null when unknown:
 * `unitCost` must be a finite number > 0 in the shop currency
 * (`unitCostCurrency === shopCurrency`, exact upper-case ISO codes); a cart in
 * another currency needs a finite rate > 0 (shop → cart), the shop currency uses
 * rate 1 whatever `rate` says. Evaluated as `(unitCost × rate) × scale`, capped
 * at the config's money cap (never Infinity).
 */
export function costMinorUnits(
  unitCost: number | undefined,
  unitCostCurrency: string | undefined,
  rate: number | undefined,
  cartCurrency: string,
  shopCurrency: string | undefined,
): number | null {
  if (!finite(unitCost) || unitCost <= 0) return null;
  if (typeof shopCurrency !== "string" || shopCurrency === "" || unitCostCurrency !== shopCurrency) return null;
  let r = 1;
  if (cartCurrency !== shopCurrency) {
    if (!finite(rate) || rate <= 0) return null;
    r = rate;
  }
  const cost = unitCost * r * minorScale(cartCurrency);
  return Math.min(cost, CONFIG_LIMITS.moneyMinorUnits);
}

/**
 * The floor of one item (see the header), minor units, within [0, money cap].
 * `costMinor` null / ≤ 0 → no cost: the maximum-discount ceiling applies.
 * Percents are clamped defensively (m to 0–95, p to 0–100).
 */
export function marginFloorUnit(args: {
  unitPrice: number;
  costMinor: number | null;
  minMarginPercent: number;
  maxDiscountPercent: number;
}): { floorUnit: number; basis: MarginBasis } {
  const cap = CONFIG_LIMITS.moneyMinorUnits;
  const { costMinor } = args;
  if (costMinor !== null && finite(costMinor) && costMinor > 0) {
    const m = finite(args.minMarginPercent) ? clamp(args.minMarginPercent, CONFIG_LIMITS.minMarginPercent) : 0;
    const floorUnit = ceilTol(costMinor / (1 - m / 100));
    return { floorUnit: Math.min(cap, Math.max(0, floorUnit)), basis: "cost" };
  }
  const p = finite(args.maxDiscountPercent) ? clamp(args.maxDiscountPercent, 100) : DEFAULT_MAX_DISCOUNT_PERCENT;
  const unitPrice = finite(args.unitPrice) ? Math.max(0, args.unitPrice) : 0;
  const floorUnit = ceilTol(unitPrice * (1 - p / 100));
  return { floorUnit: Math.min(cap, Math.max(0, floorUnit)), basis: "max_percent" };
}

// --- Impact overview (Pro admin, spec "Přehled zásahů") -------------------------------------------

/** A variant as the admin knows it from the cost mirror and the targeting index. */
export interface MarginVariant {
  productId: string;
  variantId: string;
  title: string;
  /** Price of one item, minor units of the SHOP currency. */
  price: number;
  /** Cost of one item, minor units of the shop currency; null = unknown (no cost, ≤ 0, other currency). */
  cost: number | null;
  /** Rule refs that target the variant (product metafield `ruleIds` + its `variantRuleIds`); campaign refs are ignored. */
  ruleRefs: readonly string[];
  /** Numeric ids of its collections that have a margin setting (product metafield `marginRefs`). */
  marginRefs: readonly string[];
}

export interface MarginImpactCapped {
  productId: string;
  variantId: string;
  title: string;
  /** What the rule would take off one item, minor units. */
  wanted: number;
  /** What margin protection allows on one item (< wanted). */
  allowed: number;
  basis: MarginBasis;
}

export interface MarginImpactRule {
  ruleId: string;
  discountClass: "product" | "order";
  /** How many of the variants it applies to margin protection lowers it on (all of them, not only `capped`). */
  variants: number;
  /** The top MARGIN_IMPACT_TOP of those, the largest loss (wanted − allowed) first, then variant id. */
  capped: MarginImpactCapped[];
}

export interface MarginImpact {
  /** Every enabled product rule (percentage, or fixed with a value in the currency) and every enabled percentage order rule, in config order. */
  rules: MarginImpactRule[];
  /** Variants without a known cost (the maximum discount % applies to them). */
  withoutCost: number;
}

export const MARGIN_IMPACT_TOP = 50;

/**
 * Where margin protection lowers the active discounts, per rule, for ONE item of
 * each variant in the shop currency — computed from the (gated) config and the
 * cost mirror, not from orders (orders need `read_orders`; real interventions
 * come with analytics, MVP 7). Uses the margin settings whether or not
 * protection is on, so the admin can preview it before switching it on. An
 * order rule is measured as if the item were the whole order; a fixed order
 * amount depends on the cart and is not listed. Schedules and Pro stacking are
 * not considered (each rule on its own).
 */
export function marginImpact(
  config: ReadonlyDeep<WonDiscountsConfig>,
  variants: readonly MarginVariant[],
  currency: string,
): MarginImpact {
  const payload = buildMarginPayload({ ...config.modules.margin, enabled: true }, currency);
  let withoutCost = 0;
  const measured = variants.map((v) => {
    const settings = resolveMargin(payload, v.marginRefs) as MarginSettings;
    const costMinor = finite(v.cost) && v.cost > 0 ? v.cost : null;
    if (costMinor === null) withoutCost += 1;
    const price = finite(v.price) ? Math.max(0, Math.floor(v.price)) : 0;
    const floor = marginFloorUnit({ unitPrice: price, costMinor, ...settings });
    return { v, price, allowedMax: Math.max(0, price - floor.floorUnit), basis: floor.basis };
  });
  const byRule = new Map<string, typeof measured>();
  for (const m of measured) {
    for (const ref of m.v.ruleRefs) {
      let list = byRule.get(ref);
      if (!list) byRule.set(ref, (list = []));
      if (!list.includes(m)) list.push(m);
    }
  }

  const rules: MarginImpactRule[] = [];
  for (const rule of config.modules.codes.rules) {
    if (!rule.enabled) continue;
    const kind = rule.target.kind;
    const discountClass = kind === "order" ? "order" : kind === "products" || kind === "collections" ? "product" : null;
    if (!discountClass || rule.value.kind === "freeShipping") continue;
    let wantedOf: (price: number) => number;
    if (rule.value.kind === "percentage") {
      const percent = clamp(rule.value.percent, 100);
      wantedOf = (price) => Math.round((price * percent) / 100);
    } else {
      const amount = moneyFor(rule.value.amount, currency);
      if (discountClass === "order" || amount === null) continue;
      wantedOf = (price) => Math.min(amount, price);
    }
    const targeted = discountClass === "order" ? measured : (byRule.get(rule.id) ?? []);
    const capped: MarginImpactCapped[] = [];
    for (const m of targeted) {
      const wanted = wantedOf(m.price);
      if (wanted <= m.allowedMax) continue;
      capped.push({ productId: m.v.productId, variantId: m.v.variantId, title: m.v.title, wanted, allowed: m.allowedMax, basis: m.basis });
    }
    capped.sort((a, b) => b.wanted - b.allowed - (a.wanted - a.allowed) || (a.variantId < b.variantId ? -1 : a.variantId > b.variantId ? 1 : 0));
    rules.push({ ruleId: rule.id, discountClass, variants: capped.length, capped: capped.slice(0, MARGIN_IMPACT_TOP) });
  }
  return { rules, withoutCost };
}
