
interface TierPriceEntry {
  minQuantity: number;
  unitPrice: number;
}

function normalizeTierEntry(
  minQuantity: unknown,
  unitPrice: unknown,
): TierPriceEntry | null {
  const parsedMinQuantity = Number(minQuantity);
  const parsedUnitPrice = Number(unitPrice);
  if (
    !Number.isFinite(parsedMinQuantity) ||
    !Number.isFinite(parsedUnitPrice) ||
    parsedMinQuantity < 1 ||
    parsedUnitPrice < 0
  ) {
    return null;
  }

  return {
    minQuantity: Math.floor(parsedMinQuantity),
    unitPrice: Math.round(parsedUnitPrice * 100) / 100,
  };
}

function sortTierMap(
  map: Record<string, Map<number, number>>,
): Record<string, TierPriceEntry[]> {
  const result: Record<string, TierPriceEntry[]> = {};
  for (const [productId, quantityMap] of Object.entries(map)) {
    const tiers = Array.from(quantityMap.entries())
      .map(([minQuantity, unitPrice]) => ({ minQuantity, unitPrice }))
      .sort((a, b) => a.minQuantity - b.minQuantity);
    if (tiers.length > 0) {
      result[productId] = tiers;
    }
  }

  return result;
}

function normalizeCouponCode(code: string): string {
  return code.trim().toUpperCase();
}

function normalizeAllowedSegment(value: string): "B2B" | "B2C" | "ALL" {
  if (value === "B2B" || value === "B2C") {
    return value;
  }
  return "ALL";
}

function normalizeVisibilityMode(
  value: string,
): "ALL" | "B2B_ONLY" | "B2C_ONLY" | "CUSTOMER_ONLY" {
  if (value === "B2B_ONLY" || value === "B2C_ONLY" || value === "CUSTOMER_ONLY") {
    return value;
  }
  return "ALL";
}

function normalizeDiscountRuleScope(
  value: string,
): "GLOBAL" | "COLLECTION" | "PRODUCT" | "COUPON" {
  if (
    value === "GLOBAL" ||
    value === "COLLECTION" ||
    value === "PRODUCT" ||
    value === "COUPON"
  ) {
    return value;
  }
  return "GLOBAL";
}

function normalizeDiscountStackMode(
  value: string,
): "STACKABLE" | "EXCLUSIVE" | "NEVER_WITH_COUPONS" {
  if (
    value === "STACKABLE" ||
    value === "EXCLUSIVE" ||
    value === "NEVER_WITH_COUPONS"
  ) {
    return value;
  }
  return "STACKABLE";
}

function normalizeDiscountReferenceType(
  value: string,
): "RULE_ID" | "COUPON_CODE" | "SCOPE" {
  if (value === "RULE_ID" || value === "COUPON_CODE" || value === "SCOPE") {
    return value;
  }
  return "COUPON_CODE";
}

function normalizeCustomerId(customerId: string | null | undefined): string {
  return String(customerId ?? "").trim();
}

function normalizeLoyaltyTag(value: string | null | undefined): string | null {
  const normalized = String(value ?? "").trim();
  return normalized || null;
}

function normalizeCollectionId(collectionId: string | null | undefined): string | null {
  const normalized = String(collectionId ?? "").trim();
  if (!normalized) {
    return null;
  }
  if (normalized.startsWith("gid://shopify/Collection/")) {
    return normalized;
  }
  if (/^\d+$/.test(normalized)) {
    return `gid://shopify/Collection/${normalized}`;
  }
  return null;
}

function clampPercent(value: number): number {
  return Math.min(100, Math.max(0, value));
}

function normalizePercentOrNull(value: unknown): number | null {
  if (value == null) {
    return null;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return null;
  }
  return Math.round(clampPercent(parsed) * 100) / 100;
}

function normalizeMinimumOrderQuantity(
  value: unknown,
): number | null {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return null;
  }
  return Math.floor(parsed);
}

function normalizeStepQuantity(
  value: unknown,
): number | null {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 1) {
    return null;
  }
  return Math.floor(parsed);
}

function normalizeMaximumOrderQuantity(value: unknown): number | null {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return null;
  }
  return Math.floor(parsed);
}

const DEFAULT_CATALOG_ID = "default";

export interface CustomCatalogPriceRuleInput {
  scope: string;
  targetId?: string | null;
  mode: string;
  value: number;
}

export interface CustomCatalogInput {
  id: string;
  priority: number;
  matchCompany?: boolean;
  segment?: "B2B" | "B2C";
  audienceTags?: string[];
  marketFilters?: Array<{
    countryCode?: string | null;
    currencyCode?: string | null;
    languageCode?: string | null;
  }>;
  floorDefaultPercent?: number | null;
  floorDefaultAllowZero?: boolean | null;
  perProductFloors?: Array<{
    productId: string;
    minPercentOfBasePrice: number;
    allowZeroFinalPrice?: boolean | null;
  }>;
  perVariantFloors?: Array<{
    variantId: string;
    minPercentOfBasePrice: number;
    allowZeroFinalPrice?: boolean | null;
  }>;
  priceRules?: CustomCatalogPriceRuleInput[];
  tierPrices?: Array<{ productId: string; minQuantity: number; unitPrice: number }>;
  variantTierPrices?: Array<{ variantId: string; minQuantity: number; unitPrice: number }>;
  quantityRules?: Array<{
    productId?: string | null;
    collectionId?: string | null;
    moq?: number | null;
    step?: number | null;
    max?: number | null;
  }>;
  discountRules?: Array<{
    scope: string;
    targetId?: string | null;
    code?: string | null;
    percentOff: number;
    priority?: number;
    stackMode?: string;
    minPricePercentOfBasePrice?: number | null;
  }>;
  // Cross-cutting policy (MVP_5_3 #2.0b–e), catalog-native.
  coupons?: string[];
  discountCapPercent?: number | null;
  blacklist?: Array<{
    leftType: string;
    leftValue: string;
    rightType: string;
    rightValue: string;
  }>;
  customerQuantity?: Array<{
    customerId: string;
    productId: string;
    maxOrderQuantity: number;
  }>;
}

function customCatalogToDelta(catalog: CustomCatalogInput): Record<string, unknown> {
  const delta: Record<string, unknown> = {};
  if (catalog.floorDefaultPercent != null) {
    delta.globalMinPricePercent = clampPercent(catalog.floorDefaultPercent);
  }
  if (catalog.floorDefaultAllowZero != null) {
    delta.allowZeroFinalPrice = catalog.floorDefaultAllowZero;
  }

  const perProductFloorPercents: Record<string, number> = {};
  const perProductAllowZeroFinalPrice: Record<string, boolean> = {};
  for (const floor of catalog.perProductFloors ?? []) {
    const productId = String(floor.productId ?? "").trim();
    if (!productId) continue;
    perProductFloorPercents[productId] = clampPercent(floor.minPercentOfBasePrice);
    if (floor.allowZeroFinalPrice != null) {
      perProductAllowZeroFinalPrice[productId] = floor.allowZeroFinalPrice;
    }
  }

  const perProductOverrideBasePrices: Record<string, number> = {};
  const perProductPricePercents: Record<string, number> = {};
  const perCollectionPricePercents: Record<string, number> = {};
  const perVariantOverrideBasePrices: Record<string, number> = {};
  const perVariantPricePercents: Record<string, number> = {};
  for (const rule of catalog.priceRules ?? []) {
    const value = Number(rule.value);
    if (!Number.isFinite(value) || value < 0) continue;
    const targetId = String(rule.targetId ?? "").trim();
    if (rule.mode === "FIXED" && rule.scope === "VARIANT" && targetId) {
      perVariantOverrideBasePrices[targetId] = Math.round(value * 100) / 100;
    } else if (rule.mode === "PERCENT" && rule.scope === "VARIANT" && targetId) {
      perVariantPricePercents[targetId] = value;
    } else if (rule.mode === "FIXED" && rule.scope === "PRODUCT" && targetId) {
      perProductOverrideBasePrices[targetId] = Math.round(value * 100) / 100;
    } else if (rule.mode === "PERCENT" && rule.scope === "PRODUCT" && targetId) {
      perProductPricePercents[targetId] = value;
    } else if (rule.mode === "PERCENT" && rule.scope === "COLLECTION") {
      const collectionId = normalizeCollectionId(targetId);
      if (collectionId) perCollectionPricePercents[collectionId] = value;
    } else if (rule.mode === "PERCENT" && rule.scope === "CATALOG") {
      delta.pricePercent = value;
    }
  }

  const perVariantFloorPercents: Record<string, number> = {};
  for (const floor of catalog.perVariantFloors ?? []) {
    const variantId = String(floor.variantId ?? "").trim();
    if (!variantId) continue;
    perVariantFloorPercents[variantId] = clampPercent(floor.minPercentOfBasePrice);
  }

  const variantTierMap: Record<string, Map<number, number>> = {};
  for (const tier of catalog.variantTierPrices ?? []) {
    const variantId = String(tier.variantId ?? "").trim();
    const entry = normalizeTierEntry(tier.minQuantity, tier.unitPrice);
    if (!variantId || !entry) continue;
    variantTierMap[variantId] ??= new Map();
    variantTierMap[variantId].set(entry.minQuantity, entry.unitPrice);
  }
  const perVariantTierPrices = sortTierMap(variantTierMap);

  const tierMap: Record<string, Map<number, number>> = {};
  for (const tier of catalog.tierPrices ?? []) {
    const productId = String(tier.productId ?? "").trim();
    const entry = normalizeTierEntry(tier.minQuantity, tier.unitPrice);
    if (!productId || !entry) continue;
    tierMap[productId] ??= new Map();
    tierMap[productId].set(entry.minQuantity, entry.unitPrice);
  }
  const perProductTierPrices = sortTierMap(tierMap);

  const perProductMinimumOrderQuantities: Record<string, number> = {};
  const perProductStepQuantities: Record<string, number> = {};
  const perProductMaximumOrderQuantities: Record<string, number> = {};
  const perCollectionMaximumOrderQuantities: Record<string, number> = {};
  for (const rule of catalog.quantityRules ?? []) {
    const productId = String(rule.productId ?? "").trim();
    const collectionId = normalizeCollectionId(rule.collectionId);
    const moq = normalizeMinimumOrderQuantity(rule.moq);
    const step = normalizeStepQuantity(rule.step);
    const max = normalizeMaximumOrderQuantity(rule.max);
    if (productId) {
      if (moq != null) perProductMinimumOrderQuantities[productId] = moq;
      if (step != null) perProductStepQuantities[productId] = step;
      if (max != null) perProductMaximumOrderQuantities[productId] = max;
    } else if (collectionId && max != null) {
      perCollectionMaximumOrderQuantities[collectionId] = max;
    }
  }

  const assignIfAny = (key: string, map: Record<string, unknown>) => {
    if (Object.keys(map).length > 0) delta[key] = map;
  };
  assignIfAny("perProductFloorPercents", perProductFloorPercents);
  assignIfAny("perProductAllowZeroFinalPrice", perProductAllowZeroFinalPrice);
  assignIfAny("perProductOverrideBasePrices", perProductOverrideBasePrices);
  assignIfAny("perProductPricePercents", perProductPricePercents);
  assignIfAny("perCollectionPricePercents", perCollectionPricePercents);
  assignIfAny("perVariantOverrideBasePrices", perVariantOverrideBasePrices);
  assignIfAny("perVariantPricePercents", perVariantPricePercents);
  assignIfAny("perVariantFloorPercents", perVariantFloorPercents);
  assignIfAny("perVariantTierPrices", perVariantTierPrices);
  assignIfAny("perProductTierPrices", perProductTierPrices);
  assignIfAny("perProductMinimumOrderQuantities", perProductMinimumOrderQuantities);
  assignIfAny("perProductStepQuantities", perProductStepQuantities);
  assignIfAny("perProductMaximumOrderQuantities", perProductMaximumOrderQuantities);
  assignIfAny("perCollectionMaximumOrderQuantities", perCollectionMaximumOrderQuantities);

  return delta;
}

function customCatalogDiscountRules(catalog: CustomCatalogInput) {
  const rules = [];
  let index = 0;
  for (const rule of catalog.discountRules ?? []) {
    const scope = normalizeDiscountRuleScope(rule.scope);
    const percentOff = normalizePercentOrNull(rule.percentOff);
    if (percentOff == null || percentOff <= 0) continue;
    let targetId = rule.targetId ? String(rule.targetId).trim() : null;
    let code = rule.code ? normalizeCouponCode(rule.code) : null;
    if (scope === "COLLECTION") targetId = normalizeCollectionId(targetId);
    if (scope === "GLOBAL") {
      targetId = null;
      code = null;
    }
    if (scope === "COUPON") {
      code = normalizeCouponCode(String(rule.code ?? rule.targetId ?? ""));
      targetId = null;
      if (!code) continue;
    }
    if ((scope === "PRODUCT" || scope === "COLLECTION") && !targetId) continue;
    rules.push({
      id: `${catalog.id}-disc-${index++}`,
      scope,
      targetId,
      code,
      segment: null as string | null,
      percentOff,
      priority: Number.isFinite(rule.priority) ? Math.floor(Number(rule.priority)) : 100,
      stackMode: normalizeDiscountStackMode(rule.stackMode ?? "STACKABLE"),
      minPricePercentOfBasePrice: normalizePercentOrNull(rule.minPricePercentOfBasePrice),
      requiredCustomerTag: null as string | null,
      catalogId: catalog.id,
    });
  }
  return rules;
}


// ---------------------------------------------------------------------------
// MVP_5_3 #2.2 — catalog-native builder: the config is assembled from catalog
// table rows ONLY (default catalog = base; b2b/custom inherit). The legacy
// MarginGuardConfig contributes only shop-wide scalars. Produces the same shape
// the functions already consume, so no runtime change is needed.
// ---------------------------------------------------------------------------

export interface CatalogTableInput extends CustomCatalogInput {
  isDefault?: boolean;
}

export interface CatalogShopScalars {
  b2bTag: string;
  globalMinPricePercent: number;
  allowZeroFinalPrice: boolean;
  allowStacking?: boolean;
  maxCombinedPercentOff?: number | null;
  marginGuardEnabled?: boolean;
}

export function buildCatalogConfigFromCatalogs(
  shop: CatalogShopScalars,
  catalogs: CatalogTableInput[],
) {
  const b2bTag = String(shop.b2bTag ?? "b2b").trim() || "b2b";
  const defaultCatalog = catalogs.find((catalog) => catalog.isDefault) ?? null;
  const defaultId = defaultCatalog ? defaultCatalog.id : DEFAULT_CATALOG_ID;

  const defaultDelta = defaultCatalog ? customCatalogToDelta(defaultCatalog) : {};
  const base: Record<string, unknown> = {
    ...defaultDelta,
    globalMinPricePercent:
      (defaultDelta.globalMinPricePercent as number | undefined) ??
      shop.globalMinPricePercent ??
      70,
    allowZeroFinalPrice:
      (defaultDelta.allowZeroFinalPrice as boolean | undefined) ??
      shop.allowZeroFinalPrice === true,
  };

  const catalogsOut: Record<string, Record<string, unknown>> = { [defaultId]: {} };
  const resolution: Array<Record<string, unknown>> = [
    {
      id: defaultId,
      priority: defaultCatalog?.priority ?? 0,
      isDefault: true,
      audienceTags: [] as string[],
      matchCompany: defaultCatalog?.matchCompany === true,
      marketFilters: [] as Array<Record<string, unknown>>,
      segment: "B2C",
    },
  ];
  const catalogTags: string[] = [];
  const couponCatalogRules: Record<string, string[]> = {};
  const discountCatalogCaps: Record<string, number> = {};
  const blacklistOut: Array<Record<string, unknown>> = [];
  const discountRulesOut: Array<Record<string, unknown>> = [];
  const customerQuantity: Record<string, Record<string, number>> = {};
  const collectionIds = new Set<string>();
  let shopCap: number | null = shop.maxCombinedPercentOff ?? null;

  const applyCrossCutting = (catalog: CatalogTableInput, isDefaultCatalog: boolean) => {
    for (const rawCode of catalog.coupons ?? []) {
      const code = normalizeCouponCode(rawCode);
      // Default-catalog coupons are shop-wide (no restriction); only non-default
      // catalogs restrict a coupon to themselves.
      if (code && !isDefaultCatalog) (couponCatalogRules[code] ??= []).push(catalog.id);
    }
    const cap = normalizePercentOrNull(catalog.discountCapPercent);
    if (cap != null) {
      if (isDefaultCatalog) shopCap = cap;
      else discountCatalogCaps[catalog.id] = cap;
    }
    for (const rule of catalog.blacklist ?? []) {
      const leftValue = String(rule.leftValue ?? "").trim();
      const rightValue = String(rule.rightValue ?? "").trim();
      if (!leftValue || !rightValue) continue;
      blacklistOut.push({
        leftType: rule.leftType,
        leftValue: rule.leftType === "COUPON_CODE" ? normalizeCouponCode(leftValue) : leftValue,
        rightType: rule.rightType,
        rightValue: rule.rightType === "COUPON_CODE" ? normalizeCouponCode(rightValue) : rightValue,
        segment: null as string | null,
        catalogId: isDefaultCatalog ? null : catalog.id,
      });
    }
    for (const rule of catalog.customerQuantity ?? []) {
      const customerId = String(rule.customerId ?? "").trim();
      const productId = String(rule.productId ?? "").trim();
      const max = normalizeMaximumOrderQuantity(rule.maxOrderQuantity);
      if (!customerId || !productId || max == null) continue;
      (customerQuantity[customerId] ??= {})[productId] = max;
    }
    for (const rule of customCatalogDiscountRules(catalog)) {
      discountRulesOut.push({ ...rule, catalogId: isDefaultCatalog ? null : catalog.id });
      if (rule.scope === "COLLECTION" && rule.targetId) collectionIds.add(String(rule.targetId));
    }
    for (const rule of catalog.priceRules ?? []) {
      if (rule.scope === "COLLECTION" && rule.targetId) {
        const normalized = normalizeCollectionId(rule.targetId);
        if (normalized) collectionIds.add(normalized);
      }
    }
    for (const rule of catalog.quantityRules ?? []) {
      const normalized = normalizeCollectionId(rule.collectionId);
      if (normalized) collectionIds.add(normalized);
    }
  };

  if (defaultCatalog) applyCrossCutting(defaultCatalog, true);

  for (const catalog of catalogs) {
    if (catalog.isDefault) continue;
    catalogsOut[catalog.id] = customCatalogToDelta(catalog);
    const audienceTags = Array.from(
      new Set(
        (catalog.audienceTags ?? [])
          .map((tag) => String(tag).trim().toLowerCase())
          .filter(Boolean),
      ),
    );
    resolution.push({
      id: catalog.id,
      priority: Number.isFinite(catalog.priority) ? Math.floor(catalog.priority) : 0,
      isDefault: false,
      audienceTags,
      matchCompany: catalog.matchCompany === true,
      marketFilters: (catalog.marketFilters ?? []).map((filter) => ({
        countryCode: filter.countryCode ?? null,
        currencyCode: filter.currencyCode ?? null,
        languageCode: filter.languageCode ?? null,
      })),
      segment: catalog.segment === "B2B" ? "B2B" : "B2C",
    });
    for (const tag of audienceTags) catalogTags.push(tag);
    applyCrossCutting(catalog, false);
  }

  return {
    defaultCatalogId: defaultId,
    catalogResolution: resolution,
    catalogTags: Array.from(new Set([b2bTag, ...catalogTags])),
    base,
    catalogs: catalogsOut,
    b2bTag,
    b2bTags: [b2bTag],
    loyaltyTags: [] as string[],
    collectionIds: Array.from(collectionIds).sort(),
    allowStacking: shop.allowStacking === true,
    maxCombinedPercentOff: shopCap,
    perCustomerProductMaximumOrderQuantities: customerQuantity,
    perProductVisibilityModes: {} as Record<string, unknown>,
    perProductVisibilityCustomerIds: {} as Record<string, string>,
    couponSegmentRules: {} as Record<string, string>,
    couponCatalogRules,
    discountCatalogCaps,
    discountRules: discountRulesOut,
    discountCombinationBlacklistRules: blacklistOut,
    discountSegmentCaps: [] as Array<Record<string, unknown>>,
    requestedPercentOff: 100,
    marginGuardEnabled: shop.marginGuardEnabled !== false,
  };
}
