import prisma from "../db.server";
import type { FloorRuleset } from "../../core/margin/floor.rules";

const DEFAULT_CONFIG_ID = "default";

function getMarginGuardPrismaOrThrow() {
  const client = prisma as any;
  if (
    !client.marginGuardConfig ||
    !client.productFloorRule ||
    !client.productTierPriceRule ||
    !client.productQuantityRule ||
    !client.collectionQuantityRule ||
    !client.productCustomerQuantityRule ||
    !client.productVisibilityRule ||
    !client.couponSegmentRule ||
    !client.marginViolationLog
  ) {
    throw new Error(
      "Prisma client is out of date for Margin Guard models. Run `npx prisma generate` and restart `shopify app dev`.",
    );
  }

  return client;
}

export async function getOrCreateMarginGuardConfig() {
  const db = getMarginGuardPrismaOrThrow();
  const existing = await db.marginGuardConfig.findUnique({
    where: { id: DEFAULT_CONFIG_ID },
    include: {
      productFloors: true,
      productTierPrices: true,
      productQuantityRules: true,
      collectionQuantityRules: true,
      productCustomerQuantityRules: true,
      productVisibilityRules: true,
      couponSegmentRules: true,
    },
  });

  if (existing) {
    return existing;
  }

  return db.marginGuardConfig.create({
    data: { id: DEFAULT_CONFIG_ID },
    include: {
      productFloors: true,
      productTierPrices: true,
      productQuantityRules: true,
      collectionQuantityRules: true,
      productCustomerQuantityRules: true,
      productVisibilityRules: true,
      couponSegmentRules: true,
    },
  });
}

export async function updateGlobalMarginGuardConfig(input: {
  b2bTag: string;
  globalMinPricePercent: number;
  allowZeroFinalPrice: boolean;
  allowRemoveAtMinimumOrderQuantity: boolean;
  allowStacking: boolean;
  maxCombinedPercentOff: number | null;
}) {
  const db = getMarginGuardPrismaOrThrow();
  return db.marginGuardConfig.upsert({
    where: { id: DEFAULT_CONFIG_ID },
    update: {
      b2bTag: input.b2bTag,
      globalMinPricePercent: input.globalMinPricePercent,
      allowZeroFinalPrice: input.allowZeroFinalPrice,
      allowRemoveAtMinimumOrderQuantity: input.allowRemoveAtMinimumOrderQuantity,
      allowStacking: input.allowStacking,
      maxCombinedPercentOff: input.maxCombinedPercentOff,
    },
    create: {
      id: DEFAULT_CONFIG_ID,
      b2bTag: input.b2bTag,
      globalMinPricePercent: input.globalMinPricePercent,
      allowZeroFinalPrice: input.allowZeroFinalPrice,
      allowRemoveAtMinimumOrderQuantity: input.allowRemoveAtMinimumOrderQuantity,
      allowStacking: input.allowStacking,
      maxCombinedPercentOff: input.maxCombinedPercentOff,
    },
    include: {
      productFloors: true,
      productTierPrices: true,
      productQuantityRules: true,
      collectionQuantityRules: true,
      productCustomerQuantityRules: true,
      productVisibilityRules: true,
      couponSegmentRules: true,
    },
  });
}

export async function upsertProductFloorRule(input: {
  productId: string;
  segment?: "B2B" | "B2C";
  minPercentOfBasePrice: number;
  allowZeroFinalPrice: boolean | null;
  b2bOverridePrice: number | null;
}) {
  const db = getMarginGuardPrismaOrThrow();
  const existing = await db.productFloorRule.findFirst({
    where: {
      configId: DEFAULT_CONFIG_ID,
      productId: input.productId,
      segment: input.segment ?? null,
    },
  });

  if (existing) {
    return db.productFloorRule.update({
      where: { id: existing.id },
      data: {
        minPercentOfBasePrice: input.minPercentOfBasePrice,
        allowZeroFinalPrice: input.allowZeroFinalPrice,
        b2bOverridePrice: input.b2bOverridePrice,
      },
    });
  }

  return db.productFloorRule.create({
    data: {
      configId: DEFAULT_CONFIG_ID,
      productId: input.productId,
      segment: input.segment,
      minPercentOfBasePrice: input.minPercentOfBasePrice,
      allowZeroFinalPrice: input.allowZeroFinalPrice,
      b2bOverridePrice: input.b2bOverridePrice,
    },
  });
}

export async function deleteProductFloorRule(id: string) {
  const db = getMarginGuardPrismaOrThrow();
  return db.productFloorRule.delete({ where: { id } });
}

export async function upsertProductTierPriceRule(input: {
  productId: string;
  segment?: "B2B" | "B2C";
  minQuantity: number;
  unitPrice: number;
}) {
  const db = getMarginGuardPrismaOrThrow();
  const normalizedMinQuantity = Math.max(1, Math.floor(input.minQuantity));
  const existing = await db.productTierPriceRule.findFirst({
    where: {
      configId: DEFAULT_CONFIG_ID,
      productId: input.productId,
      segment: input.segment ?? null,
      minQuantity: normalizedMinQuantity,
    },
  });

  if (existing) {
    return db.productTierPriceRule.update({
      where: { id: existing.id },
      data: {
        unitPrice: input.unitPrice,
      },
    });
  }

  return db.productTierPriceRule.create({
    data: {
      configId: DEFAULT_CONFIG_ID,
      productId: input.productId,
      segment: input.segment,
      minQuantity: normalizedMinQuantity,
      unitPrice: input.unitPrice,
    },
  });
}

export async function deleteProductTierPriceRule(id: string) {
  const db = getMarginGuardPrismaOrThrow();
  return db.productTierPriceRule.delete({ where: { id } });
}

export async function upsertProductQuantityRule(input: {
  productId: string;
  segment?: "B2B" | "B2C";
  minimumOrderQuantity: number;
}) {
  const db = getMarginGuardPrismaOrThrow();
  const normalizedMinimumOrderQuantity = Math.max(
    1,
    Math.floor(input.minimumOrderQuantity),
  );
  const existing = await db.productQuantityRule.findFirst({
    where: {
      configId: DEFAULT_CONFIG_ID,
      productId: input.productId,
      segment: input.segment ?? null,
    },
  });

  if (existing) {
    return db.productQuantityRule.update({
      where: { id: existing.id },
      data: {
        minimumOrderQuantity: normalizedMinimumOrderQuantity,
      },
    });
  }

  return db.productQuantityRule.create({
    data: {
      configId: DEFAULT_CONFIG_ID,
      productId: input.productId,
      segment: input.segment,
      minimumOrderQuantity: normalizedMinimumOrderQuantity,
      stepQuantity: null,
      maxOrderQuantity: null,
    },
  });
}

export async function deleteProductQuantityRule(id: string) {
  const db = getMarginGuardPrismaOrThrow();
  const existing = await db.productQuantityRule.findUnique({
    where: { id },
  });
  if (!existing) {
    return null;
  }

  if (
    (existing.stepQuantity != null && existing.stepQuantity > 1) ||
    (existing.maxOrderQuantity != null && existing.maxOrderQuantity > 0)
  ) {
    return db.productQuantityRule.update({
      where: { id },
      data: {
        minimumOrderQuantity: 1,
      },
    });
  }

  return db.productQuantityRule.delete({ where: { id } });
}

export async function upsertProductStepQuantityRule(input: {
  productId: string;
  segment?: "B2B" | "B2C";
  stepQuantity: number;
}) {
  const db = getMarginGuardPrismaOrThrow();
  const normalizedStepQuantity = Math.floor(input.stepQuantity);
  const stepQuantity =
    Number.isFinite(normalizedStepQuantity) && normalizedStepQuantity > 1
      ? normalizedStepQuantity
      : null;
  const existing = await db.productQuantityRule.findFirst({
    where: {
      configId: DEFAULT_CONFIG_ID,
      productId: input.productId,
      segment: input.segment ?? null,
    },
  });

  if (!stepQuantity) {
    if (!existing) {
      return null;
    }
    if (
      existing.minimumOrderQuantity > 1 ||
      (existing.maxOrderQuantity != null && existing.maxOrderQuantity > 0)
    ) {
      return db.productQuantityRule.update({
        where: { id: existing.id },
        data: {
          stepQuantity: null,
        },
      });
    }
    return db.productQuantityRule.delete({
      where: { id: existing.id },
    });
  }

  if (existing) {
    return db.productQuantityRule.update({
      where: { id: existing.id },
      data: {
        stepQuantity,
      },
    });
  }

  return db.productQuantityRule.create({
    data: {
      configId: DEFAULT_CONFIG_ID,
      productId: input.productId,
      segment: input.segment,
      minimumOrderQuantity: 1,
      stepQuantity,
      maxOrderQuantity: null,
    },
  });
}

export async function deleteProductStepQuantityRule(id: string) {
  const db = getMarginGuardPrismaOrThrow();
  const existing = await db.productQuantityRule.findUnique({
    where: { id },
  });
  if (!existing) {
    return null;
  }

  if (
    existing.minimumOrderQuantity > 1 ||
    (existing.maxOrderQuantity != null && existing.maxOrderQuantity > 0)
  ) {
    return db.productQuantityRule.update({
      where: { id },
      data: {
        stepQuantity: null,
      },
    });
  }

  return db.productQuantityRule.delete({ where: { id } });
}

export async function upsertProductMaximumQuantityRule(input: {
  productId: string;
  segment?: "B2B" | "B2C";
  maxOrderQuantity: number;
}) {
  const db = getMarginGuardPrismaOrThrow();
  const normalizedMaximumOrderQuantity = Math.floor(input.maxOrderQuantity);
  const maxOrderQuantity =
    Number.isFinite(normalizedMaximumOrderQuantity) &&
    normalizedMaximumOrderQuantity > 0
      ? normalizedMaximumOrderQuantity
      : null;
  const existing = await db.productQuantityRule.findFirst({
    where: {
      configId: DEFAULT_CONFIG_ID,
      productId: input.productId,
      segment: input.segment ?? null,
    },
  });

  if (!maxOrderQuantity) {
    if (!existing) {
      return null;
    }
    if (
      existing.minimumOrderQuantity > 1 ||
      (existing.stepQuantity != null && existing.stepQuantity > 1)
    ) {
      return db.productQuantityRule.update({
        where: { id: existing.id },
        data: {
          maxOrderQuantity: null,
        },
      });
    }
    return db.productQuantityRule.delete({
      where: { id: existing.id },
    });
  }

  if (existing) {
    return db.productQuantityRule.update({
      where: { id: existing.id },
      data: {
        maxOrderQuantity,
      },
    });
  }

  return db.productQuantityRule.create({
    data: {
      configId: DEFAULT_CONFIG_ID,
      productId: input.productId,
      segment: input.segment,
      minimumOrderQuantity: 1,
      stepQuantity: null,
      maxOrderQuantity,
    },
  });
}

export async function deleteProductMaximumQuantityRule(id: string) {
  const db = getMarginGuardPrismaOrThrow();
  const existing = await db.productQuantityRule.findUnique({
    where: { id },
  });
  if (!existing) {
    return null;
  }

  if (
    existing.minimumOrderQuantity > 1 ||
    (existing.stepQuantity != null && existing.stepQuantity > 1)
  ) {
    return db.productQuantityRule.update({
      where: { id },
      data: {
        maxOrderQuantity: null,
      },
    });
  }

  return db.productQuantityRule.delete({ where: { id } });
}

export async function upsertCollectionMaximumQuantityRule(input: {
  collectionId: string;
  segment?: "B2B" | "B2C";
  maxOrderQuantity: number;
}) {
  const db = getMarginGuardPrismaOrThrow();
  const collectionId = normalizeCollectionId(input.collectionId);
  const normalizedMaximumOrderQuantity = Math.floor(input.maxOrderQuantity);
  const maxOrderQuantity =
    Number.isFinite(normalizedMaximumOrderQuantity) &&
    normalizedMaximumOrderQuantity > 0
      ? normalizedMaximumOrderQuantity
      : null;
  if (!collectionId || !maxOrderQuantity) {
    return null;
  }

  const existing = await db.collectionQuantityRule.findFirst({
    where: {
      configId: DEFAULT_CONFIG_ID,
      collectionId,
      segment: input.segment ?? null,
    },
  });

  if (existing) {
    return db.collectionQuantityRule.update({
      where: { id: existing.id },
      data: {
        maxOrderQuantity,
      },
    });
  }

  return db.collectionQuantityRule.create({
    data: {
      configId: DEFAULT_CONFIG_ID,
      collectionId,
      segment: input.segment,
      maxOrderQuantity,
    },
  });
}

export async function deleteCollectionMaximumQuantityRule(id: string) {
  const db = getMarginGuardPrismaOrThrow();
  return db.collectionQuantityRule.delete({ where: { id } });
}

function normalizeVisibilityMode(
  value: string,
): "ALL" | "B2B_ONLY" | "B2C_ONLY" | "CUSTOMER_ONLY" {
  if (value === "B2B_ONLY" || value === "B2C_ONLY" || value === "CUSTOMER_ONLY") {
    return value;
  }
  return "ALL";
}

function normalizeCustomerId(value: string | null | undefined): string | null {
  const normalized = String(value ?? "").trim();
  return normalized || null;
}

function normalizeCollectionId(value: string | null | undefined): string | null {
  const normalized = String(value ?? "").trim();
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

export async function upsertProductCustomerMaximumQuantityRule(input: {
  productId: string;
  customerId: string;
  maxOrderQuantity: number;
}) {
  const db = getMarginGuardPrismaOrThrow();
  const productId = input.productId.trim();
  const customerId = normalizeCustomerId(input.customerId);
  const normalizedMaximumOrderQuantity = Math.floor(input.maxOrderQuantity);
  const maxOrderQuantity =
    Number.isFinite(normalizedMaximumOrderQuantity) &&
    normalizedMaximumOrderQuantity > 0
      ? normalizedMaximumOrderQuantity
      : null;
  if (!productId || !customerId || !maxOrderQuantity) {
    return null;
  }

  const existing = await db.productCustomerQuantityRule.findFirst({
    where: {
      configId: DEFAULT_CONFIG_ID,
      productId,
      customerId,
    },
  });

  if (existing) {
    return db.productCustomerQuantityRule.update({
      where: { id: existing.id },
      data: {
        maxOrderQuantity,
      },
    });
  }

  return db.productCustomerQuantityRule.create({
    data: {
      configId: DEFAULT_CONFIG_ID,
      productId,
      customerId,
      maxOrderQuantity,
    },
  });
}

export async function deleteProductCustomerMaximumQuantityRule(id: string) {
  const db = getMarginGuardPrismaOrThrow();
  return db.productCustomerQuantityRule.delete({ where: { id } });
}

export async function upsertProductVisibilityRule(input: {
  productId: string;
  visibilityMode: "ALL" | "B2B_ONLY" | "B2C_ONLY" | "CUSTOMER_ONLY";
  customerId?: string | null;
}) {
  const db = getMarginGuardPrismaOrThrow();
  const productId = input.productId.trim();
  if (!productId) {
    return null;
  }

  const visibilityMode = normalizeVisibilityMode(input.visibilityMode);
  const customerId =
    visibilityMode === "CUSTOMER_ONLY"
      ? normalizeCustomerId(input.customerId)
      : null;
  const existing = await db.productVisibilityRule.findFirst({
    where: {
      configId: DEFAULT_CONFIG_ID,
      productId,
    },
  });

  if (visibilityMode === "ALL") {
    if (existing) {
      await db.productVisibilityRule.delete({ where: { id: existing.id } });
    }
    return null;
  }

  if (visibilityMode === "CUSTOMER_ONLY" && !customerId) {
    return null;
  }

  if (existing) {
    return db.productVisibilityRule.update({
      where: { id: existing.id },
      data: {
        visibilityMode,
        customerId,
      },
    });
  }

  return db.productVisibilityRule.create({
    data: {
      configId: DEFAULT_CONFIG_ID,
      productId,
      visibilityMode,
      customerId,
    },
  });
}

export async function deleteProductVisibilityRule(id: string) {
  const db = getMarginGuardPrismaOrThrow();
  return db.productVisibilityRule.delete({ where: { id } });
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

export async function upsertCouponSegmentRule(input: {
  code: string;
  allowedSegment: "B2B" | "B2C" | "ALL";
}) {
  const db = getMarginGuardPrismaOrThrow();
  const normalizedCode = normalizeCouponCode(input.code);
  if (!normalizedCode) {
    return null;
  }
  const allowedSegment = normalizeAllowedSegment(input.allowedSegment);
  const existing = await db.couponSegmentRule.findFirst({
    where: {
      configId: DEFAULT_CONFIG_ID,
      code: normalizedCode,
    },
  });

  if (existing) {
    return db.couponSegmentRule.update({
      where: { id: existing.id },
      data: {
        allowedSegment,
      },
    });
  }

  return db.couponSegmentRule.create({
    data: {
      configId: DEFAULT_CONFIG_ID,
      code: normalizedCode,
      allowedSegment,
    },
  });
}

export async function deleteCouponSegmentRule(id: string) {
  const db = getMarginGuardPrismaOrThrow();
  return db.couponSegmentRule.delete({ where: { id } });
}

export async function listMarginViolationLogs(limit = 100) {
  const db = getMarginGuardPrismaOrThrow();
  return db.marginViolationLog.findMany({
    take: limit,
    orderBy: { createdAt: "desc" },
  });
}

export async function recordMarginViolation(input: {
  shop: string;
  productId: string;
  customerId?: string;
  segment: "B2B" | "B2C";
  basePrice: number;
  finalPrice: number;
  floorPrice: number;
  violationAmount: number;
  source: string;
}) {
  const db = getMarginGuardPrismaOrThrow();
  return db.marginViolationLog.create({
    data: {
      configId: DEFAULT_CONFIG_ID,
      shop: input.shop,
      productId: input.productId,
      customerId: input.customerId,
      segment: input.segment,
      basePrice: input.basePrice,
      finalPrice: input.finalPrice,
      floorPrice: input.floorPrice,
      violationAmount: input.violationAmount,
      source: input.source,
    },
  });
}

export function buildFloorRuleset(config: {
  globalMinPricePercent: number;
  allowZeroFinalPrice: boolean;
  productFloors: Array<{
    productId: string;
    segment: string | null;
    minPercentOfBasePrice: number;
    allowZeroFinalPrice: boolean | null;
    b2bOverridePrice?: number | null;
  }>;
}): FloorRuleset {
  return {
    global: {
      minPercentOfBasePrice: config.globalMinPricePercent,
      allowZeroFinalPrice: config.allowZeroFinalPrice,
    },
    perProduct: config.productFloors.map((rule) => ({
      productId: rule.productId,
      segment:
        rule.segment === "B2B" || rule.segment === "B2C"
          ? rule.segment
          : undefined,
      minPercentOfBasePrice: rule.minPercentOfBasePrice,
      allowZeroFinalPriceOverride: rule.allowZeroFinalPrice ?? undefined,
    })),
  };
}

export {
  buildCartValidationFunctionConfig,
  buildDiscountFunctionConfig,
} from "../../core/config/function-config.ts";
