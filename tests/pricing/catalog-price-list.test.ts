import test from "node:test";
import assert from "node:assert/strict";
import {
  resolveCatalogUnitPrice,
  type CatalogPriceRule,
} from "../../core/pricing/price-list.engine.ts";

const PRODUCT = "gid://shopify/Product/1";
const VARIANT = "gid://shopify/ProductVariant/11";
const COLLECTION_A = "gid://shopify/Collection/A";
const COLLECTION_B = "gid://shopify/Collection/B";

function rules(...r: CatalogPriceRule[]) {
  return r;
}

test("price-list: base price when no rules apply", () => {
  const result = resolveCatalogUnitPrice({ basePrice: 100, productId: PRODUCT });
  assert.equal(result.unitPrice, 100);
  assert.equal(result.source, "BASE");
});

test("price-list: catalog percent applies to base", () => {
  const result = resolveCatalogUnitPrice({
    basePrice: 100,
    productId: PRODUCT,
    priceRules: rules({ scope: "CATALOG", mode: "PERCENT", value: 90 }),
  });
  assert.equal(result.unitPrice, 90);
  assert.equal(result.source, "CATALOG_PERCENT");
});

test("price-list: most-specific percent wins (variant > product > collection > catalog)", () => {
  const all = rules(
    { scope: "CATALOG", mode: "PERCENT", value: 90 },
    { scope: "COLLECTION", mode: "PERCENT", targetId: COLLECTION_A, value: 80 },
    { scope: "PRODUCT", mode: "PERCENT", targetId: PRODUCT, value: 70 },
    { scope: "VARIANT", mode: "PERCENT", targetId: VARIANT, value: 60 },
  );
  const variant = resolveCatalogUnitPrice({ basePrice: 100, productId: PRODUCT, variantId: VARIANT, collectionIds: [COLLECTION_A], priceRules: all });
  assert.equal(variant.unitPrice, 60);
  assert.equal(variant.source, "VARIANT_PERCENT");

  // Drop variant rule → product wins.
  const product = resolveCatalogUnitPrice({ basePrice: 100, productId: PRODUCT, variantId: VARIANT, collectionIds: [COLLECTION_A], priceRules: all.filter((r) => r.scope !== "VARIANT") });
  assert.equal(product.unitPrice, 70);
  assert.equal(product.source, "PRODUCT_PERCENT");

  // Drop product too → collection wins.
  const collection = resolveCatalogUnitPrice({ basePrice: 100, productId: PRODUCT, collectionIds: [COLLECTION_A], priceRules: all.filter((r) => r.scope === "CATALOG" || r.scope === "COLLECTION") });
  assert.equal(collection.unitPrice, 80);
  assert.equal(collection.source, "COLLECTION_PERCENT");
});

test("price-list: FIXED at variant/product short-circuits the percent cascade", () => {
  const productFixed = resolveCatalogUnitPrice({
    basePrice: 100,
    productId: PRODUCT,
    variantId: VARIANT,
    priceRules: rules(
      { scope: "PRODUCT", mode: "FIXED", targetId: PRODUCT, value: 42 },
      { scope: "VARIANT", mode: "PERCENT", targetId: VARIANT, value: 50 },
    ),
  });
  // Per §4 ordering, product FIXED (step 2) beats variant PERCENT (step 3).
  assert.equal(productFixed.unitPrice, 42);
  assert.equal(productFixed.source, "PRODUCT_FIXED");

  const variantFixed = resolveCatalogUnitPrice({
    basePrice: 100,
    productId: PRODUCT,
    variantId: VARIANT,
    priceRules: rules(
      { scope: "PRODUCT", mode: "FIXED", targetId: PRODUCT, value: 42 },
      { scope: "VARIANT", mode: "FIXED", targetId: VARIANT, value: 30 },
    ),
  });
  assert.equal(variantFixed.unitPrice, 30);
  assert.equal(variantFixed.source, "VARIANT_FIXED");
});

test("price-list: collection percent picks the lowest among matching collections", () => {
  const result = resolveCatalogUnitPrice({
    basePrice: 100,
    productId: PRODUCT,
    collectionIds: [COLLECTION_A, COLLECTION_B],
    priceRules: rules(
      { scope: "COLLECTION", mode: "PERCENT", targetId: COLLECTION_A, value: 85 },
      { scope: "COLLECTION", mode: "PERCENT", targetId: COLLECTION_B, value: 75 },
    ),
  });
  assert.equal(result.unitPrice, 75);
  assert.equal(result.source, "COLLECTION_PERCENT");
});

test("price-list: tier overrides the price-list result when a threshold matches", () => {
  const result = resolveCatalogUnitPrice({
    basePrice: 100,
    productId: PRODUCT,
    quantity: 10,
    priceRules: rules({ scope: "PRODUCT", mode: "PERCENT", targetId: PRODUCT, value: 80 }),
    tierPrices: [
      { minQuantity: 5, unitPrice: 70 },
      { minQuantity: 10, unitPrice: 60 },
    ],
  });
  assert.equal(result.unitPrice, 60);
  assert.equal(result.source, "TIER");
  // The pre-tier price-list value is still reported for transparency.
  assert.equal(result.priceListUnitPrice, 80);
});

test("price-list: PRODUCT FIXED reproduces the legacy B2B override base price", () => {
  // The old per-product b2bOverridePrice is, in catalog terms, a PRODUCT FIXED rule.
  const result = resolveCatalogUnitPrice({
    basePrice: 1000,
    productId: PRODUCT,
    priceRules: rules({ scope: "PRODUCT", mode: "FIXED", targetId: PRODUCT, value: 300 }),
  });
  assert.equal(result.unitPrice, 300);
  assert.equal(result.source, "PRODUCT_FIXED");
});
