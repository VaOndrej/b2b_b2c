import test from "node:test";
import assert from "node:assert/strict";
import { createVisibilityLoader } from "../../app/services/margin-guard-visibility.loader.server.ts";
import type { getOrCreateMarginGuardConfig } from "../../app/services/margin-guard-config.server.ts";
import {
  resolveStorefrontQuantityConstraintsByProductId,
  resolveStorefrontVariantVisibilityByProductId,
} from "../../app/services/storefront-visibility.server.ts";

type MarginGuardConfig = Awaited<ReturnType<typeof getOrCreateMarginGuardConfig>>;

function stubConfig(): MarginGuardConfig {
  return {
    id: "default",
    b2bTag: "b2b",
    globalMinPricePercent: 70,
    b2bGlobalMinPricePercent: 70,
    productCatalogSourceType: "SHOPIFY",
    productCatalogAutoImportEnabled: true,
    productCatalogLastSyncAt: null,
    productCatalogLastSyncError: null,
    allowZeroFinalPrice: false,
    allowRemoveAtMinimumOrderQuantity: true,
    allowStacking: false,
    maxCombinedPercentOff: null,
    marginGuardEnabled: true,
    cartValidationStatus: "UNKNOWN",
    cartValidationLastError: null,
    cartValidationLastSyncAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    productFloors: [],
    productTierPrices: [],
    productQuantityRules: [],
    collectionQuantityRules: [],
    productCustomerQuantityRules: [],
    productVisibilityRules: [],
    productVariantVisibilityRules: [],
    collectionVisibilityRules: [],
    couponSegmentRules: [],
    discountRules: [],
    discountCombinationBlacklistRules: [],
    discountSegmentCaps: [],
  };
}

function baseDeps() {
  return {
    resolveStorefrontVisibilityByHandles: async () => ({
      productIdByHandle: {},
      hiddenHandles: [],
      hiddenProductIds: [],
      visibilityByHandle: {},
    }),
    fetchProductCollectionIdsByProductIds: async () => ({}),
    resolveStorefrontQuantityConstraintsByHandle: () => ({}),
    resolveStorefrontQuantityConstraintsByProductId: () => ({}),
    resolveStorefrontVariantVisibilityByProductId: () => ({}),
  };
}

test("visibility loader ignores ?segment= from querystring", async () => {
  const loader = createVisibilityLoader({
    async authenticatePublicAppProxy() {
      return { admin: undefined };
    },
    getOrCreateMarginGuardConfig: async () => stubConfig(),
    ...baseDeps(),
  });

  const request = new Request("https://example.com/apps/margin-guard/visibility?segment=B2B");
  const response = await loader({ request });
  const payload = await response.json();

  assert.equal(payload.segment, "B2C");
  assert.equal(payload.customerId, null);
});

test("visibility loader trusts logged_in_customer_id and ignores spoofed customerId param", async () => {
  const adminCalls: Array<Record<string, unknown> | undefined> = [];
  const loader = createVisibilityLoader({
    async authenticatePublicAppProxy() {
      return {
        admin: {
          async graphql(_query: string, options?: { variables?: Record<string, unknown> }) {
            adminCalls.push(options?.variables);
            return {
              async json() {
                return { data: { customer: { tags: ["b2b"] } } };
              },
            };
          },
        },
      };
    },
    getOrCreateMarginGuardConfig: async () => stubConfig(),
    ...baseDeps(),
  });

  const request = new Request(
    "https://example.com/apps/margin-guard/visibility?customerId=gid://shopify/Customer/SPOOFED&segment=B2C&logged_in_customer_id=gid://shopify/Customer/REAL",
  );
  const response = await loader({ request });
  const payload = await response.json();

  assert.equal(payload.segment, "B2B");
  assert.equal(adminCalls[0]?.id, "gid://shopify/Customer/REAL");
});

test("visibility loader prefers logged_in_customer_tags hint for B2B detection", async () => {
  const loader = createVisibilityLoader({
    async authenticatePublicAppProxy() {
      return {
        admin: {
          async graphql() {
            throw new Error("admin lookup should not be required when tags hint is present");
          },
        },
      };
    },
    getOrCreateMarginGuardConfig: async () => stubConfig(),
    ...baseDeps(),
  });

  const request = new Request(
    `https://example.com/apps/margin-guard/visibility?logged_in_customer_id=gid://shopify/Customer/REAL&logged_in_customer_tags=${encodeURIComponent(JSON.stringify(["b2b", "vip"]))}`,
  );
  const response = await loader({ request });
  const payload = await response.json();

  assert.equal(payload.segment, "B2B");
  assert.equal(payload.segmentDebug.source, "hint_tags");
  assert.deepEqual(payload.segmentDebug.normalizedTags, ["b2b", "vip"]);
});

test("visibility loader returns variant visibility payload alongside quantity rules", async () => {
  const loader = createVisibilityLoader({
    async authenticatePublicAppProxy() {
      return { admin: undefined };
    },
    getOrCreateMarginGuardConfig: async () => ({
      ...stubConfig(),
      productVariantVisibilityRules: [
        {
          id: "rule_1",
          configId: "default",
          productId: "gid://shopify/Product/500",
          variantId: "gid://shopify/ProductVariant/900",
          visibilityMode: "B2B_ONLY",
          customerId: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ],
    }),
    resolveStorefrontVisibilityByHandles: async () => ({
      productIdByHandle: {},
      hiddenHandles: [],
      hiddenProductIds: [],
      visibilityByHandle: {},
    }),
    fetchProductCollectionIdsByProductIds: async () => ({}),
    resolveStorefrontQuantityConstraintsByHandle: () => ({}),
    resolveStorefrontQuantityConstraintsByProductId: () => ({}),
    resolveStorefrontVariantVisibilityByProductId: () => ({
      "gid://shopify/Product/500": {
        hiddenVariantIds: ["gid://shopify/ProductVariant/900"],
      },
    }),
  });

  const request = new Request(
    "https://example.com/apps/margin-guard/visibility?product_ids=gid://shopify/Product/500",
  );
  const response = await loader({ request });
  const payload = await response.json();

  assert.deepEqual(payload.variantVisibilityByProductId, {
    "gid://shopify/Product/500": {
      hiddenVariantIds: ["gid://shopify/ProductVariant/900"],
    },
  });
});

// --- Phase B (integration tier): B2B branch without a real browser login ---
// The dev store uses NEW (passwordless) customer accounts, so a real B2B
// storefront login cannot be automated. Instead we drive the app-proxy
// visibility loader directly with a simulated B2B customer context (admin tag
// lookup mocked to return `b2b`) and assert the REAL rule resolution applies the
// B2B branch. A B2C counter-case proves the same rules do NOT apply anonymously.

const B2B_PRODUCT_ID = "gid://shopify/Product/700";
const B2B_ONLY_HIDDEN_VARIANT = "gid://shopify/ProductVariant/950";

function segmentScenarioConfig(): MarginGuardConfig {
  return {
    ...stubConfig(),
    productQuantityRules: [
      {
        id: "q_b2b",
        configId: "default",
        productId: B2B_PRODUCT_ID,
        segment: "B2B",
        minimumOrderQuantity: 6,
        stepQuantity: null,
        maxOrderQuantity: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ],
    productVariantVisibilityRules: [
      {
        id: "v_b2c_only",
        configId: "default",
        productId: B2B_PRODUCT_ID,
        variantId: B2B_ONLY_HIDDEN_VARIANT,
        visibilityMode: "B2C_ONLY",
        customerId: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ],
  };
}

function segmentScenarioDeps() {
  return {
    getOrCreateMarginGuardConfig: async () => segmentScenarioConfig(),
    resolveStorefrontVisibilityByHandles: async () => ({
      productIdByHandle: {},
      hiddenHandles: [],
      hiddenProductIds: [],
      visibilityByHandle: {},
    }),
    fetchProductCollectionIdsByProductIds: async () => ({}),
    resolveStorefrontQuantityConstraintsByHandle: () => ({}),
    // Use the REAL resolvers so the B2B branch is genuinely exercised.
    resolveStorefrontQuantityConstraintsByProductId,
    resolveStorefrontVariantVisibilityByProductId,
  };
}

test("integration: B2B customer (tag b2b via admin) gets B2B visibility + quantity rules applied", async () => {
  const loader = createVisibilityLoader({
    async authenticatePublicAppProxy() {
      return {
        admin: {
          async graphql() {
            return {
              async json() {
                return { data: { customer: { tags: ["b2b"] } } };
              },
            };
          },
        },
      };
    },
    ...segmentScenarioDeps(),
  });

  const request = new Request(
    `https://example.com/apps/margin-guard/visibility?product_ids=${encodeURIComponent(B2B_PRODUCT_ID)}&logged_in_customer_id=gid://shopify/Customer/1`,
  );
  const payload = await (await loader({ request })).json();

  assert.equal(payload.segment, "B2B");
  // B2C_ONLY variant must be hidden from a B2B visitor.
  assert.deepEqual(
    payload.variantVisibilityByProductId[B2B_PRODUCT_ID]?.hiddenVariantIds,
    [B2B_ONLY_HIDDEN_VARIANT],
  );
  // The B2B-segment MOQ rule must apply.
  assert.equal(
    payload.quantityConstraintsByProductId[B2B_PRODUCT_ID]?.minimumOrderQuantity,
    6,
  );
});

// --- Gated E2E segment override (mg_e2e_segment) at the loader boundary ------
// The override is the mechanism that lets the Playwright matrix render B2B
// EFFECTS without a real login. These tests pin both halves of the gate at the
// /visibility loader: armed → forces the segment and SKIPS the admin tag lookup;
// unarmed → the param is completely ignored.

async function withOverrideEnv<T>(
  patch: { flag?: string | undefined; nodeEnv?: string },
  run: () => Promise<T>,
): Promise<T> {
  const prevFlag = process.env.MARGIN_GUARD_E2E_OVERRIDE;
  const prevNodeEnv = process.env.NODE_ENV;
  if (patch.flag === undefined) {
    delete process.env.MARGIN_GUARD_E2E_OVERRIDE;
  } else {
    process.env.MARGIN_GUARD_E2E_OVERRIDE = patch.flag;
  }
  if (patch.nodeEnv !== undefined) {
    process.env.NODE_ENV = patch.nodeEnv;
  }
  try {
    return await run();
  } finally {
    if (prevFlag === undefined) delete process.env.MARGIN_GUARD_E2E_OVERRIDE;
    else process.env.MARGIN_GUARD_E2E_OVERRIDE = prevFlag;
    if (prevNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = prevNodeEnv;
  }
}

test("override: armed mg_e2e_segment=B2B forces B2B and SKIPS the admin tag lookup", async () => {
  await withOverrideEnv({ flag: "1", nodeEnv: "test" }, async () => {
    let adminCalled = false;
    const loader = createVisibilityLoader({
      async authenticatePublicAppProxy() {
        return {
          admin: {
            async graphql() {
              adminCalled = true;
              throw new Error("admin tag lookup must be skipped under the E2E override");
            },
          },
        };
      },
      ...segmentScenarioDeps(),
    });

    const request = new Request(
      `https://example.com/apps/margin-guard/visibility?product_ids=${encodeURIComponent(B2B_PRODUCT_ID)}&mg_e2e_segment=B2B`,
    );
    const payload = await (await loader({ request })).json();

    assert.equal(payload.segment, "B2B");
    assert.equal(adminCalled, false);
    // The forced B2B segment must drive the REAL rule resolution (B2B MOQ applies).
    assert.equal(
      payload.quantityConstraintsByProductId[B2B_PRODUCT_ID]?.minimumOrderQuantity,
      6,
    );
  });
});

test("override: param is IGNORED when the flag is not armed (anonymous stays B2C)", async () => {
  await withOverrideEnv({ flag: undefined, nodeEnv: "test" }, async () => {
    const loader = createVisibilityLoader({
      async authenticatePublicAppProxy() {
        return { admin: undefined };
      },
      ...segmentScenarioDeps(),
    });

    const request = new Request(
      `https://example.com/apps/margin-guard/visibility?product_ids=${encodeURIComponent(B2B_PRODUCT_ID)}&mg_e2e_segment=B2B`,
    );
    const payload = await (await loader({ request })).json();

    assert.equal(payload.segment, "B2C");
    assert.equal(payload.quantityConstraintsByProductId[B2B_PRODUCT_ID], undefined);
  });
});

test("visibility loader returns an empty discountConflictsByHandle by default", async () => {
  const loader = createVisibilityLoader({
    async authenticatePublicAppProxy() {
      return { admin: undefined };
    },
    getOrCreateMarginGuardConfig: async () => stubConfig(),
    ...baseDeps(),
  });

  const request = new Request(
    "https://example.com/apps/margin-guard/visibility?handles=widget",
  );
  const payload = await (await loader({ request })).json();

  assert.deepEqual(payload.discountConflictsByHandle, {});
});

test("visibility loader surfaces injected cart discount conflicts in the response", async () => {
  const loader = createVisibilityLoader({
    async authenticatePublicAppProxy() {
      return { admin: undefined };
    },
    getOrCreateMarginGuardConfig: async () => stubConfig(),
    ...baseDeps(),
    resolveCartDiscountConflictsByHandle: async (input: { segment: string; handles: string[] }) => ({
      widget: [
        {
          discountTitle: "Spring Sale",
          percentOff: 40,
          floorPercent: 70,
          totalPercentOff: 40,
          reason: "BELOW_FLOOR" as const,
        },
      ],
    }),
  });

  const request = new Request(
    "https://example.com/apps/margin-guard/visibility?handles=widget",
  );
  const payload = await (await loader({ request })).json();

  assert.equal(payload.discountConflictsByHandle.widget[0].discountTitle, "Spring Sale");
  assert.equal(payload.discountConflictsByHandle.widget[0].reason, "BELOW_FLOOR");
});

test("integration: anonymous B2C visitor does NOT get the B2B-only rules", async () => {
  const loader = createVisibilityLoader({
    async authenticatePublicAppProxy() {
      return { admin: undefined };
    },
    ...segmentScenarioDeps(),
  });

  const request = new Request(
    `https://example.com/apps/margin-guard/visibility?product_ids=${encodeURIComponent(B2B_PRODUCT_ID)}`,
  );
  const payload = await (await loader({ request })).json();

  assert.equal(payload.segment, "B2C");
  // B2C_ONLY variant stays visible for B2C → not in the hidden list.
  const hidden =
    payload.variantVisibilityByProductId[B2B_PRODUCT_ID]?.hiddenVariantIds ?? [];
  assert.equal(hidden.includes(B2B_ONLY_HIDDEN_VARIANT), false);
  // The B2B-only MOQ rule must NOT apply → no constraint entry for the product.
  assert.equal(payload.quantityConstraintsByProductId[B2B_PRODUCT_ID], undefined);
});
