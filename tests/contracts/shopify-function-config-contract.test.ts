import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  buildCartValidationFunctionConfig,
  buildDiscountFunctionConfig,
} from "../../core/config/function-config.ts";

const CART_VALIDATION_QUERY_PATH =
  "extensions/margin-guard-cart-validation/src/cart_validations_generate_run.graphql";
const DISCOUNT_QUERY_PATH =
  "extensions/margin-guard-discount-function/src/cart_lines_discounts_generate_run.graphql";

test("cart validation query contract is stable without nullable external variables", async () => {
  const query = await readFile(CART_VALIDATION_QUERY_PATH, "utf8");

  assert.equal(
    query.includes("$b2bTags"),
    false,
    "[CONTRACT FAIL] Cart validation query nesmi vyzadovat nullable b2bTags variable.",
  );
  assert.match(
    query,
    /hasAnyTag\(tags:\s*\["b2b"\]\)/,
    "[CONTRACT FAIL] Cart validation query musi mit stabilni fallback na b2b tag.",
  );
});

test("discount query variable contract matches generated config payload", async () => {
  const query = await readFile(DISCOUNT_QUERY_PATH, "utf8");

  assert.match(
    query,
    /\$b2bTags:\s*\[String!\]!\s*=\s*\["b2b"\]/,
    "[CONTRACT FAIL] Discount query musi deklarovat b2bTags variable s fallback default.",
  );
  assert.match(
    query,
    /hasAnyTag\(tags:\s*\$b2bTags\)/,
    "[CONTRACT FAIL] Discount query musi pouzivat b2bTags variable v hasAnyTag.",
  );

  const discountConfig = buildDiscountFunctionConfig({
    b2bTag: " wholesale ",
    globalMinPricePercent: 65,
    allowZeroFinalPrice: false,
    productFloors: [],
  });

  assert.deepEqual(
    discountConfig.b2bTags,
    ["wholesale"],
    "[CONTRACT FAIL] Generated discount config musi vzdy obsahovat normalizovane b2bTags.",
  );
});

test("floor mapping contract stays consistent across B2B/B2C maps", () => {
  const config = buildCartValidationFunctionConfig({
    b2bTag: "b2b",
    globalMinPricePercent: 70,
    allowZeroFinalPrice: false,
    productFloors: [
      {
        productId: "gid://shopify/Product/ALL_SEGMENTS",
        minPercentOfBasePrice: 80,
        segment: null,
        allowZeroFinalPrice: null,
      },
      {
        productId: "gid://shopify/Product/B2B_ONLY",
        minPercentOfBasePrice: 60,
        segment: "B2B",
        allowZeroFinalPrice: true,
      },
      {
        productId: "gid://shopify/Product/B2C_ONLY",
        minPercentOfBasePrice: 90,
        segment: "B2C",
        allowZeroFinalPrice: false,
      },
    ],
  });

  assert.equal(config.perProductFloorPercentsB2B["gid://shopify/Product/ALL_SEGMENTS"], 80);
  assert.equal(config.perProductFloorPercentsB2C["gid://shopify/Product/ALL_SEGMENTS"], 80);
  assert.equal(config.perProductFloorPercentsB2B["gid://shopify/Product/B2B_ONLY"], 60);
  assert.equal(config.perProductFloorPercentsB2C["gid://shopify/Product/B2B_ONLY"], undefined);
  assert.equal(config.perProductFloorPercentsB2C["gid://shopify/Product/B2C_ONLY"], 90);
  assert.equal(config.perProductFloorPercentsB2B["gid://shopify/Product/B2C_ONLY"], undefined);
});
