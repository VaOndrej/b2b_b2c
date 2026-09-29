// The normalized cart the engine plans (spec §3). Every consumer has its own
// adapter into this shape — the discount function (its input query), the admin
// "Vyzkoušet košík", later the storefront (/cart.js) — and nothing else: the
// engine never reads a Shopify payload directly (DATA-4, one brain).

import type { CurrencyCode } from "./money.ts";

export type PlanLocale = "cs" | "en";

export interface CartLineInput {
  /** Cart line id (the function's `cart.lines[].id`); product candidates target it. */
  id: string;
  variantId: string;
  productId: string;
  quantity: number;
  /** Price per item in minor units of the cart currency, before any discount. */
  unitPrice: number;
  compareAtUnitPrice?: number;
  /** MVP 2 slot (margin protection); unused by MVP 1. */
  unitCost?: number;
  /** Active outlet run on the variant (A1.1): excluded from product and order discounts. */
  outlet?: boolean;
  /** A Won gift line (`_won_gift`, A1.2): outside every discount and every threshold. */
  giftTierId?: string;
  /**
   * Precomputed product-wide targeting from the product metafield (targeting.ts):
   * `ruleId` or `ruleId@<campaign>`. Product and collection rules apply ONLY to
   * lines listing them (here or in `variantRuleIds`); order rules to every line.
   */
  ruleIds: readonly string[];
  /**
   * Variant-level targeting from the same metafield, keyed by the variant's
   * numeric id (`variantKey`, the tail of its GID — short, so ~400 targeted
   * variants still fit the product metafield). The engine uses only the entry of
   * this line's own variant — a sibling variant's rules never apply. A full-GID
   * key is still understood (tolerant reader). The adapter may pass the whole map.
   */
  variantRuleIds?: Readonly<Record<string, readonly string[]>>;
}

export interface CartCampaignInput {
  id: string | null;
  active: boolean;
  varsVersion: string | null;
}

export interface CartPlanInput {
  currency: CurrencyCode;
  /**
   * Buyer's country (function: `localization.country.isoCode`). Pro market
   * targeting matches it against the shared config's `marketCountries`; unknown
   * → market-targeted rules are not offered.
   */
  countryCode?: string;
  lines: readonly CartLineInput[];
  /** Every entered code, Won or not (function: enteredDiscountCodes). Case-insensitive. */
  enteredCodes: readonly string[];
  /**
   * The node's campaign variables (C4/C7): `id` + `varsVersion` from its
   * `function_vars`, `active` = `shop.localTime.dateTimeBetween(start, end)`.
   * Overrides apply only when id + version match the shop config's current
   * campaign (function-payload.ts); otherwise the plan has no campaign.
   * Admin simulation: `campaignInputFromVars(buildNodeVars(...), now)`.
   */
  campaign?: CartCampaignInput | null;
  /**
   * Shop-local date `YYYY-MM-DD` (function: `shop.localTime.date`). Rule schedules
   * are evaluated at DAY granularity against the shop-local dates the shared
   * config carries (buildShopFunctionConfig converts them with the shop's time
   * zone); exact-time windows are the Campaigns module's job (C4).
   */
  today?: string;
  /** Shop-local `YYYY-MM-DDTHH:MM:SS` (admin simulation); `today` is taken from it when missing. */
  now?: string;
  // No delivery cost: the function's input query does not read one, so the
  // engine never ranks shipping discounts by it (a TS-only ranking would let
  // the admin or storefront promise what checkout does not give, audit MVP 1
  // drift #7). A cost-aware ranking needs the Rust function to read the cost first.
  /** Language of generated messages (rule names win; this only phrases the fallback). */
  locale?: PlanLocale;
}

export interface NormalizedLine {
  id: string;
  variantId: string;
  productId: string;
  quantity: number;
  unitPrice: number;
  subtotal: number;
  outlet: boolean;
  gift: boolean;
  /** Product-wide refs + this variant's refs. */
  ruleIds: readonly string[];
}

export interface NormalizedCart {
  currency: CurrencyCode;
  /** Upper-case ISO 3166-1 alpha-2, or null. */
  countryCode: string | null;
  lines: NormalizedLine[];
  /** Upper-cased, trimmed, unique, in entry order. */
  enteredCodes: string[];
  campaign: CartCampaignInput | null;
  today: string | null;
  locale: PlanLocale;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const LOCAL_DATETIME_PREFIX_RE = /^(\d{4}-\d{2}-\d{2})T\d{2}:\d{2}/;
const COUNTRY_RE = /^[A-Z]{2}$/;

function nonNegativeInt(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.floor(v) : 0;
}

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function strings(v: unknown): string[] {
  return Array.isArray(v) ? (v as unknown[]).filter((r): r is string => typeof r === "string") : [];
}

function readCampaign(v: unknown): CartCampaignInput | null {
  if (typeof v !== "object" || v === null) return null;
  const c = v as Record<string, unknown>;
  return {
    id: typeof c.id === "string" && c.id ? c.id : null,
    active: c.active === true,
    varsVersion: typeof c.varsVersion === "string" && c.varsVersion ? c.varsVersion : null,
  };
}

/** The short, stable key of a GID (`gid://shopify/ProductVariant/42` → "42"). */
export function variantKey(variantId: string): string {
  const slash = variantId.lastIndexOf("/");
  return slash === -1 ? variantId : variantId.slice(slash + 1);
}

/** This variant's refs from a `variantRuleIds` map: by numeric id, else by full GID. */
function refsOfVariant(byVariant: unknown, variantId: string): string[] {
  if (!variantId || typeof byVariant !== "object" || byVariant === null) return [];
  const map = byVariant as Record<string, unknown>;
  const own = (key: string) => Object.prototype.hasOwnProperty.call(map, key);
  const key = variantKey(variantId);
  if (own(key)) return strings(map[key]);
  return own(variantId) ? strings(map[variantId]) : [];
}

export function normalizeCode(code: string): string {
  return code.trim().toUpperCase();
}

/**
 * Defensive normalization: the function hands in whatever its adapter built from
 * a Shopify payload, so nonsense (NaN quantity, negative price, junk arrays) is
 * read as "nothing" rather than trusted. Throws only when `input` is not an
 * object at all (planCart turns that into an empty plan with a reason).
 */
export function normalizeCart(input: CartPlanInput): NormalizedCart {
  if (typeof input !== "object" || input === null) throw new TypeError("cart input is not an object");
  const lines: NormalizedLine[] = [];
  const rawLines: readonly unknown[] = Array.isArray(input.lines) ? input.lines : [];
  for (const item of rawLines) {
    if (typeof item !== "object" || item === null) continue;
    const raw = item as Partial<Record<keyof CartLineInput, unknown>>;
    const quantity = nonNegativeInt(raw.quantity);
    const unitPrice = nonNegativeInt(raw.unitPrice);
    const variantId = str(raw.variantId);
    const variantRefs = refsOfVariant(raw.variantRuleIds, variantId);
    lines.push({
      id: str(raw.id),
      variantId,
      productId: str(raw.productId),
      quantity,
      unitPrice,
      subtotal: quantity * unitPrice,
      outlet: raw.outlet === true,
      gift: typeof raw.giftTierId === "string" && raw.giftTierId !== "",
      ruleIds: variantRefs.length > 0 ? [...strings(raw.ruleIds), ...variantRefs] : strings(raw.ruleIds),
    });
  }

  const enteredCodes: string[] = [];
  for (const raw of Array.isArray(input.enteredCodes) ? input.enteredCodes : []) {
    if (typeof raw !== "string") continue;
    const code = normalizeCode(raw);
    if (code && !enteredCodes.includes(code)) enteredCodes.push(code);
  }

  let today: string | null = null;
  if (typeof input.today === "string" && DATE_RE.test(input.today)) today = input.today;
  else if (typeof input.now === "string") today = LOCAL_DATETIME_PREFIX_RE.exec(input.now)?.[1] ?? null;

  const country = str(input.countryCode).trim().toUpperCase();

  return {
    currency: str(input.currency).toUpperCase(),
    countryCode: COUNTRY_RE.test(country) ? country : null,
    lines,
    enteredCodes,
    campaign: readCampaign(input.campaign),
    today,
    locale: input.locale === "en" ? "en" : "cs",
  };
}
