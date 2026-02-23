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
const CART_VALIDATION_TOML_PATH =
  "extensions/margin-guard-cart-validation/shopify.extension.toml";

test("cart validation query variable contract matches generated config payload", async () => {
  const query = await readFile(CART_VALIDATION_QUERY_PATH, "utf8");

  assert.match(
    query,
    /\$b2bTags:\s*\[String!\]!\s*=\s*\["b2b"\]/,
    "[CONTRACT FAIL] Cart validation query musi deklarovat b2bTags variable s fallback default.",
  );
  assert.match(
    query,
    /hasAnyTag\(tags:\s*\$b2bTags\)/,
    "[CONTRACT FAIL] Cart validation query musi pouzivat b2bTags variable v hasAnyTag.",
  );
  assert.match(
    query,
    /buyerIdentity\s*\{[\s\S]*purchasingCompany\s*\{[\s\S]*company\s*\{[\s\S]*id/,
    "[CONTRACT FAIL] Cart validation query musi nacitat purchasingCompany pro B2B role precedence.",
  );

  const cartConfig = buildCartValidationFunctionConfig({
    b2bTag: " wholesale ",
    globalMinPricePercent: 65,
    allowZeroFinalPrice: false,
    productFloors: [],
  });

  assert.deepEqual(
    cartConfig.b2bTags,
    ["wholesale"],
    "[CONTRACT FAIL] Generated cart validation config musi vzdy obsahovat normalizovane b2bTags.",
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
  assert.match(
    query,
    /buyerIdentity\s*\{[\s\S]*purchasingCompany\s*\{[\s\S]*company\s*\{[\s\S]*id/,
    "[CONTRACT FAIL] Discount query musi nacitat purchasingCompany pro B2B role precedence.",
  );
  assert.match(
    query,
    /enteredDiscountCodes\s*\{[\s\S]*code[\s\S]*rejectable/,
    "[CONTRACT FAIL] Discount query musi nacitat enteredDiscountCodes pro segment-based coupon validation.",
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
        b2bOverridePrice: 90,
      },
      {
        productId: "gid://shopify/Product/B2B_ONLY",
        minPercentOfBasePrice: 60,
        segment: "B2B",
        allowZeroFinalPrice: true,
        b2bOverridePrice: 55,
      },
      {
        productId: "gid://shopify/Product/B2C_ONLY",
        minPercentOfBasePrice: 90,
        segment: "B2C",
        allowZeroFinalPrice: false,
        b2bOverridePrice: 40,
      },
    ],
  });

  assert.equal(config.perProductFloorPercentsB2B["gid://shopify/Product/ALL_SEGMENTS"], 80);
  assert.equal(config.perProductFloorPercentsB2C["gid://shopify/Product/ALL_SEGMENTS"], 80);
  assert.equal(config.perProductFloorPercentsB2B["gid://shopify/Product/B2B_ONLY"], 60);
  assert.equal(config.perProductFloorPercentsB2C["gid://shopify/Product/B2B_ONLY"], undefined);
  assert.equal(config.perProductFloorPercentsB2C["gid://shopify/Product/B2C_ONLY"], 90);
  assert.equal(config.perProductFloorPercentsB2B["gid://shopify/Product/B2C_ONLY"], undefined);
  assert.equal(
    config.perProductB2BOverridePrices["gid://shopify/Product/ALL_SEGMENTS"],
    90,
  );
  assert.equal(
    config.perProductB2BOverridePrices["gid://shopify/Product/B2B_ONLY"],
    55,
  );
  assert.equal(
    config.perProductB2BOverridePrices["gid://shopify/Product/B2C_ONLY"],
    undefined,
  );
});

test("tier pricing mapping contract stays consistent across B2B/B2C maps", () => {
  const config = buildCartValidationFunctionConfig({
    b2bTag: "b2b",
    globalMinPricePercent: 70,
    allowZeroFinalPrice: false,
    productFloors: [],
    productTierPrices: [
      {
        productId: "gid://shopify/Product/ALL_SEGMENTS",
        segment: null,
        minQuantity: 5,
        unitPrice: 95,
      },
      {
        productId: "gid://shopify/Product/ALL_SEGMENTS",
        segment: "B2B",
        minQuantity: 5,
        unitPrice: 90,
      },
      {
        productId: "gid://shopify/Product/B2B_ONLY",
        segment: "B2B",
        minQuantity: 10,
        unitPrice: 80,
      },
      {
        productId: "gid://shopify/Product/B2C_ONLY",
        segment: "B2C",
        minQuantity: 3,
        unitPrice: 70,
      },
    ],
  });

  assert.deepEqual(config.perProductTierPricesB2B["gid://shopify/Product/ALL_SEGMENTS"], [
    { minQuantity: 5, unitPrice: 90 },
  ]);
  assert.deepEqual(config.perProductTierPricesB2C["gid://shopify/Product/ALL_SEGMENTS"], [
    { minQuantity: 5, unitPrice: 95 },
  ]);
  assert.deepEqual(config.perProductTierPricesB2B["gid://shopify/Product/B2B_ONLY"], [
    { minQuantity: 10, unitPrice: 80 },
  ]);
  assert.equal(
    config.perProductTierPricesB2C["gid://shopify/Product/B2B_ONLY"],
    undefined,
  );
  assert.deepEqual(config.perProductTierPricesB2C["gid://shopify/Product/B2C_ONLY"], [
    { minQuantity: 3, unitPrice: 70 },
  ]);
  assert.equal(
    config.perProductTierPricesB2B["gid://shopify/Product/B2C_ONLY"],
    undefined,
  );
});

test("coupon segment mapping contract normalizes codes and allowed segments", () => {
  const config = buildDiscountFunctionConfig({
    b2bTag: "b2b",
    globalMinPricePercent: 70,
    allowZeroFinalPrice: false,
    productFloors: [],
    couponSegmentRules: [
      { code: " vip20 ", allowedSegment: "B2B" },
      { code: "retail10", allowedSegment: "B2C" },
      { code: "all5", allowedSegment: "ALL" },
      { code: "fallback", allowedSegment: "ANY_UNKNOWN_VALUE" },
    ],
  });

  assert.deepEqual(config.couponSegmentRules, {
    VIP20: "B2B",
    RETAIL10: "B2C",
    ALL5: "ALL",
    FALLBACK: "ALL",
  });
});

test("cart validation extension maps input variables from metafield config", async () => {
  const toml = await readFile(CART_VALIDATION_TOML_PATH, "utf8");
  assert.match(
    toml,
    /\[extensions\.input\.variables\][\s\S]*namespace\s*=\s*"\$app:margin_guard"[\s\S]*key\s*=\s*"config"/,
    "[CONTRACT FAIL] Cart validation extension musi mapovat input variables z app metafieldu.",
  );
});
