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
  /**
   * Margin protection (MVP 2): cost of one item in MAJOR units of the SHOP
   * currency, from the variant metafield `$app:won_discounts`/`variant`
   * (`cost`). Pass it as read; the engine decides whether it is usable
   * (margin.ts costMinorUnits: a finite number > 0 in the shop currency).
   */
  unitCost?: number;
  /**
   * The currency `unitCost` is in (the metafield's `cur`). Adapters pass
   * Shopify's currency code AS-IS (an upper-case ISO 4217 enum, e.g. "CZK"): the
   * engine compares it case-sensitively with the shop config's margin `cur`, and
   * anything else (another currency, "czk", missing) makes the cost unknown.
   */
  unitCostCurrency?: string;
  /**
   * Numeric ids of the product's collections that have a margin setting (the
   * product metafield's `marginRefs`, targeting.ts). Only ids the shop config's
   * margin `col` lists change anything.
   */
  marginRefs?: readonly string[];
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
  /**
   * MVP 3 (contracts K1/K3): the product metafield's `tierRef` — the id of the
   * scoped tier set of the product, as the sync wrote it. Absent or null = the
   * payload's global set applies. Anything else that is not a set id of the
   * shop config (another type, "", a set it does not carry) gives the line NO
   * tier (fail closed: never the global set).
   */
  tierRef?: string | null;
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
  /**
   * Every entered code, Won or not, one per entry (function:
   * enteredDiscountCodes; the adapter passes an entry without a code string as
   * ""). Case-insensitive. Every entry counts toward MAX_ENTERED_CODES.
   */
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
  /**
   * Shop currency → cart currency (function: `presentmentCurrencyRate`), for
   * margin protection's cost conversion. Unused when the cart is in the shop
   * currency; missing / not a positive number → costs in another cart currency
   * are unknown (the maximum discount % applies).
   */
  shopToCartRate?: number;
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
  /** The `_won_gift` attribute (the gift tier id, MVP 4 R3); null when not a gift line. */
  giftTierId: string | null;
  /** Product-wide refs + this variant's refs. */
  ruleIds: readonly string[];
  /** As given (validated by margin.ts costMinorUnits); null = none. */
  unitCost: number | null;
  unitCostCurrency: string | null;
  /** The metafield's `marginRefs` that are strings. */
  marginRefs: readonly string[];
  /**
   * How many entries the metafield's `marginRefs` array has, junk included (0
   * when not an array): more than margin.ts MAX_MARGIN_REFS → the payload's
   * strictest setting applies (resolveProductMargin).
   */
  marginRefCount: number;
  /**
   * The product metafield's `tierRef`: null when absent or null (the global
   * set); a string as given; any other value "" — no set has that id, so the
   * line gets no tier (fail closed, plan-tiers.ts step 1).
   */
  tierRef: string | null;
}

export interface NormalizedCart {
  currency: CurrencyCode;
  /** Upper-case ISO 3166-1 alpha-2, or null. */
  countryCode: string | null;
  lines: NormalizedLine[];
  /** Upper-cased, trimmed, unique, in entry order (every entry: the code outcomes). */
  enteredCodes: string[];
  /**
   * How many of `enteredCodes` the engine considers (a prefix): those first
   * entered among the first MAX_ENTERED_CODES entries.
   */
  consideredCodes: number;
  /**
   * The first MAX_ENTERED_CODES entries as entered (every entry counts, whatever
   * it holds), each normalized ("" for one that is not a string) with its length
   * as entered (UTF-16 units, white space included): plan.ts `matchCodes`
   * matches those that can be a Won code.
   */
  consideredEntries: ConsideredEntry[];
  campaign: CartCampaignInput | null;
  today: string | null;
  locale: PlanLocale;
  /** As given when it is a number (validated by costMinorUnits), else null. */
  shopToCartRate: number | null;
}

/** One of the first MAX_ENTERED_CODES entries (NormalizedCart `consideredEntries`). */
export interface ConsideredEntry {
  /** normalizeCode of the entry; "" when it is not a string. */
  code: string;
  /** The entry's length as entered, white space included (UTF-16 units); 0 when not a string. */
  rawLength: number;
  /**
   * The entry, trimmed, is all ASCII (false when not a string). Only such an
   * entry can be a generated batch code (code-batch.ts): the function compares
   * bytes, and "ı" / "ſ" upper-case INTO ASCII letters.
   */
  ascii: boolean;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The entered codes the engine considers ([spec], MVP 2 audit round 5b): the
 * first 25 entries as entered. A cart can hold 250 (Shopify's Storefront API),
 * and reading every one took the checkout function over Shopify's instruction
 * limit on a heavy cart. The cap counts ENTRIES, whatever they hold — a repeat,
 * an empty code, one longer than every Won code (audit round 6) or padded past
 * ENTERED_CODE_PADDING (audit round 7): such a code is never matched, plan.ts
 * `matchCodes`, and still counts — so nothing can
 * make the reader read more. Each of the first 25 is trimmed and upper-cased
 * (`normalizeCode`) and matched to a rule once. A later code is never matched
 * (plan.ts `over_limit`): a code discount whose code comes after them does not
 * apply (fail closed), and its code node emits nothing. The same holds for a
 * rule with one code among the first 25 and another after them: the plan (and
 * Try Cart) say the rule applies, but when Shopify runs its node with the later
 * code as the triggering code, the node emits nothing (fail closed; the
 * discount function's README, Invariants).
 */
export const MAX_ENTERED_CODES = 25;

/**
 * How much longer than the longest Won code an entered code may be AS ENTERED
 * (UTF-16 units, the white space around it included) and still be matched
 * (MVP 2 audit round 7; plan.ts `matchCodes`, the Rust function's hash.rs
 * `CODE_PADDING`). A longer entry is never matched, nor trimmed or upper-cased
 * by the function, and still counts toward MAX_ENTERED_CODES: whatever an entry
 * holds, the work on it is bounded by the longest Won code. A customer enters a
 * code as it is written (a pasted one may carry a space or a line break), so a
 * Won code with up to 16 characters of white space around it always matches;
 * one entered with more than the bound allows is not taken (fail closed: its
 * discount does not apply).
 */
export const ENTERED_CODE_PADDING = 16;
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
      giftTierId: typeof raw.giftTierId === "string" && raw.giftTierId !== "" ? raw.giftTierId : null,
      ruleIds: variantRefs.length > 0 ? [...strings(raw.ruleIds), ...variantRefs] : strings(raw.ruleIds),
      unitCost: typeof raw.unitCost === "number" ? raw.unitCost : null,
      unitCostCurrency: typeof raw.unitCostCurrency === "string" ? raw.unitCostCurrency : null,
      marginRefs: strings(raw.marginRefs),
      marginRefCount: Array.isArray(raw.marginRefs) ? raw.marginRefs.length : 0,
      tierRef: raw.tierRef === undefined || raw.tierRef === null ? null : typeof raw.tierRef === "string" ? raw.tierRef : "",
    });
  }

  const enteredCodes: string[] = [];
  const seenCodes = new Set<string>(); // O(1) a code: a cart can hold 250 (Storefront API)
  const consideredEntries: ConsideredEntry[] = [];
  let entered = 0;
  let consideredCodes = 0;
  // Every entry counts toward the cap, whatever it holds (the Rust function reads
  // exactly the first 25 entries, src/input.rs).
  for (const raw of Array.isArray(input.enteredCodes) ? (input.enteredCodes as readonly unknown[]) : []) {
    entered += 1;
    const code = typeof raw === "string" ? raw.trim().toUpperCase() : ""; // normalizeCode
    if (entered <= MAX_ENTERED_CODES) {
      // eslint-disable-next-line no-control-regex
      consideredEntries.push({ code, rawLength: typeof raw === "string" ? raw.length : 0, ascii: typeof raw === "string" && /^[\x00-\x7f]*$/.test(raw.trim()) });
    }
    if (code && !seenCodes.has(code)) {
      seenCodes.add(code);
      enteredCodes.push(code);
      if (entered <= MAX_ENTERED_CODES) consideredCodes += 1;
    }
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
    consideredCodes,
    consideredEntries,
    campaign: readCampaign(input.campaign),
    today,
    locale: input.locale === "en" ? "en" : "cs",
    shopToCartRate: typeof input.shopToCartRate === "number" ? input.shopToCartRate : null,
  };
}
