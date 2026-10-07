// Won Discounts config types (spec §2 catalog). Shapes only; sanitize.ts owns
// how an arbitrary stored value becomes one of these.

import type { CustomLook } from "../custom-look.ts";
import type { CurrencyCode, MoneyByCurrency } from "../money.ts";
import type {
  AccentPreset,
  AppearancePreset,
  CodeBatchAlphabet,
  DiscountMethod,
  LocaleCode,
  MinimumScope,
  OnboardingGoal,
  OutletDisplay,
  ProductWithProductMode,
  ReopenOnReturnMode,
  TierCountAcross,
} from "./enums.ts";

export interface MarketSetting {
  handle: string;
  currency: CurrencyCode;
  enabled: boolean;
  /**
   * ISO 3166-1 alpha-2 countries of the market (upper-case). Pro market targeting
   * matches the cart's country against these (the function's `localization.market`
   * is deprecated). Absent = the market cannot be targeted by country yet.
   */
  countries?: string[];
}

export interface EngineSettings {
  combination: {
    outletWithAnything: boolean; // default false (A1): outlet combines with nothing
    productWithProduct: ProductWithProductMode; // default "best"
    productWithOrder: boolean; // default true
    productWithShipping: boolean; // default true
    orderWithShipping: boolean; // default true
  };
  /**
   * Amounts per market (7 Oct 2026): what a cart from a country in NO market gets where the markets of its currency
   * have different amounts. true = the lowest of those amounts; absent = nothing (never another market's amount).
   * Stored only when true.
   */
  unknownMarketLowest?: true;
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
/**
 * A minimum quantity of ONE selected product or collection (Pro, plan
 * 2026-10-06 bod 8). `id` = a product GID (products target; it also covers the
 * product's variants selected one by one in `variantIds`: the variants of one
 * product count together) or a collection GID (collections target).
 * Each item is judged on its own: its lines get the discount when the pieces
 * of THAT product (collection) in the cart reach `quantity`; the rule's common
 * `minimum.quantity` then does not apply to it. An item without an entry
 * follows the common minimum. plan.ts "Per-item minimum" is the port spec.
 */
export interface ItemMinimum {
  id: string;
  /** Whole items, 1–CONFIG_LIMITS.itemMinQty. */
  quantity: number;
}
export interface DiscountTargetProducts {
  kind: "products";
  productIds: string[];
  variantIds: string[];
  /** Pro. Absent = none. One entry per product id at most. */
  itemMinimums?: ItemMinimum[];
}
export interface DiscountTargetCollections {
  kind: "collections";
  ids: string[];
  /** Pro. Absent = none. Only collections listed in `ids`, one entry each. */
  itemMinimums?: ItemMinimum[];
}
export interface DiscountTargetShipping {
  kind: "shipping";
}
export type DiscountTarget =
  | DiscountTargetOrder
  | DiscountTargetProducts
  | DiscountTargetCollections
  | DiscountTargetShipping;

/**
 * A generated batch of codes (code-batch.ts is the spec). The codes are NOT
 * stored: `generateBatchCodes(batch)` rebuilds them from `seed`, always the
 * same, so the config and the function payload stay a constant size whatever
 * `count` is. A code is
 *   prefix + random part (+ middle inside it) + suffix
 * where the random part is `length` characters of `alphabet`, its last
 * characters a keyed check of the ones before (the function recognises the
 * batch by the prefix and the check, never by a list).
 * `seed` is a SECRET (whoever has it can list every code): it never leaves the
 * stored config — the function payload carries a key derived from it, the
 * storefront config nothing.
 */
export interface CodeBatch {
  /** `[A-Za-z0-9_-]{1,64}`, unique in the rule. */
  id: string;
  /** `[A-Z0-9_-]`, 2–12 characters; no batch's prefix starts another's (shop-wide). */
  prefix: string;
  /** How many codes were generated (1–CONFIG_LIMITS.codeBatchSize). */
  count: number;
  /** 32 lower-case hex digits. */
  seed: string;
  /** Characters of the random part, check characters included. */
  length: number;
  alphabet: CodeBatchAlphabet;
  /** Pro: a literal inside the random part (after its first half). */
  middle?: string;
  /** Pro: a literal after the random part. */
  suffix?: string;
  /** Indexes (0-based, ascending) of the generated codes the merchant deleted. */
  removed?: number[];
}

export interface DiscountRule {
  id: string;
  enabled: boolean;
  name: string;
  method: DiscountMethod;
  codes?: string[];
  /** Generated code batches (code rules; plan 2026-10-06 dávka 4, code-batch.ts). Absent = none. */
  codeBatches?: CodeBatch[];
  value: DiscountRuleValue;
  target: DiscountTarget;
  /** `scope` (MINIMUM_SCOPES): the sanitizer always sets it, "cart" unless the rule says "entitled". */
  minimum?: { subtotal?: MoneyByCurrency; quantity?: number; scope?: MinimumScope };
  schedule?: { startsAt?: string; endsAt?: string };
  limits?: { usageLimit?: number; oncePerCustomer?: boolean };
  /** Tie-break (A1: `priority desc, id asc`) and owner of a Pro stack; absent = 0. */
  priority?: number;
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
  /** 0–95; absent = the global value. */
  minMarginPercent?: number;
  /** 0–100; absent = the global value. */
  maxDiscountPercent?: number;
}

/**
 * Margin protection (MVP 2, A1.7/A2): no Won discount takes a line below its
 * floor — cost + minimum margin when the cost is known, else the price minus the
 * maximum discount %. Never blocks a checkout, only lowers discounts.
 */
export interface MarginModule {
  /** Off by default: until the merchant turns it on, planning is exactly MVP 1's. */
  enabled: boolean;
  global: {
    /** 0–95, margin = (price after discounts − cost) / price after discounts; absent = 0 (never below cost). */
    minMarginPercent?: number;
    /** 0–100, the ceiling for products with no known cost (A2); default 50. */
    maxDiscountPercent: number;
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
  /** K7: one of APPEARANCE_PRESETS (the sanitizer turns anything else into "default"). */
  appearancePreset: AppearancePreset;
  /** The blocks' highlight colour, on every plan (ACCENT_PRESETS). Absent = "theme": the theme's text colour. */
  accent?: AccentPreset;
  cardPricesEnabled: boolean; // BETA: quantity prices on cards/search
  /** MVP 7 (Pro): the custom look — validated variables + the merchant's CSS as typed (custom-look.ts). Absent = none. */
  custom?: CustomLook;
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
  /** Stable machine key (the admin words the issue by it; never shown). */
  code: string;
  /** English, for logs and tests (never shown to a merchant as is). */
  message: string;
  /**
   * The values the message names, structured (limits, counts, the value
   * given and the value kept, ids, codes…), so a UI can word the issue in its
   * own language without reading `message`. Absent when the message names none.
   * A list (codes, ids, currencies, values) is its first five values joined by
   * ", " plus `more` = how many it leaves out (0 when none): the UI words
   * "and N more" itself, never the English message's.
   */
  params?: Record<string, string | number>;
}

/** Deeply read-only view of `T` (the type of the shared, frozen DEFAULT_CONFIG). */
export type ReadonlyDeep<T> = T extends (infer U)[]
  ? ReadonlyArray<ReadonlyDeep<U>>
  : T extends object
    ? { readonly [K in keyof T]: ReadonlyDeep<T[K]> }
    : T;
