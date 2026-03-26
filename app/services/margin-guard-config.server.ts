import prisma from "../db.server.ts";
import type {
  ConfiguredDiscountRule,
  DiscountBlacklistRule,
  DiscountRules,
  DiscountSegmentCap,
  DiscountStackMode,
} from "../../core/discount/discount.rules.ts";
import {
  buildDiscountRuleLookupKey,
  canonicalizeDiscountBlacklistPair,
} from "../../core/discount/discount.identity.ts";
import type { FloorRuleset } from "../../core/margin/floor.rules.ts";

const DEFAULT_CONFIG_ID = "default";

function orderByCreatedAtAndId() {
  return [{ createdAt: "asc" as const }, { id: "asc" as const }];
}

const MARGIN_GUARD_CONFIG_INCLUDE = {
  productFloors: { orderBy: orderByCreatedAtAndId() },
  productTierPrices: { orderBy: orderByCreatedAtAndId() },
  productQuantityRules: { orderBy: orderByCreatedAtAndId() },
  collectionQuantityRules: { orderBy: orderByCreatedAtAndId() },
  productCustomerQuantityRules: { orderBy: orderByCreatedAtAndId() },
  productVisibilityRules: { orderBy: orderByCreatedAtAndId() },
  productVariantVisibilityRules: { orderBy: orderByCreatedAtAndId() },
  couponSegmentRules: { orderBy: orderByCreatedAtAndId() },
  discountRules: { orderBy: orderByCreatedAtAndId() },
  discountCombinationBlacklistRules: {
    orderBy: orderByCreatedAtAndId(),
  },
  discountSegmentCaps: { orderBy: orderByCreatedAtAndId() },
};

export function buildQuantityRuleUpdateData(
  existing: { stepQuantity: number | null; maxOrderQuantity: number | null },
  minimumOrderQuantity: number,
) {
  return {
    minimumOrderQuantity,
    stepQuantity: existing.stepQuantity,
    maxOrderQuantity: existing.maxOrderQuantity,
  };
}

function getMarginGuardPrismaOrThrow() {
  const client = prisma;
  if (
    !client.marginGuardConfig ||
    !client.productFloorRule ||
    !client.productTierPriceRule ||
    !client.productQuantityRule ||
    !client.collectionQuantityRule ||
    !client.productCustomerQuantityRule ||
    !client.productVisibilityRule ||
    !client.productVariantVisibilityRule ||
    !client.couponSegmentRule ||
    !client.discountRule ||
    !client.discountCombinationBlacklistRule ||
    !client.discountSegmentCap ||
    !client.marginViolationLog
  ) {
    throw new Error(
      "Prisma client is out of date for Margin Guard models. Run `npm run prisma:generate` and restart `shopify app dev`.",
    );
  }

  return client;
}

export async function getOrCreateMarginGuardConfig() {
  const db = getMarginGuardPrismaOrThrow();
  const existing = await db.marginGuardConfig.findUnique({
    where: { id: DEFAULT_CONFIG_ID },
    include: MARGIN_GUARD_CONFIG_INCLUDE,
  });

  if (existing) {
    return existing;
  }

  return db.marginGuardConfig.create({
    data: { id: DEFAULT_CONFIG_ID },
    include: MARGIN_GUARD_CONFIG_INCLUDE,
  });
}

export async function updateGlobalMarginGuardConfig(input: {
  b2bTag: string;
  globalMinPricePercent: number;
  b2bGlobalMinPricePercent: number;
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
      b2bGlobalMinPricePercent: input.b2bGlobalMinPricePercent,
      allowZeroFinalPrice: input.allowZeroFinalPrice,
      allowRemoveAtMinimumOrderQuantity: input.allowRemoveAtMinimumOrderQuantity,
      allowStacking: input.allowStacking,
      maxCombinedPercentOff: input.maxCombinedPercentOff,
    },
    create: {
      id: DEFAULT_CONFIG_ID,
      b2bTag: input.b2bTag,
      globalMinPricePercent: input.globalMinPricePercent,
      b2bGlobalMinPricePercent: input.b2bGlobalMinPricePercent,
      allowZeroFinalPrice: input.allowZeroFinalPrice,
      allowRemoveAtMinimumOrderQuantity: input.allowRemoveAtMinimumOrderQuantity,
      allowStacking: input.allowStacking,
      maxCombinedPercentOff: input.maxCombinedPercentOff,
    },
    include: MARGIN_GUARD_CONFIG_INCLUDE,
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
      data: buildQuantityRuleUpdateData(existing, normalizedMinimumOrderQuantity),
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

function normalizeVariantId(value: string | null | undefined): string | null {
  const normalized = String(value ?? "").trim();
  if (!normalized) {
    return null;
  }
  if (normalized.startsWith("gid://shopify/ProductVariant/")) {
    return normalized;
  }
  if (/^\d+$/.test(normalized)) {
    return `gid://shopify/ProductVariant/${normalized}`;
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

export async function upsertProductVariantVisibilityRule(input: {
  productId: string;
  variantId: string;
  visibilityMode: "ALL" | "B2B_ONLY" | "B2C_ONLY" | "CUSTOMER_ONLY";
  customerId?: string | null;
}) {
  const db = getMarginGuardPrismaOrThrow();
  const productId = input.productId.trim();
  const variantId = normalizeVariantId(input.variantId);
  if (!productId || !variantId) {
    return null;
  }

  const visibilityMode = normalizeVisibilityMode(input.visibilityMode);
  const customerId =
    visibilityMode === "CUSTOMER_ONLY"
      ? normalizeCustomerId(input.customerId)
      : null;
  const existing = await db.productVariantVisibilityRule.findFirst({
    where: {
      configId: DEFAULT_CONFIG_ID,
      variantId,
    },
  });

  if (visibilityMode === "ALL") {
    if (existing) {
      await db.productVariantVisibilityRule.delete({ where: { id: existing.id } });
    }
    return null;
  }

  if (visibilityMode === "CUSTOMER_ONLY" && !customerId) {
    return null;
  }

  if (existing) {
    return db.productVariantVisibilityRule.update({
      where: { id: existing.id },
      data: {
        productId,
        variantId,
        visibilityMode,
        customerId,
      },
    });
  }

  return db.productVariantVisibilityRule.create({
    data: {
      configId: DEFAULT_CONFIG_ID,
      productId,
      variantId,
      visibilityMode,
      customerId,
    },
  });
}

export async function deleteProductVariantVisibilityRule(id: string) {
  const db = getMarginGuardPrismaOrThrow();
  return db.productVariantVisibilityRule.delete({ where: { id } });
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

function normalizeDiscountStackMode(value: string): DiscountStackMode {
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

function normalizePercentOrNull(value: number | null | undefined): number | null {
  if (value == null || !Number.isFinite(value)) {
    return null;
  }
  return Math.round(Math.max(0, Math.min(100, value)) * 100) / 100;
}

export function buildDiscountRuleCanonicalKey(input: {
  scope: "GLOBAL" | "COLLECTION" | "PRODUCT" | "COUPON";
  segment?: string | null;
  targetId?: string | null;
  code?: string | null;
}) {
  let targetId = String(input.targetId ?? "").trim() || null;
  let code = input.code ?? null;

  if (input.scope === "COLLECTION") {
    targetId = normalizeCollectionId(targetId);
    if (!targetId) {
      return null;
    }
  }

  if (input.scope === "PRODUCT" && !targetId) {
    return null;
  }

  if (input.scope === "COUPON") {
    code = normalizeCouponCode(String(input.code ?? input.targetId ?? ""));
    if (!code) {
      return null;
    }
  }

  return buildDiscountRuleLookupKey({
    scope: input.scope,
    targetId,
    code,
    segment: input.segment,
  });
}

export function buildDiscountCombinationBlacklistCanonicalPairKey(input: {
  leftType: "RULE_ID" | "COUPON_CODE" | "SCOPE";
  leftValue: string;
  rightType: "RULE_ID" | "COUPON_CODE" | "SCOPE";
  rightValue: string;
  segment?: string | null;
}) {
  return canonicalizeDiscountBlacklistPair(input).pairKey;
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
  return db.couponSegmentRule.upsert({
    where: {
      configId_code: {
        configId: DEFAULT_CONFIG_ID,
        code: normalizedCode,
      },
    },
    update: {
      allowedSegment,
    },
    create: {
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

export async function upsertDiscountRule(input: {
  scope: "GLOBAL" | "COLLECTION" | "PRODUCT" | "COUPON";
  targetId?: string | null;
  code?: string | null;
  segment?: "B2B" | "B2C";
  percentOff: number;
  priority: number;
  stackMode: DiscountStackMode;
  minPricePercentOfBasePrice?: number | null;
}) {
  const db = getMarginGuardPrismaOrThrow();
  const scope = normalizeDiscountRuleScope(input.scope);
  const segment = input.segment ?? null;
  const percentOff = normalizePercentOrNull(input.percentOff);
  const minPricePercentOfBasePrice = normalizePercentOrNull(
    input.minPricePercentOfBasePrice ?? null,
  );
  const priority = Number.isFinite(input.priority)
    ? Math.max(0, Math.floor(input.priority))
    : 100;
  const stackMode = normalizeDiscountStackMode(input.stackMode);

  let targetId: string | null = null;
  let code: string | null = null;
  if (scope === "COLLECTION") {
    targetId = normalizeCollectionId(input.targetId);
  } else if (scope === "PRODUCT") {
    targetId = String(input.targetId ?? "").trim() || null;
  } else if (scope === "COUPON") {
    code = normalizeCouponCode(String(input.code ?? input.targetId ?? ""));
  }

  if (percentOff == null || percentOff <= 0) {
    return null;
  }
  const canonicalKey = buildDiscountRuleCanonicalKey({
    scope,
    segment,
    targetId,
    code,
  });
  if (!canonicalKey) {
    return null;
  }

  return db.discountRule.upsert({
    where: {
      configId_canonicalKey: {
        configId: DEFAULT_CONFIG_ID,
        canonicalKey,
      },
    },
    update: {
      percentOff,
      priority,
      stackMode,
      minPricePercentOfBasePrice,
      scope,
      targetId,
      code,
      segment,
      canonicalKey,
    },
    create: {
      configId: DEFAULT_CONFIG_ID,
      scope,
      targetId,
      code,
      segment,
      canonicalKey,
      percentOff,
      priority,
      stackMode,
      minPricePercentOfBasePrice,
    },
  });
}

export async function deleteDiscountRule(id: string) {
  const db = getMarginGuardPrismaOrThrow();
  return db.discountRule.delete({ where: { id } });
}

function normalizeDiscountReferenceValue(
  type: "RULE_ID" | "COUPON_CODE" | "SCOPE",
  value: string,
): string | null {
  const trimmed = String(value ?? "").trim();
  if (!trimmed) {
    return null;
  }
  if (type === "COUPON_CODE") {
    return normalizeCouponCode(trimmed);
  }
  if (type === "SCOPE") {
    return normalizeDiscountRuleScope(trimmed);
  }
  return trimmed;
}

export async function upsertDiscountCombinationBlacklistRule(input: {
  leftType: "RULE_ID" | "COUPON_CODE" | "SCOPE";
  leftValue: string;
  rightType: "RULE_ID" | "COUPON_CODE" | "SCOPE";
  rightValue: string;
  segment?: "ALL" | "B2B" | "B2C";
}) {
  const db = getMarginGuardPrismaOrThrow();
  const leftType = normalizeDiscountReferenceType(input.leftType);
  const rightType = normalizeDiscountReferenceType(input.rightType);
  const leftValue = normalizeDiscountReferenceValue(leftType, input.leftValue);
  const rightValue = normalizeDiscountReferenceValue(rightType, input.rightValue);
  const segment =
    input.segment === "B2B" || input.segment === "B2C" || input.segment === "ALL"
      ? input.segment
      : null;
  if (!leftValue || !rightValue) {
    return null;
  }

  const canonicalPair = canonicalizeDiscountBlacklistPair({
    leftType,
    leftValue,
    rightType,
    rightValue,
    segment,
  });
  const canonicalPairKey = canonicalPair.pairKey;

  return db.discountCombinationBlacklistRule.upsert({
    where: {
      configId_canonicalPairKey: {
        configId: DEFAULT_CONFIG_ID,
        canonicalPairKey,
      },
    },
    update: {
      leftType: canonicalPair.leftType,
      leftValue: canonicalPair.leftValue,
      rightType: canonicalPair.rightType,
      rightValue: canonicalPair.rightValue,
      segment,
      canonicalPairKey,
    },
    create: {
      configId: DEFAULT_CONFIG_ID,
      canonicalPairKey,
      leftType: canonicalPair.leftType,
      leftValue: canonicalPair.leftValue,
      rightType: canonicalPair.rightType,
      rightValue: canonicalPair.rightValue,
      segment,
    },
  });
}

export async function deleteDiscountCombinationBlacklistRule(id: string) {
  const db = getMarginGuardPrismaOrThrow();
  return db.discountCombinationBlacklistRule.delete({ where: { id } });
}

export async function upsertDiscountSegmentCap(input: {
  segment: "ALL" | "B2B" | "B2C";
  maxCombinedPercentOff: number;
}) {
  const db = getMarginGuardPrismaOrThrow();
  const segment =
    input.segment === "B2B" || input.segment === "B2C" ? input.segment : "ALL";
  const maxCombinedPercentOff = normalizePercentOrNull(input.maxCombinedPercentOff);
  if (maxCombinedPercentOff == null) {
    return null;
  }

  return db.discountSegmentCap.upsert({
    where: {
      configId_segment: {
        configId: DEFAULT_CONFIG_ID,
        segment,
      },
    },
    update: {
      maxCombinedPercentOff,
    },
    create: {
      configId: DEFAULT_CONFIG_ID,
      segment,
      maxCombinedPercentOff,
    },
  });
}

export async function deleteDiscountSegmentCap(id: string) {
  const db = getMarginGuardPrismaOrThrow();
  return db.discountSegmentCap.delete({ where: { id } });
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
  b2bGlobalMinPricePercent?: number;
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
      b2bMinPercentOfBasePrice:
        config.b2bGlobalMinPricePercent ?? config.globalMinPricePercent,
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

export function buildDiscountRuleset(config: {
  allowStacking: boolean;
  maxCombinedPercentOff?: number | null;
  discountRules?: Array<{
    id: string;
    scope: string;
    targetId: string | null;
    code: string | null;
    segment: string | null;
    percentOff: number;
    priority: number;
    stackMode: string;
    minPricePercentOfBasePrice: number | null;
  }>;
  discountCombinationBlacklistRules?: Array<{
    leftType: string;
    leftValue: string;
    rightType: string;
    rightValue: string;
    segment: string | null;
  }>;
  discountSegmentCaps?: Array<{
    segment: string;
    maxCombinedPercentOff: number;
  }>;
}): DiscountRules {
  const rules: ConfiguredDiscountRule[] = [];
  const blacklists: DiscountBlacklistRule[] = [];
  const segmentCaps: DiscountSegmentCap[] = [];

  for (const rule of config.discountRules ?? []) {
    const scope = normalizeDiscountRuleScope(rule.scope);
    const normalizedSegment =
      rule.segment === "B2B" || rule.segment === "B2C" ? rule.segment : undefined;
    const percentOff = normalizePercentOrNull(rule.percentOff);
    if (percentOff == null || percentOff <= 0) {
      continue;
    }
    rules.push({
      id: rule.id,
      scope,
      targetId: rule.targetId ?? undefined,
      code: rule.code ?? undefined,
      segment: normalizedSegment,
      percentOff,
      priority: Number.isFinite(rule.priority) ? Math.floor(rule.priority) : 100,
      stackMode: normalizeDiscountStackMode(rule.stackMode),
      minPricePercentOfBasePrice:
        normalizePercentOrNull(rule.minPricePercentOfBasePrice ?? null) ?? undefined,
    });
  }

  for (const blacklistRule of config.discountCombinationBlacklistRules ?? []) {
    blacklists.push({
      leftType: normalizeDiscountReferenceType(blacklistRule.leftType),
      leftValue: blacklistRule.leftValue,
      rightType: normalizeDiscountReferenceType(blacklistRule.rightType),
      rightValue: blacklistRule.rightValue,
      segment:
        blacklistRule.segment === "B2B" ||
        blacklistRule.segment === "B2C" ||
        blacklistRule.segment === "ALL"
          ? blacklistRule.segment
          : undefined,
    });
  }

  for (const cap of config.discountSegmentCaps ?? []) {
    const segment =
      cap.segment === "B2B" || cap.segment === "B2C" ? cap.segment : "ALL";
    const maxCombinedPercentOff = normalizePercentOrNull(cap.maxCombinedPercentOff);
    if (maxCombinedPercentOff == null) {
      continue;
    }
    segmentCaps.push({
      segment,
      maxCombinedPercentOff,
    });
  }

  return {
    allowStacking: config.allowStacking,
    maxCombinedPercentOff:
      normalizePercentOrNull(config.maxCombinedPercentOff ?? null) ?? undefined,
    rules,
    blacklists,
    segmentCaps,
  };
}

export {
  buildCartValidationFunctionConfig,
  buildDiscountFunctionConfig,
} from "../../core/config/function-config.ts";
