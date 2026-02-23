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

interface ProductVisibilityRuleInput {
  productId: string;
  visibilityMode: string;
  customerId?: string | null;
}

interface CouponSegmentRuleInput {
  code: string;
  allowedSegment: string;
}

interface MarginGuardFunctionConfigInput {
  b2bTag: string;
  globalMinPricePercent: number;
  allowZeroFinalPrice: boolean;
  allowStacking?: boolean;
  maxCombinedPercentOff?: number | null;
  productFloors: ProductFloorInput[];
  productTierPrices?: ProductTierPriceInput[];
  productVisibilityRules?: ProductVisibilityRuleInput[];
  couponSegmentRules?: CouponSegmentRuleInput[];
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

function normalizeCustomerId(customerId: string | null | undefined): string {
  return String(customerId ?? "").trim();
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
  const perProductVisibilityModes: Record<
    string,
    "B2B_ONLY" | "B2C_ONLY" | "CUSTOMER_ONLY"
  > = {};
  const perProductVisibilityCustomerIds: Record<string, string> = {};
  const couponSegmentRules: Record<string, "B2B" | "B2C" | "ALL"> = {};
  const normalizedB2BTag = config.b2bTag.trim() || "b2b";
  const productTierPrices = config.productTierPrices ?? [];
  const productVisibilityRules = config.productVisibilityRules ?? [];
  const rawCouponSegmentRules = config.couponSegmentRules ?? [];
  const allowStacking = config.allowStacking === true;
  const maxCombinedPercentOff = normalizePercentOrNull(
    config.maxCombinedPercentOff,
  );

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

  return {
    b2bTag: normalizedB2BTag,
    b2bTags: [normalizedB2BTag],
    globalMinPricePercent: config.globalMinPricePercent,
    b2bGlobalMinPricePercent: config.globalMinPricePercent,
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
    perProductVisibilityModes,
    perProductVisibilityCustomerIds,
    couponSegmentRules,
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
