import type { TierPrice } from "./pricing.types.ts";

// MVP_5_3 §4 — catalog price-list precedence (FULL native parity,
// most-specific-wins, NON-compounding). The effective unit price is:
//   1. per-variant FIXED            → that price
//   2. else per-product FIXED       → that price
//   3. else base × (most-specific PERCENT: variant% ?? product% ?? collection% ?? catalog%)
//   4. else base
//   → then TIER (quantity break) overrides 1–4 if a threshold matches
//   → (discounts + floor happen later in the pipeline / function)
//
// A PERCENT value is the percentage OF base price to charge (e.g. 90 → 90% of
// base). A FIXED value is the absolute unit price. FIXED is honored only at
// variant/product scope (steps 1–2), matching §4.

export type CatalogPriceRuleScope = "CATALOG" | "COLLECTION" | "PRODUCT" | "VARIANT";
export type CatalogPriceRuleMode = "FIXED" | "PERCENT";

export interface CatalogPriceRule {
  scope: CatalogPriceRuleScope;
  targetId?: string | null;
  mode: CatalogPriceRuleMode;
  value: number;
}

export interface CatalogPriceListInput {
  basePrice: number;
  productId: string;
  variantId?: string | null;
  collectionIds?: string[];
  priceRules?: CatalogPriceRule[];
  tierPrices?: TierPrice[];
  quantity?: number;
}

export type CatalogUnitPriceSource =
  | "VARIANT_FIXED"
  | "PRODUCT_FIXED"
  | "VARIANT_PERCENT"
  | "PRODUCT_PERCENT"
  | "COLLECTION_PERCENT"
  | "CATALOG_PERCENT"
  | "TIER"
  | "BASE";

export interface CatalogUnitPriceResult {
  unitPrice: number;
  source: CatalogUnitPriceSource;
  priceListUnitPrice: number;
  appliedTierPrice?: TierPrice;
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

function normalizeQuantity(quantity: number | undefined): number {
  const parsed = Number(quantity);
  if (!Number.isFinite(parsed)) {
    return 1;
  }
  return Math.max(1, Math.floor(parsed));
}

function isUsableValue(value: number): boolean {
  return Number.isFinite(value) && value >= 0;
}

function findFixed(
  rules: CatalogPriceRule[],
  scope: CatalogPriceRuleScope,
  targetId: string | null | undefined,
): number | null {
  if (targetId == null) {
    return null;
  }
  for (const rule of rules) {
    if (
      rule.scope === scope &&
      rule.mode === "FIXED" &&
      rule.targetId === targetId &&
      isUsableValue(rule.value)
    ) {
      return roundMoney(rule.value);
    }
  }
  return null;
}

function findPercent(
  rules: CatalogPriceRule[],
  scope: CatalogPriceRuleScope,
  targetId: string | null | undefined,
): number | null {
  for (const rule of rules) {
    const targetMatches =
      scope === "CATALOG" ? true : rule.targetId === targetId && targetId != null;
    if (
      rule.scope === scope &&
      rule.mode === "PERCENT" &&
      targetMatches &&
      isUsableValue(rule.value)
    ) {
      return rule.value;
    }
  }
  return null;
}

// Among collection PERCENT rules whose target collection the line belongs to,
// pick the most aggressive (lowest %) deterministically — collections share a
// specificity level, so we resolve ties toward the cheapest catalog price.
function findCollectionPercent(
  rules: CatalogPriceRule[],
  collectionIds: string[] | undefined,
): number | null {
  if (!Array.isArray(collectionIds) || collectionIds.length === 0) {
    return null;
  }
  const memberships = new Set(collectionIds);
  let lowest: number | null = null;
  for (const rule of rules) {
    if (
      rule.scope === "COLLECTION" &&
      rule.mode === "PERCENT" &&
      rule.targetId != null &&
      memberships.has(rule.targetId) &&
      isUsableValue(rule.value)
    ) {
      lowest = lowest == null ? rule.value : Math.min(lowest, rule.value);
    }
  }
  return lowest;
}

function resolveTierPrice(
  tierPrices: TierPrice[] | undefined,
  quantity: number,
): TierPrice | undefined {
  if (!Array.isArray(tierPrices) || tierPrices.length === 0) {
    return undefined;
  }
  let selected: TierPrice | undefined;
  for (const tier of tierPrices) {
    if (
      !tier ||
      !Number.isFinite(tier.minQuantity) ||
      !Number.isFinite(tier.unitPrice) ||
      tier.minQuantity < 1 ||
      tier.unitPrice < 0 ||
      quantity < tier.minQuantity
    ) {
      continue;
    }
    if (!selected || tier.minQuantity > selected.minQuantity) {
      selected = {
        minQuantity: Math.floor(tier.minQuantity),
        unitPrice: roundMoney(tier.unitPrice),
      };
    }
  }
  return selected;
}

export function resolveCatalogUnitPrice(
  input: CatalogPriceListInput,
): CatalogUnitPriceResult {
  const base = roundMoney(input.basePrice);
  const rules = Array.isArray(input.priceRules) ? input.priceRules : [];
  const quantity = normalizeQuantity(input.quantity);

  let priceListUnitPrice = base;
  let source: CatalogUnitPriceSource = "BASE";

  const variantFixed = findFixed(rules, "VARIANT", input.variantId);
  const productFixed = findFixed(rules, "PRODUCT", input.productId);

  if (variantFixed != null) {
    priceListUnitPrice = variantFixed;
    source = "VARIANT_FIXED";
  } else if (productFixed != null) {
    priceListUnitPrice = productFixed;
    source = "PRODUCT_FIXED";
  } else {
    const variantPercent = findPercent(rules, "VARIANT", input.variantId);
    const productPercent = findPercent(rules, "PRODUCT", input.productId);
    const collectionPercent = findCollectionPercent(rules, input.collectionIds);
    const catalogPercent = findPercent(rules, "CATALOG", null);

    if (variantPercent != null) {
      priceListUnitPrice = roundMoney(base * (variantPercent / 100));
      source = "VARIANT_PERCENT";
    } else if (productPercent != null) {
      priceListUnitPrice = roundMoney(base * (productPercent / 100));
      source = "PRODUCT_PERCENT";
    } else if (collectionPercent != null) {
      priceListUnitPrice = roundMoney(base * (collectionPercent / 100));
      source = "COLLECTION_PERCENT";
    } else if (catalogPercent != null) {
      priceListUnitPrice = roundMoney(base * (catalogPercent / 100));
      source = "CATALOG_PERCENT";
    }
  }

  // Tier (quantity break) overrides the price-list result when a threshold matches.
  const appliedTierPrice = resolveTierPrice(input.tierPrices, quantity);
  if (appliedTierPrice) {
    return {
      unitPrice: appliedTierPrice.unitPrice,
      source: "TIER",
      priceListUnitPrice,
      appliedTierPrice,
    };
  }

  return { unitPrice: priceListUnitPrice, source, priceListUnitPrice };
}
