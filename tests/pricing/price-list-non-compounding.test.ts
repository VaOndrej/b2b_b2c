import test from "node:test";
import assert from "node:assert/strict";
import {
  resolveCatalogUnitPrice,
  type CatalogPriceRule,
} from "#core/pricing/price-list.engine";

/**
 * Non-compounding regression guard: percents must NOT stack — only the most-specific
 * scope applies, and it is always computed against the ORIGINAL base, never against an
 * already-discounted intermediate. A regression here would quietly over-discount.
 */

const PRODUCT = "gid://shopify/Product/1";
const VARIANT = "gid://shopify/ProductVariant/11";
const COLLECTION = "gid://shopify/Collection/A";

function rules(...r: CatalogPriceRule[]) {
  return r;
}

test("only the most-specific percent applies (variant wins over product/collection/catalog)", () => {
  const result = resolveCatalogUnitPrice({
    basePrice: 100,
    productId: PRODUCT,
    variantId: VARIANT,
    collectionIds: [COLLECTION],
    priceRules: rules(
      { scope: "CATALOG", mode: "PERCENT", value: 95 },
      { scope: "COLLECTION", targetId: COLLECTION, mode: "PERCENT", value: 90 },
      { scope: "PRODUCT", targetId: PRODUCT, mode: "PERCENT", value: 80 },
      { scope: "VARIANT", targetId: VARIANT, mode: "PERCENT", value: 70 },
    ),
  });
  // 70% of base only — NOT 0.95*0.90*0.80*0.70*base.
  assert.equal(result.unitPrice, 70);
  assert.equal(result.source, "VARIANT_PERCENT");
});

test("product percent applies to the ORIGINAL base, not a collection-discounted value", () => {
  const result = resolveCatalogUnitPrice({
    basePrice: 200,
    productId: PRODUCT,
    collectionIds: [COLLECTION],
    priceRules: rules(
      { scope: "COLLECTION", targetId: COLLECTION, mode: "PERCENT", value: 50 },
      { scope: "PRODUCT", targetId: PRODUCT, mode: "PERCENT", value: 80 },
    ),
  });
  // 80% of 200 = 160. Compounding would give 0.8*0.5*200 = 80.
  assert.equal(result.unitPrice, 160);
  assert.equal(result.source, "PRODUCT_PERCENT");
});

test("collection tie resolves to the lowest (most aggressive) percent, still non-compounding", () => {
  const COLLECTION_B = "gid://shopify/Collection/B";
  const result = resolveCatalogUnitPrice({
    basePrice: 100,
    productId: PRODUCT,
    collectionIds: [COLLECTION, COLLECTION_B],
    priceRules: rules(
      { scope: "COLLECTION", targetId: COLLECTION, mode: "PERCENT", value: 85 },
      { scope: "COLLECTION", targetId: COLLECTION_B, mode: "PERCENT", value: 75 },
    ),
  });
  assert.equal(result.unitPrice, 75, "lowest percent wins on a collection tie");
  assert.equal(result.source, "COLLECTION_PERCENT");
});
