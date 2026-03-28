import { getOrCreateMarginGuardConfig } from "./margin-guard-config.server.ts";
import {
  getCatalogProductMapByIds,
  getCatalogVariantMapByIds,
} from "./product-catalog.server.ts";

function collectRuleIds(config: Awaited<ReturnType<typeof getOrCreateMarginGuardConfig>>) {
  const productIds = new Set<string>();
  const variantIds = new Set<string>();

  for (const rule of config.productFloors) {
    productIds.add(String(rule.productId ?? ""));
  }
  for (const rule of config.productTierPrices) {
    productIds.add(String(rule.productId ?? ""));
  }
  for (const rule of config.productQuantityRules) {
    productIds.add(String(rule.productId ?? ""));
  }
  for (const rule of config.productCustomerQuantityRules) {
    productIds.add(String(rule.productId ?? ""));
  }
  for (const rule of config.productVisibilityRules) {
    productIds.add(String(rule.productId ?? ""));
  }
  for (const rule of config.productVariantVisibilityRules) {
    productIds.add(String(rule.productId ?? ""));
    variantIds.add(String(rule.variantId ?? ""));
  }
  for (const rule of config.discountRules) {
    if (String(rule.scope ?? "") === "PRODUCT") {
      productIds.add(String(rule.targetId ?? ""));
    }
  }

  return {
    productIds: Array.from(productIds).filter(Boolean),
    variantIds: Array.from(variantIds).filter(Boolean),
  };
}

export async function loadMarginGuardSettingsView() {
  const config = await getOrCreateMarginGuardConfig();
  const { productIds, variantIds } = collectRuleIds(config);
  const [catalogProductsById, catalogVariantsById] = await Promise.all([
    getCatalogProductMapByIds(productIds),
    getCatalogVariantMapByIds(variantIds),
  ]);

  return {
    config,
    catalogProductsById,
    catalogVariantsById,
  };
}
