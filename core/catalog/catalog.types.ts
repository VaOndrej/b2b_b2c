// MVP_5_3 — Price catalogs generalize the binary B2B/B2C segment into N
// data-driven catalogs. A customer resolves into exactly one catalog; the
// effective pricing/quantity/floor config for that catalog is
// merge(base, catalogDelta) (delta-encoding, see catalog.merge.ts).
//
// Phase 1 keeps behavior identical to the two hardwired segments: the only
// seeded catalogs are "default" (= today's Global settings / B2C / anonymous
// fallback) and "b2b" (purchasing company or B2B tag).

export interface CatalogMarketFilter {
  countryCode?: string | null;
  currencyCode?: string | null;
  languageCode?: string | null;
}

// Optional second resolution axis (Q2 — delegated to Shopify Markets). The
// function reads localization.country/language + presentment currency and the
// resolver only matches a catalog when its market filter also matches.
export interface MarketContext {
  countryCode?: string | null;
  currencyCode?: string | null;
  languageCode?: string | null;
}

// One catalog as seen by the resolver. Audience = tags + (optional) purchasing
// company; priority breaks ties (highest wins); isDefault is the always-present
// fallback for anonymous / non-matching customers.
export interface CatalogResolutionEntry {
  id: string;
  priority: number;
  isDefault: boolean;
  audienceTags: string[];
  matchCompany: boolean;
  // A catalog matches if it has no market constraint, or ANY of its filters
  // matches. `marketFilter` (singular) is kept for back-compat with Phase 1.
  marketFilter?: CatalogMarketFilter | null;
  marketFilters?: CatalogMarketFilter[];
  // The legacy segment this catalog maps to for segment-keyed mechanisms
  // (coupon segment rules / visibility). default→B2C, b2b→B2B, custom→B2C.
  segment?: "B2B" | "B2C";
}

export interface CatalogResolutionInput {
  matchedTags?: string[];
  hasPurchasingCompany?: boolean;
  marketContext?: MarketContext | null;
  catalogs: CatalogResolutionEntry[];
}

// A pricing layer is sparse: base carries the shared baseline (incl. global
// scalars); a catalog delta carries only the keys that differ from base. The
// delta-encoding invariant (§10) is: a delta NEVER stores a value equal to base.
export interface CatalogPricingLayer {
  globalMinPricePercent?: number;
  allowZeroFinalPrice?: boolean;
  // pricePercent = catalog-wide % of base to charge (e.g. 90 → 90% of base);
  // perProductPricePercents = per-product override of that. Both feed the
  // effective base-price precedence (FIXED override > product% > catalog% > base),
  // matching core/pricing/price-list.engine.ts.
  pricePercent?: number;
  perProductPricePercents?: Record<string, number>;
  // Per-collection % of base (price-list precedence: between product% and catalog%).
  perCollectionPricePercents?: Record<string, number>;
  // Variant-level overrides (most specific — win over product-level).
  perVariantOverrideBasePrices?: Record<string, number>;
  perVariantPricePercents?: Record<string, number>;
  perVariantFloorPercents?: Record<string, number>;
  perVariantTierPrices?: Record<string, Array<{ minQuantity: number; unitPrice: number }>>;
  perProductFloorPercents?: Record<string, number>;
  perProductAllowZeroFinalPrice?: Record<string, boolean>;
  perProductOverrideBasePrices?: Record<string, number>;
  perProductTierPrices?: Record<string, Array<{ minQuantity: number; unitPrice: number }>>;
  perProductMinimumOrderQuantities?: Record<string, number>;
  perProductStepQuantities?: Record<string, number>;
  perProductMaximumOrderQuantities?: Record<string, number>;
  perCollectionMaximumOrderQuantities?: Record<string, number>;
}

// merge(base, delta) is dense: every map is present (possibly empty) and scalars
// are resolved. This is what the runtime reads after resolving a catalog.
export interface EffectiveCatalogPricingLayer {
  globalMinPricePercent: number;
  allowZeroFinalPrice: boolean;
  pricePercent: number | null;
  perProductPricePercents: Record<string, number>;
  perCollectionPricePercents: Record<string, number>;
  perVariantOverrideBasePrices: Record<string, number>;
  perVariantPricePercents: Record<string, number>;
  perVariantFloorPercents: Record<string, number>;
  perVariantTierPrices: Record<string, Array<{ minQuantity: number; unitPrice: number }>>;
  perProductFloorPercents: Record<string, number>;
  perProductAllowZeroFinalPrice: Record<string, boolean>;
  perProductOverrideBasePrices: Record<string, number>;
  perProductTierPrices: Record<string, Array<{ minQuantity: number; unitPrice: number }>>;
  perProductMinimumOrderQuantities: Record<string, number>;
  perProductStepQuantities: Record<string, number>;
  perProductMaximumOrderQuantities: Record<string, number>;
  perCollectionMaximumOrderQuantities: Record<string, number>;
}
