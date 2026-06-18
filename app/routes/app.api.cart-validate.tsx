import { authenticate } from "../shopify.server";
import { getOrCreateMarginGuardConfig, recordMarginViolation } from "../services/margin-guard-config.server";
import { loadCatalogRulesets } from "../services/catalog-ruleset.server";
import { validateCartLine } from "../../functions/cart-validation/src";
import {
  createCartValidateAdminAction,
} from "../../functions/cart-validation/src/admin-cart-validate-endpoint.ts";

// NOTE: do NOT re-export `createCartValidateAdminAction` here. It is a
// non-standard route export, so React Router cannot strip it from the client
// bundle (unlike `loader`/`action`), which drags its server-only transitive
// import (`pricing-preview.server.ts`) into the client build and fails it. The
// factory is only used by `action` (server) and imported directly from the
// function module by its test.
export const action = createCartValidateAdminAction({
  authenticateAdmin: (request) => authenticate.admin(request),
  getB2bTag: async () => (await getOrCreateMarginGuardConfig()).b2bTag,
  loadCatalogRulesets,
  validate: validateCartLine,
  recordViolation: recordMarginViolation,
});
