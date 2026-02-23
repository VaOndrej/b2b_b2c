import prisma from "../db.server";
import type { FloorRuleset } from "../../core/margin/floor.rules";

const DEFAULT_CONFIG_ID = "default";

function getMarginGuardPrismaOrThrow() {
  const client = prisma as any;
  if (
    !client.marginGuardConfig ||
    !client.productFloorRule ||
    !client.productTierPriceRule ||
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
      couponSegmentRules: true,
    },
  });
}

export async function updateGlobalMarginGuardConfig(input: {
  b2bTag: string;
  globalMinPricePercent: number;
  allowZeroFinalPrice: boolean;
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
      allowStacking: input.allowStacking,
      maxCombinedPercentOff: input.maxCombinedPercentOff,
    },
    create: {
      id: DEFAULT_CONFIG_ID,
      b2bTag: input.b2bTag,
      globalMinPricePercent: input.globalMinPricePercent,
      allowZeroFinalPrice: input.allowZeroFinalPrice,
      allowStacking: input.allowStacking,
      maxCombinedPercentOff: input.maxCombinedPercentOff,
    },
    include: {
      productFloors: true,
      productTierPrices: true,
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
