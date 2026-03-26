interface ProductFloorInput {
  productId: string;
  minPercentOfBasePrice: number;
  segment: string | null;
  allowZeroFinalPrice: boolean | null;
  b2bOverridePrice?: number | null;
}

interface ProductTierPriceInput {
  productId: string;
  segment: string | null;
  minQuantity: number;
  unitPrice: number;
}

interface ProductQuantityRuleInput {
  productId: string;
  segment: string | null;
  minimumOrderQuantity: number;
  stepQuantity?: number | null;
  maxOrderQuantity?: number | null;
}

interface CollectionQuantityRuleInput {
  collectionId: string;
  segment: string | null;
  maxOrderQuantity?: number | null;
}

interface ProductCustomerQuantityRuleInput {
  productId: string;
  customerId: string;
  maxOrderQuantity: number;
}

interface ProductVisibilityRuleInput {
  productId: string;
  visibilityMode: string;
  customerId?: string | null;
}

interface CouponSegmentRuleInput {
  code: string;
  allowedSegment: string;
}

interface DiscountRuleInput {
  id: string;
  scope: string;
  targetId?: string | null;
  code?: string | null;
  segment: string | null;
  percentOff: number;
  priority: number;
  stackMode: string;
  minPricePercentOfBasePrice?: number | null;
}

interface DiscountCombinationBlacklistRuleInput {
  leftType: string;
  leftValue: string;
  rightType: string;
  rightValue: string;
  segment?: string | null;
}

interface DiscountSegmentCapInput {
  segment: string;
  maxCombinedPercentOff: number;
}

interface MarginGuardFunctionConfigInput {
  b2bTag: string;
  globalMinPricePercent: number;
  b2bGlobalMinPricePercent?: number;
  allowZeroFinalPrice: boolean;
  allowStacking?: boolean;
  maxCombinedPercentOff?: number | null;
  productFloors: ProductFloorInput[];
  productTierPrices?: ProductTierPriceInput[];
  productQuantityRules?: ProductQuantityRuleInput[];
  collectionQuantityRules?: CollectionQuantityRuleInput[];
  productCustomerQuantityRules?: ProductCustomerQuantityRuleInput[];
  productVisibilityRules?: ProductVisibilityRuleInput[];
  couponSegmentRules?: CouponSegmentRuleInput[];
  discountRules?: DiscountRuleInput[];
  discountCombinationBlacklistRules?: DiscountCombinationBlacklistRuleInput[];
  discountSegmentCaps?: DiscountSegmentCapInput[];
}

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

export function buildCartValidationFunctionConfig(
  config: MarginGuardFunctionConfigInput,
) {
  const perProductFloorPercentsB2C: Record<string, number> = {};
  const perProductFloorPercentsB2B: Record<string, number> = {};
  const perProductAllowZeroFinalPriceB2C: Record<string, boolean> = {};
  const perProductAllowZeroFinalPriceB2B: Record<string, boolean> = {};
  const perProductB2BOverridePrices: Record<string, number> = {};
  const perProductTierMapB2C: Record<string, Map<number, number>> = {};
  const perProductTierMapB2B: Record<string, Map<number, number>> = {};
  const perProductMinimumOrderQuantitiesB2C: Record<string, number> = {};
  const perProductMinimumOrderQuantitiesB2B: Record<string, number> = {};
  const perProductStepQuantitiesB2C: Record<string, number> = {};
  const perProductStepQuantitiesB2B: Record<string, number> = {};
  const perProductMaximumOrderQuantitiesB2C: Record<string, number> = {};
  const perProductMaximumOrderQuantitiesB2B: Record<string, number> = {};
  const perCollectionMaximumOrderQuantitiesB2C: Record<string, number> = {};
  const perCollectionMaximumOrderQuantitiesB2B: Record<string, number> = {};
  const perCustomerProductMaximumOrderQuantities: Record<
    string,
    Record<string, number>
  > = {};
  const perProductVisibilityModes: Record<
    string,
    "B2B_ONLY" | "B2C_ONLY" | "CUSTOMER_ONLY"
  > = {};
  const perProductVisibilityCustomerIds: Record<string, string> = {};
  const couponSegmentRules: Record<string, "B2B" | "B2C" | "ALL"> = {};
  const normalizedB2BTag = config.b2bTag.trim() || "b2b";
  const productTierPrices = config.productTierPrices ?? [];
  const productQuantityRules = config.productQuantityRules ?? [];
  const collectionQuantityRules = config.collectionQuantityRules ?? [];
  const productCustomerQuantityRules = config.productCustomerQuantityRules ?? [];
  const productVisibilityRules = config.productVisibilityRules ?? [];
  const rawCouponSegmentRules = config.couponSegmentRules ?? [];
  const rawDiscountRules = config.discountRules ?? [];
  const rawDiscountCombinationBlacklistRules =
    config.discountCombinationBlacklistRules ?? [];
  const rawDiscountSegmentCaps = config.discountSegmentCaps ?? [];
  const allowStacking = config.allowStacking === true;
  const maxCombinedPercentOff = normalizePercentOrNull(
    config.maxCombinedPercentOff,
  );
  const discountRules = [];
  const discountCombinationBlacklistRules = [];
  const discountSegmentCaps = [];

  for (const floor of config.productFloors) {
    const appliesToB2C = floor.segment == null || floor.segment === "B2C";
    const appliesToB2B = floor.segment == null || floor.segment === "B2B";

    if (appliesToB2C) {
      perProductFloorPercentsB2C[floor.productId] = floor.minPercentOfBasePrice;
      if (floor.allowZeroFinalPrice != null) {
        perProductAllowZeroFinalPriceB2C[floor.productId] =
          floor.allowZeroFinalPrice;
      }
    }

    if (appliesToB2B) {
      perProductFloorPercentsB2B[floor.productId] = floor.minPercentOfBasePrice;
      if (floor.allowZeroFinalPrice != null) {
        perProductAllowZeroFinalPriceB2B[floor.productId] =
          floor.allowZeroFinalPrice;
      }
      if (
        floor.b2bOverridePrice != null &&
        Number.isFinite(floor.b2bOverridePrice) &&
        floor.b2bOverridePrice >= 0
      ) {
        perProductB2BOverridePrices[floor.productId] = floor.b2bOverridePrice;
      }
    }
  }

  for (const tier of productTierPrices) {
    if (tier.segment != null) {
      continue;
    }
    const entry = normalizeTierEntry(tier.minQuantity, tier.unitPrice);
    if (!entry) {
      continue;
    }
    perProductTierMapB2C[tier.productId] ??= new Map();
    perProductTierMapB2B[tier.productId] ??= new Map();
    perProductTierMapB2C[tier.productId].set(entry.minQuantity, entry.unitPrice);
    perProductTierMapB2B[tier.productId].set(entry.minQuantity, entry.unitPrice);
  }

  for (const tier of productTierPrices) {
    if (tier.segment == null) {
      continue;
    }
    const entry = normalizeTierEntry(tier.minQuantity, tier.unitPrice);
    if (!entry) {
      continue;
    }
    if (tier.segment === "B2C") {
      perProductTierMapB2C[tier.productId] ??= new Map();
      perProductTierMapB2C[tier.productId].set(entry.minQuantity, entry.unitPrice);
    }
    if (tier.segment === "B2B") {
      perProductTierMapB2B[tier.productId] ??= new Map();
      perProductTierMapB2B[tier.productId].set(entry.minQuantity, entry.unitPrice);
    }
  }

  const perProductTierPricesB2C = sortTierMap(perProductTierMapB2C);
  const perProductTierPricesB2B = sortTierMap(perProductTierMapB2B);

  for (const rule of productQuantityRules) {
    if (rule.segment != null) {
      continue;
    }
    const productId = rule.productId.trim();
    const minimumOrderQuantity = normalizeMinimumOrderQuantity(
      rule.minimumOrderQuantity,
    );
    const stepQuantity = normalizeStepQuantity(rule.stepQuantity);
    const maxOrderQuantity = normalizeMaximumOrderQuantity(rule.maxOrderQuantity);
    if (
      !productId ||
      (minimumOrderQuantity == null &&
        stepQuantity == null &&
        maxOrderQuantity == null)
    ) {
      continue;
    }
    if (minimumOrderQuantity != null) {
      perProductMinimumOrderQuantitiesB2C[productId] = minimumOrderQuantity;
      perProductMinimumOrderQuantitiesB2B[productId] = minimumOrderQuantity;
    }
    if (stepQuantity != null) {
      perProductStepQuantitiesB2C[productId] = stepQuantity;
      perProductStepQuantitiesB2B[productId] = stepQuantity;
    }
    if (maxOrderQuantity != null) {
      perProductMaximumOrderQuantitiesB2C[productId] = maxOrderQuantity;
      perProductMaximumOrderQuantitiesB2B[productId] = maxOrderQuantity;
    }
  }

  for (const rule of productQuantityRules) {
    if (rule.segment == null) {
      continue;
    }
    const productId = rule.productId.trim();
    const minimumOrderQuantity = normalizeMinimumOrderQuantity(
      rule.minimumOrderQuantity,
    );
    const stepQuantity = normalizeStepQuantity(rule.stepQuantity);
    const maxOrderQuantity = normalizeMaximumOrderQuantity(rule.maxOrderQuantity);
    if (
      !productId ||
      (minimumOrderQuantity == null &&
        stepQuantity == null &&
        maxOrderQuantity == null)
    ) {
      continue;
    }
    if (rule.segment === "B2C") {
      if (minimumOrderQuantity != null) {
        perProductMinimumOrderQuantitiesB2C[productId] = minimumOrderQuantity;
      }
      if (stepQuantity != null) {
        perProductStepQuantitiesB2C[productId] = stepQuantity;
      }
      if (maxOrderQuantity != null) {
        perProductMaximumOrderQuantitiesB2C[productId] = maxOrderQuantity;
      }
    }
    if (rule.segment === "B2B") {
      if (minimumOrderQuantity != null) {
        perProductMinimumOrderQuantitiesB2B[productId] = minimumOrderQuantity;
      }
      if (stepQuantity != null) {
        perProductStepQuantitiesB2B[productId] = stepQuantity;
      }
      if (maxOrderQuantity != null) {
        perProductMaximumOrderQuantitiesB2B[productId] = maxOrderQuantity;
      }
    }
  }

  for (const rule of collectionQuantityRules) {
    if (rule.segment != null) {
      continue;
    }
    const collectionId = normalizeCollectionId(rule.collectionId);
    const maxOrderQuantity = normalizeMaximumOrderQuantity(rule.maxOrderQuantity);
    if (collectionId == null || maxOrderQuantity == null) {
      continue;
    }
    perCollectionMaximumOrderQuantitiesB2C[collectionId] = maxOrderQuantity;
    perCollectionMaximumOrderQuantitiesB2B[collectionId] = maxOrderQuantity;
  }

  for (const rule of collectionQuantityRules) {
    if (rule.segment == null) {
      continue;
    }
    const collectionId = normalizeCollectionId(rule.collectionId);
    const maxOrderQuantity = normalizeMaximumOrderQuantity(rule.maxOrderQuantity);
    if (collectionId == null || maxOrderQuantity == null) {
      continue;
    }
    if (rule.segment === "B2C") {
      perCollectionMaximumOrderQuantitiesB2C[collectionId] = maxOrderQuantity;
    }
    if (rule.segment === "B2B") {
      perCollectionMaximumOrderQuantitiesB2B[collectionId] = maxOrderQuantity;
    }
  }

  for (const rule of productCustomerQuantityRules) {
    const productId = rule.productId.trim();
    const customerId = normalizeCustomerId(rule.customerId);
    const maxOrderQuantity = normalizeMaximumOrderQuantity(rule.maxOrderQuantity);
    if (!productId || !customerId || maxOrderQuantity == null) {
      continue;
    }
    perCustomerProductMaximumOrderQuantities[customerId] ??= {};
    perCustomerProductMaximumOrderQuantities[customerId][productId] = maxOrderQuantity;
  }

  for (const rule of productVisibilityRules) {
    const productId = rule.productId.trim();
    if (!productId) {
      continue;
    }
    const visibilityMode = normalizeVisibilityMode(rule.visibilityMode);
    if (visibilityMode === "ALL") {
      delete perProductVisibilityModes[productId];
      delete perProductVisibilityCustomerIds[productId];
      continue;
    }
    if (visibilityMode === "CUSTOMER_ONLY") {
      const customerId = normalizeCustomerId(rule.customerId);
      if (!customerId) {
        continue;
      }
      perProductVisibilityModes[productId] = "CUSTOMER_ONLY";
      perProductVisibilityCustomerIds[productId] = customerId;
      continue;
    }
    perProductVisibilityModes[productId] = visibilityMode;
    delete perProductVisibilityCustomerIds[productId];
  }

  for (const rule of rawCouponSegmentRules) {
    const normalizedCode = normalizeCouponCode(rule.code);
    if (!normalizedCode) {
      continue;
    }
    couponSegmentRules[normalizedCode] = normalizeAllowedSegment(
      rule.allowedSegment,
    );
  }

  for (const rule of rawDiscountRules) {
    const scope = normalizeDiscountRuleScope(rule.scope);
    const segment =
      rule.segment === "B2B" || rule.segment === "B2C" ? rule.segment : null;
    const percentOff = normalizePercentOrNull(rule.percentOff);
    const minPricePercentOfBasePrice = normalizePercentOrNull(
      rule.minPricePercentOfBasePrice,
    );
    if (percentOff == null || percentOff <= 0) {
      continue;
    }
    let targetId = rule.targetId ? String(rule.targetId).trim() : null;
    let code = rule.code ? normalizeCouponCode(rule.code) : null;
    if (scope === "COLLECTION") {
      targetId = normalizeCollectionId(targetId);
    }
    if (scope === "GLOBAL") {
      targetId = null;
      code = null;
    }
    if (scope === "COUPON") {
      code = normalizeCouponCode(String(rule.code ?? rule.targetId ?? ""));
      targetId = null;
      if (!code) {
        continue;
      }
    }
    if ((scope === "PRODUCT" || scope === "COLLECTION") && !targetId) {
      continue;
    }
    discountRules.push({
      id: String(rule.id ?? "").trim(),
      scope,
      targetId,
      code,
      segment,
      percentOff,
      priority: Number.isFinite(rule.priority) ? Math.floor(rule.priority) : 100,
      stackMode: normalizeDiscountStackMode(rule.stackMode),
      minPricePercentOfBasePrice,
    });
  }

  for (const rule of rawDiscountCombinationBlacklistRules) {
    const leftType = normalizeDiscountReferenceType(rule.leftType);
    const rightType = normalizeDiscountReferenceType(rule.rightType);
    const leftValue = String(rule.leftValue ?? "").trim();
    const rightValue = String(rule.rightValue ?? "").trim();
    if (!leftValue || !rightValue) {
      continue;
    }
    discountCombinationBlacklistRules.push({
      leftType,
      leftValue: leftType === "COUPON_CODE" ? normalizeCouponCode(leftValue) : leftValue,
      rightType,
      rightValue:
        rightType === "COUPON_CODE" ? normalizeCouponCode(rightValue) : rightValue,
      segment:
        rule.segment === "B2B" || rule.segment === "B2C" || rule.segment === "ALL"
          ? rule.segment
          : null,
    });
  }

  for (const cap of rawDiscountSegmentCaps) {
    const maxPercent = normalizePercentOrNull(cap.maxCombinedPercentOff);
    if (maxPercent == null) {
      continue;
    }
    discountSegmentCaps.push({
      segment:
        cap.segment === "B2B" || cap.segment === "B2C" ? cap.segment : "ALL",
      maxCombinedPercentOff: maxPercent,
    });
  }

  const collectionIds = Array.from(
    new Set([
      ...Object.keys(perCollectionMaximumOrderQuantitiesB2C),
      ...Object.keys(perCollectionMaximumOrderQuantitiesB2B),
      ...discountRules
        .filter((rule) => rule.scope === "COLLECTION" && rule.targetId)
        .map((rule) => rule.targetId),
    ]),
  ).sort();
  const b2bGlobalMinPricePercent =
    config.b2bGlobalMinPricePercent != null
      ? config.b2bGlobalMinPricePercent
      : config.globalMinPricePercent;

  return {
    b2bTag: normalizedB2BTag,
    b2bTags: [normalizedB2BTag],
    collectionIds,
    globalMinPricePercent: config.globalMinPricePercent,
    b2bGlobalMinPricePercent,
    allowZeroFinalPrice: config.allowZeroFinalPrice,
    allowStacking,
    maxCombinedPercentOff,
    perProductFloorPercentsB2C,
    perProductFloorPercentsB2B,
    perProductAllowZeroFinalPriceB2C,
    perProductAllowZeroFinalPriceB2B,
    perProductB2BOverridePrices,
    perProductTierPricesB2C,
    perProductTierPricesB2B,
    perProductMinimumOrderQuantitiesB2C,
    perProductMinimumOrderQuantitiesB2B,
    perProductStepQuantitiesB2C,
    perProductStepQuantitiesB2B,
    perProductMaximumOrderQuantitiesB2C,
    perProductMaximumOrderQuantitiesB2B,
    perCollectionMaximumOrderQuantitiesB2C,
    perCollectionMaximumOrderQuantitiesB2B,
    perCustomerProductMaximumOrderQuantities,
    perProductVisibilityModes,
    perProductVisibilityCustomerIds,
    couponSegmentRules,
    discountRules,
    discountCombinationBlacklistRules,
    discountSegmentCaps,
  };
}

export function buildDiscountFunctionConfig(
  config: MarginGuardFunctionConfigInput,
) {
  return {
    ...buildCartValidationFunctionConfig(config),
    requestedPercentOff: 100,
  };
}
