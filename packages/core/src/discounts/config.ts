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

// --- Defaults ------------------------------------------------------------------------

export const DEFAULT_CONFIG: WonDiscountsConfig = {
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
};

// --- Sanitize helpers ------------------------------------------------------------------

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
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

function sanitizeDiscountRule(v: unknown, issues: ConfigIssue[], index: number): DiscountRule | null {
  if (!isRecord(v)) return null;
  const path = `modules.codes.rules[${index}]`;
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

  if (Array.isArray(v.codes)) rule.codes = sanitizeStringArray(v.codes);

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

function sanitizeTierSet(v: unknown, issues: ConfigIssue[], index: number): TierSet | null {
  if (!isRecord(v)) return null;
  const id = typeof v.id === "string" && v.id ? v.id : "";
  if (!id) {
    pushIssue(issues, `modules.tiers.sets[${index}]`, "missing_id", "Tier set without an id was dropped.");
    return null;
  }
  const breaks = Array.isArray(v.breaks)
    ? v.breaks.map(sanitizeTierBreak).filter((b): b is TierBreak => b !== null)
    : [];
  return {
    id,
    scope: sanitizeTierSetScope(v.scope),
    countAcross: sanitizeEnum(
      v.countAcross,
      TIER_COUNT_ACROSS_MODES,
      "line",
      `modules.tiers.sets[${index}].countAcross`,
      issues,
    ),
    breaks,
  };
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
  const out: RewardsModule = {
    gifts: Array.isArray(rec.gifts)
      ? rec.gifts.map(sanitizeGiftTier).filter((g): g is GiftTier => g !== null)
      : [],
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

function sanitizeRuleOverride(v: unknown): RuleOverride | null {
  if (!isRecord(v)) return null;
  const ruleId = typeof v.ruleId === "string" && v.ruleId ? v.ruleId : "";
  if (!ruleId) return null;
  return { ruleId, patch: isRecord(v.patch) ? v.patch : {} };
}

function sanitizeCampaign(v: unknown, _index: number): Campaign | null {
  if (!isRecord(v)) return null;
  const id = typeof v.id === "string" && v.id ? v.id : "";
  if (!id) return null;
  const window = isRecord(v.window) ? v.window : {};
  return {
    id,
    name: sanitizeString(v.name, ""),
    window: {
      start: typeof window.start === "string" ? window.start : "",
      end: typeof window.end === "string" ? window.end : "",
    },
    overrides: Array.isArray(v.overrides)
      ? v.overrides.map(sanitizeRuleOverride).filter((o): o is RuleOverride => o !== null)
      : [],
    killed: sanitizeBool(v.killed, false),
  };
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

function sanitizeLocaleTexts(v: unknown): Record<string, string> {
  if (!isRecord(v)) return {};
  const out: Record<string, string> = {};
  for (const [k, val] of Object.entries(v)) {
    if (typeof val === "string") out[k.slice(0, 100)] = val.slice(0, 2000);
  }
  return out;
}

function sanitizeLocales(v: unknown): LocaleDictionary {
  const rec = isRecord(v) ? v : {};
  return {
    cs: sanitizeLocaleTexts(rec.cs),
    sk: sanitizeLocaleTexts(rec.sk),
    en: sanitizeLocaleTexts(rec.en),
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

  const codesRaw = isRecord(modules.codes) ? modules.codes : {};
  const rules = Array.isArray(codesRaw.rules)
    ? codesRaw.rules
        .map((r, i) => sanitizeDiscountRule(r, issues, i))
        .filter((r): r is DiscountRule => r !== null)
    : [];

  const tiersRaw = isRecord(modules.tiers) ? modules.tiers : {};
  const sets = Array.isArray(tiersRaw.sets)
    ? tiersRaw.sets.map((s, i) => sanitizeTierSet(s, issues, i)).filter((s): s is TierSet => s !== null)
    : [];

  const config: WonDiscountsConfig = {
    schemaVersion: SCHEMA_VERSION,
    markets: sanitizeMarkets(rec.markets, issues),
    engine: sanitizeEngine(rec.engine, issues),
    modules: {
      codes: { rules },
      tiers: { sets },
      rewards: sanitizeRewards(modules.rewards, issues),
      outlet: sanitizeOutlet(modules.outlet, issues),
      margin: sanitizeMargin(modules.margin, issues),
    },
    campaigns: Array.isArray(rec.campaigns)
      ? rec.campaigns.map((c, i) => sanitizeCampaign(c, i)).filter((c): c is Campaign => c !== null)
      : [],
    storefront: sanitizeStorefront(rec.storefront),
    locales: sanitizeLocales(rec.locales),
    onboarding: sanitizeOnboarding(rec.onboarding),
  };

  return { config, issues };
}

/**
 * Tolerant migration, vN -> current (DATA-3). MVP0 has no prior real schema, so a
 * v0/no-version fixture only needs its schemaVersion stamped forward — sanitizeConfig
 * fills any structural gaps. Future breaking shape changes branch on `version` here,
 * each with its own fixture test, before the shape reaches sanitizeConfig.
 */
export function migrateConfig(stored: unknown): unknown {
  if (!isRecord(stored)) return stored;
  const version = typeof stored.schemaVersion === "number" ? stored.schemaVersion : 0;
  if (version >= SCHEMA_VERSION) return stored;
  return { ...stored, schemaVersion: SCHEMA_VERSION };
}

/** migrate + sanitize; never throws, always returns a valid config. */
export function readStoredConfig(stored: unknown): WonDiscountsConfig {
  return sanitizeConfig(migrateConfig(stored)).config;
}
