// Won Discounts config v1 (doctrine DATA-2/DATA-3, spec §2). This is the single
// source of truth's *shape*: sanitize + migrate + read all live here so admin,
// storefront and the discount function agree on exactly one interpretation of a
// stored config (DATA-4 — "one brain").
//
// Every field has a strong default so a shop that never touched a setting still
// gets a complete, valid config; sanitizeConfig never throws and drops anything it
// cannot make sense of, recording a human-readable ConfigIssue instead.
//
// This file is the stable public surface (`@won/core/discounts/config`). The code
// lives per module in ./config/*.ts (enums, types, limits, defaults, validators,
// one sanitizer per module, and the top-level sanitize/migrate/read).

export {
  APPEARANCE_PRESETS,
  COMBINATION_CATEGORIES,
  DISCOUNT_METHODS,
  DISCOUNT_TARGET_KINDS,
  DISCOUNT_VALUE_KINDS,
  LOCALE_CODES,
  MINIMUM_SCOPES,
  ONBOARDING_GOALS,
  OUTLET_DISPLAY_MODES,
  PRODUCT_WITH_PRODUCT_MODES,
  REOPEN_ON_RETURN_MODES,
  SCHEMA_VERSION,
  TIER_COUNT_ACROSS_MODES,
} from "./config/enums.ts";
export type {
  AppearancePreset,
  CombinationCategory,
  DiscountMethod,
  DiscountTargetKind,
  DiscountValueKind,
  LocaleCode,
  MinimumScope,
  OnboardingGoal,
  OutletDisplay,
  ProductWithProductMode,
  ReopenOnReturnMode,
  TierCountAcross,
} from "./config/enums.ts";
export type {
  Campaign,
  CodesModule,
  ConfigIssue,
  DiscountRule,
  DiscountRuleValue,
  DiscountRuleValueFixed,
  DiscountRuleValueFreeShipping,
  DiscountRuleValuePercentage,
  DiscountTarget,
  DiscountTargetCollections,
  DiscountTargetOrder,
  DiscountTargetProducts,
  DiscountTargetShipping,
  EngineSettings,
  GiftTier,
  LocaleDictionary,
  MarginCollectionOverride,
  MarginModule,
  MarketSetting,
  OnboardingState,
  OutletModule,
  ReadonlyDeep,
  RewardsModule,
  RuleOverride,
  StorefrontSettings,
  TierBreak,
  TierSet,
  TierSetScope,
  TiersModule,
  WonDiscountsConfig,
} from "./config/types.ts";
export { CONFIG_LIMITS } from "./config/limits.ts";
export { createDefaultConfig, DEFAULT_CONFIG } from "./config/defaults.ts";
export { isIsoDateTime, isShopLocalDateTime, isValidEntityId } from "./config/validators.ts";
export { isNewerSchema, migrateConfig, readStoredConfig, sanitizeConfig } from "./config/sanitize.ts";
