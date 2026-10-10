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
//   product  product          productMetafieldValue(entry) = {"ruleIds", "variantRuleIds", "marginRefs"?, "tierRef"?}
//   product  outlet           MVP 5 (contract O9, outlet.server.ts): {"d": display, "v": {"<variant numeric id>": left}},
//                              only while a sale runs on the product; the storefront block reads it
//   variant  outlet           MVP 5 (contract O6, outlet.server.ts): true while the variant is on sale; the function
//                              reads it as `wonOutlet` (A1: no other discount), the app proxy and the tier block too
//   variant  variant          the cost mirror (margin protection, MVP 2, costs.ts):
//                              {"cost": <inventoryItem.unitCost.amount>, "cur": "<its currency>"},
//                              only on variants with a cost > 0
//   variant  pdp              MVP 3 (contract K4, costs.ts): {"max": <the largest discount %
//                              margin protection allows at the variant's price>}, only on
//                              variants with a known cost while protection is on; the
//                              storefront reads it, the function never does
// And one APP-DATA metafield (MVP 3, contract K5, storefront.ts): owner = the app's
// AppInstallation, PLAIN namespace `won_discounts` (app-data metafields do not use
// `$app`: the owner isolates them), key `storefront_config`, type json — the
// theme block reads `app.metafields.won_discounts.storefront_config.value`.
// Which products carry `product` is sync bookkeeping in Prisma
// ProductTargetIndex (DATA-1), not in Shopify; which variants carry `variant`,
// Prisma VariantCost.
//
// Every document stays under Shopify's 1 000-point requested-cost cap per
// query (connections cost 2 + first × node cost); tests/lib/sync/query-cost.test.ts
// measures each one.

export const WON_NAMESPACE = "$app:won_discounts";
export const SHOP_CONFIG_KEY = "function_config";
export const NODE_VARS_KEY = "function_vars";
export const PRODUCT_KEY = "product";
export const VARIANT_COST_KEY = "variant";
/** MVP 5 (contract O9): product metafield the storefront's outlet block reads, {"d": display, "v": {variant: left}}. */
export const OUTLET_STOREFRONT_KEY = "outlet";
/** MVP 5 (contract O6): variant metafield `true` while the variant is on sale (the function's `wonOutlet`). */
export const OUTLET_VARIANT_KEY = "outlet";
/** Variant metafield `$app:won_discounts/pdp` (MVP 3, K4). */
export const VARIANT_PDP_KEY = "pdp";
/** App-data metafield (AppInstallation, plain namespace — K5). */
export const STOREFRONT_NAMESPACE = "won_discounts";
export const STOREFRONT_CONFIG_KEY = "storefront_config";

/**
 * Variants per page of the cost mirror's full pass. Shopify accepted
 * `productVariants(first: 250)` with this selection live (2026-09-29), but
 * the conservative requested-cost estimate (tests/lib/sync/query-cost.test.ts:
 * every object 1 point, MoneyV2 included) is 5 per variant, so a page of 150
 * (~753 points) stays under the 1 000-point cap by the book too.
 */
export const COST_PAGE_SIZE = 150;

export const GQL = {
  shop: `query WonSyncShop {
  shop {
    id
    ianaTimezone
    currencyCode
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

  // --- Storefront config (MVP 3, K5, storefront.ts): the app installation and its app-data metafield ------
  storefrontConfig: `query WonSyncStorefrontConfig {
  currentAppInstallation {
    id
    metafield(namespace: "won_discounts", key: "storefront_config") {
      id
      value
    }
  }
}`,

  // Storefront texts (storefront.ts writeStorefrontTexts): every app-data metafield of the namespace — one a
  // language (`tx_<locale>`) next to the config itself.
  storefrontTexts: `query WonSyncStorefrontTexts {
  currentAppInstallation {
    id
    metafields(namespace: "won_discounts", first: 100) {
      nodes {
        key
        value
      }
    }
  }
}`,

  // The gift variants' product handles (MVP 4, contract R7): Liquid renders a gift through
  // `all_products[handle]`. A deleted variant answers null.
  giftVariants: `query WonSyncGiftVariants($ids: [ID!]!) {
  nodes(ids: $ids) {
    ... on ProductVariant {
      id
      product {
        handle
      }
    }
  }
}`,

  // metafieldsSet under its own operation name: the storefront write is told apart from the shop /
  // product / variant writes (logs, tests).
  storefrontConfigSet: `mutation WonSyncStorefrontConfigSet($metafields: [MetafieldsSetInput!]!) {
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

  // Gift cards never take a discount (gift-cards.ts): every gift card product with its variants' flag.
  // Admin 2026-04: `gift_card` is a filter of the products query, `isGiftCard` a field of Product; read_products.
  // Four products a page: with 100 variants each the document stays under 1 000 points (a shop has a few gift cards).
  giftCardVariants: `query WonGiftCardVariants($after: String, $namespace: String!, $key: String!) {
  products(first: 4, after: $after, query: "gift_card:true") {
    nodes {
      id
      isGiftCard
      variants(first: 100) {
        nodes {
          id
          flag: metafield(namespace: $namespace, key: $key) {
            jsonValue
          }
        }
      }
    }
    pageInfo {
      hasNextPage
      endCursor
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
      title
      productsCount {
        count
        precision
      }
    }
  }
}`,

  // Membership read one by one (audit fix round 4): is each product in a collection this pass could not
  // read (the live config lists it; it is too large, or past the budget)? products.ts planProducts.
  productsInCollection: `query WonSyncProductsInCollection($ids: [ID!]!, $collection: ID!) {
  nodes(ids: $ids) {
    __typename
    ... on Product {
      id
      inCollection(id: $collection)
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
  // --- Cost mirror (margin protection, MVP 2, costs.ts) ------------------------------------
  // inventoryItem.unitCost reads with read_products alone (live, MVP 2 build
  // log; the MCP validator lists read_inventory as an alternative scope).
  // The shop currency the variant prices are in (MVP 3, pdp: the price → max. discount % in the shop currency).
  costShop: `query WonSyncCostShop {
  shop {
    currencyCode
  }
}`,

  costVariantsCount: `query WonSyncCostVariantsCount {
  productVariantsCount {
    count
    precision
  }
}`,

  costVariants: `query WonSyncCostVariants($after: String) {
  productVariants(first: 150, after: $after) {
    pageInfo {
      hasNextPage
      endCursor
    }
    nodes {
      id
      title
      price
      product {
        id
        title
      }
      inventoryItem {
        id
        unitCost {
          amount
          currencyCode
        }
      }
      cost: metafield(namespace: "$app:won_discounts", key: "variant") {
        value
      }
      pdp: metafield(namespace: "$app:won_discounts", key: "pdp") {
        value
      }
    }
  }
}`,

  costVariantNodes: `query WonSyncCostVariantNodes($ids: [ID!]!) {
  nodes(ids: $ids) {
    __typename
    ... on ProductVariant {
      id
      title
      price
      product {
        id
        title
      }
      inventoryItem {
        id
        unitCost {
          amount
          currencyCode
        }
      }
      cost: metafield(namespace: "$app:won_discounts", key: "variant") {
        value
      }
      pdp: metafield(namespace: "$app:won_discounts", key: "pdp") {
        value
      }
    }
  }
}`,

  // inventory_items/update names the inventory item; its variant is looked up
  // here (InventoryItem.variant is deprecated in favour of `variants`; an
  // inventory item belongs to one variant).
  costInventoryItems: `query WonSyncCostInventoryItems($ids: [ID!]!) {
  nodes(ids: $ids) {
    __typename
    ... on InventoryItem {
      id
      unitCost {
        amount
        currencyCode
      }
      variants(first: 1) {
        nodes {
          id
          title
          price
          product {
            id
            title
          }
          cost: metafield(namespace: "$app:won_discounts", key: "variant") {
            value
          }
          pdp: metafield(namespace: "$app:won_discounts", key: "pdp") {
            value
          }
        }
      }
    }
  }
}`,

  costProductVariants: `query WonSyncCostProductVariants($id: ID!, $after: String) {
  product(id: $id) {
    id
    title
    variants(first: 150, after: $after) {
      pageInfo {
        hasNextPage
        endCursor
      }
      nodes {
        id
        title
        price
        inventoryItem {
          id
          unitCost {
            amount
            currencyCode
          }
        }
        cost: metafield(namespace: "$app:won_discounts", key: "variant") {
          value
        }
        pdp: metafield(namespace: "$app:won_discounts", key: "pdp") {
          value
        }
      }
    }
  }
}`,

  // Výprodej (MVP 5, contracts O2–O5; app/lib/integration/outlet.server.ts). Validated with the Shopify dev
  // MCP (admin 2026-04): read_products for the reads, write_products for both mutations (price lists too).
  outletVariant: `query WonOutletVariant($id: ID!) {
  shop {
    currencyCode
  }
  productVariant(id: $id) {
    id
    price
    compareAtPrice
    displayName
    title
    product {
      id
      title
      isGiftCard
    }
  }
}`,

  // The price lists the admin offers (no markets: those need read_markets; the catalog title names the market).
  outletPriceLists: `query WonOutletPriceLists {
  priceLists(first: 25) {
    nodes {
      id
      name
      currency
      fixedPricesCount
      catalog {
        title
      }
    }
  }
}`,

  // One list's fixed prices of one product (query "product_id:<numeric id>"); the caller picks the variant.
  outletPriceListPrices: `query WonOutletPriceListPrices($id: ID!, $query: String!) {
  priceList(id: $id) {
    id
    name
    currency
    prices(first: 100, originType: FIXED, query: $query) {
      nodes {
        variant {
          id
        }
        price {
          amount
          currencyCode
        }
        compareAtPrice {
          amount
          currencyCode
        }
      }
    }
  }
}`,

  // Only the fields given change (an omitted compareAtPrice stays); compareAtPrice null removes it.
  outletVariantUpdate: `mutation WonOutletVariantUpdate($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
  productVariantsBulkUpdate(productId: $productId, variants: $variants) {
    productVariants {
      id
      price
      compareAtPrice
    }
    userErrors {
      field
      message
      code
    }
  }
}`,

  // A fixed price is written whole (price + compareAtPrice); variantIdsToDelete is always [] here.
  outletFixedPrices: `mutation WonOutletFixedPrices($priceListId: ID!, $pricesToAdd: [PriceListPriceInput!]!, $variantIdsToDelete: [ID!]!) {
  priceListFixedPricesUpdate(priceListId: $priceListId, pricesToAdd: $pricesToAdd, variantIdsToDelete: $variantIdsToDelete) {
    pricesAdded {
      variant {
        id
      }
      price {
        amount
        currencyCode
      }
      compareAtPrice {
        amount
      }
    }
    deletedFixedPriceVariantIds
    userErrors {
      field
      message
      code
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
