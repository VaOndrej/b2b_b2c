// Won Discounts config v0 (doctrine DATA-2/DATA-3, spec §2). This is the single
// source of truth's *shape*: sanitize + migrate + read all live here so admin,
// storefront and the discount function agree on exactly one interpretation of a
// stored config (DATA-4 — "one brain"). No engine/planCart here (YAGNI for MVP0).
//
// Every field has a strong default so a shop that never touched a setting still
// gets a complete, valid config; sanitizeConfig never throws and drops anything it
// cannot make sense of, recording a human-readable ConfigIssue instead.

import { type CurrencyCode, type MoneyByCurrency, sanitizeMoneyByCurrency } from "./money.ts";

export const SCHEMA_VERSION = 1;

// --- Enums (runtime `as const` arrays so a docs generator can read them later) -----

export const COMBINATION_CATEGORIES = [
  "outletWithAnything",
  "productWithProduct",
  "productWithOrder",
  "productWithShipping",
  "orderWithShipping",
] as const;
export type CombinationCategory = (typeof COMBINATION_CATEGORIES)[number];

/** MVP0: engine-level product-vs-product combination is always "best wins" (A1).
 * Pro's per-rule combination is expressed on the rule itself (`combinesWith`), not
 * as another engine-level mode here. */
export const PRODUCT_WITH_PRODUCT_MODES = ["best"] as const;
export type ProductWithProductMode = (typeof PRODUCT_WITH_PRODUCT_MODES)[number];

export const DISCOUNT_METHODS = ["automatic", "code"] as const;
export type DiscountMethod = (typeof DISCOUNT_METHODS)[number];

export const DISCOUNT_VALUE_KINDS = ["percentage", "fixed", "freeShipping"] as const;
export type DiscountValueKind = (typeof DISCOUNT_VALUE_KINDS)[number];

export const DISCOUNT_TARGET_KINDS = [
  "order",
  "products",
  "collections",
  "shipping",
] as const;
export type DiscountTargetKind = (typeof DISCOUNT_TARGET_KINDS)[number];

export const TIER_COUNT_ACROSS_MODES = ["line", "product", "cart"] as const;
export type TierCountAcross = (typeof TIER_COUNT_ACROSS_MODES)[number];

export const OUTLET_DISPLAY_MODES = [
  "silent",
  "strike",
  "strike_badge",
  "strike_badge_left",
] as const;
export type OutletDisplay = (typeof OUTLET_DISPLAY_MODES)[number];

export const REOPEN_ON_RETURN_MODES = ["auto", "ask", "never"] as const;
export type ReopenOnReturnMode = (typeof REOPEN_ON_RETURN_MODES)[number];

export const LOCALE_CODES = ["cs", "sk", "en"] as const;
export type LocaleCode = (typeof LOCALE_CODES)[number];

/**
 * Onboarding step 1 "Co chceš řešit?" (docs/won-discounts/rozhodnuti.md, Onboarding):
 * doprava/dárek → rewards, množstevní slevy → tiers, výprodej → outlet, marže →
 * margin, přesun slev → migrate. Goals only ORDER the modules (all five stay
 * visible). MVP 1 onboarding extends this list when it needs another goal; an
 * unknown value is dropped with an issue, never stored.
 */
export const ONBOARDING_GOALS = ["rewards", "tiers", "outlet", "margin", "migrate"] as const;
export type OnboardingGoal = (typeof ONBOARDING_GOALS)[number];

// --- Types (spec §2 catalog) --------------------------------------------------------

export interface MarketSetting {
  handle: string;
  currency: CurrencyCode;
  enabled: boolean;
}

export interface EngineSettings {
  combination: {
    outletWithAnything: boolean; // default false (A1): outlet combines with nothing
    productWithProduct: ProductWithProductMode; // default "best"
    productWithOrder: boolean; // default true
    productWithShipping: boolean; // default true
    orderWithShipping: boolean; // default true
  };
}

export interface DiscountRuleValuePercentage {
  kind: "percentage";
  percent: number;
}
export interface DiscountRuleValueFixed {
  kind: "fixed";
  amount: MoneyByCurrency;
}
export interface DiscountRuleValueFreeShipping {
  kind: "freeShipping";
}
export type DiscountRuleValue =
  | DiscountRuleValuePercentage
  | DiscountRuleValueFixed
  | DiscountRuleValueFreeShipping;

export interface DiscountTargetOrder {
  kind: "order";
}
export interface DiscountTargetProducts {
  kind: "products";
  productIds: string[];
  variantIds: string[];
}
export interface DiscountTargetCollections {
  kind: "collections";
  ids: string[];
}
export interface DiscountTargetShipping {
  kind: "shipping";
}
export type DiscountTarget =
  | DiscountTargetOrder
  | DiscountTargetProducts
  | DiscountTargetCollections
  | DiscountTargetShipping;

export interface DiscountRule {
  id: string;
  enabled: boolean;
  name: string;
  method: DiscountMethod;
  codes?: string[];
  value: DiscountRuleValue;
  target: DiscountTarget;
  minimum?: { subtotal?: MoneyByCurrency; quantity?: number };
  schedule?: { startsAt?: string; endsAt?: string };
  limits?: { usageLimit?: number; oncePerCustomer?: boolean };
  targeting?: { segments?: string[]; markets?: string[] }; // Pro
  combinesWith?: { ruleIds: string[] }; // Pro (per-rule combination override)
  origin?: { nativeId: string }; // set when migrated from a native Shopify discount
}

export interface CodesModule {
  rules: DiscountRule[];
}

export interface TierBreak {
  minQty: number;
  percent?: number;
  amountOff?: MoneyByCurrency;
}

/** "global" (Free: exactly one set) or a Pro scoped selection. */
export type TierSetScope = "global" | { productIds?: string[]; collectionIds?: string[] };

export interface TierSet {
  id: string;
  scope: TierSetScope;
  countAcross: TierCountAcross;
  breaks: TierBreak[];
}

export interface TiersModule {
  sets: TierSet[];
}

export interface GiftTier {
  id: string;
  threshold: MoneyByCurrency;
  choices: string[]; // variant ids; Free = 1, Pro = up to 3
  fallbackVariantId?: string;
}

export interface RewardsModule {
  freeShipping?: { threshold: MoneyByCurrency };
  gifts: GiftTier[];
  /** Default false (safest for the shopper): the reward threshold is the pre-discount
   * subtotal, so a gift already earned in the cart never disappears at checkout. */
  countOtherDiscounts: boolean;
  giftDeclinable: true;
}

export interface OutletModule {
  display: OutletDisplay; // default "strike_badge" — no "X left" by default
  reopenOnReturnAfterEnd: ReopenOnReturnMode; // default "ask"
}

export interface MarginCollectionOverride {
  collectionId: string;
  minMarginPercent?: number;
  maxDiscountPercent?: number;
}

export interface MarginModule {
  global: {
    minMarginPercent?: number; // from unitCost, when known
    maxDiscountPercent: number; // ceiling for products with no unitCost (A2); default 50
  };
  perCollection: MarginCollectionOverride[]; // Pro
}

export interface RuleOverride {
  ruleId: string;
  patch: Record<string, unknown>;
}

export interface Campaign {
  id: string;
  name: string;
  window: { start: string; end: string }; // shop local time
  overrides: RuleOverride[];
  killed: boolean;
}

export interface StorefrontSettings {
  appearancePreset: string;
  cardPricesEnabled: boolean; // BETA: quantity prices on cards/search
}

export type LocaleDictionary = Readonly<Record<LocaleCode, Record<string, string>>>;

export interface OnboardingState {
  goals: OnboardingGoal[];
  step: number; // 1-5, ordering only — modules stay always visible
}

export interface WonDiscountsConfig {
  schemaVersion: 1;
  markets: MarketSetting[];
  engine: EngineSettings;
  modules: {
    codes: CodesModule;
    tiers: TiersModule;
    rewards: RewardsModule;
    outlet: OutletModule;
    margin: MarginModule;
  };
  campaigns: Campaign[];
  storefront: StorefrontSettings;
  locales: LocaleDictionary;
  onboarding: OnboardingState;
}

export interface ConfigIssue {
  path: string;
  code: string;
  message: string;
}

/** Deeply read-only view of `T` (the type of the shared, frozen DEFAULT_CONFIG). */
export type ReadonlyDeep<T> = T extends (infer U)[]
  ? ReadonlyArray<ReadonlyDeep<U>>
  : T extends object
    ? { readonly [K in keyof T]: ReadonlyDeep<T[K]> }
    : T;

// --- Limits (audit P2-1) ---------------------------------------------------------------

/**
 * Hard caps on every list that reaches ShopConfig/ConfigVersion, so a buggy or
 * hostile admin request cannot bloat storage or the per-request read. Anything over
 * a cap is dropped with a human-readable issue (never silently). The part of the
 * config the discount function reads is additionally bounded at save time by the
 * byte budget in function-config.ts (C3). Exported so the admin can explain a limit
 * instead of hard-coding the number (§4c, "no magic numbers").
 */
export const CONFIG_LIMITS = Object.freeze({
  rules: 200,
  codesPerRule: 1000,
  /** Shopify's own maximum discount code length. */
  codeLength: 255,
  tierSets: 50,
  breaksPerTierSet: 10,
  giftTiers: 10,
  campaigns: 50,
  overridesPerCampaign: 200,
  localeStringLength: 500,
  localeKeysPerLanguage: 200,
  /** Rule, tier set, gift tier and campaign ids: `[A-Za-z0-9_-]{1,64}` (see sanitizeEntityId). */
  idLength: 64,
  markets: 50,
  /** Currencies per MoneyByCurrency map (one per market at most). */
  currenciesPerAmount: 50,
  /** Items in any list of references (product/variant/collection ids, segments, rule ids, gift choices). */
  listItems: 250,
  /** Length of one reference (a Shopify GID, a market handle, a segment id). */
  referenceLength: 100,
  /** Margin overrides per collection. */
  marginOverrides: 100,
  /**
   * Backstop on the WHOLE stored config (UTF-8 bytes of the sanitized JSON),
   * enforced by the app's saveConfig: 256 KiB. The per-field caps above bound
   * each list, but multiplied out (50 campaigns × 200 overrides × lists, three
   * languages × 200 texts) they still allow MBs; nothing a merchant builds by
   * hand comes near 256 KiB, and it keeps every ShopConfig/ConfigVersion row
   * small (audit P2-1, re-review of fix round 1).
   */
  storedConfigBytes: 256 * 1024,
  /**
   * The issues list itself must stay bounded (audit P3-10 followup): an input with
   * tens of thousands of invalid entries (e.g. 30 000 markets each missing a
   * handle) would otherwise push one ConfigIssue per bad entry, growing the
   * response without limit even though sanitization itself is already capped.
   * sanitizeConfig keeps only the first `maxIssues` and adds one summary issue for
   * the rest.
   */
  maxIssues: 100,
});

// --- Defaults ------------------------------------------------------------------------

/**
 * The shared defaults. Deep-frozen (audit P1-1, SEC-2): it is one object per
 * process, so a caller that mutated it would leak its change into every other
 * shop that falls back to the default. Never hand this object out as a shop's
 * config — use createDefaultConfig() / readStoredConfig() for a fresh copy.
 */
export const DEFAULT_CONFIG: ReadonlyDeep<WonDiscountsConfig> = deepFreeze<WonDiscountsConfig>({
  schemaVersion: SCHEMA_VERSION,
  markets: [],
  engine: {
    combination: {
      outletWithAnything: false,
      productWithProduct: "best",
      productWithOrder: true,
      productWithShipping: true,
      orderWithShipping: true,
    },
  },
  modules: {
    codes: { rules: [] },
    tiers: { sets: [] },
    rewards: { gifts: [], countOtherDiscounts: false, giftDeclinable: true },
    outlet: { display: "strike_badge", reopenOnReturnAfterEnd: "ask" },
    margin: { global: { maxDiscountPercent: 50 }, perCollection: [] },
  },
  campaigns: [],
  storefront: { appearancePreset: "default", cardPricesEnabled: false },
  locales: { cs: {}, sk: {}, en: {} },
  onboarding: { goals: [], step: 1 },
});

function deepFreeze<T>(value: T): ReadonlyDeep<T> {
  if (typeof value === "object" && value !== null && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value as ReadonlyDeep<T>;
}

/** A fresh, mutable copy of the defaults: what a shop with no stored config gets. */
export function createDefaultConfig(): WonDiscountsConfig {
  // DEFAULT_CONFIG is plain JSON data by construction, so a JSON round trip is an
  // exact deep copy (and works in runtimes without structuredClone).
  return JSON.parse(JSON.stringify(DEFAULT_CONFIG)) as WonDiscountsConfig;
}

const SHOP_LOCAL_DATETIME_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})$/;

/**
 * True for a real calendar date-time in the exact `YYYY-MM-DDTHH:MM:SS` shape of
 * Shopify's `DateTimeWithoutTimezone` (shop-local time, no offset). Campaign
 * windows become the function's `$campaignStart/$campaignEnd` variables, and a
 * value the platform cannot parse fails the whole run (C4), so the shape is
 * checked strictly here rather than trusted.
 */
export function isShopLocalDateTime(v: unknown): v is string {
  if (typeof v !== "string") return false;
  const m = SHOP_LOCAL_DATETIME_RE.exec(v);
  if (!m) return false;
  const [year, month, day, hour, minute, second] = m.slice(1).map(Number);
  if (month < 1 || month > 12 || day < 1 || hour > 23 || minute > 59 || second > 59) return false;
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return day <= daysInMonth;
}

const ISO_DATETIME_RE =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,9})?)?(?:Z|[+-](\d{2}):(\d{2}))$/;

/**
 * True for an ISO 8601 date-time WITH a zone designator (`Z` or `±HH:MM`), e.g.
 * `2026-11-27T00:00:00Z` or `2026-11-27T00:00:00+01:00` — the shape of Shopify's
 * `DateTime` scalar, which is what a rule's `schedule.startsAt/endsAt` becomes on
 * its discount node. A zone-less value would be read in an unknown zone, so it is
 * refused (campaign windows are the shop-local exception, see isShopLocalDateTime).
 */
export function isIsoDateTime(v: unknown): v is string {
  if (typeof v !== "string") return false;
  const m = ISO_DATETIME_RE.exec(v);
  if (!m) return false;
  const [year, month, day, hour, minute] = m.slice(1, 6).map(Number);
  const second = m[6] === undefined ? 0 : Number(m[6]);
  if (month < 1 || month > 12 || day < 1 || hour > 23 || minute > 59 || second > 59) return false;
  if (m[7] !== undefined && (Number(m[7]) > 23 || Number(m[8]) > 59)) return false;
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return day <= daysInMonth && Number.isFinite(Date.parse(v));
}

const ENTITY_ID_RE = /^[A-Za-z0-9_-]+$/;

/** True for an id the config accepts as-is: 1–64 characters of `[A-Za-z0-9_-]`. */
export function isValidEntityId(v: unknown): v is string {
  return typeof v === "string" && v.length > 0 && v.length <= CONFIG_LIMITS.idLength && ENTITY_ID_RE.test(v);
}

/** Native Shopify discount node GID (the backup link of a migrated rule). */
const NATIVE_DISCOUNT_GID_RE = /^gid:\/\/shopify\/(?:DiscountNode|DiscountCodeNode|DiscountAutomaticNode)\/\d{1,20}$/;

// --- Sanitize helpers ------------------------------------------------------------------

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function listPreview(values: string[], max = 5): string {
  const shown = values.slice(0, max).join(", ");
  return values.length > max ? `${shown} and ${values.length - max} more` : shown;
}

function pushIssue(issues: ConfigIssue[], path: string, code: string, message: string): void {
  issues.push({ path, code, message });
}

/** Only reports an issue when a value was actually supplied and was wrong — a field
 * left out entirely is not an error, it just takes the default silently. */
function sanitizeBoolWithIssue(
  v: unknown,
  fallback: boolean,
  path: string,
  issues: ConfigIssue[],
): boolean {
  if (typeof v === "boolean") return v;
  if (v !== undefined) {
    pushIssue(
      issues,
      path,
      "invalid_boolean",
      `Expected a boolean, got ${preview(v)}; using default ${fallback}.`,
    );
  }
  return fallback;
}

function sanitizeBool(v: unknown, fallback: boolean): boolean {
  return typeof v === "boolean" ? v : fallback;
}

function sanitizeEnum<T extends string>(
  v: unknown,
  allowed: readonly T[],
  fallback: T,
  path: string,
  issues: ConfigIssue[],
): T {
  if (v === undefined) return fallback;
  if (typeof v === "string" && (allowed as readonly string[]).includes(v)) return v as T;
  pushIssue(
    issues,
    path,
    "invalid_enum",
    `Expected one of ${allowed.join(", ")}; got ${preview(v)}. Using default "${fallback}".`,
  );
  return fallback;
}

/**
 * Clamps to 0-100. Only a finite `number` is accepted (same policy as
 * sanitizeMoneyByCurrency, audit P3-10): a string like "50", a boolean or null is
 * never coerced, it is reported as invalid and the default is used. Reports an
 * issue only for a supplied-but-invalid/out-of-range value.
 */
function sanitizePercent(
  v: unknown,
  fallback: number,
  path: string,
  issues: ConfigIssue[],
): number {
  if (v === undefined) return fallback;
  if (typeof v !== "number" || !Number.isFinite(v)) {
    pushIssue(
      issues,
      path,
      "invalid_percent",
      `Expected a number between 0 and 100, got ${preview(v)}. Using default ${fallback}.`,
    );
    return fallback;
  }
  const n = v;
  if (n < 0 || n > 100) {
    const clamped = Math.min(100, Math.max(0, n));
    pushIssue(
      issues,
      path,
      "clamped_percent",
      `Percent ${n} is out of range 0-100; clamped to ${clamped}.`,
    );
    return clamped;
  }
  return n;
}

function sanitizeString(v: unknown, fallback: string, maxLen = 200): string {
  return typeof v === "string" ? v.slice(0, maxLen) : fallback;
}

/** A user-supplied value shortened for an issue message (issues must stay small too). */
function preview(v: unknown, max = 80): string {
  let text: string;
  try {
    text = typeof v === "string" ? JSON.stringify(v.slice(0, max + 1)) : (JSON.stringify(v) ?? String(v));
  } catch {
    text = typeof v; // never throw from an issue message (cyclic/BigInt input)
  }
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

/**
 * A list of references (Shopify GIDs, segment ids, market handles, rule ids):
 * strings only, each at most CONFIG_LIMITS.referenceLength characters, at most
 * CONFIG_LIMITS.listItems of them. Anything cut is reported (audit P2-1: an
 * uncapped list here let a 3 MB config through a ~500 B function payload).
 */
function sanitizeStringArray(v: unknown, issues: ConfigIssue[], path: string): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  let tooLong = 0;
  let overLimit = 0;
  for (const item of v) {
    if (typeof item !== "string") continue;
    if (item.length > CONFIG_LIMITS.referenceLength) {
      tooLong++;
      continue;
    }
    if (out.length >= CONFIG_LIMITS.listItems) {
      overLimit++;
      continue;
    }
    out.push(item);
  }
  if (tooLong > 0) {
    pushIssue(
      issues,
      path,
      "reference_too_long",
      `${tooLong} value(s) longer than ${CONFIG_LIMITS.referenceLength} characters were dropped.`,
    );
  }
  if (overLimit > 0) {
    pushIssue(
      issues,
      path,
      "too_many_items",
      `A list can have at most ${CONFIG_LIMITS.listItems} items; ${overLimit} more were dropped.`,
    );
  }
  return out;
}

/** A single optional reference (e.g. a variant GID): dropped with an issue when too long. */
function sanitizeReference(v: unknown, issues: ConfigIssue[], path: string): string | undefined {
  if (typeof v !== "string") return undefined;
  if (v.length <= CONFIG_LIMITS.referenceLength) return v;
  pushIssue(
    issues,
    path,
    "reference_too_long",
    `Value longer than ${CONFIG_LIMITS.referenceLength} characters was dropped.`,
  );
  return undefined;
}

/** MoneyByCurrency with at most CONFIG_LIMITS.currenciesPerAmount currencies (first ones win). */
function sanitizeMoney(v: unknown, issues: ConfigIssue[], path: string): MoneyByCurrency {
  const money = sanitizeMoneyByCurrency(v);
  const keys = Object.keys(money);
  if (keys.length <= CONFIG_LIMITS.currenciesPerAmount) return money;
  pushIssue(
    issues,
    path,
    "too_many_currencies",
    `An amount can have at most ${CONFIG_LIMITS.currenciesPerAmount} currencies; ${keys.length - CONFIG_LIMITS.currenciesPerAmount} more were dropped.`,
  );
  return Object.fromEntries(keys.slice(0, CONFIG_LIMITS.currenciesPerAmount).map((k) => [k, money[k]]));
}

/** FNV-1a (32 bit): a tiny, stable string hash — the same input always gives the same id. */
function fnv1a(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(36);
}

type EntityKind = "rule" | "tier" | "gift" | "campaign";

/**
 * Ids of rules, tier sets, gift tiers and campaigns key the Shopify discount
 * nodes (MVP 1: one node per code rule), metafield payloads and admin URLs, so
 * they must be short and URL/GID-safe: `[A-Za-z0-9_-]{1,64}`.
 *
 * Policy for a non-empty id that breaks that rule: it is REGENERATED
 * deterministically as `<kind>-<fnv1a(original)>` (e.g. `rule-1x9k2ab`) with an
 * `invalid_id` issue, and every reference to the original id (combinesWith,
 * campaign override targets) is remapped to the new one. Regenerating instead
 * of dropping keeps the merchant's rule; determinism keeps readStoredConfig
 * stable (the same stored row always yields the same id) and the sanitizer
 * idempotent (the new id is valid). A missing/empty id carries no identity to
 * derive from, so that entry is still dropped (`missing_id`), as before.
 */
function sanitizeEntityId(
  v: unknown,
  kind: EntityKind,
  issues: ConfigIssue[],
  path: string,
): { id: string; original?: string } | null {
  if (typeof v !== "string" || v === "") return null;
  if (isValidEntityId(v)) return { id: v };
  const id = `${kind}-${fnv1a(v)}`;
  pushIssue(
    issues,
    `${path}.id`,
    "invalid_id",
    `Id ${preview(v, 40)} is not 1-${CONFIG_LIMITS.idLength} characters of letters, digits, "-" or "_"; it was replaced by "${id}".`,
  );
  return { id, original: v };
}

// --- Markets ---------------------------------------------------------------------------

function sanitizeMarket(v: unknown, issues: ConfigIssue[], index: number): MarketSetting | null {
  if (!isRecord(v)) return null;
  const handle = typeof v.handle === "string" ? v.handle.slice(0, 100) : "";
  if (!handle) {
    pushIssue(issues, `markets[${index}].handle`, "missing_handle", "Market without a handle was dropped.");
    return null;
  }
  const currency = typeof v.currency === "string" ? v.currency.toUpperCase() : "";
  if (!/^[A-Z]{3}$/.test(currency)) {
    pushIssue(
      issues,
      `markets[${index}].currency`,
      "invalid_currency",
      `Invalid market currency ${preview(v.currency)}; market dropped.`,
    );
    return null;
  }
  return { handle, currency, enabled: sanitizeBool(v.enabled, true) };
}

function sanitizeMarkets(v: unknown, issues: ConfigIssue[]): MarketSetting[] {
  if (!Array.isArray(v)) return [];
  const out: MarketSetting[] = [];
  let overLimit = 0;
  v.forEach((item, i) => {
    if (out.length >= CONFIG_LIMITS.markets) {
      overLimit++;
      return;
    }
    const m = sanitizeMarket(item, issues, i);
    if (m) out.push(m);
  });
  if (overLimit > 0) {
    pushIssue(
      issues,
      "markets",
      "too_many_markets",
      `Only the first ${CONFIG_LIMITS.markets} markets are kept; ${overLimit} more were dropped.`,
    );
  }
  return out;
}

// --- Engine ------------------------------------------------------------------------------

function sanitizeEngine(v: unknown, issues: ConfigIssue[]): EngineSettings {
  const def = DEFAULT_CONFIG.engine.combination;
  const c = isRecord(v) && isRecord(v.combination) ? v.combination : {};
  return {
    combination: {
      outletWithAnything: sanitizeBoolWithIssue(
        c.outletWithAnything,
        def.outletWithAnything,
        "engine.combination.outletWithAnything",
        issues,
      ),
      productWithProduct: sanitizeEnum(
        c.productWithProduct,
        PRODUCT_WITH_PRODUCT_MODES,
        def.productWithProduct,
        "engine.combination.productWithProduct",
        issues,
      ),
      productWithOrder: sanitizeBoolWithIssue(
        c.productWithOrder,
        def.productWithOrder,
        "engine.combination.productWithOrder",
        issues,
      ),
      productWithShipping: sanitizeBoolWithIssue(
        c.productWithShipping,
        def.productWithShipping,
        "engine.combination.productWithShipping",
        issues,
      ),
      orderWithShipping: sanitizeBoolWithIssue(
        c.orderWithShipping,
        def.orderWithShipping,
        "engine.combination.orderWithShipping",
        issues,
      ),
    },
  };
}

// --- Codes module (discount rules) --------------------------------------------------------

function sanitizeDiscountRuleValue(
  v: unknown,
  issues: ConfigIssue[],
  path: string,
): DiscountRuleValue {
  if (isRecord(v)) {
    if (v.kind === "percentage") {
      return { kind: "percentage", percent: sanitizePercent(v.percent, 0, `${path}.percent`, issues) };
    }
    if (v.kind === "fixed") {
      return { kind: "fixed", amount: sanitizeMoney(v.amount, issues, `${path}.amount`) };
    }
    if (v.kind === "freeShipping") {
      return { kind: "freeShipping" };
    }
  }
  pushIssue(issues, path, "invalid_value", "Invalid discount value; defaulted to 0% off.");
  return { kind: "percentage", percent: 0 };
}

function sanitizeDiscountTarget(
  v: unknown,
  issues: ConfigIssue[],
  path: string,
): DiscountTarget {
  if (isRecord(v)) {
    if (v.kind === "order") return { kind: "order" };
    if (v.kind === "shipping") return { kind: "shipping" };
    if (v.kind === "products") {
      return {
        kind: "products",
        productIds: sanitizeStringArray(v.productIds, issues, `${path}.productIds`),
        variantIds: sanitizeStringArray(v.variantIds, issues, `${path}.variantIds`),
      };
    }
    if (v.kind === "collections") {
      return { kind: "collections", ids: sanitizeStringArray(v.ids, issues, `${path}.ids`) };
    }
  }
  pushIssue(issues, path, "invalid_target", "Invalid discount target; defaulted to order.");
  return { kind: "order" };
}

/**
 * Discount codes are case-insensitive in Shopify, so they are stored trimmed and
 * upper-cased, once each, and never longer than Shopify accepts (audit P3-10).
 */
function sanitizeCodes(v: unknown[], issues: ConfigIssue[], path: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  let duplicates = 0;
  let tooLong = 0;
  let overLimit = 0;
  for (const raw of v) {
    if (typeof raw !== "string") continue;
    const code = raw.trim().toUpperCase();
    if (!code) continue;
    if (code.length > CONFIG_LIMITS.codeLength) {
      tooLong++;
      continue;
    }
    if (seen.has(code)) {
      duplicates++;
      continue;
    }
    if (out.length >= CONFIG_LIMITS.codesPerRule) {
      overLimit++;
      continue;
    }
    seen.add(code);
    out.push(code);
  }
  if (tooLong > 0) {
    pushIssue(
      issues,
      path,
      "code_too_long",
      `${tooLong} code(s) longer than ${CONFIG_LIMITS.codeLength} characters were dropped.`,
    );
  }
  if (duplicates > 0) {
    pushIssue(
      issues,
      path,
      "duplicate_code",
      `${duplicates} duplicate code(s) were merged (codes are not case-sensitive).`,
    );
  }
  if (overLimit > 0) {
    pushIssue(
      issues,
      path,
      "too_many_codes",
      `A rule can have at most ${CONFIG_LIMITS.codesPerRule} codes; ${overLimit} more were dropped.`,
    );
  }
  return out;
}

/**
 * A rule's schedule becomes startsAt/endsAt of its Shopify discount node, so both
 * must be ISO 8601 date-times with a zone and start < end. A schedule that is
 * supplied but wrong is removed AND the rule is disabled (with an issue): running
 * a time-limited discount forever is worse than not running it until fixed.
 */
function sanitizeSchedule(
  v: unknown,
  issues: ConfigIssue[],
  path: string,
): { ok: true; schedule?: DiscountRule["schedule"] } | { ok: false } {
  if (v === undefined || v === null) return { ok: true };
  const fail = (why: string) => {
    pushIssue(
      issues,
      path,
      "invalid_schedule",
      `${why} Use ISO 8601 date-times with a time zone (e.g. 2026-11-27T00:00:00+01:00) and a start before the end; the schedule was removed and the rule disabled.`,
    );
    return { ok: false as const };
  };
  if (!isRecord(v)) return fail("The schedule is not an object.");
  const schedule: NonNullable<DiscountRule["schedule"]> = {};
  for (const key of ["startsAt", "endsAt"] as const) {
    const value = v[key];
    if (value === undefined || value === null) continue;
    if (!isIsoDateTime(value)) return fail(`${key} ${preview(value, 40)} is not a valid date-time.`);
    schedule[key] = value;
  }
  if (schedule.startsAt && schedule.endsAt && Date.parse(schedule.startsAt) >= Date.parse(schedule.endsAt)) {
    return fail("The schedule ends before (or when) it starts.");
  }
  // An empty schedule means "always"; it is simply omitted.
  return schedule.startsAt || schedule.endsAt ? { ok: true, schedule } : { ok: true };
}

function sanitizeDiscountRule(v: unknown, issues: ConfigIssue[], path: string): DiscountRule | null {
  if (!isRecord(v)) return null;
  const entity = sanitizeEntityId(v.id, "rule", issues, path);
  if (!entity) {
    pushIssue(issues, path, "missing_id", "Discount rule without an id was dropped.");
    return null;
  }
  const { id } = entity;

  const rule: DiscountRule = {
    id,
    enabled: sanitizeBoolWithIssue(v.enabled, true, `${path}.enabled`, issues),
    name: sanitizeString(v.name, ""),
    method: sanitizeEnum(v.method, DISCOUNT_METHODS, "automatic", `${path}.method`, issues),
    value: sanitizeDiscountRuleValue(v.value, issues, `${path}.value`),
    target: sanitizeDiscountTarget(v.target, issues, `${path}.target`),
  };

  if (Array.isArray(v.codes)) rule.codes = sanitizeCodes(v.codes, issues, `${path}.codes`);

  if (isRecord(v.minimum)) {
    const minimum: DiscountRule["minimum"] = {};
    if (v.minimum.subtotal !== undefined) {
      minimum.subtotal = sanitizeMoney(v.minimum.subtotal, issues, `${path}.minimum.subtotal`);
    }
    if (typeof v.minimum.quantity === "number" && Number.isFinite(v.minimum.quantity)) {
      minimum.quantity = Math.max(0, Math.floor(v.minimum.quantity));
    }
    rule.minimum = minimum;
  }

  const schedule = sanitizeSchedule(v.schedule, issues, `${path}.schedule`);
  if (!schedule.ok) rule.enabled = false;
  else if (schedule.schedule) rule.schedule = schedule.schedule;

  if (isRecord(v.limits)) {
    const limits: DiscountRule["limits"] = {};
    if (typeof v.limits.usageLimit === "number" && Number.isFinite(v.limits.usageLimit)) {
      limits.usageLimit = Math.max(0, Math.floor(v.limits.usageLimit));
    }
    if (typeof v.limits.oncePerCustomer === "boolean") limits.oncePerCustomer = v.limits.oncePerCustomer;
    rule.limits = limits;
  }

  if (isRecord(v.targeting)) {
    const targeting: DiscountRule["targeting"] = {};
    if (Array.isArray(v.targeting.segments)) {
      targeting.segments = sanitizeStringArray(v.targeting.segments, issues, `${path}.targeting.segments`);
    }
    if (Array.isArray(v.targeting.markets)) {
      targeting.markets = sanitizeStringArray(v.targeting.markets, issues, `${path}.targeting.markets`);
    }
    rule.targeting = targeting;
  }

  // Orphaned rule ids are pruned later (pruneCombinesWith), once every rule id is known.
  if (isRecord(v.combinesWith) && Array.isArray(v.combinesWith.ruleIds)) {
    rule.combinesWith = {
      ruleIds: sanitizeStringArray(v.combinesWith.ruleIds, issues, `${path}.combinesWith.ruleIds`),
    };
  }

  if (isRecord(v.origin)) {
    if (typeof v.origin.nativeId === "string" && NATIVE_DISCOUNT_GID_RE.test(v.origin.nativeId)) {
      rule.origin = { nativeId: v.origin.nativeId };
    } else {
      pushIssue(
        issues,
        `${path}.origin.nativeId`,
        "invalid_origin",
        `Native discount link ${preview(v.origin.nativeId, 60)} is not a Shopify discount node id (gid://shopify/DiscountCodeNode/…); the link was removed.`,
      );
    }
  }

  return rule;
}

/**
 * `combinesWith.ruleIds` may only name rules that exist (audit P2-2): ids of
 * rules whose id was regenerated are remapped, unknown ids are removed with an
 * issue, duplicates are merged.
 */
function pruneCombinesWith(
  ruleIds: string[],
  known: ReadonlySet<string>,
  aliases: ReadonlyMap<string, string>,
  issues: ConfigIssue[],
  path: string,
): string[] {
  const out: string[] = [];
  const orphans: string[] = [];
  for (const raw of ruleIds) {
    const id = known.has(raw) ? raw : aliases.get(raw);
    if (id === undefined) {
      orphans.push(raw);
      continue;
    }
    if (!out.includes(id)) out.push(id);
  }
  if (orphans.length > 0) {
    pushIssue(
      issues,
      path,
      "orphan_combines_with",
      `Combines-with points to rule(s) that do not exist (${listPreview(orphans.map((o) => preview(o, 40)))}); they were removed.`,
    );
  }
  return out;
}

/**
 * Rules list: capped, one rule per id (the first wins, so the node-per-code-rule
 * mapping in MVP 1 can key on `id`), and every code owned by exactly one rule —
 * Shopify refuses the same code on two discount nodes.
 */
/** Original (invalid) id → regenerated id, per entity kind (see sanitizeEntityId). */
type IdAliases = Map<string, string>;

function rememberAlias(aliases: IdAliases, raw: unknown, id: string): void {
  if (typeof raw === "string" && raw !== id && !aliases.has(raw)) aliases.set(raw, id);
}

function sanitizeRules(v: unknown, issues: ConfigIssue[]): { rules: DiscountRule[]; aliases: IdAliases } {
  const aliases: IdAliases = new Map();
  if (!Array.isArray(v)) return { rules: [], aliases };
  const out: DiscountRule[] = [];
  const paths: string[] = [];
  const ids = new Set<string>();
  const usedCodes = new Set<string>();
  let overLimit = 0;
  v.forEach((item, i) => {
    if (out.length >= CONFIG_LIMITS.rules) {
      overLimit++;
      return;
    }
    const path = `modules.codes.rules[${i}]`;
    const rule = sanitizeDiscountRule(item, issues, path);
    if (!rule) return;
    if (ids.has(rule.id)) {
      pushIssue(
        issues,
        path,
        "duplicate_rule_id",
        `Another rule already uses the id "${rule.id}"; this duplicate was dropped.`,
      );
      return;
    }
    ids.add(rule.id);
    if (isRecord(item)) rememberAlias(aliases, item.id, rule.id);
    if (rule.codes) {
      const taken = rule.codes.filter((code) => usedCodes.has(code));
      if (taken.length > 0) {
        rule.codes = rule.codes.filter((code) => !usedCodes.has(code));
        pushIssue(
          issues,
          `${path}.codes`,
          "duplicate_code",
          `Code(s) ${listPreview(taken)} already belong to an earlier rule and were removed from this one.`,
        );
      }
      for (const code of rule.codes) usedCodes.add(code);
    }
    out.push(rule);
    paths.push(path);
  });
  if (overLimit > 0) {
    pushIssue(
      issues,
      "modules.codes.rules",
      "too_many_rules",
      `Only the first ${CONFIG_LIMITS.rules} discount rules are kept; ${overLimit} more were dropped.`,
    );
  }
  out.forEach((rule, i) => {
    if (rule.combinesWith) {
      rule.combinesWith.ruleIds = pruneCombinesWith(
        rule.combinesWith.ruleIds,
        ids,
        aliases,
        issues,
        `${paths[i]}.combinesWith.ruleIds`,
      );
    }
  });
  return { rules: out, aliases };
}

// --- Tiers module ----------------------------------------------------------------------

function sanitizeTierBreak(v: unknown, issues: ConfigIssue[], path: string): TierBreak | null {
  if (!isRecord(v)) return null;
  if (typeof v.minQty !== "number" || !Number.isFinite(v.minQty)) return null;
  const out: TierBreak = { minQty: Math.max(1, Math.floor(v.minQty)) };
  if (typeof v.percent === "number" && Number.isFinite(v.percent)) {
    out.percent = Math.min(100, Math.max(0, v.percent));
  }
  if (v.amountOff !== undefined) out.amountOff = sanitizeMoney(v.amountOff, issues, `${path}.amountOff`);
  return out;
}

function sanitizeTierSetScope(v: unknown, issues: ConfigIssue[], path: string): TierSetScope {
  if (v === "global") return "global";
  if (isRecord(v)) {
    const out: { productIds?: string[]; collectionIds?: string[] } = {};
    if (Array.isArray(v.productIds)) out.productIds = sanitizeStringArray(v.productIds, issues, `${path}.productIds`);
    if (Array.isArray(v.collectionIds)) {
      out.collectionIds = sanitizeStringArray(v.collectionIds, issues, `${path}.collectionIds`);
    }
    return out;
  }
  return "global";
}

function sanitizeTierSet(v: unknown, issues: ConfigIssue[], path: string): TierSet | null {
  if (!isRecord(v)) return null;
  const entity = sanitizeEntityId(v.id, "tier", issues, path);
  if (!entity) {
    pushIssue(issues, path, "missing_id", "Tier set without an id was dropped.");
    return null;
  }
  const { id } = entity;
  let breaks = Array.isArray(v.breaks)
    ? v.breaks
        .map((b, j) => sanitizeTierBreak(b, issues, `${path}.breaks[${j}]`))
        .filter((b): b is TierBreak => b !== null)
    : [];
  if (breaks.length > CONFIG_LIMITS.breaksPerTierSet) {
    pushIssue(
      issues,
      `${path}.breaks`,
      "too_many_tier_breaks",
      `A tier set can have at most ${CONFIG_LIMITS.breaksPerTierSet} quantity breaks; ${breaks.length - CONFIG_LIMITS.breaksPerTierSet} more were dropped.`,
    );
    breaks = breaks.slice(0, CONFIG_LIMITS.breaksPerTierSet);
  }
  return {
    id,
    scope: sanitizeTierSetScope(v.scope, issues, `${path}.scope`),
    countAcross: sanitizeEnum(v.countAcross, TIER_COUNT_ACROSS_MODES, "line", `${path}.countAcross`, issues),
    breaks,
  };
}

function sanitizeTierSets(v: unknown, issues: ConfigIssue[]): { sets: TierSet[]; aliases: IdAliases } {
  const aliases: IdAliases = new Map();
  if (!Array.isArray(v)) return { sets: [], aliases };
  const out: TierSet[] = [];
  let overLimit = 0;
  v.forEach((item, i) => {
    if (out.length >= CONFIG_LIMITS.tierSets) {
      overLimit++;
      return;
    }
    const set = sanitizeTierSet(item, issues, `modules.tiers.sets[${i}]`);
    if (!set) return;
    if (isRecord(item)) rememberAlias(aliases, item.id, set.id);
    out.push(set);
  });
  if (overLimit > 0) {
    pushIssue(
      issues,
      "modules.tiers.sets",
      "too_many_tier_sets",
      `Only the first ${CONFIG_LIMITS.tierSets} tier sets are kept; ${overLimit} more were dropped.`,
    );
  }
  return { sets: out, aliases };
}

// --- Rewards module ----------------------------------------------------------------------

function sanitizeGiftTier(v: unknown, issues: ConfigIssue[], path: string): GiftTier | null {
  if (!isRecord(v)) return null;
  const entity = sanitizeEntityId(v.id, "gift", issues, path);
  if (!entity) return null;
  const out: GiftTier = {
    id: entity.id,
    threshold: sanitizeMoney(v.threshold, issues, `${path}.threshold`),
    choices: sanitizeStringArray(v.choices, issues, `${path}.choices`),
  };
  const fallback = sanitizeReference(v.fallbackVariantId, issues, `${path}.fallbackVariantId`);
  if (fallback !== undefined) out.fallbackVariantId = fallback;
  return out;
}

function sanitizeRewards(v: unknown, issues: ConfigIssue[]): { rewards: RewardsModule; aliases: IdAliases } {
  const def = DEFAULT_CONFIG.modules.rewards;
  const rec = isRecord(v) ? v : {};
  const aliases: IdAliases = new Map();
  let gifts: GiftTier[] = [];
  if (Array.isArray(rec.gifts)) {
    rec.gifts.forEach((item, i) => {
      const gift = sanitizeGiftTier(item, issues, `modules.rewards.gifts[${i}]`);
      if (!gift) return;
      if (isRecord(item)) rememberAlias(aliases, item.id, gift.id);
      gifts.push(gift);
    });
  }
  if (gifts.length > CONFIG_LIMITS.giftTiers) {
    pushIssue(
      issues,
      "modules.rewards.gifts",
      "too_many_gift_tiers",
      `Only the first ${CONFIG_LIMITS.giftTiers} gift tiers are kept; ${gifts.length - CONFIG_LIMITS.giftTiers} more were dropped.`,
    );
    gifts = gifts.slice(0, CONFIG_LIMITS.giftTiers);
  }
  const out: RewardsModule = {
    gifts,
    countOtherDiscounts: sanitizeBoolWithIssue(
      rec.countOtherDiscounts,
      def.countOtherDiscounts,
      "modules.rewards.countOtherDiscounts",
      issues,
    ),
    giftDeclinable: true,
  };
  if (isRecord(rec.freeShipping)) {
    out.freeShipping = {
      threshold: sanitizeMoney(rec.freeShipping.threshold, issues, "modules.rewards.freeShipping.threshold"),
    };
  }
  return { rewards: out, aliases };
}

// --- Outlet module -----------------------------------------------------------------------

function sanitizeOutlet(v: unknown, issues: ConfigIssue[]): OutletModule {
  const def = DEFAULT_CONFIG.modules.outlet;
  const rec = isRecord(v) ? v : {};
  return {
    display: sanitizeEnum(rec.display, OUTLET_DISPLAY_MODES, def.display, "modules.outlet.display", issues),
    reopenOnReturnAfterEnd: sanitizeEnum(
      rec.reopenOnReturnAfterEnd,
      REOPEN_ON_RETURN_MODES,
      def.reopenOnReturnAfterEnd,
      "modules.outlet.reopenOnReturnAfterEnd",
      issues,
    ),
  };
}

// --- Margin module -----------------------------------------------------------------------

function sanitizeMarginOverride(v: unknown, issues: ConfigIssue[], path: string): MarginCollectionOverride | null {
  if (!isRecord(v)) return null;
  const collectionId = sanitizeReference(v.collectionId, issues, `${path}.collectionId`) ?? "";
  if (!collectionId) return null;
  const out: MarginCollectionOverride = { collectionId };
  if (typeof v.minMarginPercent === "number" && Number.isFinite(v.minMarginPercent)) {
    out.minMarginPercent = Math.min(100, Math.max(0, v.minMarginPercent));
  }
  if (typeof v.maxDiscountPercent === "number" && Number.isFinite(v.maxDiscountPercent)) {
    out.maxDiscountPercent = Math.min(100, Math.max(0, v.maxDiscountPercent));
  }
  return out;
}

function sanitizeMargin(v: unknown, issues: ConfigIssue[]): MarginModule {
  const def = DEFAULT_CONFIG.modules.margin;
  const rec = isRecord(v) ? v : {};
  const g = isRecord(rec.global) ? rec.global : {};
  const global: MarginModule["global"] = {
    maxDiscountPercent: sanitizePercent(
      g.maxDiscountPercent,
      def.global.maxDiscountPercent,
      "modules.margin.global.maxDiscountPercent",
      issues,
    ),
  };
  if (g.minMarginPercent !== undefined) {
    global.minMarginPercent = sanitizePercent(
      g.minMarginPercent,
      0,
      "modules.margin.global.minMarginPercent",
      issues,
    );
  }
  let perCollection = Array.isArray(rec.perCollection)
    ? rec.perCollection
        .map((item, i) => sanitizeMarginOverride(item, issues, `modules.margin.perCollection[${i}]`))
        .filter((x): x is MarginCollectionOverride => x !== null)
    : [];
  if (perCollection.length > CONFIG_LIMITS.marginOverrides) {
    pushIssue(
      issues,
      "modules.margin.perCollection",
      "too_many_margin_overrides",
      `Only the first ${CONFIG_LIMITS.marginOverrides} collection margin settings are kept; ${perCollection.length - CONFIG_LIMITS.marginOverrides} more were dropped.`,
    );
    perCollection = perCollection.slice(0, CONFIG_LIMITS.marginOverrides);
  }
  return { global, perCollection };
}

// --- Campaigns ---------------------------------------------------------------------------

// A campaign override targets, by id, a discount rule, a tier set or a gift tier
// (spec §4.6: overrides across Slevy a kódy / Množstevní / Odměny). Its patch may
// only touch the fields listed here, and each patched value goes through the very
// sanitizer that guards the target itself — a campaign can never smuggle in a
// value (e.g. 1000 %) the module would have refused (audit P2-2, DATA-2).
// `method`/`codes`/`limits`/`origin` are excluded on purpose: they define the
// Shopify discount node, which a time window must not rewrite.
const OVERRIDE_FIELDS = {
  rule: ["enabled", "name", "value", "target", "minimum", "targeting", "combinesWith"],
  tierSet: ["countAcross", "breaks"],
  giftTier: ["threshold", "choices", "fallbackVariantId"],
} as const;

type OverrideTarget =
  | { kind: "rule"; value: DiscountRule }
  | { kind: "tierSet"; value: TierSet }
  | { kind: "giftTier"; value: GiftTier };

const OVERRIDE_TARGET_LABELS: Record<OverrideTarget["kind"], string> = {
  rule: "a discount rule",
  tierSet: "a tier set",
  giftTier: "a gift tier",
};

/**
 * What a campaign override can point at: every rule, tier set and gift tier by
 * its final id AND by the original id it had before sanitizeEntityId replaced
 * it (aliases), so an override written against the old id follows the entity.
 * An invalid original id can never equal a valid final id, so the two key
 * spaces never collide. `ruleIds`/`ruleAliases` prune `combinesWith` in patches.
 */
interface OverrideContext {
  targets: Map<string, OverrideTarget[]>;
  ruleIds: ReadonlySet<string>;
  ruleAliases: ReadonlyMap<string, string>;
}

function collectOverrideTargets(
  rules: DiscountRule[],
  sets: TierSet[],
  gifts: GiftTier[],
  aliases: { rules: IdAliases; sets: IdAliases; gifts: IdAliases },
): OverrideContext {
  const targets = new Map<string, OverrideTarget[]>();
  const add = (id: string, target: OverrideTarget) => {
    const list = targets.get(id);
    if (list) list.push(target);
    else targets.set(id, [target]);
  };
  const byId = <T extends { id: string }>(values: T[]) => new Map(values.map((value) => [value.id, value]));
  const rulesById = byId(rules);
  const setsById = byId(sets);
  const giftsById = byId(gifts);
  for (const value of rules) add(value.id, { kind: "rule", value });
  for (const value of sets) add(value.id, { kind: "tierSet", value });
  for (const value of gifts) add(value.id, { kind: "giftTier", value });
  for (const [raw, id] of aliases.rules) {
    const value = rulesById.get(id);
    if (value) add(raw, { kind: "rule", value });
  }
  for (const [raw, id] of aliases.sets) {
    const value = setsById.get(id);
    if (value) add(raw, { kind: "tierSet", value });
  }
  for (const [raw, id] of aliases.gifts) {
    const value = giftsById.get(id);
    if (value) add(raw, { kind: "giftTier", value });
  }
  return { targets, ruleIds: new Set(rulesById.keys()), ruleAliases: aliases.rules };
}

function sanitizeOverridePatch(
  target: OverrideTarget,
  rawPatch: Record<string, unknown>,
  issues: ConfigIssue[],
  path: string,
  ctx: OverrideContext,
): Record<string, unknown> {
  const allowed: readonly string[] = OVERRIDE_FIELDS[target.kind];
  // Start from the target's current (already sanitized) value so the target's own
  // sanitizer sees a complete object; only the patched keys are read back out.
  const merged: Record<string, unknown> = { ...(target.value as unknown as Record<string, unknown>) };
  const patched: string[] = [];
  for (const key of Object.keys(rawPatch)) {
    if (!allowed.includes(key)) {
      pushIssue(
        issues,
        `${path}.${key}`,
        "override_field_not_allowed",
        `A campaign cannot change "${key}" of ${OVERRIDE_TARGET_LABELS[target.kind]}; the field was ignored.`,
      );
      continue;
    }
    merged[key] = rawPatch[key];
    patched.push(key);
  }
  if (patched.length === 0) return {};

  const sanitized: unknown =
    target.kind === "rule"
      ? sanitizeDiscountRule(merged, issues, path)
      : target.kind === "tierSet"
        ? sanitizeTierSet(merged, issues, path)
        : sanitizeGiftTier(merged, issues, path);
  if (!isRecord(sanitized)) return {};
  if (target.kind === "rule" && patched.includes("combinesWith")) {
    const combinesWith = (sanitized as unknown as DiscountRule).combinesWith;
    if (combinesWith) {
      combinesWith.ruleIds = pruneCombinesWith(
        combinesWith.ruleIds,
        ctx.ruleIds,
        ctx.ruleAliases,
        issues,
        `${path}.combinesWith.ruleIds`,
      );
    }
  }

  const out: Record<string, unknown> = {};
  for (const key of patched) {
    if (sanitized[key] !== undefined) out[key] = sanitized[key];
  }
  return out;
}

function sanitizeOverrides(
  v: unknown,
  issues: ConfigIssue[],
  path: string,
  ctx: OverrideContext,
): RuleOverride[] {
  const { targets } = ctx;
  if (!Array.isArray(v)) return [];
  const out: RuleOverride[] = [];
  let overLimit = 0;
  v.forEach((item, i) => {
    if (out.length >= CONFIG_LIMITS.overridesPerCampaign) {
      overLimit++;
      return;
    }
    if (!isRecord(item)) return;
    const itemPath = `${path}[${i}]`;
    const ruleId = typeof item.ruleId === "string" ? item.ruleId : "";
    const found = ruleId ? (targets.get(ruleId) ?? []) : [];
    if (found.length === 0) {
      pushIssue(
        issues,
        itemPath,
        "orphan_override",
        `Campaign override points to ${preview(ruleId, 60)}, which does not exist; the override was removed.`,
      );
      return;
    }
    if (found.length > 1) {
      pushIssue(
        issues,
        itemPath,
        "ambiguous_override",
        `${preview(ruleId, 60)} matches more than one rule, tier set or gift tier; the override was removed.`,
      );
      return;
    }
    const patch = sanitizeOverridePatch(found[0], isRecord(item.patch) ? item.patch : {}, issues, `${itemPath}.patch`, ctx);
    if (Object.keys(patch).length === 0) {
      pushIssue(issues, itemPath, "empty_override", "Campaign override changes nothing; it was removed.");
      return;
    }
    // Always the target's final id (an override written against an id that
    // sanitizeEntityId regenerated follows its entity).
    out.push({ ruleId: found[0].value.id, patch });
  });
  if (overLimit > 0) {
    pushIssue(
      issues,
      path,
      "too_many_overrides",
      `A campaign can have at most ${CONFIG_LIMITS.overridesPerCampaign} overrides; ${overLimit} more were dropped.`,
    );
  }
  return out;
}

function sanitizeCampaign(
  v: unknown,
  issues: ConfigIssue[],
  path: string,
  ctx: OverrideContext,
): Campaign | null {
  if (!isRecord(v)) return null;
  const entity = sanitizeEntityId(v.id, "campaign", issues, path);
  if (!entity) {
    pushIssue(issues, path, "missing_id", "Campaign without an id was dropped.");
    return null;
  }
  const { id } = entity;
  const name = sanitizeString(v.name, "");
  const window = isRecord(v.window) ? v.window : {};
  const start = isShopLocalDateTime(window.start) ? window.start : "";
  const end = isShopLocalDateTime(window.end) ? window.end : "";
  let killed = sanitizeBool(v.killed, false);
  // Same-shape strings compare chronologically, so `<` is a date comparison here.
  if (!start || !end || start >= end) {
    killed = true;
    pushIssue(
      issues,
      `${path}.window`,
      "invalid_campaign_window",
      `Campaign "${name || id}" needs a start before its end, both as YYYY-MM-DDTHH:MM:SS in shop time; the campaign was disabled.`,
    );
  }
  return {
    id,
    name,
    window: { start, end },
    // Killed campaigns keep their overrides (the merchant may revive them), and
    // those go through exactly the same caps and sanitizers as live ones.
    overrides: sanitizeOverrides(v.overrides, issues, `${path}.overrides`, ctx),
    killed,
  };
}

/**
 * Campaigns must not overlap (A8): the function checks one window at a time (C4),
 * so two live windows would make "which overrides apply" ambiguous. The campaign
 * that starts earlier (array order on a tie) stays; a later overlapping one is
 * disabled with an issue rather than deleted, so the merchant keeps their work.
 */
function disableOverlappingCampaigns(entries: Array<{ campaign: Campaign; path: string }>, issues: ConfigIssue[]) {
  const live = entries
    .filter((e) => !e.campaign.killed)
    .sort((a, b) => (a.campaign.window.start < b.campaign.window.start ? -1 : a.campaign.window.start > b.campaign.window.start ? 1 : 0));
  const kept: Campaign[] = [];
  for (const { campaign, path } of live) {
    const clash = kept.find((k) => campaign.window.start < k.window.end && k.window.start < campaign.window.end);
    if (!clash) {
      kept.push(campaign);
      continue;
    }
    campaign.killed = true;
    pushIssue(
      issues,
      path,
      "overlapping_campaign",
      `Campaign "${campaign.name || campaign.id}" overlaps "${clash.name || clash.id}"; campaigns must not overlap, so the later one was disabled.`,
    );
  }
}

function sanitizeCampaigns(v: unknown, issues: ConfigIssue[], ctx: OverrideContext): Campaign[] {
  if (!Array.isArray(v)) return [];
  const entries: Array<{ campaign: Campaign; path: string }> = [];
  const ids = new Set<string>();
  let overLimit = 0;
  v.forEach((item, i) => {
    if (entries.length >= CONFIG_LIMITS.campaigns) {
      overLimit++;
      return;
    }
    const path = `campaigns[${i}]`;
    const campaign = sanitizeCampaign(item, issues, path, ctx);
    if (!campaign) return;
    if (ids.has(campaign.id)) {
      pushIssue(
        issues,
        path,
        "duplicate_campaign_id",
        `Another campaign already uses the id "${campaign.id}"; this duplicate was dropped.`,
      );
      return;
    }
    ids.add(campaign.id);
    entries.push({ campaign, path });
  });
  if (overLimit > 0) {
    pushIssue(
      issues,
      "campaigns",
      "too_many_campaigns",
      `Only the first ${CONFIG_LIMITS.campaigns} campaigns are kept; ${overLimit} more were dropped.`,
    );
  }
  disableOverlappingCampaigns(entries, issues);
  return entries.map((e) => e.campaign);
}

// --- Storefront / locales / onboarding -----------------------------------------------------

function sanitizeStorefront(v: unknown): StorefrontSettings {
  const def = DEFAULT_CONFIG.storefront;
  const rec = isRecord(v) ? v : {};
  return {
    appearancePreset: sanitizeString(rec.appearancePreset, def.appearancePreset, 60),
    cardPricesEnabled: sanitizeBool(rec.cardPricesEnabled, def.cardPricesEnabled),
  };
}

function sanitizeLocaleTexts(v: unknown, issues: ConfigIssue[], path: string): Record<string, string> {
  if (!isRecord(v)) return {};
  const out = new Map<string, string>();
  let overLimit = 0;
  for (const [k, val] of Object.entries(v)) {
    if (typeof val !== "string") continue;
    const key = k.slice(0, 100);
    if (key === "__proto__") continue;
    if (!out.has(key) && out.size >= CONFIG_LIMITS.localeKeysPerLanguage) {
      overLimit++;
      continue;
    }
    if (val.length > CONFIG_LIMITS.localeStringLength) {
      pushIssue(
        issues,
        `${path}.${key}`,
        "locale_text_too_long",
        `Text is longer than ${CONFIG_LIMITS.localeStringLength} characters; it was shortened.`,
      );
    }
    out.set(key, val.slice(0, CONFIG_LIMITS.localeStringLength));
  }
  if (overLimit > 0) {
    pushIssue(
      issues,
      path,
      "too_many_locale_keys",
      `Only the first ${CONFIG_LIMITS.localeKeysPerLanguage} texts per language are kept; ${overLimit} more were dropped.`,
    );
  }
  return Object.fromEntries(out);
}

function sanitizeLocales(v: unknown, issues: ConfigIssue[]): LocaleDictionary {
  const rec = isRecord(v) ? v : {};
  return {
    cs: sanitizeLocaleTexts(rec.cs, issues, "locales.cs"),
    sk: sanitizeLocaleTexts(rec.sk, issues, "locales.sk"),
    en: sanitizeLocaleTexts(rec.en, issues, "locales.en"),
  };
}

/** Known goals only (ONBOARDING_GOALS), each once, in the merchant's order. */
function sanitizeGoals(v: unknown, issues: ConfigIssue[]): OnboardingGoal[] {
  if (!Array.isArray(v)) return [];
  const out: OnboardingGoal[] = [];
  const unknown: unknown[] = [];
  for (const goal of v) {
    if (typeof goal === "string" && (ONBOARDING_GOALS as readonly string[]).includes(goal)) {
      if (!out.includes(goal as OnboardingGoal)) out.push(goal as OnboardingGoal);
    } else {
      unknown.push(goal);
    }
  }
  if (unknown.length > 0) {
    pushIssue(
      issues,
      "onboarding.goals",
      "unknown_onboarding_goal",
      `${unknown.length} unknown onboarding goal(s) (${listPreview(unknown.map((g) => preview(g, 30)))}) were dropped; known goals: ${ONBOARDING_GOALS.join(", ")}.`,
    );
  }
  return out;
}

function sanitizeOnboarding(v: unknown, issues: ConfigIssue[]): OnboardingState {
  const def = DEFAULT_CONFIG.onboarding;
  const rec = isRecord(v) ? v : {};
  return {
    goals: sanitizeGoals(rec.goals, issues),
    step:
      typeof rec.step === "number" && Number.isFinite(rec.step)
        ? Math.min(5, Math.max(1, Math.floor(rec.step)))
        : def.step,
  };
}

// --- Top-level sanitize / migrate / read -----------------------------------------------

/**
 * The single sanitizer (DATA-2): clamps, enums, defaults, drops unknown keys and
 * orphaned/invalid entries. Returns a complete, valid config plus a list of
 * human-readable issues for the admin to show (§4c). Never throws.
 */
export function sanitizeConfig(input: unknown): { config: WonDiscountsConfig; issues: ConfigIssue[] } {
  const issues: ConfigIssue[] = [];
  const rec = isRecord(input) ? input : {};
  const modules = isRecord(rec.modules) ? rec.modules : {};

  const markets = sanitizeMarkets(rec.markets, issues);
  const engine = sanitizeEngine(rec.engine, issues);

  const codesRaw = isRecord(modules.codes) ? modules.codes : {};
  const { rules, aliases: ruleAliases } = sanitizeRules(codesRaw.rules, issues);

  const tiersRaw = isRecord(modules.tiers) ? modules.tiers : {};
  const { sets, aliases: setAliases } = sanitizeTierSets(tiersRaw.sets, issues);

  const { rewards, aliases: giftAliases } = sanitizeRewards(modules.rewards, issues);

  const config: WonDiscountsConfig = {
    schemaVersion: SCHEMA_VERSION,
    markets,
    engine,
    modules: {
      codes: { rules },
      tiers: { sets },
      rewards,
      outlet: sanitizeOutlet(modules.outlet, issues),
      margin: sanitizeMargin(modules.margin, issues),
    },
    // Campaigns last: their overrides are checked against the final rule/tier/gift ids.
    campaigns: sanitizeCampaigns(
      rec.campaigns,
      issues,
      collectOverrideTargets(rules, sets, rewards.gifts, { rules: ruleAliases, sets: setAliases, gifts: giftAliases }),
    ),
    storefront: sanitizeStorefront(rec.storefront),
    locales: sanitizeLocales(rec.locales, issues),
    onboarding: sanitizeOnboarding(rec.onboarding, issues),
  };

  return { config, issues: capIssues(issues) };
}

/**
 * Caps the issues list at CONFIG_LIMITS.maxIssues, replacing anything past that
 * with one summary issue — the list itself is not something a hostile or buggy
 * admin request should be able to blow up (audit P3-10 followup).
 */
function capIssues(issues: ConfigIssue[]): ConfigIssue[] {
  if (issues.length <= CONFIG_LIMITS.maxIssues) return issues;
  const kept = issues.slice(0, CONFIG_LIMITS.maxIssues);
  kept.push({
    path: "",
    code: "issues_truncated",
    message: `${issues.length - CONFIG_LIMITS.maxIssues} more problem(s) were found but are not listed here.`,
  });
  return kept;
}

/**
 * True when `stored` was written by a NEWER schema than this code knows (DATA-3,
 * rolling deploys). Such a config can still be read — readStoredConfig returns the
 * best-effort current-schema view — but must be treated as read-only: writing that
 * view back would silently drop every field the newer code added.
 */
export function isNewerSchema(stored: unknown): boolean {
  return isRecord(stored) && typeof stored.schemaVersion === "number" && stored.schemaVersion > SCHEMA_VERSION;
}

/**
 * Tolerant migration, vN -> current (DATA-3). MVP0 has no prior real schema, so a
 * v0/no-version fixture only needs its schemaVersion stamped forward — sanitizeConfig
 * fills any structural gaps. Future breaking shape changes branch on `version` here,
 * each with its own fixture test, before the shape reaches sanitizeConfig.
 * A newer-schema config passes through unchanged (see isNewerSchema).
 */
export function migrateConfig(stored: unknown): unknown {
  if (!isRecord(stored)) return stored;
  const version = typeof stored.schemaVersion === "number" ? stored.schemaVersion : 0;
  if (version >= SCHEMA_VERSION) return stored;
  return { ...stored, schemaVersion: SCHEMA_VERSION };
}

/**
 * migrate + sanitize; never throws, always returns a valid, freshly allocated
 * config (never DEFAULT_CONFIG itself). For a newer-schema row this is a read-only
 * view — check isNewerSchema(stored) before saving anything derived from it.
 */
export function readStoredConfig(stored: unknown): WonDiscountsConfig {
  return sanitizeConfig(migrateConfig(stored)).config;
}
