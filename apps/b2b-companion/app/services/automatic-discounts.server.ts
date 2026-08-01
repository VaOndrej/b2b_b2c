import type { AutomaticDiscount } from "@won/core/discount/conflict.detector";

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
                ... on DiscountAmount {
                  appliesOnEachItem
                  amount { amount }
                }
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
          ... on DiscountAutomaticBxgy {
            title
            status
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
 * Resolve the value-shape of a DiscountAutomaticBasic.customerGets.value into the
 * value-aware fields the conflict detector understands. Returns null when the
 * value carries no effect (e.g. zero percentage/amount).
 */
function resolveBasicValue(
  value: any,
):
  | Pick<AutomaticDiscount, "valueType" | "percentOff">
  | Pick<AutomaticDiscount, "valueType" | "amount" | "amountScope">
  | { valueType: "UNSUPPORTED"; unsupportedKind: string }
  | null {
  if (value?.__typename === "DiscountPercentage") {
    // Shopify returns the percentage as a 0..1 decimal (0.4 === 40%).
    const percentOff = roundPercent(Number(value.percentage ?? 0) * 100);
    if (percentOff <= 0) {
      return null;
    }
    return { valueType: "PERCENTAGE", percentOff };
  }

  if (value?.__typename === "DiscountAmount") {
    const amount = Math.round(Number(value.amount?.amount ?? 0) * 100) / 100;
    if (!(amount > 0)) {
      return null;
    }
    return {
      valueType: "FIXED_AMOUNT",
      amount,
      amountScope: value.appliesOnEachItem === true ? "PER_UNIT" : "PER_ORDER",
    };
  }

  // DiscountOnQuantity and any other value shapes can't be converted to an
  // effective unit price reliably → flag for manual review.
  if (value?.__typename) {
    return { valueType: "UNSUPPORTED", unsupportedKind: String(value.__typename) };
  }
  return null;
}

/**
 * Normalize a single automatic discount node into zero or more AutomaticDiscount
 * entries — one per entitled product/collection, or a single GLOBAL entry when
 * the discount applies to all items. MVP_5_2: percentage AND fixed-amount values
 * are converted; BXGY and other value shapes are flagged UNSUPPORTED rather than
 * silently dropped. Free-shipping automatic discounts do not affect the product
 * floor and are skipped.
 */
function normalizeDiscountNode(node: any): AutomaticDiscount[] {
  const discount = node?.discount;
  if (!discount) {
    return [];
  }
  if (String(discount.status ?? "").toUpperCase() !== "ACTIVE") {
    return [];
  }

  const id = String(node.id ?? "");
  const title = discount.title ? String(discount.title) : undefined;

  // Buy X Get Y is a native type we cannot convert to an effective price.
  if (discount.__typename === "DiscountAutomaticBxgy") {
    return [{ id, title, scope: "GLOBAL", valueType: "UNSUPPORTED", unsupportedKind: "Buy X Get Y" }];
  }

  if (discount.__typename !== "DiscountAutomaticBasic") {
    return [];
  }

  const valueFields = resolveBasicValue(discount.customerGets?.value);
  if (!valueFields) {
    return [];
  }

  const items = discount.customerGets?.items;
  const itemsType = items?.__typename;

  if (itemsType === "AllDiscountItems") {
    return [{ id, title, scope: "GLOBAL", ...valueFields }];
  }

  if (itemsType === "DiscountProducts") {
    const productNodes = Array.isArray(items.products?.nodes) ? items.products.nodes : [];
    return productNodes
      .map((product: any) => String(product?.id ?? ""))
      .filter(Boolean)
      .map((targetId: string) => ({
        id,
        title,
        scope: "PRODUCT" as const,
        targetId,
        ...valueFields,
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
        scope: "COLLECTION" as const,
        targetId,
        ...valueFields,
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
