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
   * Precomputed targeting from the product metafield (targeting.ts ruleRef):
   * `ruleId`, `ruleId:<variant>` or `ruleId@<campaign>[:<variant>]`. Product and
   * collection rules apply ONLY to lines listing them; order rules to every line.
   */
  ruleIds: readonly string[];
}

export interface CartCampaignInput {
  id: string | null;
  active: boolean;
  varsVersion: string | null;
}

export interface CartPlanInput {
  currency: CurrencyCode;
  countryCode?: string;
  /** Market handle (Pro market targeting). Unknown → market-targeted rules are not offered. */
  marketHandle?: string;
  customer?: { segments?: readonly string[] };
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
   * are evaluated at DAY granularity [spec]: that is all the function can read
   * without variables; exact-time windows are the Campaigns module's job (C4).
   */
  today?: string;
  /** Shop-local `YYYY-MM-DDTHH:MM:SS` (admin simulation); `today` is taken from it when missing. */
  now?: string;
  /** Delivery target only: cost of the delivery option in minor units, when known. */
  shippingAmount?: number;
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
  ruleIds: readonly string[];
}

export interface NormalizedCart {
  currency: CurrencyCode;
  marketHandle: string | null;
  segments: ReadonlySet<string> | null;
  lines: NormalizedLine[];
  /** Upper-cased, trimmed, unique, in entry order. */
  enteredCodes: string[];
  campaign: CartCampaignInput | null;
  today: string | null;
  shippingAmount: number | null;
  locale: PlanLocale;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const LOCAL_DATETIME_PREFIX_RE = /^(\d{4}-\d{2}-\d{2})T\d{2}:\d{2}/;

function nonNegativeInt(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.floor(v) : 0;
}

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
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

export function normalizeCode(code: string): string {
  return code.trim().toUpperCase();
}

/**
 * Defensive normalization: the function hands in whatever its adapter built from
 * a Shopify payload, so nonsense (NaN quantity, negative price, junk arrays) is
 * read as "nothing" rather than trusted. Throws only when `input` is not an
 * object at all (planCart turns that into an empty plan with an error).
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
    lines.push({
      id: str(raw.id),
      variantId: str(raw.variantId),
      productId: str(raw.productId),
      quantity,
      unitPrice,
      subtotal: quantity * unitPrice,
      outlet: raw.outlet === true,
      gift: typeof raw.giftTierId === "string" && raw.giftTierId !== "",
      ruleIds: Array.isArray(raw.ruleIds) ? (raw.ruleIds as unknown[]).filter((r): r is string => typeof r === "string") : [],
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

  const segments = input.customer && Array.isArray(input.customer.segments)
    ? new Set(input.customer.segments.filter((s): s is string => typeof s === "string"))
    : null;

  return {
    currency: str(input.currency).toUpperCase(),
    marketHandle: typeof input.marketHandle === "string" && input.marketHandle ? input.marketHandle : null,
    segments,
    lines,
    enteredCodes,
    campaign: readCampaign(input.campaign),
    today,
    shippingAmount:
      typeof input.shippingAmount === "number" && Number.isFinite(input.shippingAmount) && input.shippingAmount >= 0
        ? Math.floor(input.shippingAmount)
        : null,
    locale: input.locale === "en" ? "en" : "cs",
  };
}
