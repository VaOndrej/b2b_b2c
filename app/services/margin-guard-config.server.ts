import prisma from "../db.server";
import type { FloorRuleset } from "../../core/margin/floor.rules";

const DEFAULT_CONFIG_ID = "default";

function getMarginGuardPrismaOrThrow() {
  const client = prisma as any;
  if (
    !client.marginGuardConfig ||
    !client.productFloorRule ||
    !client.marginViolationLog
  ) {
    throw new Error(
      "Prisma client is out of date for MVP_1 models. Run `npx prisma generate` and restart `shopify app dev`.",
    );
  }

  return client;
}

export async function getOrCreateMarginGuardConfig() {
  const db = getMarginGuardPrismaOrThrow();
  const existing = await db.marginGuardConfig.findUnique({
    where: { id: DEFAULT_CONFIG_ID },
    include: { productFloors: true },
  });

  if (existing) {
    return existing;
  }

  return db.marginGuardConfig.create({
    data: { id: DEFAULT_CONFIG_ID },
    include: { productFloors: true },
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
    include: { productFloors: true },
  });
}

export async function upsertProductFloorRule(input: {
  productId: string;
  segment?: "B2B" | "B2C";
  minPercentOfBasePrice: number;
  allowZeroFinalPrice: boolean | null;
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
    },
  });
}

export async function deleteProductFloorRule(id: string) {
  const db = getMarginGuardPrismaOrThrow();
  return db.productFloorRule.delete({ where: { id } });
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

export function buildCartValidationFunctionConfig(config: {
  b2bTag: string;
  globalMinPricePercent: number;
  allowZeroFinalPrice: boolean;
  productFloors: Array<{
    productId: string;
    minPercentOfBasePrice: number;
    segment: string | null;
    allowZeroFinalPrice: boolean | null;
  }>;
}) {
  const perProductFloorPercentsB2C: Record<string, number> = {};
  const perProductFloorPercentsB2B: Record<string, number> = {};
  const perProductAllowZeroFinalPriceB2C: Record<string, boolean> = {};
  const perProductAllowZeroFinalPriceB2B: Record<string, boolean> = {};
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
    }
  }

  return {
    b2bTag: config.b2bTag,
    globalMinPricePercent: config.globalMinPricePercent,
    b2bGlobalMinPricePercent: config.globalMinPricePercent,
    allowZeroFinalPrice: config.allowZeroFinalPrice,
    perProductFloorPercentsB2C,
    perProductFloorPercentsB2B,
    perProductAllowZeroFinalPriceB2C,
    perProductAllowZeroFinalPriceB2B,
  };
}

export function buildDiscountFunctionConfig(config: {
  b2bTag: string;
  globalMinPricePercent: number;
  allowZeroFinalPrice: boolean;
  productFloors: Array<{
    productId: string;
    minPercentOfBasePrice: number;
    segment: string | null;
    allowZeroFinalPrice: boolean | null;
  }>;
}) {
  return {
    ...buildCartValidationFunctionConfig(config),
    requestedPercentOff: 100,
  };
}
