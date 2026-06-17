import type { AutomaticDiscount } from "../../core/discount/conflict.detector.ts";

interface AdminGraphqlClient {
  graphql: (
    query: string,
    options?: { variables?: Record<string, unknown> },
  ) => Promise<{ json(): Promise<any> }>;
}

const AUTOMATIC_DISCOUNTS_QUERY = `#graphql
  query AutomaticDiscounts($first: Int!, $after: String) {
    discountNodes(first: $first, after: $after, query: "status:active method:automatic") {
      pageInfo { hasNextPage endCursor }
      nodes {
        id
        discount {
          __typename
          ... on DiscountAutomaticBasic {
            title
            status
            customerGets {
              value {
                __typename
                ... on DiscountPercentage { percentage }
              }
              items {
                __typename
                ... on AllDiscountItems { allItems }
                ... on DiscountProducts {
                  products(first: 250) { nodes { id } }
                }
                ... on DiscountCollections {
                  collections(first: 250) { nodes { id } }
                }
              }
            }
          }
        }
      }
    }
  }`;

const MAX_PAGES = 20;
const PAGE_SIZE = 100;

function roundPercent(value: number): number {
  return Math.round(Math.min(100, Math.max(0, value)) * 100) / 100;
}

/**
 * Normalize a single DiscountAutomaticBasic node into zero or more
 * AutomaticDiscount entries — one per entitled product/collection, or a single
 * GLOBAL entry when the discount applies to all items. Only percentage-value
 * automatic discounts are relevant to the margin floor; everything else is skipped.
 */
function normalizeDiscountNode(node: any): AutomaticDiscount[] {
  const discount = node?.discount;
  if (!discount || discount.__typename !== "DiscountAutomaticBasic") {
    return [];
  }
  if (String(discount.status ?? "").toUpperCase() !== "ACTIVE") {
    return [];
  }

  const value = discount.customerGets?.value;
  if (value?.__typename !== "DiscountPercentage") {
    return [];
  }
  // Shopify returns the percentage as a 0..1 decimal (0.4 === 40%).
  const percentOff = roundPercent(Number(value.percentage ?? 0) * 100);
  if (percentOff <= 0) {
    return [];
  }

  const id = String(node.id ?? "");
  const title = discount.title ? String(discount.title) : undefined;
  const items = discount.customerGets?.items;
  const itemsType = items?.__typename;

  if (itemsType === "AllDiscountItems") {
    return [{ id, title, percentOff, scope: "GLOBAL" }];
  }

  if (itemsType === "DiscountProducts") {
    const productNodes = Array.isArray(items.products?.nodes) ? items.products.nodes : [];
    return productNodes
      .map((product: any) => String(product?.id ?? ""))
      .filter(Boolean)
      .map((targetId: string) => ({
        id,
        title,
        percentOff,
        scope: "PRODUCT" as const,
        targetId,
      }));
  }

  if (itemsType === "DiscountCollections") {
    const collectionNodes = Array.isArray(items.collections?.nodes)
      ? items.collections.nodes
      : [];
    return collectionNodes
      .map((collection: any) => String(collection?.id ?? ""))
      .filter(Boolean)
      .map((targetId: string) => ({
        id,
        title,
        percentOff,
        scope: "COLLECTION" as const,
        targetId,
      }));
  }

  return [];
}

/**
 * Fetch all active automatic percentage discounts from Shopify and normalize
 * them into the conflict detector's AutomaticDiscount shape. Returns an empty
 * list (never throws) on failure so callers can degrade gracefully.
 */
export async function fetchAutomaticDiscounts(
  admin: AdminGraphqlClient,
): Promise<AutomaticDiscount[]> {
  const discounts: AutomaticDiscount[] = [];
  let after: string | null = null;

  try {
    for (let page = 0; page < MAX_PAGES; page += 1) {
      const response = await admin.graphql(AUTOMATIC_DISCOUNTS_QUERY, {
        variables: { first: PAGE_SIZE, after },
      });
      const payload = await response.json();
      const connection = payload?.data?.discountNodes;
      const nodes = Array.isArray(connection?.nodes) ? connection.nodes : [];
      for (const node of nodes) {
        discounts.push(...normalizeDiscountNode(node));
      }
      if (!connection?.pageInfo?.hasNextPage) {
        break;
      }
      after = connection.pageInfo.endCursor ?? null;
      if (!after) {
        break;
      }
    }
  } catch (error) {
    console.error("[fetchAutomaticDiscounts] failed:", error);
    return [];
  }

  return discounts;
}

export { normalizeDiscountNode };
