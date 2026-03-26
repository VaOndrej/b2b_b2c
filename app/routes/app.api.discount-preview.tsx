import { authenticate } from "../shopify.server";
import { getOrCreateMarginGuardConfig } from "../services/margin-guard-config.server";
import { createDiscountPreviewAction } from "../services/discount-preview-action.server.ts";
import { applyDiscountFunction } from "../../functions/discount-function/src/index.ts";

export const action = createDiscountPreviewAction({
  authenticateAdmin: (request) => authenticate.admin(request),
  getConfig: getOrCreateMarginGuardConfig,
  applyDiscount: applyDiscountFunction,
});
