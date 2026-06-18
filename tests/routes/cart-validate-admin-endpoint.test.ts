import test from "node:test";
import assert from "node:assert/strict";
import { applyDiscountFunction } from "../../functions/discount-function/src/index.ts";
import { createCartValidateAdminAction } from "../../functions/cart-validation/src/admin-cart-validate-endpoint.ts";
import { resolvePricingSimulationInput } from "../../app/services/pricing-preview.server.ts";
import type { PricingPipelineInput } from "../../core/pricing/pricing.pipeline.ts";
import type {
  CatalogProductFloorInput,
  CatalogProductTierPriceInput,
  CatalogRuleset,
} from "../../core/catalog/catalog.ruleset.ts";

// MVP_5_3 #2.3c — the preview/endpoint now simulate against a resolved catalog
// ruleset (sourced from catalog tables). This factory builds a minimal one.
function makeCatalogRuleset(input: {
  catalogId?: string;
  isDefault?: boolean;
  segment?: "B2B" | "B2C";
  audienceTags?: string[];
  priority?: number;
  globalMinPricePercent?: number;
  b2bGlobalMinPricePercent?: number;
  productFloors?: CatalogProductFloorInput[];
  productTierPrices?: CatalogProductTierPriceInput[];
  allowStacking?: boolean;
  maxCombinedPercentOff?: number;
}): CatalogRuleset {
  const min = input.globalMinPricePercent ?? 70;
  return {
    catalogId: input.catalogId ?? "default",
    isDefault: input.isDefault ?? true,
    segment: input.segment ?? "B2C",
    audienceTags: input.audienceTags ?? [],
    priority: input.priority ?? 0,
    matchCompany: false,
    marketFilters: [],
    effectiveLayer: {} as any,
    floorRuleset: {
      global: {
        minPercentOfBasePrice: min,
        b2bMinPercentOfBasePrice: input.b2bGlobalMinPricePercent ?? min,
        allowZeroFinalPrice: false,
      },
      perProduct: (input.productFloors ?? []).map((floor) => ({
        productId: floor.productId,
        minPercentOfBasePrice: floor.minPercentOfBasePrice,
        allowZeroFinalPriceOverride: floor.allowZeroFinalPrice ?? undefined,
      })),
    },
    discountRuleset: {
      allowStacking: input.allowStacking ?? true,
      maxCombinedPercentOff: input.maxCombinedPercentOff,
      rules: [],
      blacklists: [],
      segmentCaps: [],
    },
    productFloors: input.productFloors ?? [],
    productTierPrices: input.productTierPrices ?? [],
  };
}

type CapturedValidateInput = {
  productId: string;
  segment: "B2B" | "B2C";
  quantity: number;
  collectionIds?: string[];
  enteredDiscountCodes?: string[];
  tierPrices?: Array<{ minQuantity: number; unitPrice: number }>;
};

function buildRequest(body: unknown, options?: { contentType?: string; method?: string }) {
  return new Request("https://example.test/app/api/cart-validate", {
    method: options?.method ?? "POST",
    headers:
      options?.contentType === undefined
        ? { "content-type": "application/json" }
        : { "content-type": options.contentType },
    body: JSON.stringify(body),
  });
}

test("cart-validate admin endpoint rejects non-json requests with explicit contract", async () => {
  const action = createCartValidateAdminAction({
    authenticateAdmin: async () => ({ session: { shop: "shop-a.myshopify.com" } }),
    getB2bTag: async () => "b2b",
    loadCatalogRulesets: async () => [makeCatalogRuleset({})],
    validate: (() => {
      throw new Error("validate must not be called for invalid requests");
    }) as unknown as never,
    recordViolation: (async () => undefined) as unknown as never,
  });

  const response = await action({
    request: buildRequest(
      { productId: "gid://shopify/Product/1", basePrice: 100 },
      { contentType: "text/plain" },
    ),
  });

  assert.equal(response.status, 415);
  const payload = await response.json();
  assert.equal(payload.ok, false);
  assert.equal(payload.contract, "INTERNAL_ADMIN_ENDPOINT");
});

test("cart-validate admin endpoint records violation for invalid line", async () => {
  const recorded: Array<Record<string, unknown>> = [];
  let capturedValidateInput: CapturedValidateInput | null = null;
  const action = createCartValidateAdminAction({
    authenticateAdmin: async () => ({ session: { shop: "shop-b.myshopify.com" } }),
    getB2bTag: async () => "wholesale",
    loadCatalogRulesets: async () => [
      makeCatalogRuleset({
        catalogId: "wholesale",
        isDefault: false,
        segment: "B2B",
        audienceTags: ["wholesale"],
        priority: 90,
        globalMinPricePercent: 70,
        b2bGlobalMinPricePercent: 60,
        allowStacking: false,
        maxCombinedPercentOff: 10,
      }),
      makeCatalogRuleset({}),
    ],
    validate: ((input: PricingPipelineInput) => {
      capturedValidateInput = {
        productId: input.productId,
        segment: input.segment,
        quantity: input.quantity ?? 1,
        collectionIds: input.collectionIds,
        enteredDiscountCodes: input.enteredDiscountCodes,
        tierPrices: input.tierPrices,
      };
      return {
        valid: false,
        errors: [{ code: "PRICE_BELOW_FLOOR" }],
        result: {
          finalPrice: 10,
          floorPrice: 70,
          violationAmount: 60,
        },
      };
    }) as unknown as never,
    recordViolation: (async (payload: Record<string, unknown>) => {
      recorded.push(payload);
    }) as unknown as never,
  });

  const response = await action({
    request: buildRequest({
      productId: "gid://shopify/Product/2",
      basePrice: 100,
      customerId: "gid://shopify/Customer/9",
      buyerHasB2BTag: true,
      buyerHasPurchasingCompany: false,
      quantity: 5,
      collectionIds: [
        "gid://shopify/Collection/SALE",
        "gid://shopify/Collection/FEATURED",
      ],
      enteredDiscountCodes: ["vip20", "extra10"],
      tierPrices: [{ minQuantity: 5, unitPrice: 82 }],
      discounts: [{ code: "DEMO", percentOff: 50 }],
    }),
  });

  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.ok, true);
  assert.equal(payload.contract, "INTERNAL_ADMIN_ENDPOINT");
  assert.equal(payload.result.valid, false);
  assert.equal(recorded.length, 1);
  assert.equal(recorded[0]?.shop, "shop-b.myshopify.com");
  assert.equal(recorded[0]?.productId, "gid://shopify/Product/2");
  assert.equal(recorded[0]?.segment, "B2B");
  assert.equal(recorded[0]?.source, "api_cart_validation");
  assert.ok(capturedValidateInput);
  const captured = capturedValidateInput as CapturedValidateInput;
  assert.equal(captured.productId, "gid://shopify/Product/2");
  assert.equal(captured.segment, "B2B");
  assert.equal(captured.quantity, 5);
  assert.deepEqual(captured.collectionIds, [
    "gid://shopify/Collection/SALE",
    "gid://shopify/Collection/FEATURED",
  ]);
  assert.deepEqual(captured.enteredDiscountCodes, [
    "VIP20",
    "EXTRA10",
  ]);
  assert.deepEqual(captured.tierPrices, [{ minQuantity: 5, unitPrice: 82 }]);
});

test("pricing input resolution hydrates persisted tier prices and B2B override", () => {
  const productId = "gid://shopify/Product/PREVIEW_HYDRATION";
  // A B2B catalog (override + B2B tier) and the default catalog (B2C tier). Each
  // catalog is a single audience, so the segment split now lives across catalogs.
  const b2bRuleset = makeCatalogRuleset({
    catalogId: "b2b",
    isDefault: false,
    segment: "B2B",
    audienceTags: ["b2b"],
    priority: 90,
    globalMinPricePercent: 70,
    b2bGlobalMinPricePercent: 60,
    productFloors: [
      {
        productId,
        segment: null,
        minPercentOfBasePrice: 70,
        allowZeroFinalPrice: null,
        b2bOverridePrice: 80,
      },
    ],
    productTierPrices: [
      { productId, segment: null, minQuantity: 5, unitPrice: 75 },
    ],
  });
  const defaultRuleset = makeCatalogRuleset({
    productTierPrices: [
      { productId, segment: null, minQuantity: 3, unitPrice: 90 },
    ],
  });

  const b2bQtyOne = resolvePricingSimulationInput(b2bRuleset, {
    productId,
    segment: "B2B",
    basePrice: 100,
    quantity: 1,
    collectionIds: [],
    enteredDiscountCodes: [],
    discounts: [],
  });
  const b2bQtyFive = resolvePricingSimulationInput(b2bRuleset, {
    productId,
    segment: "B2B",
    basePrice: 100,
    b2bOverridePrice: 999,
    quantity: 5,
    collectionIds: [],
    enteredDiscountCodes: [],
    discounts: [],
  });
  const b2cQtyThree = resolvePricingSimulationInput(defaultRuleset, {
    productId,
    segment: "B2C",
    basePrice: 100,
    quantity: 3,
    collectionIds: [],
    enteredDiscountCodes: [],
    discounts: [],
  });
  const explicitTierPreview = resolvePricingSimulationInput(b2bRuleset, {
    productId,
    segment: "B2B",
    basePrice: 100,
    b2bOverridePrice: 77,
    quantity: 5,
    tierPrices: [{ minQuantity: 5, unitPrice: 72 }],
    collectionIds: [],
    enteredDiscountCodes: [],
    discounts: [],
  });

  const b2bQtyOneResult = applyDiscountFunction({
    ...b2bQtyOne,
  });
  const b2bQtyFiveResult = applyDiscountFunction({
    ...b2bQtyFive,
  });
  const b2cQtyThreeResult = applyDiscountFunction({
    ...b2cQtyThree,
  });
  const explicitTierPreviewResult = applyDiscountFunction({
    ...explicitTierPreview,
  });

  assert.equal(
    b2bQtyOne.b2bOverridePrice,
    80,
    "[PREVIEW HYDRATION FAIL] Persisted B2B override must hydrate the preview when no explicit override is provided.",
  );
  assert.deepEqual(b2bQtyOne.tierPrices, [
    { minQuantity: 5, unitPrice: 75 },
  ]);
  assert.equal(
    b2bQtyOneResult.result.finalPrice,
    80,
    "[PREVIEW HYDRATION FAIL] Quantity 1 should use persisted B2B override.",
  );
  assert.equal(
    b2bQtyFiveResult.result.finalPrice,
    75,
    "[PREVIEW HYDRATION FAIL] Quantity 5 should use persisted tier pricing.",
  );
  assert.equal(
    b2cQtyThree.b2bOverridePrice,
    undefined,
    "[PREVIEW HYDRATION FAIL] B2C preview must not inherit B2B override pricing.",
  );
  assert.deepEqual(b2cQtyThree.tierPrices, [
    { minQuantity: 3, unitPrice: 90 },
  ]);
  assert.equal(
    b2cQtyThreeResult.result.finalPrice,
    90,
    "[PREVIEW HYDRATION FAIL] B2C quantity 3 should use the B2C tier price.",
  );
  assert.equal(
    explicitTierPreview.b2bOverridePrice,
    77,
    "[PREVIEW HYDRATION FAIL] Explicit preview override must win over persisted B2B override.",
  );
  assert.deepEqual(explicitTierPreview.tierPrices, [
    { minQuantity: 5, unitPrice: 72 },
  ]);
  assert.equal(
    explicitTierPreviewResult.result.finalPrice,
    72,
    "[PREVIEW HYDRATION FAIL] Explicit preview tier prices must override persisted tier pricing.",
  );
});
