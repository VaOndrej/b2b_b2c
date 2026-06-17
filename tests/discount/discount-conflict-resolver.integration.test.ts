import test from "node:test";
import assert from "node:assert/strict";
import { resolveCartDiscountConflictsByHandle } from "../../app/services/discount-conflict.server.ts";

/**
 * Tier 3 runtime integration: the conflict resolver must turn the live Shopify
 * automatic-discount query response + configured margin rules into the
 * handle-keyed cart notices that the storefront visibility loader serves and the
 * visibility script renders. Uses a fake admin client — no Prisma, no network.
 */

type GraphqlResponse = { json(): Promise<any> };

function fakeAdmin(automaticDiscountsPayload: any) {
  return {
    graphql: async (query: string): Promise<GraphqlResponse> => {
      if (query.includes("discountNodes")) {
        return { json: async () => automaticDiscountsPayload };
      }
      return { json: async () => ({ data: {} }) };
    },
  };
}

function configWithGlobalFloor(floorPercent: number) {
  return {
    globalMinPricePercent: floorPercent,
    b2bGlobalMinPricePercent: floorPercent,
    allowZeroFinalPrice: false,
    productFloors: [],
    allowStacking: true,
    maxCombinedPercentOff: null,
    discountRules: [],
    discountCombinationBlacklistRules: [],
    discountSegmentCaps: [],
  } as any;
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
    config: configWithGlobalFloor(70),
    segment: "B2C",
    handles: ["snowboard"],
    productIdByHandle: { snowboard: "gid://shopify/Product/1" },
    productCollectionIdsByProductId: {},
  });

  // 40% off vs 70% floor → conflict.
  assert.deepEqual(byHandle, {
    snowboard: [
      {
        discountTitle: "Spring Sale",
        percentOff: 40,
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
    config: configWithGlobalFloor(50), // 40% off → 60 final, above 50 floor
    segment: "B2C",
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
      config: configWithGlobalFloor(70),
      segment: "B2C",
      handles: ["snowboard"],
      productIdByHandle: { snowboard: "gid://shopify/Product/1" },
      productCollectionIdsByProductId: {},
    }),
    {},
  );

  assert.deepEqual(
    await resolveCartDiscountConflictsByHandle({
      admin: fakeAdmin(GLOBAL_40_OFF_PAYLOAD),
      config: configWithGlobalFloor(70),
      segment: "B2C",
      handles: [],
      productIdByHandle: {},
      productCollectionIdsByProductId: {},
    }),
    {},
  );
});
