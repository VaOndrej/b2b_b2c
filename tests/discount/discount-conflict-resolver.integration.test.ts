import test from "node:test";
import assert from "node:assert/strict";
import { resolveCartDiscountConflictsByHandle } from "../../app/services/discount-conflict.server.ts";
import type { CatalogRuleset } from "#core/catalog/catalog.ruleset";

/**
 * Tier 3 runtime integration: the conflict resolver must turn the live Shopify
 * automatic-discount query response + configured margin rules into the
 * handle-keyed cart notices that the storefront visibility loader serves and the
 * visibility script renders. Uses a fake admin client — no Prisma, no network.
 */

type GraphqlResponse = { json(): Promise<any> };

function fakeAdmin(
  automaticDiscountsPayload: any,
  unitPriceByProductId: Record<string, number> = {},
) {
  return {
    graphql: async (query: string): Promise<GraphqlResponse> => {
      if (query.includes("discountNodes")) {
        return { json: async () => automaticDiscountsPayload };
      }
      if (query.includes("ProductUnitPrices")) {
        return {
          json: async () => ({
            data: {
              nodes: Object.entries(unitPriceByProductId).map(([id, amount]) => ({
                __typename: "Product",
                id,
                priceRangeV2: { minVariantPrice: { amount: String(amount) } },
              })),
            },
          }),
        };
      }
      return { json: async () => ({ data: {} }) };
    },
  };
}

// MVP_5_3 #2.3c — the resolver now reads a per-catalog ruleset (sourced from
// catalog tables), not the legacy MarginGuardConfig children. The test injects a
// single default catalog ruleset with the floor under test.
function catalogRulesetsWithGlobalFloor(floorPercent: number): CatalogRuleset[] {
  return [
    {
      catalogId: "default",
      isDefault: true,
      segment: "B2C",
      audienceTags: [],
      priority: 0,
      matchCompany: false,
      marketFilters: [],
      effectiveLayer: {} as any,
      floorRuleset: {
        global: {
          minPercentOfBasePrice: floorPercent,
          b2bMinPercentOfBasePrice: floorPercent,
          allowZeroFinalPrice: false,
        },
        perProduct: [],
      },
      discountRuleset: {
        allowStacking: true,
        rules: [],
        blacklists: [],
        segmentCaps: [],
      },
      productFloors: [],
      productTierPrices: [],
    },
  ];
}

const GLOBAL_40_OFF_PAYLOAD = {
  data: {
    discountNodes: {
      pageInfo: { hasNextPage: false, endCursor: null },
      nodes: [
        {
          id: "gid://shopify/DiscountAutomaticNode/1",
          discount: {
            __typename: "DiscountAutomaticBasic",
            title: "Spring Sale",
            status: "ACTIVE",
            customerGets: {
              value: { __typename: "DiscountPercentage", percentage: 0.4 },
              items: { __typename: "AllDiscountItems", allItems: true },
            },
          },
        },
      ],
    },
  },
};

test("resolver maps a live automatic discount into a handle-keyed cart conflict", async () => {
  const byHandle = await resolveCartDiscountConflictsByHandle({
    admin: fakeAdmin(GLOBAL_40_OFF_PAYLOAD),
    catalogRulesets: catalogRulesetsWithGlobalFloor(70),
    matchedTags: [],
    handles: ["snowboard"],
    productIdByHandle: { snowboard: "gid://shopify/Product/1" },
    productCollectionIdsByProductId: {},
  });

  // 40% off vs 70% floor → conflict.
  assert.deepEqual(byHandle, {
    snowboard: [
      {
        discountTitle: "Spring Sale",
        valueType: "PERCENTAGE",
        percentOff: 40,
        floorPercent: 70,
        totalPercentOff: 40,
        reason: "BELOW_FLOOR",
      },
    ],
  });
});

const GLOBAL_FIXED_AMOUNT_PAYLOAD = {
  data: {
    discountNodes: {
      pageInfo: { hasNextPage: false, endCursor: null },
      nodes: [
        {
          id: "gid://shopify/DiscountAutomaticNode/2",
          discount: {
            __typename: "DiscountAutomaticBasic",
            title: "$40 off each",
            status: "ACTIVE",
            customerGets: {
              value: {
                __typename: "DiscountAmount",
                appliesOnEachItem: true,
                amount: { amount: "40.0" },
              },
              items: { __typename: "AllDiscountItems", allItems: true },
            },
          },
        },
      ],
    },
  },
};

test("resolver verifies a per-unit fixed-amount discount against the real price", async () => {
  const byHandle = await resolveCartDiscountConflictsByHandle({
    admin: fakeAdmin(GLOBAL_FIXED_AMOUNT_PAYLOAD, {
      "gid://shopify/Product/1": 100,
    }),
    catalogRulesets: catalogRulesetsWithGlobalFloor(70),
    matchedTags: [],
    handles: ["snowboard"],
    productIdByHandle: { snowboard: "gid://shopify/Product/1" },
    productCollectionIdsByProductId: {},
  });

  // $40 off a $100 product → 60 final vs 70 floor → conflict (40% equivalent).
  assert.deepEqual(byHandle, {
    snowboard: [
      {
        discountTitle: "$40 off each",
        valueType: "FIXED_AMOUNT",
        percentOff: 40,
        amount: 40,
        floorPercent: 70,
        totalPercentOff: 40,
        reason: "BELOW_FLOOR",
      },
    ],
  });
});

test("resolver returns no conflicts when the discount stays above the floor", async () => {
  const byHandle = await resolveCartDiscountConflictsByHandle({
    admin: fakeAdmin(GLOBAL_40_OFF_PAYLOAD),
    catalogRulesets: catalogRulesetsWithGlobalFloor(50), // 40% off → 60 final, above 50 floor
    matchedTags: [],
    handles: ["snowboard"],
    productIdByHandle: { snowboard: "gid://shopify/Product/1" },
    productCollectionIdsByProductId: {},
  });

  assert.deepEqual(byHandle, {});
});

test("resolver returns nothing without an admin client or handles", async () => {
  assert.deepEqual(
    await resolveCartDiscountConflictsByHandle({
      admin: undefined,
      catalogRulesets: catalogRulesetsWithGlobalFloor(70),
      matchedTags: [],
      handles: ["snowboard"],
      productIdByHandle: { snowboard: "gid://shopify/Product/1" },
      productCollectionIdsByProductId: {},
    }),
    {},
  );

  assert.deepEqual(
    await resolveCartDiscountConflictsByHandle({
      admin: fakeAdmin(GLOBAL_40_OFF_PAYLOAD),
      catalogRulesets: catalogRulesetsWithGlobalFloor(70),
      matchedTags: [],
      handles: [],
      productIdByHandle: {},
      productCollectionIdsByProductId: {},
    }),
    {},
  );
});
