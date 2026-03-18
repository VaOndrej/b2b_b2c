import { authenticate } from "../shopify.server";
import { getOrCreateMarginGuardConfig, recordMarginViolation } from "../services/margin-guard-config.server";
import { validateCartLine } from "../../functions/cart-validation/src";
import {
  createCartValidateAdminAction,
} from "../../functions/cart-validation/src/admin-cart-validate-endpoint.ts";

export { createCartValidateAdminAction };

export const action = createCartValidateAdminAction({
  authenticateAdmin: (request) => authenticate.admin(request),
  getConfig: getOrCreateMarginGuardConfig,
  validate: validateCartLine,
  recordViolation: recordMarginViolation,
});
