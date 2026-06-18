import test from "node:test";
import assert from "node:assert/strict";
import { cartValidationsGenerateRun } from "../../extensions/margin-guard-cart-validation/src/cart_validations_generate_run.js";
import { cartLinesDiscountsGenerateRun } from "../../extensions/margin-guard-discount-function/src/cart_lines_discounts_generate_run.js";
import {
  buildCatalogConfigFromCatalogs,
  type CatalogTableInput,
} from "../../core/config/function-config.ts";

// MVP_5_3 — the Shopify Functions enforce a tag-routed custom catalog (config
// assembled from catalog tables): resolveCatalog(matchedTags) → merge(default,
// catalog) → catalog price (% of base) + catalog floor + catalogId-scoped discount.

const LOCALIZATION = { language: { isoCode: "EN" } };

const SHOP = {
  b2bTag: "b2b",
  globalMinPricePercent: 70,
  allowZeroFinalPrice: false,
};
const DEFAULT_CATALOG: CatalogTableInput = { id: "default", isDefault: true, priority: 0 };

// Build a published config from the default catalog + the catalog under test.
function buildConfig(catalog: CatalogTableInput) {
  return buildCatalogConfigFromCatalogs(SHOP, [DEFAULT_CATALOG, catalog]);
}

const GOLD: CatalogTableInput = {
  id: "loyalty-gold",
  priority: 90,
  matchCompany: false,
  segment: "B2C",
  audienceTags: ["gold"],
  floorDefaultPercent: 50,
  priceRules: [{ scope: "CATALOG", mode: "PERCENT", value: 80 }],
  discountRules: [{ scope: "GLOBAL", percentOff: 15, priority: 50, stackMode: "STACKABLE" }],
};

function goldCustomer() {
  return { customer: { id: "gid://shopify/Customer/1", hasAnyTag: false, hasTags: [{ tag: "gold", hasTag: true }] } };
}
function plainCustomer() {
  return { customer: { id: "gid://shopify/Customer/2", hasAnyTag: false, hasTags: [{ tag: "gold", hasTag: false }] } };
}

function runCart(buyerIdentity: any, total: string) {
  return cartValidationsGenerateRun({
    cart: {
      buyerIdentity,
      lines: [
        {
          id: "l1",
          quantity: 1,
          merchandise: { __typename: "ProductVariant", product: { id: "gid://shopify/Product/1", title: "Widget" } },
          cost: { amountPerQuantity: { amount: total }, subtotalAmount: { amount: "100.00" }, totalAmount: { amount: total } },
        },
      ],
    },
    validation: { metafield: { jsonValue: buildConfig(GOLD) } },
    localization: LOCALIZATION,
  } as any);
}

function runDiscount(buyerIdentity: any) {
  return cartLinesDiscountsGenerateRun({
    cart: {
      buyerIdentity,
      lines: [
        {
          id: "l1",
          quantity: 1,
          cost: { subtotalAmount: { amount: "100.00" }, totalAmount: { amount: "100.00" } },
          merchandise: { __typename: "ProductVariant", product: { id: "gid://shopify/Product/1", inCollections: [] } },
        },
      ],
    },
    discount: { discountClasses: ["PRODUCT"], metafield: { jsonValue: buildConfig(GOLD) } },
    enteredDiscountCodes: [],
    localization: LOCALIZATION,
  } as any);
}

test("custom catalog runtime: gold customer gets catalog price (80% of base) + 50% floor → floor 40", () => {
  // Catalog base = 100 * 0.80 = 80; floor 50% → 40. Final 45 passes, 35 fails.
  assert.equal(runCart(goldCustomer(), "45.00").operations.length, 0, "45 ≥ catalog floor 40 → allowed");
  assert.equal(runCart(goldCustomer(), "35.00").operations.length > 0, true, "35 < catalog floor 40 → blocked");
});

test("custom catalog runtime: non-member resolves the default catalog (floor 70%)", () => {
  // Default catalog: base 100, floor 70 → final 45 is below floor → blocked.
  assert.equal(runCart(plainCustomer(), "45.00").operations.length > 0, true, "45 < default floor 70 → blocked");
  assert.equal(runCart(plainCustomer(), "75.00").operations.length, 0, "75 ≥ default floor 70 → allowed");
});

test("custom catalog runtime: COLLECTION% price rule applies to products in that collection", () => {
  const COLLECTION = "gid://shopify/Collection/777";
  const catalog: CatalogTableInput = {
    id: "wholesale-coll",
    priority: 80,
    audienceTags: ["gold"],
    floorDefaultPercent: 50,
    priceRules: [{ scope: "COLLECTION", targetId: COLLECTION, mode: "PERCENT", value: 80 }],
  };
  const config = buildConfig(catalog);
  const runWithCollection = (total: string, member: boolean) =>
    cartValidationsGenerateRun({
      cart: {
        buyerIdentity: goldCustomer(),
        lines: [
          {
            id: "l1",
            quantity: 1,
            merchandise: {
              __typename: "ProductVariant",
              product: {
                id: "gid://shopify/Product/9",
                title: "W",
                inCollections: [{ collectionId: COLLECTION, isMember: member }],
              },
            },
            cost: { amountPerQuantity: { amount: total }, subtotalAmount: { amount: "100.00" }, totalAmount: { amount: total } },
          },
        ],
      },
      validation: { metafield: { jsonValue: config } },
      localization: LOCALIZATION,
    } as any);

  // Member: catalog base = 100*0.80 = 80; floor 50% → 40. 45 passes, 35 fails.
  assert.equal(runWithCollection("45.00", true).operations.length, 0, "member: 45 ≥ collection-priced floor 40");
  assert.equal(runWithCollection("35.00", true).operations.length > 0, true, "member: 35 < floor 40 → blocked");
  // Non-member of the collection: no collection% → base 100, floor 50% → 50. 45 fails.
  assert.equal(runWithCollection("45.00", false).operations.length > 0, true, "non-member: 45 < base floor 50 → blocked");
});

test("custom catalog runtime: VARIANT FIXED price wins over product%, with variant precedence", () => {
  const PRODUCT = "gid://shopify/Product/55";
  const VARIANT = "gid://shopify/ProductVariant/501";
  const catalog: CatalogTableInput = {
    id: "variant-cat",
    priority: 85,
    audienceTags: ["gold"],
    floorDefaultPercent: 60,
    priceRules: [
      { scope: "VARIANT", targetId: VARIANT, mode: "FIXED", value: 50 },
      { scope: "PRODUCT", targetId: PRODUCT, mode: "PERCENT", value: 90 },
    ],
  };
  const config = buildConfig(catalog);
  const runVariant = (variantId: string, total: string) =>
    cartValidationsGenerateRun({
      cart: {
        buyerIdentity: goldCustomer(),
        lines: [
          {
            id: "l1",
            quantity: 1,
            merchandise: {
              __typename: "ProductVariant",
              id: variantId,
              product: { id: PRODUCT, title: "V", inCollections: [] },
            },
            cost: { amountPerQuantity: { amount: total }, subtotalAmount: { amount: "100.00" }, totalAmount: { amount: total } },
          },
        ],
      },
      validation: { metafield: { jsonValue: config } },
      localization: LOCALIZATION,
    } as any);

  // Targeted variant: FIXED 50 → floor 60% → 30. 35 passes, 25 fails.
  assert.equal(runVariant(VARIANT, "35.00").operations.length, 0, "variant FIXED 50 → floor 30 → 35 allowed");
  assert.equal(runVariant(VARIANT, "25.00").operations.length > 0, true, "25 < floor 30 → blocked");
  // Other variant of same product: product% 90 → base 90 → floor 60% → 54. 35 fails, 60 passes.
  assert.equal(runVariant("gid://shopify/ProductVariant/502", "35.00").operations.length > 0, true, "product% base 90 → floor 54 → 35 blocked");
  assert.equal(runVariant("gid://shopify/ProductVariant/502", "60.00").operations.length, 0, "60 ≥ floor 54 → allowed");
});

test("custom catalog runtime: a coupon restricted to a catalog is rejected outside it", () => {
  const catalog: CatalogTableInput = {
    id: "coupon-cat",
    priority: 80,
    audienceTags: ["gold"],
    coupons: ["VIP20"],
  };
  const config = buildConfig(catalog);
  const run = (buyer: any) =>
    cartLinesDiscountsGenerateRun({
      cart: {
        buyerIdentity: buyer,
        lines: [
          {
            id: "l1",
            quantity: 1,
            cost: { subtotalAmount: { amount: "100.00" }, totalAmount: { amount: "100.00" } },
            merchandise: { __typename: "ProductVariant", product: { id: "gid://shopify/Product/1", inCollections: [] } },
          },
        ],
      },
      discount: { discountClasses: ["PRODUCT"], metafield: { jsonValue: config } },
      enteredDiscountCodes: [{ code: "VIP20", rejectable: true }],
      localization: LOCALIZATION,
    } as any);

  const goldReject = run(goldCustomer()).operations.find((op: any) => op?.enteredDiscountCodesReject);
  assert.equal(goldReject, undefined, "gold member: VIP20 (allowed for its catalog) not rejected");
  const plainReject = run(plainCustomer()).operations.find((op: any) => op?.enteredDiscountCodesReject);
  assert.deepEqual(plainReject?.enteredDiscountCodesReject?.codes, [{ code: "VIP20" }], "non-member: VIP20 rejected");
});

test("custom catalog runtime: catalogId-scoped discount applies only to the member", () => {
  const gold = runDiscount(goldCustomer());
  const goldCandidate = gold.operations.find((op: any) => op?.productDiscountsAdd)?.productDiscountsAdd?.candidates?.[0];
  assert.equal(goldCandidate?.value?.percentage?.value, 15, "gold member gets the catalog's 15% discount");

  const plain = runDiscount(plainCustomer());
  const plainHasDiscount = plain.operations.some((op: any) => op?.productDiscountsAdd);
  assert.equal(plainHasDiscount, false, "non-member does not get the catalog-scoped discount");
});
