import { resolveQuantityConstraints } from "@won/core/quantity/quantity.engine";

import type { PrismaClient } from "../generated/prisma/client";
import db from "../db.server";

export interface QuantityConfigInput {
  enabled: boolean;
  minimum: number;
  step: number;
  maximum: number | null;
}

export interface QuantityRuleInput {
  targetKey: `product:${string}` | `variant:${string}`;
  minimum?: number | null;
  step?: number | null;
  maximum?: number | null;
}

export interface ResolvedQuantityRule {
  enabled: boolean;
  minimum: number;
  step: number;
  maximum: number | null;
}

function normalizeShop(shop: string): string {
  const normalized = String(shop ?? "")
    .trim()
    .toLowerCase();
  if (!normalized) {
    throw new Error("Authenticated shop is required.");
  }
  return normalized;
}

function assertPositiveInteger(value: number, field: "minimum" | "step"): void {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${field} must be an integer greater than or equal to 1.`);
  }
}

function validateMaximum(maximum: number | null, minimum: number): void {
  if (maximum !== null && (!Number.isInteger(maximum) || maximum < minimum)) {
    throw new Error(
      "maximum must be null or greater than or equal to minimum.",
    );
  }
}

function validateConfigInput(input: QuantityConfigInput): void {
  assertPositiveInteger(input.minimum, "minimum");
  assertPositiveInteger(input.step, "step");
  validateMaximum(input.maximum, input.minimum);
}

function normalizeTargetKey(targetKey: string): QuantityRuleInput["targetKey"] {
  const normalized = String(targetKey ?? "").trim();
  if (
    !/^(product:gid:\/\/shopify\/Product\/\d+|variant:gid:\/\/shopify\/ProductVariant\/\d+)$/.test(
      normalized,
    )
  ) {
    throw new Error("targetKey must contain a Shopify product or variant GID.");
  }
  return normalized as QuantityRuleInput["targetKey"];
}

function toCoreRule(
  targetId: string | undefined,
  values: {
    minimum: number | null;
    step: number | null;
    maximum: number | null;
  },
) {
  return {
    ...(targetId ? { productId: targetId } : {}),
    ...(values.minimum == null ? {} : { minimumOrderQuantity: values.minimum }),
    ...(values.step == null ? {} : { stepQuantity: values.step }),
    ...(values.maximum == null ? {} : { maxOrderQuantity: values.maximum }),
  };
}

export function createQuantityConfigService(prisma: PrismaClient) {
  async function getQuantityConfig(shop: string) {
    const normalizedShop = normalizeShop(shop);
    return prisma.quantityConfig.upsert({
      where: { shop: normalizedShop },
      create: { shop: normalizedShop },
      update: {},
    });
  }

  async function updateQuantityConfig(
    shop: string,
    input: QuantityConfigInput,
  ) {
    const normalizedShop = normalizeShop(shop);
    validateConfigInput(input);

    return prisma.quantityConfig.upsert({
      where: { shop: normalizedShop },
      create: { shop: normalizedShop, ...input },
      update: input,
    });
  }

  async function upsertQuantityRule(shop: string, input: QuantityRuleInput) {
    const normalizedShop = normalizeShop(shop);
    const targetKey = normalizeTargetKey(input.targetKey);
    const minimum = input.minimum ?? null;
    const step = input.step ?? null;
    const maximum = input.maximum ?? null;

    if (minimum !== null) assertPositiveInteger(minimum, "minimum");
    if (step !== null) assertPositiveInteger(step, "step");
    if (maximum !== null) {
      validateMaximum(maximum, minimum ?? 1);
    }
    if (minimum === null && step === null && maximum === null) {
      throw new Error(
        "A quantity override must define at least one constraint.",
      );
    }

    await getQuantityConfig(normalizedShop);
    return prisma.quantityRule.upsert({
      where: { shop_targetKey: { shop: normalizedShop, targetKey } },
      create: { shop: normalizedShop, targetKey, minimum, step, maximum },
      update: { minimum, step, maximum },
    });
  }

  async function resolveQuantityRule(
    shop: string,
    productGid: string,
    variantGid: string | null = null,
  ): Promise<ResolvedQuantityRule> {
    const normalizedShop = normalizeShop(shop);
    const config = await getQuantityConfig(normalizedShop);
    const targetKeys = [`product:${productGid}`];
    if (variantGid) targetKeys.push(`variant:${variantGid}`);

    const rules = await prisma.quantityRule.findMany({
      where: { shop: normalizedShop, targetKey: { in: targetKeys } },
    });
    const productRule = rules.find((rule) => rule.targetKey === targetKeys[0]);
    const productConstraints = resolveQuantityConstraints({
      quantity: 1,
      productId: productGid,
      rules: [
        toCoreRule(undefined, config),
        ...(productRule ? [toCoreRule(productGid, productRule)] : []),
      ],
    });

    let effective = productConstraints;
    if (variantGid) {
      const variantRule = rules.find(
        (rule) => rule.targetKey === `variant:${variantGid}`,
      );
      effective = resolveQuantityConstraints({
        quantity: 1,
        productId: variantGid,
        rules: [
          {
            minimumOrderQuantity: productConstraints.minimumOrderQuantity,
            stepQuantity: productConstraints.stepQuantity,
            ...(productConstraints.maxOrderQuantity == null
              ? {}
              : { maxOrderQuantity: productConstraints.maxOrderQuantity }),
          },
          ...(variantRule ? [toCoreRule(variantGid, variantRule)] : []),
        ],
      });
    }

    if (
      effective.maxOrderQuantity !== null &&
      effective.maxOrderQuantity < effective.minimumOrderQuantity
    ) {
      throw new Error("Resolved maximum cannot be lower than minimum.");
    }

    return {
      enabled: config.enabled,
      minimum: effective.minimumOrderQuantity,
      step: effective.stepQuantity,
      maximum: effective.maxOrderQuantity,
    };
  }

  async function deleteShopData(shop: string): Promise<void> {
    const normalizedShop = normalizeShop(shop);
    await prisma.$transaction([
      prisma.quantityRule.deleteMany({ where: { shop: normalizedShop } }),
      prisma.quantityConfig.deleteMany({ where: { shop: normalizedShop } }),
    ]);
  }

  return {
    getQuantityConfig,
    updateQuantityConfig,
    upsertQuantityRule,
    resolveQuantityRule,
    deleteShopData,
  };
}

const quantityConfigService = createQuantityConfigService(db);

export const getQuantityConfig = quantityConfigService.getQuantityConfig;
export const updateQuantityConfig = quantityConfigService.updateQuantityConfig;
export const upsertQuantityRule = quantityConfigService.upsertQuantityRule;
export const resolveQuantityRule = quantityConfigService.resolveQuantityRule;
export const deleteShopData = quantityConfigService.deleteShopData;
