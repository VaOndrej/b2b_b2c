// Admin GraphQL 2026-04 documents for native discounts. Every operation below
// was validated with the Shopify dev MCP (api "admin", version 2026-04); the
// results are listed in .superpowers/sdd/2026-09-28-won-discounts-mvp1/task-4-report.md.
// Required scopes: read_discounts (via write_discounts), read_products.
//
// Query cost: the list query nests three item connections and one code
// connection per node, so its page size stays small (DETECT_PAGE_SIZE ×
// ~(3 × DETECT_ITEMS + DETECT_CODES)) to stay well under the 1 000 point cap.
// `recurringCycleLimit` is Int on some discount types and Int! on others, so
// each type reads it under its own alias (one response key, one type).

import { GQL as SYNC_GQL } from "../sync/graphql.ts";

/** Nodes per `discountNodes` page during detection. */
export const DETECT_PAGE_SIZE = 10;
/** Products / variants / collections read per node during detection (the move reads all). */
export const DETECT_ITEMS = 20;
/** Redeem codes read per node during detection (the move reads all). */
export const DETECT_CODES = 5;
/** First page of each list in the full read; the rest is paged by the *_PAGE documents. */
export const FULL_READ_ITEMS = 100;
export const FULL_READ_CODES = 100;

const FRAGMENTS = `
fragment WonNativeItems on DiscountItems {
  __typename
  ... on AllDiscountItems {
    allItems
  }
  ... on DiscountProducts {
    products(first: $items) {
      nodes { id }
      pageInfo { hasNextPage endCursor }
    }
    productVariants(first: $items) {
      nodes { id }
      pageInfo { hasNextPage endCursor }
    }
  }
  ... on DiscountCollections {
    collections(first: $items) {
      nodes { id }
      pageInfo { hasNextPage endCursor }
    }
  }
}

fragment WonNativeCustomerGets on DiscountCustomerGets {
  value {
    __typename
    ... on DiscountPercentage { percentage }
    ... on DiscountAmount {
      amount { amount currencyCode }
      appliesOnEachItem
    }
  }
  items { ...WonNativeItems }
  appliesOnOneTimePurchase
  appliesOnSubscription
}

fragment WonNativeMinimum on DiscountMinimumRequirement {
  __typename
  ... on DiscountMinimumQuantity { greaterThanOrEqualToQuantity }
  ... on DiscountMinimumSubtotal {
    greaterThanOrEqualToSubtotal { amount currencyCode }
  }
}

fragment WonNativeContext on DiscountContext {
  __typename
  ... on DiscountBuyerSelectionAll { all }
}

fragment WonNativeDestination on DiscountShippingDestinationSelection {
  __typename
  ... on DiscountCountryAll { allCountries }
  ... on DiscountCountries { countries includeRestOfWorld }
}

fragment WonNativeCodes on DiscountRedeemCodeConnection {
  nodes { code }
  pageInfo { hasNextPage endCursor }
}

fragment WonNativeDiscountFields on Discount {
  __typename
  ... on DiscountCodeBasic {
    title status startsAt endsAt asyncUsageCount usageLimit appliesOncePerCustomer discountClasses
    codeBasicCycleLimit: recurringCycleLimit
    codesCount { count precision }
    codes(first: $codes) { ...WonNativeCodes }
    customerGets { ...WonNativeCustomerGets }
    minimumRequirement { ...WonNativeMinimum }
    combinesWith { orderDiscounts productDiscounts shippingDiscounts }
    context { ...WonNativeContext }
  }
  ... on DiscountAutomaticBasic {
    title status startsAt endsAt asyncUsageCount discountClasses
    autoBasicCycleLimit: recurringCycleLimit
    customerGets { ...WonNativeCustomerGets }
    minimumRequirement { ...WonNativeMinimum }
    combinesWith { orderDiscounts productDiscounts shippingDiscounts }
    context { ...WonNativeContext }
  }
  ... on DiscountCodeFreeShipping {
    title status startsAt endsAt asyncUsageCount usageLimit appliesOncePerCustomer appliesOnOneTimePurchase appliesOnSubscription
    codeShipCycleLimit: recurringCycleLimit
    codesCount { count precision }
    codes(first: $codes) { ...WonNativeCodes }
    destinationSelection { ...WonNativeDestination }
    maximumShippingPrice { amount currencyCode }
    minimumRequirement { ...WonNativeMinimum }
    combinesWith { orderDiscounts productDiscounts shippingDiscounts }
    context { ...WonNativeContext }
  }
  ... on DiscountAutomaticFreeShipping {
    title status startsAt endsAt asyncUsageCount appliesOnOneTimePurchase appliesOnSubscription
    autoShipCycleLimit: recurringCycleLimit
    destinationSelection { ...WonNativeDestination }
    maximumShippingPrice { amount currencyCode }
    minimumRequirement { ...WonNativeMinimum }
    combinesWith { orderDiscounts productDiscounts shippingDiscounts }
    context { ...WonNativeContext }
  }
  ... on DiscountCodeBxgy {
    title status discountClasses
    combinesWith { orderDiscounts productDiscounts shippingDiscounts }
    codes(first: $codes) { ...WonNativeCodes }
  }
  ... on DiscountAutomaticBxgy {
    title status discountClasses
    combinesWith { orderDiscounts productDiscounts shippingDiscounts }
  }
  ... on DiscountCodeApp {
    title status discountClasses
    combinesWith { orderDiscounts productDiscounts shippingDiscounts }
    codes(first: $codes) { ...WonNativeCodes }
    appDiscountType { appKey functionId title app { title } }
  }
  ... on DiscountAutomaticApp {
    title status discountClasses
    combinesWith { orderDiscounts productDiscounts shippingDiscounts }
    appDiscountType { appKey functionId title app { title } }
  }
}
`;

export const GQL = Object.freeze({
  shop: `query WonNativeShop {
  shop {
    currencyCode
    ianaTimezone
  }
}
`,

  /** Detection: every discount node, paged. Variables: after, first, items, codes. */
  list: `query WonNativeDiscounts($after: String, $first: Int!, $items: Int!, $codes: Int!) {
  discountNodes(first: $first, after: $after, sortKey: ID) {
    pageInfo {
      hasNextPage
      endCursor
    }
    nodes {
      id
      discount {
        ...WonNativeDiscountFields
      }
    }
  }
}
${FRAGMENTS}`,

  /** Full read of one node (first page of each list). Variables: id, items, codes. */
  one: `query WonNativeDiscount($id: ID!, $items: Int!, $codes: Int!) {
  discountNode(id: $id) {
    id
    discount {
      ...WonNativeDiscountFields
    }
  }
}
${FRAGMENTS}`,

  exists: `query WonNativeDiscountExists($id: ID!) {
  discountNode(id: $id) {
    id
  }
}
`,

  productsPage: `query WonNativeProductsPage($id: ID!, $after: String) {
  discountNode(id: $id) {
    id
    discount {
      __typename
      ... on DiscountCodeBasic { customerGets { items { ...WonNativeProductsPage } } }
      ... on DiscountAutomaticBasic { customerGets { items { ...WonNativeProductsPage } } }
    }
  }
}

fragment WonNativeProductsPage on DiscountItems {
  ... on DiscountProducts {
    products(first: 250, after: $after) {
      nodes { id }
      pageInfo { hasNextPage endCursor }
    }
  }
}
`,

  variantsPage: `query WonNativeVariantsPage($id: ID!, $after: String) {
  discountNode(id: $id) {
    id
    discount {
      __typename
      ... on DiscountCodeBasic { customerGets { items { ...WonNativeVariantsPage } } }
      ... on DiscountAutomaticBasic { customerGets { items { ...WonNativeVariantsPage } } }
    }
  }
}

fragment WonNativeVariantsPage on DiscountItems {
  ... on DiscountProducts {
    productVariants(first: 250, after: $after) {
      nodes { id }
      pageInfo { hasNextPage endCursor }
    }
  }
}
`,

  collectionsPage: `query WonNativeCollectionsPage($id: ID!, $after: String) {
  discountNode(id: $id) {
    id
    discount {
      __typename
      ... on DiscountCodeBasic { customerGets { items { ...WonNativeCollectionsPage } } }
      ... on DiscountAutomaticBasic { customerGets { items { ...WonNativeCollectionsPage } } }
    }
  }
}

fragment WonNativeCollectionsPage on DiscountItems {
  ... on DiscountCollections {
    collections(first: 250, after: $after) {
      nodes { id }
      pageInfo { hasNextPage endCursor }
    }
  }
}
`,

  codesPage: `query WonNativeCodesPage($id: ID!, $after: String) {
  discountNode(id: $id) {
    id
    discount {
      __typename
      ... on DiscountCodeBasic { codes(first: 250, after: $after) { ...WonNativeCodesPage } }
      ... on DiscountCodeFreeShipping { codes(first: 250, after: $after) { ...WonNativeCodesPage } }
    }
  }
}

fragment WonNativeCodesPage on DiscountRedeemCodeConnection {
  nodes { code }
  pageInfo { hasNextPage endCursor }
}
`,

  codeDelete: `mutation WonNativeCodeDelete($id: ID!) {
  discountCodeDelete(id: $id) {
    deletedCodeDiscountId
    userErrors { field code message }
  }
}
`,

  automaticDelete: `mutation WonNativeAutomaticDelete($id: ID!) {
  discountAutomaticDelete(id: $id) {
    deletedAutomaticDiscountId
    userErrors { field code message }
  }
}
`,

  codeBasicCreate: `mutation WonNativeCodeBasicCreate($input: DiscountCodeBasicInput!) {
  discountCodeBasicCreate(basicCodeDiscount: $input) {
    codeDiscountNode { id }
    userErrors { field code message }
  }
}
`,

  automaticBasicCreate: `mutation WonNativeAutomaticBasicCreate($input: DiscountAutomaticBasicInput!) {
  discountAutomaticBasicCreate(automaticBasicDiscount: $input) {
    automaticDiscountNode { id }
    userErrors { field code message }
  }
}
`,

  codeFreeShippingCreate: `mutation WonNativeCodeFreeShippingCreate($input: DiscountCodeFreeShippingInput!) {
  discountCodeFreeShippingCreate(freeShippingCodeDiscount: $input) {
    codeDiscountNode { id }
    userErrors { field code message }
  }
}
`,

  automaticFreeShippingCreate: `mutation WonNativeAutomaticFreeShippingCreate($input: DiscountAutomaticFreeShippingInput!) {
  discountAutomaticFreeShippingCreate(freeShippingAutomaticDiscount: $input) {
    automaticDiscountNode { id }
    userErrors { field code message }
  }
}
`,

  /** Up to 250 codes per call (Shopify maximum); asynchronous. */
  redeemCodesAdd: `mutation WonNativeRedeemCodesAdd($id: ID!, $codes: [DiscountRedeemCodeInput!]!) {
  discountRedeemCodeBulkAdd(discountId: $id, codes: $codes) {
    bulkCreation { id done }
    userErrors { field code message }
  }
}
`,

  redeemCodesStatus: `query WonNativeRedeemCodesStatus($id: ID!) {
  discountRedeemCodeBulkCreation(id: $id) {
    done
    codesCount
    importedCount
    failedCount
  }
}
`,

  /** Which discount holds a code (restore idempotency + "code taken" checks). */
  codeLookup: `query WonNativeCodeLookup($code: String!) {
  codeDiscountNodeByCode(code: $code) {
    id
    codeDiscount {
      __typename
      ... on DiscountCodeBasic { title createdAt }
      ... on DiscountCodeFreeShipping { title createdAt }
      ... on DiscountCodeApp { title asyncUsageCount }
    }
  }
}
`,

  /**
   * The shop's Won function config as Shopify holds it: the sync layer's own
   * read-back document (app/lib/sync/graphql.ts, validated there). F2: before
   * a native comes back, Shopify must no longer run its Won rule.
   */
  shopFunctionConfig: SYNC_GQL.shopConfigReadBack,

  /**
   * Newest automatic discounts, 50 per page (F8: matched by type, title, start
   * and value before any create; paged until older than the backup).
   */
  recentAutomatic: `query WonNativeRecentAutomatic($after: String) {
  discountNodes(first: 50, after: $after, query: "method:automatic", sortKey: CREATED_AT, reverse: true) {
    pageInfo { hasNextPage endCursor }
    nodes {
      id
      discount {
        __typename
        ... on DiscountAutomaticBasic {
          title createdAt startsAt
          customerGets {
            value {
              __typename
              ... on DiscountPercentage { percentage }
              ... on DiscountAmount { amount { amount currencyCode } appliesOnEachItem }
            }
          }
        }
        ... on DiscountAutomaticFreeShipping { title createdAt startsAt }
      }
    }
  }
}
`,
});

export type GqlName = keyof typeof GQL;

/** Shopify's maximum codes per discountRedeemCodeBulkAdd call. */
export const REDEEM_CODES_PER_CALL = 250;
