import { authenticate } from "../shopify.server";
import { getOrCreateMarginGuardConfig } from "../services/margin-guard-config.server";
import { createVisibilityLoader } from "../services/margin-guard-visibility.loader.server";
import {
  fetchProductCollectionIdsByProductIds,
  resolveStorefrontQuantityConstraintsByProductId,
  resolveStorefrontQuantityConstraintsByHandle,
  resolveStorefrontVariantVisibilityByProductId,
  resolveStorefrontVisibilityByHandles,
} from "../services/storefront-visibility.server";
import { resolveCartDiscountConflictsByHandle } from "../services/discount-conflict.server";
import {
  resolveStorefrontCatalogVariantVisibility,
  resolveStorefrontCatalogProductVisibility,
} from "../services/price-catalog.server";
import {
  loadStorefrontCatalogQuantity,
  resolveStorefrontCatalogId,
} from "../services/catalog-ruleset.server";
import { getCatalogProductMapByIds } from "../services/product-catalog.server";

export const loader = createVisibilityLoader({
  authenticatePublicAppProxy: authenticate.public.appProxy,
  getOrCreateMarginGuardConfig,
  resolveStorefrontVisibilityByHandles,
  fetchProductCollectionIdsByProductIds,
  resolveStorefrontQuantityConstraintsByHandle,
  resolveStorefrontQuantityConstraintsByProductId,
  resolveStorefrontVariantVisibilityByProductId,
  resolveCartDiscountConflictsByHandle,
  resolveStorefrontCatalogVariantVisibility: (customerTags) =>
    resolveStorefrontCatalogVariantVisibility(customerTags).catch(() => ({})),
  resolveStorefrontCatalogProductVisibility: (customerTags) =>
    resolveStorefrontCatalogProductVisibility(customerTags).catch(() => []),
  getCatalogProductMapByIds,
  loadStorefrontCatalogQuantity: (input) =>
    loadStorefrontCatalogQuantity(input).catch(() => ({
      productQuantityRules: [],
      collectionQuantityRules: [],
      customerQuantityRules: [],
    })),
  resolveStorefrontCatalogId: (input) =>
    resolveStorefrontCatalogId(input).catch(() => null),
});
