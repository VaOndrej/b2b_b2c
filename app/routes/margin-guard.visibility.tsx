import { authenticate } from "../shopify.server";
import { getOrCreateMarginGuardConfig } from "../services/margin-guard-config.server";
import { createVisibilityLoader } from "../services/margin-guard-visibility.loader.server";
import {
  fetchProductCollectionIdsByProductIds,
  resolveStorefrontQuantityConstraintsByProductId,
  resolveStorefrontQuantityConstraintsByHandle,
  resolveStorefrontVisibilityByHandles,
} from "../services/storefront-visibility.server";

export const loader = createVisibilityLoader({
  authenticatePublicAppProxy: authenticate.public.appProxy,
  getOrCreateMarginGuardConfig,
  resolveStorefrontVisibilityByHandles,
  fetchProductCollectionIdsByProductIds,
  resolveStorefrontQuantityConstraintsByHandle,
  resolveStorefrontQuantityConstraintsByProductId,
});
