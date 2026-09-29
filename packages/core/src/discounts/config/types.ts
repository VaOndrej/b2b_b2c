// Won Discounts config types (spec §2 catalog). Shapes only; sanitize.ts owns
// how an arbitrary stored value becomes one of these.

import type { CurrencyCode, MoneyByCurrency } from "../money.ts";
import type {
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
