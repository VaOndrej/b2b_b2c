interface ProductFloorInput {
  productId: string;
  minPercentOfBasePrice: number;
  segment: string | null;
  allowZeroFinalPrice: boolean | null;
  b2bOverridePrice?: number | null;
}

interface MarginGuardFunctionConfigInput {
  b2bTag: string;
  globalMinPricePercent: number;
  allowZeroFinalPrice: boolean;
  productFloors: ProductFloorInput[];
}

export function buildCartValidationFunctionConfig(
  config: MarginGuardFunctionConfigInput,
) {
  const perProductFloorPercentsB2C: Record<string, number> = {};
  const perProductFloorPercentsB2B: Record<string, number> = {};
  const perProductAllowZeroFinalPriceB2C: Record<string, boolean> = {};
  const perProductAllowZeroFinalPriceB2B: Record<string, boolean> = {};
  const perProductB2BOverridePrices: Record<string, number> = {};
  const normalizedB2BTag = config.b2bTag.trim() || "b2b";

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

  return {
    b2bTag: normalizedB2BTag,
    b2bTags: [normalizedB2BTag],
    globalMinPricePercent: config.globalMinPricePercent,
    b2bGlobalMinPricePercent: config.globalMinPricePercent,
    allowZeroFinalPrice: config.allowZeroFinalPrice,
    perProductFloorPercentsB2C,
    perProductFloorPercentsB2B,
    perProductAllowZeroFinalPriceB2C,
    perProductAllowZeroFinalPriceB2B,
    perProductB2BOverridePrices,
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
