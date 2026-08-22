// Won Toasts — Phase 8 trust-data bridge (writer).
//
// Reads recent orders (read_orders — only createdAt + line-item product/quantity,
// no PII), aggregates them with the pure core engine, and writes the result to
// `won.*` PRODUCT metafields that the theme won-schema engine reads:
//   • won.units_sold_30d (number_integer) — factual units in the window
//   • won.bestseller     (boolean)        — derived top-seller flag
//
// Pro-gated (the AI trust-data bridge is a Pro feature). Throttle-aware writes
// (batched metafieldsSet + backoff) — we learned the hard way that hammering the
// Admin API 500s everything.
//
// NOTE: the pure mapping (`ordersToSales`) is unit-tested; the I/O orchestration
// needs a live app run to verify end-to-end (no PII is read or stored).

import {
  computeProductPopularity,
  DEFAULT_POPULARITY_OPTIONS,
  type ProductSale,
} from "@won/core/toasts/popularity";
import { checkActivePlan } from "./billing.server";
import {
  ordersToSales,
  popularityToMetafields,
  type MetafieldInput,
  type OrderNode,
} from "./popularity-map";

export type AdminGraphql = {
  graphql: (
    query: string,
    opts?: { variables?: Record<string, unknown> },
  ) => Promise<Response>;
};

// ---- I/O (needs a live app run to verify) --------------------------------

const ORDERS_QUERY = `#graphql
  query WonPopularityOrders($cursor: String, $query: String!) {
    orders(first: 100, after: $cursor, query: $query, sortKey: CREATED_AT, reverse: true) {
      edges {
        node {
          createdAt
          lineItems(first: 50) { edges { node { quantity product { id } } } }
        }
      }
      pageInfo { hasNextPage endCursor }
    }
  }`;

const METAFIELDS_SET = `#graphql
  mutation WonPopularityMetafields($metafields: [MetafieldsSetInput!]!) {
    metafieldsSet(metafields: $metafields) {
      metafields { id }
      userErrors { field message }
    }
  }`;

const MAX_ORDER_PAGES = 20; // bound: <= 2000 recent orders per run
const METAFIELD_BATCH = 25; // metafieldsSet accepts up to 25 per call
const THROTTLE_PAUSE_MS = 1200;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const isThrottled = (payload: unknown): boolean =>
  Array.isArray((payload as { errors?: Array<{ extensions?: { code?: string } }> })?.errors) &&
  (payload as { errors: Array<{ extensions?: { code?: string } }> }).errors.some(
    (e) => e?.extensions?.code === "THROTTLED",
  );

/** Fetch recent orders within the window and flatten to sales. Paginated + capped. */
/**
 * The slice of the orders GraphQL response this function actually reads.
 * Every field is optional on purpose: API-2 says tolerate partial results, so
 * the type must not promise fields the API may omit. Malformed nodes are dropped
 * downstream by ordersToSales, which is unit-tested for exactly that.
 */
interface OrdersPayload {
  data?: {
    orders?: {
      edges?: ({ node?: OrderNode | null } | null)[];
      pageInfo?: { hasNextPage?: boolean; endCursor?: string | null };
    };
  };
}

export async function fetchRecentOrderSales(
  admin: AdminGraphql,
  windowDays: number,
  now: number,
): Promise<ProductSale[]> {
  const sinceIso = new Date(now - windowDays * 24 * 60 * 60 * 1000).toISOString();
  const query = `created_at:>=${sinceIso}`;
  const sales: ProductSale[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < MAX_ORDER_PAGES; page++) {
    let payload: OrdersPayload | undefined;
    for (let attempt = 0; attempt < 4; attempt++) {
      const res = await admin.graphql(ORDERS_QUERY, { variables: { cursor, query } });
      payload = (await res.json()) as OrdersPayload;
      if (!isThrottled(payload)) break;
      await sleep(THROTTLE_PAUSE_MS * (attempt + 1)); // linear backoff
    }
    const conn = payload?.data?.orders;
    if (!conn) break;
    sales.push(...ordersToSales((conn.edges ?? []).map((e) => e?.node)));
    if (!conn.pageInfo?.hasNextPage) break;
    cursor = conn.pageInfo.endCursor ?? null;
  }
  return sales;
}

/** Write metafields in throttle-aware batches. Returns count written. */
export async function writePopularityMetafields(
  admin: AdminGraphql,
  metafields: ReadonlyArray<MetafieldInput>,
): Promise<number> {
  let written = 0;
  for (let i = 0; i < metafields.length; i += METAFIELD_BATCH) {
    const batch = metafields.slice(i, i + METAFIELD_BATCH);
    for (let attempt = 0; attempt < 4; attempt++) {
      const res = await admin.graphql(METAFIELDS_SET, { variables: { metafields: batch } });
      const payload = await res.json();
      if (isThrottled(payload)) {
        await sleep(THROTTLE_PAUSE_MS * (attempt + 1));
        continue;
      }
      const errors = payload?.data?.metafieldsSet?.userErrors ?? [];
      if (errors.length > 0) console.error("[popularity] metafieldsSet userErrors:", JSON.stringify(errors));
      written += batch.length;
      break;
    }
    await sleep(300); // gentle pacing between batches
  }
  return written;
}

export interface PopularitySyncResult {
  ok: boolean;
  reason?: "not_pro";
  productsUpdated: number;
  bestsellers: number;
}

/** Orchestrate a full popularity recompute + write. Pro-gated. */
export async function runPopularitySync(
  admin: AdminGraphql,
  now: number = Date.now(),
  windowDays: number = DEFAULT_POPULARITY_OPTIONS.windowDays,
): Promise<PopularitySyncResult> {
  const plan = await checkActivePlan(admin);
  if (plan !== "pro") return { ok: false, reason: "not_pro", productsUpdated: 0, bestsellers: 0 };

  const sales = await fetchRecentOrderSales(admin, windowDays, now);
  const rows = computeProductPopularity(sales, { ...DEFAULT_POPULARITY_OPTIONS, windowDays, now });
  const written = await writePopularityMetafields(admin, popularityToMetafields(rows));
  console.log(`[popularity] wrote ${written} metafields for ${rows.length} products`);
  return {
    ok: true,
    productsUpdated: rows.length,
    bestsellers: rows.filter((r) => r.isBestseller).length,
  };
}
