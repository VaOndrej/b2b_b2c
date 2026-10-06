// Won Discounts config enums (spec §2). Runtime `as const` arrays, so a docs
// generator — and the sanitizer — read the SAME list the types are derived from.

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

/**
 * What the random part of a generated code is made of (code-batch.ts): never
 * 0 / O, 1 / I / L (they read alike). "both" = letters and digits.
 */
export const CODE_BATCH_ALPHABETS = ["both", "letters", "digits"] as const;
export type CodeBatchAlphabet = (typeof CODE_BATCH_ALPHABETS)[number];

export const DISCOUNT_VALUE_KINDS = ["percentage", "fixed", "freeShipping"] as const;
export type DiscountValueKind = (typeof DISCOUNT_VALUE_KINDS)[number];

export const DISCOUNT_TARGET_KINDS = [
  "order",
  "products",
  "collections",
  "shipping",
] as const;
export type DiscountTargetKind = (typeof DISCOUNT_TARGET_KINDS)[number];

/**
 * What a rule's minimum (subtotal / quantity) is measured on:
 *   - "cart": the whole cart, every non-gift line at its pre-discount price,
 *     outlet included — the spec's „minimum košíku“, the default for a rule
 *     made in Won;
 *   - "entitled": only the lines the rule targets (for an order or shipping
 *     rule that is the whole cart too) — Shopify's semantics for a product /
 *     collection discount's minimum, which a migrated native keeps.
 */
export const MINIMUM_SCOPES = ["cart", "entitled"] as const;
export type MinimumScope = (typeof MINIMUM_SCOPES)[number];

export const TIER_COUNT_ACROSS_MODES = ["line", "product", "cart"] as const;
export type TierCountAcross = (typeof TIER_COUNT_ACROSS_MODES)[number];

/**
 * Předpřipravené vzhledy bloků (Free, MVP 3 kontrakt K7): `default` = tabulka,
 * `highlight` = zvýrazněná aktivní úroveň, `chips` = kompaktní štítky v řádku,
 * `tiles` = dlaždice. `config.storefront.appearancePreset`; neznámá hodnota se
 * sanitizuje na `default` (s issue).
 */
export const APPEARANCE_PRESETS = ["default", "highlight", "chips", "tiles"] as const;
export type AppearancePreset = (typeof APPEARANCE_PRESETS)[number];

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
