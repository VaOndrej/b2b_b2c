import prisma from "../../../app/db.server.ts";
import {
  updateGlobalMarginGuardConfig,
  upsertProductMaximumQuantityRule,
  upsertProductQuantityRule,
  upsertProductStepQuantityRule,
  upsertProductVariantVisibilityRule,
  upsertProductVisibilityRule,
} from "../../../app/services/margin-guard-config.server.ts";

interface MarginGuardConfigSnapshot {
  globalConfig: {
    b2bTag: string;
    globalMinPricePercent: number;
    b2bGlobalMinPricePercent: number;
    allowZeroFinalPrice: boolean;
    allowRemoveAtMinimumOrderQuantity: boolean;
    allowStacking: boolean;
    maxCombinedPercentOff: number | null;
  };
  productQuantityRules: Array<{
    productId: string;
    segment: string | null;
    minimumOrderQuantity: number;
    stepQuantity: number | null;
    maxOrderQuantity: number | null;
  }>;
  collectionQuantityRules: Array<{
    collectionId: string;
    segment: string | null;
    maxOrderQuantity: number;
  }>;
  productCustomerQuantityRules: Array<{
    productId: string;
    customerId: string;
    maxOrderQuantity: number;
  }>;
  productVisibilityRules: Array<{
    productId: string;
    visibilityMode: string;
    customerId: string | null;
  }>;
  productVariantVisibilityRules: Array<{
    productId: string;
    variantId: string;
    visibilityMode: string;
    customerId: string | null;
  }>;
  couponSegmentRules: Array<{
    code: string;
    allowedSegment: string;
  }>;
}

let originalSnapshotPromise: Promise<MarginGuardConfigSnapshot> | null = null;

async function captureMarginGuardConfigSnapshot(): Promise<MarginGuardConfigSnapshot> {
  const config = await prisma.marginGuardConfig.findUnique({
    where: {
      id: "default",
    },
    include: {
      productQuantityRules: true,
      collectionQuantityRules: true,
      productCustomerQuantityRules: true,
      productVisibilityRules: true,
      productVariantVisibilityRules: true,
      couponSegmentRules: true,
    },
  });

  if (!config) {
    const defaults = await updateGlobalMarginGuardConfig({
      b2bTag: "b2b",
      globalMinPricePercent: 70,
      b2bGlobalMinPricePercent: 70,
      allowZeroFinalPrice: false,
      allowRemoveAtMinimumOrderQuantity: true,
      allowStacking: false,
      maxCombinedPercentOff: null,
    });

    return {
      globalConfig: {
        b2bTag: defaults.b2bTag,
        globalMinPricePercent: defaults.globalMinPricePercent,
        b2bGlobalMinPricePercent: defaults.b2bGlobalMinPricePercent,
        allowZeroFinalPrice: defaults.allowZeroFinalPrice,
        allowRemoveAtMinimumOrderQuantity: defaults.allowRemoveAtMinimumOrderQuantity,
        allowStacking: defaults.allowStacking,
        maxCombinedPercentOff: defaults.maxCombinedPercentOff ?? null,
      },
      productQuantityRules: [],
      collectionQuantityRules: [],
      productCustomerQuantityRules: [],
      productVisibilityRules: [],
      productVariantVisibilityRules: [],
      couponSegmentRules: [],
    };
  }

  return {
    globalConfig: {
      b2bTag: config.b2bTag,
      globalMinPricePercent: config.globalMinPricePercent,
      b2bGlobalMinPricePercent: config.b2bGlobalMinPricePercent,
      allowZeroFinalPrice: config.allowZeroFinalPrice,
      allowRemoveAtMinimumOrderQuantity: config.allowRemoveAtMinimumOrderQuantity,
      allowStacking: config.allowStacking,
      maxCombinedPercentOff: config.maxCombinedPercentOff ?? null,
    },
    productQuantityRules: config.productQuantityRules.map((rule) => ({
      productId: rule.productId,
      segment: rule.segment,
      minimumOrderQuantity: rule.minimumOrderQuantity,
      stepQuantity: rule.stepQuantity,
      maxOrderQuantity: rule.maxOrderQuantity,
    })),
    collectionQuantityRules: config.collectionQuantityRules.map((rule) => ({
      collectionId: rule.collectionId,
      segment: rule.segment,
      maxOrderQuantity: rule.maxOrderQuantity,
    })),
    productCustomerQuantityRules: config.productCustomerQuantityRules.map((rule) => ({
      productId: rule.productId,
      customerId: rule.customerId,
      maxOrderQuantity: rule.maxOrderQuantity,
    })),
    productVisibilityRules: config.productVisibilityRules.map((rule) => ({
      productId: rule.productId,
      visibilityMode: rule.visibilityMode,
      customerId: rule.customerId,
    })),
    productVariantVisibilityRules: config.productVariantVisibilityRules.map((rule) => ({
      productId: rule.productId,
      variantId: rule.variantId,
      visibilityMode: rule.visibilityMode,
      customerId: rule.customerId,
    })),
    couponSegmentRules: config.couponSegmentRules.map((rule) => ({
      code: rule.code,
      allowedSegment: rule.allowedSegment,
    })),
  };
}

export async function ensureOriginalMarginGuardSnapshot() {
  if (!originalSnapshotPromise) {
    originalSnapshotPromise = captureMarginGuardConfigSnapshot();
  }
  return originalSnapshotPromise;
}

export async function resetMarginGuardConfigForStorefrontE2E() {
  await ensureOriginalMarginGuardSnapshot();
  await updateGlobalMarginGuardConfig({
    b2bTag: "b2b",
    globalMinPricePercent: 70,
    b2bGlobalMinPricePercent: 70,
    allowZeroFinalPrice: false,
    allowRemoveAtMinimumOrderQuantity: true,
    allowStacking: false,
    maxCombinedPercentOff: null,
  });

  await prisma.productVariantVisibilityRule.deleteMany({
    where: { configId: "default" },
  });
  await prisma.productVisibilityRule.deleteMany({
    where: { configId: "default" },
  });
  await prisma.productCustomerQuantityRule.deleteMany({
    where: { configId: "default" },
  });
  await prisma.collectionQuantityRule.deleteMany({
    where: { configId: "default" },
  });
  await prisma.productQuantityRule.deleteMany({
    where: { configId: "default" },
  });
  await prisma.couponSegmentRule.deleteMany({
    where: { configId: "default" },
  });
}

export async function restoreOriginalMarginGuardSnapshot() {
  const snapshot = await ensureOriginalMarginGuardSnapshot();

  await updateGlobalMarginGuardConfig(snapshot.globalConfig);

  await prisma.productVariantVisibilityRule.deleteMany({
    where: { configId: "default" },
  });
  await prisma.productVisibilityRule.deleteMany({
    where: { configId: "default" },
  });
  await prisma.productCustomerQuantityRule.deleteMany({
    where: { configId: "default" },
  });
  await prisma.collectionQuantityRule.deleteMany({
    where: { configId: "default" },
  });
  await prisma.productQuantityRule.deleteMany({
    where: { configId: "default" },
  });
  await prisma.couponSegmentRule.deleteMany({
    where: { configId: "default" },
  });

  for (const rule of snapshot.productQuantityRules) {
    await prisma.productQuantityRule.create({
      data: {
        configId: "default",
        productId: rule.productId,
        segment: rule.segment,
        minimumOrderQuantity: rule.minimumOrderQuantity,
        stepQuantity: rule.stepQuantity,
        maxOrderQuantity: rule.maxOrderQuantity,
      },
    });
  }

  for (const rule of snapshot.collectionQuantityRules) {
    await prisma.collectionQuantityRule.create({
      data: {
        configId: "default",
        collectionId: rule.collectionId,
        segment: rule.segment,
        maxOrderQuantity: rule.maxOrderQuantity,
      },
    });
  }

  for (const rule of snapshot.productCustomerQuantityRules) {
    await prisma.productCustomerQuantityRule.create({
      data: {
        configId: "default",
        productId: rule.productId,
        customerId: rule.customerId,
        maxOrderQuantity: rule.maxOrderQuantity,
      },
    });
  }

  for (const rule of snapshot.productVisibilityRules) {
    await prisma.productVisibilityRule.create({
      data: {
        configId: "default",
        productId: rule.productId,
        visibilityMode: rule.visibilityMode,
        customerId: rule.customerId,
      },
    });
  }

  for (const rule of snapshot.productVariantVisibilityRules) {
    await prisma.productVariantVisibilityRule.create({
      data: {
        configId: "default",
        productId: rule.productId,
        variantId: rule.variantId,
        visibilityMode: rule.visibilityMode,
        customerId: rule.customerId,
      },
    });
  }

  for (const rule of snapshot.couponSegmentRules) {
    await prisma.couponSegmentRule.create({
      data: {
        configId: "default",
        code: rule.code,
        allowedSegment: rule.allowedSegment,
      },
    });
  }
}

export async function seedB2BOnlyVisibilityScenario(input: {
  productId: string;
}) {
  await resetMarginGuardConfigForStorefrontE2E();
  await upsertProductVisibilityRule({
    productId: input.productId,
    visibilityMode: "B2B_ONLY",
  });
}

export async function seedQuantityConstraintScenario(input: {
  productId: string;
  minimumOrderQuantity: number;
  stepQuantity: number;
}) {
  await resetMarginGuardConfigForStorefrontE2E();
  await upsertProductQuantityRule({
    productId: input.productId,
    minimumOrderQuantity: input.minimumOrderQuantity,
  });
  await upsertProductStepQuantityRule({
    productId: input.productId,
    stepQuantity: input.stepQuantity,
  });
}

export async function seedVariantVisibilityScenario(input: {
  productId: string;
  variantId: string;
}) {
  await resetMarginGuardConfigForStorefrontE2E();
  await upsertProductVariantVisibilityRule({
    productId: input.productId,
    variantId: input.variantId,
    visibilityMode: "B2B_ONLY",
  });
}

export async function seedMaxOrderQuantityScenario(input: {
  productId: string;
  maxOrderQuantity: number;
}) {
  await resetMarginGuardConfigForStorefrontE2E();
  await upsertProductMaximumQuantityRule({
    productId: input.productId,
    maxOrderQuantity: input.maxOrderQuantity,
  });
}

export async function disconnectE2EPrisma() {
  await prisma.$disconnect();
}
