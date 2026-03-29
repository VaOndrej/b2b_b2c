import { getOrCreateMarginGuardConfig } from "./margin-guard-config.server.ts";
import {
  getCatalogCollectionMapByIds,
  getCatalogProductMapByIds,
  getCatalogVariantMapByIds,
} from "./product-catalog.server.ts";

function collectRuleIds(config: Awaited<ReturnType<typeof getOrCreateMarginGuardConfig>>) {
  const productIds = new Set<string>();
  const variantIds = new Set<string>();
  const collectionIds = new Set<string>();

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
    if (String(rule.scope ?? "") === "COLLECTION") {
      collectionIds.add(String(rule.targetId ?? ""));
    }
  }
  for (const rule of config.collectionQuantityRules) {
    collectionIds.add(String(rule.collectionId ?? ""));
  }
  for (const rule of config.collectionVisibilityRules) {
    collectionIds.add(String(rule.collectionId ?? ""));
  }

  return {
    productIds: Array.from(productIds).filter(Boolean),
    variantIds: Array.from(variantIds).filter(Boolean),
    collectionIds: Array.from(collectionIds).filter(Boolean),
  };
}

export async function loadMarginGuardSettingsView() {
  const config = await getOrCreateMarginGuardConfig();
  const { productIds, variantIds, collectionIds } = collectRuleIds(config);
  const [catalogProductsById, catalogVariantsById, catalogCollectionsById] = await Promise.all([
    getCatalogProductMapByIds(productIds),
    getCatalogVariantMapByIds(variantIds),
    getCatalogCollectionMapByIds(collectionIds),
  ]);

  return {
    config,
    catalogProductsById,
    catalogVariantsById,
    catalogCollectionsById,
  };
}
