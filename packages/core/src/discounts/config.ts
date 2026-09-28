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
  goals: string[];
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
      `Expected a boolean, got ${JSON.stringify(v)}; using default ${fallback}.`,
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
    `Expected one of ${allowed.join(", ")}; got ${JSON.stringify(v)}. Using default "${fallback}".`,
  );
  return fallback;
}

/** Clamps to 0-100; reports an issue only for a supplied-but-invalid/out-of-range value. */
function sanitizePercent(
  v: unknown,
  fallback: number,
  path: string,
  issues: ConfigIssue[],
): number {
  if (v === undefined) return fallback;
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) {
    pushIssue(
      issues,
      path,
      "invalid_percent",
      `Expected a number between 0 and 100, got ${JSON.stringify(v)}. Using default ${fallback}.`,
    );
    return fallback;
  }
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

function sanitizeStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === "string");
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
      `Invalid market currency ${JSON.stringify(v.currency)}; market dropped.`,
    );
    return null;
  }
  return { handle, currency, enabled: sanitizeBool(v.enabled, true) };
}

function sanitizeMarkets(v: unknown, issues: ConfigIssue[]): MarketSetting[] {
  if (!Array.isArray(v)) return [];
  const out: MarketSetting[] = [];
  v.forEach((item, i) => {
    const m = sanitizeMarket(item, issues, i);
    if (m) out.push(m);
  });
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
      return { kind: "fixed", amount: sanitizeMoneyByCurrency(v.amount) };
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
        productIds: sanitizeStringArray(v.productIds),
        variantIds: sanitizeStringArray(v.variantIds),
      };
    }
    if (v.kind === "collections") {
      return { kind: "collections", ids: sanitizeStringArray(v.ids) };
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

function sanitizeDiscountRule(v: unknown, issues: ConfigIssue[], path: string): DiscountRule | null {
  if (!isRecord(v)) return null;
  const id = typeof v.id === "string" && v.id ? v.id : "";
  if (!id) {
    pushIssue(issues, path, "missing_id", "Discount rule without an id was dropped.");
    return null;
  }

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
    if (v.minimum.subtotal !== undefined) minimum.subtotal = sanitizeMoneyByCurrency(v.minimum.subtotal);
    if (typeof v.minimum.quantity === "number" && Number.isFinite(v.minimum.quantity)) {
      minimum.quantity = Math.max(0, Math.floor(v.minimum.quantity));
    }
    rule.minimum = minimum;
  }

  if (isRecord(v.schedule)) {
    const schedule: DiscountRule["schedule"] = {};
    if (typeof v.schedule.startsAt === "string") schedule.startsAt = v.schedule.startsAt;
    if (typeof v.schedule.endsAt === "string") schedule.endsAt = v.schedule.endsAt;
    rule.schedule = schedule;
  }

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
    if (Array.isArray(v.targeting.segments)) targeting.segments = sanitizeStringArray(v.targeting.segments);
    if (Array.isArray(v.targeting.markets)) targeting.markets = sanitizeStringArray(v.targeting.markets);
    rule.targeting = targeting;
  }

  if (isRecord(v.combinesWith) && Array.isArray(v.combinesWith.ruleIds)) {
    rule.combinesWith = { ruleIds: sanitizeStringArray(v.combinesWith.ruleIds) };
  }

  if (isRecord(v.origin) && typeof v.origin.nativeId === "string") {
    rule.origin = { nativeId: v.origin.nativeId };
  }

  return rule;
}

/**
 * Rules list: capped, one rule per id (the first wins, so the node-per-code-rule
 * mapping in MVP 1 can key on `id`), and every code owned by exactly one rule —
 * Shopify refuses the same code on two discount nodes.
 */
function sanitizeRules(v: unknown, issues: ConfigIssue[]): DiscountRule[] {
  if (!Array.isArray(v)) return [];
  const out: DiscountRule[] = [];
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
  });
  if (overLimit > 0) {
    pushIssue(
      issues,
      "modules.codes.rules",
      "too_many_rules",
      `Only the first ${CONFIG_LIMITS.rules} discount rules are kept; ${overLimit} more were dropped.`,
    );
  }
  return out;
}

// --- Tiers module ----------------------------------------------------------------------

function sanitizeTierBreak(v: unknown): TierBreak | null {
  if (!isRecord(v)) return null;
  if (typeof v.minQty !== "number" || !Number.isFinite(v.minQty)) return null;
  const out: TierBreak = { minQty: Math.max(1, Math.floor(v.minQty)) };
  if (typeof v.percent === "number" && Number.isFinite(v.percent)) {
    out.percent = Math.min(100, Math.max(0, v.percent));
  }
  if (v.amountOff !== undefined) out.amountOff = sanitizeMoneyByCurrency(v.amountOff);
  return out;
}

function sanitizeTierSetScope(v: unknown): TierSetScope {
  if (v === "global") return "global";
  if (isRecord(v)) {
    const out: { productIds?: string[]; collectionIds?: string[] } = {};
    if (Array.isArray(v.productIds)) out.productIds = sanitizeStringArray(v.productIds);
    if (Array.isArray(v.collectionIds)) out.collectionIds = sanitizeStringArray(v.collectionIds);
    return out;
  }
  return "global";
}

function sanitizeTierSet(v: unknown, issues: ConfigIssue[], path: string): TierSet | null {
  if (!isRecord(v)) return null;
  const id = typeof v.id === "string" && v.id ? v.id : "";
  if (!id) {
    pushIssue(issues, path, "missing_id", "Tier set without an id was dropped.");
    return null;
  }
  let breaks = Array.isArray(v.breaks)
    ? v.breaks.map(sanitizeTierBreak).filter((b): b is TierBreak => b !== null)
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
    scope: sanitizeTierSetScope(v.scope),
    countAcross: sanitizeEnum(v.countAcross, TIER_COUNT_ACROSS_MODES, "line", `${path}.countAcross`, issues),
    breaks,
  };
}

function sanitizeTierSets(v: unknown, issues: ConfigIssue[]): TierSet[] {
  if (!Array.isArray(v)) return [];
  const out: TierSet[] = [];
  let overLimit = 0;
  v.forEach((item, i) => {
    if (out.length >= CONFIG_LIMITS.tierSets) {
      overLimit++;
      return;
    }
    const set = sanitizeTierSet(item, issues, `modules.tiers.sets[${i}]`);
    if (set) out.push(set);
  });
  if (overLimit > 0) {
    pushIssue(
      issues,
      "modules.tiers.sets",
      "too_many_tier_sets",
      `Only the first ${CONFIG_LIMITS.tierSets} tier sets are kept; ${overLimit} more were dropped.`,
    );
  }
  return out;
}

// --- Rewards module ----------------------------------------------------------------------

function sanitizeGiftTier(v: unknown): GiftTier | null {
  if (!isRecord(v)) return null;
  const id = typeof v.id === "string" && v.id ? v.id : "";
  if (!id) return null;
  const out: GiftTier = {
    id,
    threshold: sanitizeMoneyByCurrency(v.threshold),
    choices: sanitizeStringArray(v.choices),
  };
  if (typeof v.fallbackVariantId === "string") out.fallbackVariantId = v.fallbackVariantId;
  return out;
}

function sanitizeRewards(v: unknown, issues: ConfigIssue[]): RewardsModule {
  const def = DEFAULT_CONFIG.modules.rewards;
  const rec = isRecord(v) ? v : {};
  let gifts = Array.isArray(rec.gifts)
    ? rec.gifts.map(sanitizeGiftTier).filter((g): g is GiftTier => g !== null)
    : [];
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
    out.freeShipping = { threshold: sanitizeMoneyByCurrency(rec.freeShipping.threshold) };
  }
  return out;
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

function sanitizeMarginOverride(v: unknown): MarginCollectionOverride | null {
  if (!isRecord(v)) return null;
  const collectionId = typeof v.collectionId === "string" && v.collectionId ? v.collectionId : "";
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
  const perCollection = Array.isArray(rec.perCollection)
    ? rec.perCollection.map(sanitizeMarginOverride).filter((x): x is MarginCollectionOverride => x !== null)
    : [];
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

function collectOverrideTargets(
  rules: DiscountRule[],
  sets: TierSet[],
  gifts: GiftTier[],
): Map<string, OverrideTarget[]> {
  const targets = new Map<string, OverrideTarget[]>();
  const add = (id: string, target: OverrideTarget) => {
    const list = targets.get(id);
    if (list) list.push(target);
    else targets.set(id, [target]);
  };
  for (const value of rules) add(value.id, { kind: "rule", value });
  for (const value of sets) add(value.id, { kind: "tierSet", value });
  for (const value of gifts) add(value.id, { kind: "giftTier", value });
  return targets;
}

function sanitizeOverridePatch(
  target: OverrideTarget,
  rawPatch: Record<string, unknown>,
  issues: ConfigIssue[],
  path: string,
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
        : sanitizeGiftTier(merged);
  if (!isRecord(sanitized)) return {};

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
  targets: Map<string, OverrideTarget[]>,
): RuleOverride[] {
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
        `Campaign override points to ${JSON.stringify(ruleId)}, which does not exist; the override was removed.`,
      );
      return;
    }
    if (found.length > 1) {
      pushIssue(
        issues,
        itemPath,
        "ambiguous_override",
        `"${ruleId}" matches more than one rule, tier set or gift tier; the override was removed.`,
      );
      return;
    }
    const patch = sanitizeOverridePatch(found[0], isRecord(item.patch) ? item.patch : {}, issues, `${itemPath}.patch`);
    if (Object.keys(patch).length === 0) {
      pushIssue(issues, itemPath, "empty_override", "Campaign override changes nothing; it was removed.");
      return;
    }
    out.push({ ruleId, patch });
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
  targets: Map<string, OverrideTarget[]>,
): Campaign | null {
  if (!isRecord(v)) return null;
  const id = typeof v.id === "string" && v.id ? v.id : "";
  if (!id) {
    pushIssue(issues, path, "missing_id", "Campaign without an id was dropped.");
    return null;
  }
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
    overrides: sanitizeOverrides(v.overrides, issues, `${path}.overrides`, targets),
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

function sanitizeCampaigns(v: unknown, issues: ConfigIssue[], targets: Map<string, OverrideTarget[]>): Campaign[] {
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
    const campaign = sanitizeCampaign(item, issues, path, targets);
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

function sanitizeOnboarding(v: unknown): OnboardingState {
  const def = DEFAULT_CONFIG.onboarding;
  const rec = isRecord(v) ? v : {};
  return {
    goals: sanitizeStringArray(rec.goals),
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
  const rules = sanitizeRules(codesRaw.rules, issues);

  const tiersRaw = isRecord(modules.tiers) ? modules.tiers : {};
  const sets = sanitizeTierSets(tiersRaw.sets, issues);

  const rewards = sanitizeRewards(modules.rewards, issues);

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
    campaigns: sanitizeCampaigns(rec.campaigns, issues, collectOverrideTargets(rules, sets, rewards.gifts)),
    storefront: sanitizeStorefront(rec.storefront),
    locales: sanitizeLocales(rec.locales, issues),
    onboarding: sanitizeOnboarding(rec.onboarding),
  };

  return { config, issues };
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
