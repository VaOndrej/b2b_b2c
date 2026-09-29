// Every Admin GraphQL document the sync layer sends. Each one was validated
// with the Shopify dev MCP (`validate`, api "admin", version 2026-04) — see
// .superpowers/sdd/2026-09-28-won-discounts-mvp1/task-3-report.md. The
// operation name is the key tests (fake AdminClient) dispatch on, so keep
// `query|mutation <Name>` as the first token of each document.
//
// Namespace `$app:won_discounts` is app-owned: only this app can read or write
// it, and the discount function reads the same keys:
//   shop     function_config  the shared config (C7), one atomic write for all nodes
//   node     function_vars    per-node input-query variables (role, campaign window)
//   product  product          productMetafieldValue(entry) = {"ruleIds", "variantRuleIds"}
// Which products carry `product` is sync bookkeeping in Prisma
// ProductTargetIndex (DATA-1), not in Shopify.
//
// Every document stays under Shopify's 1 000-point requested-cost cap per
// query (connections cost 2 + first × node cost); tests/lib/sync/query-cost.test.ts
// measures each one.

export const WON_NAMESPACE = "$app:won_discounts";
export const SHOP_CONFIG_KEY = "function_config";
export const NODE_VARS_KEY = "function_vars";
export const PRODUCT_KEY = "product";

export const GQL = {
  shop: `query WonSyncShop {
  shop {
    id
    ianaTimezone
    functionConfig: metafield(namespace: "$app:won_discounts", key: "function_config") {
      id
      value
    }
  }
}`,

  shopConfigReadBack: `query WonSyncShopConfigReadBack {
  shop {
    id
    metafield(namespace: "$app:won_discounts", key: "function_config") {
      id
      value
    }
  }
}`,

  functions: `query WonSyncFunctions {
  shopifyFunctions(first: 50) {
    nodes {
      id
      handle
      apiType
    }
  }
}`,

  nodes: `query WonSyncNodes($ids: [ID!]!) {
  nodes(ids: $ids) {
    __typename
    ... on DiscountAutomaticNode {
      id
      vars: metafield(namespace: "$app:won_discounts", key: "function_vars") {
        value
      }
      automaticDiscount {
        __typename
        ... on DiscountAutomaticApp {
          title
          status
          startsAt
          endsAt
          discountClasses
          combinesWith {
            productDiscounts
            orderDiscounts
            shippingDiscounts
          }
        }
      }
    }
    ... on DiscountCodeNode {
      id
      vars: metafield(namespace: "$app:won_discounts", key: "function_vars") {
        value
      }
      codeDiscount {
        __typename
        ... on DiscountCodeApp {
          title
          status
          startsAt
          endsAt
          discountClasses
          usageLimit
          appliesOncePerCustomer
          codesCount {
            count
          }
          combinesWith {
            productDiscounts
            orderDiscounts
            shippingDiscounts
          }
        }
      }
    }
  }
}`,

  automaticCreate: `mutation WonSyncAutomaticCreate($automaticAppDiscount: DiscountAutomaticAppInput!) {
  discountAutomaticAppCreate(automaticAppDiscount: $automaticAppDiscount) {
    automaticAppDiscount {
      discountId
    }
    userErrors {
      field
      message
      code
    }
  }
}`,

  automaticUpdate: `mutation WonSyncAutomaticUpdate($id: ID!, $automaticAppDiscount: DiscountAutomaticAppInput!) {
  discountAutomaticAppUpdate(id: $id, automaticAppDiscount: $automaticAppDiscount) {
    automaticAppDiscount {
      discountId
    }
    userErrors {
      field
      message
      code
    }
  }
}`,

  automaticDelete: `mutation WonSyncAutomaticDelete($id: ID!) {
  discountAutomaticDelete(id: $id) {
    deletedAutomaticDiscountId
    userErrors {
      field
      message
      code
    }
  }
}`,

  codeCreate: `mutation WonSyncCodeCreate($codeAppDiscount: DiscountCodeAppInput!) {
  discountCodeAppCreate(codeAppDiscount: $codeAppDiscount) {
    codeAppDiscount {
      discountId
    }
    userErrors {
      field
      message
      code
    }
  }
}`,

  codeUpdate: `mutation WonSyncCodeUpdate($id: ID!, $codeAppDiscount: DiscountCodeAppInput!) {
  discountCodeAppUpdate(id: $id, codeAppDiscount: $codeAppDiscount) {
    codeAppDiscount {
      discountId
    }
    userErrors {
      field
      message
      code
    }
  }
}`,

  codeDelete: `mutation WonSyncCodeDelete($id: ID!) {
  discountCodeDelete(id: $id) {
    deletedCodeDiscountId
    userErrors {
      field
      message
      code
    }
  }
}`,

  // Deactivate = endsAt := now → EXPIRED; codes, usage count and
  // once-per-customer history stay. Activate = endsAt := null → ACTIVE.
  // (live: scripts/sync/verify-code-facts.mjs, task-3-report.md "Fix round 1").
  codeDeactivate: `mutation WonSyncCodeDeactivate($id: ID!) {
  discountCodeDeactivate(id: $id) {
    codeDiscountNode {
      id
    }
    userErrors {
      field
      message
      code
    }
  }
}`,

  codeActivate: `mutation WonSyncCodeActivate($id: ID!) {
  discountCodeActivate(id: $id) {
    codeDiscountNode {
      id
    }
    userErrors {
      field
      message
      code
    }
  }
}`,

  redeemBulkAdd: `mutation WonSyncRedeemBulkAdd($discountId: ID!, $codes: [DiscountRedeemCodeInput!]!) {
  discountRedeemCodeBulkAdd(discountId: $discountId, codes: $codes) {
    bulkCreation {
      id
      done
      codesCount
      importedCount
      failedCount
    }
    userErrors {
      field
      message
      code
    }
  }
}`,

  redeemBulkStatus: `query WonSyncRedeemBulkStatus($id: ID!) {
  discountRedeemCodeBulkCreation(id: $id) {
    id
    done
    codesCount
    importedCount
    failedCount
    codes(first: 250) {
      nodes {
        code
        errors {
          field
          message
          code
        }
      }
    }
  }
}`,

  redeemBulkDelete: `mutation WonSyncRedeemBulkDelete($discountId: ID!, $ids: [ID!]) {
  discountCodeRedeemCodeBulkDelete(discountId: $discountId, ids: $ids) {
    job {
      id
      done
    }
    userErrors {
      field
      message
      code
    }
  }
}`,

  job: `query WonSyncJob($id: ID!) {
  job(id: $id) {
    id
    done
  }
}`,

  nodeCodes: `query WonSyncNodeCodes($id: ID!, $after: String) {
  discountNode(id: $id) {
    id
    discount {
      __typename
      ... on DiscountCodeApp {
        codes(first: 250, after: $after) {
          pageInfo {
            hasNextPage
            endCursor
          }
          nodes {
            id
            code
          }
        }
      }
    }
  }
}`,

  codeLookup: `query WonSyncCodeLookup($code: String!) {
  codeDiscountNodeByCode(code: $code) {
    id
    codeDiscount {
      __typename
      ... on DiscountCodeApp {
        title
        appDiscountType {
          functionId
        }
      }
      ... on DiscountCodeBasic {
        title
      }
      ... on DiscountCodeBxgy {
        title
      }
      ... on DiscountCodeFreeShipping {
        title
      }
    }
  }
}`,

  // Paged without a search `query`: the search index lags behind fresh
  // creates (MVP 0 prototypes), a plain listing does not.
  automaticLookup: `query WonSyncAutomaticLookup($after: String) {
  discountNodes(first: 100, after: $after) {
    pageInfo {
      hasNextPage
      endCursor
    }
    nodes {
      id
      discount {
        __typename
        ... on DiscountAutomaticApp {
          title
          appDiscountType {
            functionId
          }
        }
      }
    }
  }
}`,

  metafieldsSet: `mutation WonSyncMetafieldsSet($metafields: [MetafieldsSetInput!]!) {
  metafieldsSet(metafields: $metafields) {
    metafields {
      id
      key
      ownerType
    }
    userErrors {
      field
      message
      code
    }
  }
}`,

  metafieldsDelete: `mutation WonSyncMetafieldsDelete($metafields: [MetafieldIdentifierInput!]!) {
  metafieldsDelete(metafields: $metafields) {
    deletedMetafields {
      ownerId
      namespace
      key
    }
    userErrors {
      field
      message
    }
  }
}`,

  collectionProducts: `query WonSyncCollectionProducts($id: ID!, $after: String) {
  collection(id: $id) {
    id
    products(first: 250, after: $after) {
      pageInfo {
        hasNextPage
        endCursor
      }
      nodes {
        id
      }
    }
  }
}`,

  // How many products each targeted collection has (F2 re-review M-4/M-5):
  // Won reads at most MAX_COLLECTION_PRODUCTS collection members per sync.
  // Count.precision AT_LEAST = Shopify stopped counting at its limit.
  collectionSizes: `query WonSyncCollectionSizes($ids: [ID!]!) {
  nodes(ids: $ids) {
    __typename
    ... on Collection {
      id
      productsCount {
        count
        precision
      }
    }
  }
}`,

  variantProducts: `query WonSyncVariantProducts($ids: [ID!]!) {
  nodes(ids: $ids) {
    __typename
    ... on ProductVariant {
      id
      product {
        id
      }
    }
  }
}`,

  productVariants: `query WonSyncProductVariants($id: ID!, $after: String) {
  product(id: $id) {
    id
    variants(first: 250, after: $after) {
      pageInfo {
        hasNextPage
        endCursor
      }
      nodes {
        id
      }
    }
  }
}`,

  productMetafields: `query WonSyncProductMetafields($ids: [ID!]!) {
  nodes(ids: $ids) {
    __typename
    ... on Product {
      id
      metafield(namespace: "$app:won_discounts", key: "product") {
        id
        value
      }
    }
  }
}`,

  // Shopify Markets (Pro market targeting). Needs read_markets
  // (https://shopify.dev/docs/api/admin-graphql/2026-04/queries/markets). Paged
  // WITHOUT regions: markets(first: 50) × regions(first: 250) would request
  // ~12 500 points, far over the 1 000-point cap; regions are read per market.
  markets: `query WonSyncMarkets($after: String) {
  markets(first: 10, after: $after) {
    pageInfo {
      hasNextPage
      endCursor
    }
    nodes {
      id
      handle
      name
      status
      currencySettings {
        baseCurrency {
          currencyCode
        }
      }
    }
  }
}`,

  marketRegions: `query WonSyncMarketRegions($id: ID!, $after: String) {
  market(id: $id) {
    id
    conditions {
      regionsCondition {
        regions(first: 50, after: $after) {
          pageInfo {
            hasNextPage
            endCursor
          }
          nodes {
            __typename
            ... on MarketRegionCountry {
              code
            }
          }
        }
      }
    }
  }
}`,
} as const;

export type GqlName = keyof typeof GQL;

/** `WonSyncShop` from `query WonSyncShop {...}` (fakes and logs key on it). */
export function operationName(document: string): string {
  const match = /^\s*(?:query|mutation)\s+(\w+)/.exec(document);
  return match ? match[1]! : "anonymous";
}
