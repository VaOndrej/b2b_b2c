import type {
  CatalogPricingLayer,
  EffectiveCatalogPricingLayer,
} from "./catalog.types";

const DEFAULT_GLOBAL_MIN_PRICE_PERCENT = 70;

// The record maps merge per-key: delta entries override base entries. Because
// `base` is the strict intersection-where-equal of the source segments (see
// buildCatalogFunctionConfig), no deletion semantics are ever needed — a key
// absent from base + absent from the catalog's delta simply does not apply.
const RECORD_MAP_KEYS = [
  "perProductPricePercents",
  "perCollectionPricePercents",
  "perVariantOverrideBasePrices",
  "perVariantPricePercents",
  "perVariantFloorPercents",
  "perVariantTierPrices",
  "perProductFloorPercents",
  "perProductAllowZeroFinalPrice",
  "perProductOverrideBasePrices",
  "perProductTierPrices",
  "perProductMinimumOrderQuantities",
  "perProductStepQuantities",
  "perProductMaximumOrderQuantities",
  "perCollectionMaximumOrderQuantities",
] as const;

// merge(base, delta) → dense effective layer the runtime reads after resolving a
// catalog. Mirrored by the JS function (extensions/.../*.js) so TS core and the
// Shopify Functions stay in sync (contract tests enforce equivalence).
export function mergeCatalogLayer(
  base: CatalogPricingLayer,
  delta: CatalogPricingLayer = {},
): EffectiveCatalogPricingLayer {
  const merged = {
    globalMinPricePercent:
      delta.globalMinPricePercent ??
      base.globalMinPricePercent ??
      DEFAULT_GLOBAL_MIN_PRICE_PERCENT,
    allowZeroFinalPrice:
      delta.allowZeroFinalPrice ?? base.allowZeroFinalPrice ?? false,
    pricePercent: delta.pricePercent ?? base.pricePercent ?? null,
  } as EffectiveCatalogPricingLayer;

  for (const key of RECORD_MAP_KEYS) {
    merged[key] = {
      ...((base[key] ?? {}) as Record<string, never>),
      ...((delta[key] ?? {}) as Record<string, never>),
    };
  }

  return merged;
}
