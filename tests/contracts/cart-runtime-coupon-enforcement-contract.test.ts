import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const CART_VALIDATION_QUERY_PATH =
  "extensions/margin-guard-cart-validation/src/cart_validations_generate_run.graphql";

test("cart validation query carries coupon-code attribute inputs for runtime coupon enforcement", async () => {
  const query = await readFile(CART_VALIDATION_QUERY_PATH, "utf8");

  assert.match(
    query,
    /marginGuardDiscountCodes:\s*attribute\(key:\s*"margin_guard_discount_codes"\)/,
    "[CONTRACT FAIL] Cart validation query musi nacitat margin_guard_discount_codes attribute pro coupon enforcement.",
  );
  assert.match(
    query,
    /discountCodes:\s*attribute\(key:\s*"discount_codes"\)/,
    "[CONTRACT FAIL] Cart validation query musi nacitat discount_codes attribute jako fallback pro coupon enforcement.",
  );
});
