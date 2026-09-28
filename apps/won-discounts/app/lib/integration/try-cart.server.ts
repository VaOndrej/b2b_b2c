// Vyzkoušet košík, the Shopify part: the cart the merchant built (validated
// by the server form parser, SEC-1: only variant ids, quantities, a known
// currency/market, codes, a day) gets its real data from the Admin API —
//   prices     ProductVariant.contextualPricing(context: { country }) for a
//              country of the chosen market, so the price is the one that
//              market's buyers pay, in its currency (a currency Shopify does
//              not price in = "unknown", never 0 and never converted);
//   products   each variant's product (the form's product id is not trusted)
//              and, when some rule targets collections, the product's
//              collections;
// then planTryCart (the engine on the function's payload). All documents are
// validated against Admin 2026-04 (Shopify dev MCP) and request ≤ 1 000 points
// (tests/integration/try-cart.test.ts).

import type { WonDiscountsConfig } from "@won/core/discounts/config";
import { toMinorUnits } from "@won/core/discounts/money";

import { AdminTransportError } from "../admin-client.server";
import { shopLocalDateTime } from "../sync/sync.server";
import { targetScopes } from "../sync/products";
import type { TryCartInput } from "../../components/model/try-cart-form";
import type { CartPlanView, TryCartLineView, UiResult } from "../../components/model/types";
import { nowOf, type ShopCtx } from "./context.server";
import { planTryCart, type PricedLine } from "./try-cart-plan";

/** Variants per WonTryCartVariants call: 25 × 27 points = 675 requested (≤ 1 000; tests/integration/try-cart.test.ts). */
export const TRY_CART_VARIANTS_BATCH = 25;
/** Collection pages read per product beyond the first (100 each). */
const MAX_COLLECTION_PAGES = 10;
/** Shopify markets read for the country (10 per page). */
const MAX_MARKET_PAGES = 5;
const MARKETS_TTL_MS = 60_000;

export const TRY_CART_DOCUMENTS = Object.freeze({
  variants: `query WonTryCartVariants($ids: [ID!]!, $country: CountryCode, $priced: Boolean!, $withCollections: Boolean!) {
  nodes(ids: $ids) {
    __typename
    ... on ProductVariant {
      id
      title
      price
      contextualPricing(context: { country: $country }) @include(if: $priced) {
        price {
          amount
          currencyCode
        }
      }
      product {
        id
        title
        collections(first: 20) @include(if: $withCollections) {
          pageInfo {
            hasNextPage
            endCursor
          }
          nodes {
            id
          }
        }
      }
    }
  }
}`,
  productCollections: `query WonTryCartProductCollections($id: ID!, $after: String) {
  product(id: $id) {
    id
    collections(first: 100, after: $after) {
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
  markets: `query WonTryCartMarkets($after: String) {
  markets(first: 10, after: $after) {
    pageInfo {
      hasNextPage
      endCursor
    }
    nodes {
      handle
      status
      currencySettings {
        baseCurrency {
          currencyCode
        }
      }
      conditions {
        regionsCondition {
          regions(first: 1) {
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
  }
}`,
});

/** A Shopify read failed in a way the merchant should hear about (technical detail). */
class ShopifyReadError extends Error {}

async function call<T>(ctx: ShopCtx, query: string, variables: Record<string, unknown>): Promise<T> {
  let result;
  try {
    result = await ctx.client.graphql<T>(query, variables);
  } catch (error) {
    if (error instanceof Response) throw error;
    throw new ShopifyReadError(error instanceof AdminTransportError || error instanceof Error ? error.message : String(error));
  }
  if (!result.data) throw new ShopifyReadError((result.errors ?? []).map((e) => e.message).join("; ") || "no data");
  return result.data;
}

// --- Markets → a country per market ------------------------------------------------------

export interface MarketCountry {
  handle: string;
  active: boolean;
  currency: string | null;
  /** First country region of the market (ISO alpha-2), null when it has none. */
  country: string | null;
}

const marketCache = new Map<string, { at: number; value: MarketCountry[] }>();

/** Test hook. */
export function clearMarketCountryCache(): void {
  marketCache.clear();
}

type Page<T> = { pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: T[] };

/** The shop's markets with one country each (read_markets; cached 60 s; [] when unreadable). */
export async function readMarketCountries(ctx: ShopCtx): Promise<MarketCountry[]> {
  const hit = marketCache.get(ctx.shop);
  if (hit && Date.now() - hit.at < MARKETS_TTL_MS) return hit.value;
  const out: MarketCountry[] = [];
  try {
    let after: string | null = null;
    for (let page = 0; page < MAX_MARKET_PAGES; page++) {
      const data: {
        markets: Page<{
          handle: string;
          status: string;
          currencySettings?: { baseCurrency?: { currencyCode?: string } | null } | null;
          conditions?: { regionsCondition?: { regions?: { nodes: ({ __typename?: string; code?: string } | null)[] } | null } | null } | null;
        }>;
      } = await call(ctx, TRY_CART_DOCUMENTS.markets, { after });
      for (const node of data.markets.nodes) {
        const region = node.conditions?.regionsCondition?.regions?.nodes?.find((r) => r?.__typename === "MarketRegionCountry" && r.code);
        out.push({
          handle: node.handle,
          active: node.status === "ACTIVE",
          currency: node.currencySettings?.baseCurrency?.currencyCode ?? null,
          country: region?.code ? region.code.toUpperCase() : null,
        });
      }
      if (!data.markets.pageInfo.hasNextPage) break;
      after = data.markets.pageInfo.endCursor;
    }
  } catch (error) {
    if (error instanceof Response) throw error;
    return [];
  }
  marketCache.set(ctx.shop, { at: Date.now(), value: out });
  return out;
}

/**
 * The buyer country the simulation uses: the chosen market's first country;
 * without a chosen market, an active Shopify market selling in the currency.
 * The saved market countries (Pro targeting) are the fallback.
 */
export function countryFor(
  config: WonDiscountsConfig,
  markets: readonly MarketCountry[],
  currency: string,
  market: string | null,
): { country: string | null; handle: string | null } {
  if (market) {
    const shopify = markets.find((m) => m.handle === market);
    const saved = config.markets.find((m) => m.handle === market)?.countries?.[0] ?? null;
    return { country: shopify?.country ?? saved, handle: market };
  }
  const selling = markets.find((m) => m.active && m.currency === currency && m.country);
  return { country: selling?.country ?? null, handle: selling?.handle ?? null };
}

// --- Variants ---------------------------------------------------------------------------

interface VariantNode {
  __typename?: string;
  id?: string;
  title?: string;
  price?: string;
  contextualPricing?: { price?: { amount?: string; currencyCode?: string } | null } | null;
  product?: {
    id?: string;
    title?: string;
    collections?: Page<{ id: string }> | null;
  } | null;
}

interface ReadVariant {
  variantId: string;
  productId: string;
  title: string;
  variantTitle: string | null;
  /** Price in the requested currency, as Shopify's decimal string; null = no price in that currency. */
  amount: string | null;
  collectionIds: string[];
}

async function productCollections(ctx: ShopCtx, productId: string, after: string | null): Promise<string[]> {
  const out: string[] = [];
  let cursor = after;
  for (let page = 0; cursor && page < MAX_COLLECTION_PAGES; page++) {
    const data: { product: { collections: Page<{ id: string }> } | null } = await call(ctx, TRY_CART_DOCUMENTS.productCollections, {
      id: productId,
      after: cursor,
    });
    const connection = data.product?.collections;
    if (!connection) break;
    out.push(...connection.nodes.map((n) => n.id));
    cursor = connection.pageInfo.hasNextPage ? connection.pageInfo.endCursor : null;
  }
  return out;
}

async function readVariants(
  ctx: ShopCtx,
  ids: readonly string[],
  opts: { currency: string; country: string | null; shopCurrency: string | null; withCollections: boolean },
): Promise<Map<string, ReadVariant>> {
  const out = new Map<string, ReadVariant>();
  const extraPages = new Map<string, string>();
  for (let i = 0; i < ids.length; i += TRY_CART_VARIANTS_BATCH) {
    const batch = ids.slice(i, i + TRY_CART_VARIANTS_BATCH);
    // Without a country there is no market price to ask for: the base price (shop currency) is used.
    const data: { nodes: (VariantNode | null)[] } = await call(ctx, TRY_CART_DOCUMENTS.variants, {
      ids: batch,
      country: opts.country,
      priced: opts.country !== null,
      withCollections: opts.withCollections,
    });
    for (const node of data.nodes ?? []) {
      if (!node || node.__typename !== "ProductVariant" || !node.id || !node.product?.id) continue;
      let amount: string | null = null;
      if (opts.country) {
        const price = node.contextualPricing?.price;
        if (price?.amount && price.currencyCode === opts.currency) amount = price.amount;
      } else if (opts.currency === opts.shopCurrency && typeof node.price === "string") {
        amount = node.price;
      }
      const collections = node.product.collections;
      if (collections?.pageInfo.hasNextPage && collections.pageInfo.endCursor) extraPages.set(node.product.id, collections.pageInfo.endCursor);
      out.set(node.id, {
        variantId: node.id,
        productId: node.product.id,
        title: node.product.title ?? node.product.id,
        variantTitle: node.title && node.title !== "Default Title" ? node.title : null,
        amount,
        collectionIds: collections ? collections.nodes.map((n) => n.id) : [],
      });
    }
  }
  for (const [productId, cursor] of extraPages) {
    const more = await productCollections(ctx, productId, cursor);
    for (const variant of out.values()) if (variant.productId === productId) variant.collectionIds.push(...more);
  }
  return out;
}

// --- The action ---------------------------------------------------------------------------

export interface TryCartRun {
  result: UiResult | null;
  plan: CartPlanView | null;
  /** The cart as Shopify priced it (titles, unit price in the chosen currency). */
  lines?: TryCartLineView[];
}

export async function runTryCartPlan(
  ctx: ShopCtx,
  input: TryCartInput & { locale: "cs" | "en" },
  opts: {
    config: WonDiscountsConfig;
    shopCurrency: string | null;
    timezone: string | null;
    marketNames?: Readonly<Record<string, string>>;
  },
): Promise<TryCartRun> {
  if (!opts.timezone) {
    // Rule days are shop days: without the zone the plan could be a day off.
    return { result: { ok: false, reason: "shopify_unavailable", detail: "shop time zone" }, plan: null };
  }
  try {
    const markets = await readMarketCountries(ctx);
    const { country, handle } = countryFor(opts.config, markets, input.currency, input.market ?? null);
    const variants = await readVariants(
      ctx,
      [...new Set(input.lines.map((l) => l.variantId))],
      {
        currency: input.currency,
        country,
        shopCurrency: opts.shopCurrency,
        withCollections: targetScopes(opts.config).collectionIds.size > 0,
      },
    );
    if (input.lines.some((l) => !variants.has(l.variantId))) {
      return {
        result: { ok: false, reason: "invalid", errors: [{ field: "lines", key: "tryCart.error.unknownProduct" }] },
        plan: null,
      };
    }
    const priced: PricedLine[] = [];
    const missing: string[] = [];
    const lines: TryCartLineView[] = [];
    for (const line of input.lines) {
      const v = variants.get(line.variantId)!;
      const title = v.variantTitle ? `${v.title} (${v.variantTitle})` : v.title;
      const minor = v.amount === null ? null : toMinorUnits(v.amount, input.currency);
      lines.push({
        variantId: v.variantId,
        productId: v.productId,
        title: v.title,
        ...(v.variantTitle ? { variantTitle: v.variantTitle } : {}),
        quantity: line.quantity,
        unitPrice: minor === null ? {} : { [input.currency]: minor },
      });
      if (minor === null) {
        missing.push(title);
        continue;
      }
      priced.push({
        variantId: v.variantId,
        productId: v.productId,
        title,
        quantity: line.quantity,
        unitPrice: minor,
        collectionIds: v.collectionIds,
      });
    }
    if (missing.length > 0) {
      return { result: { ok: false, reason: "prices_unavailable", currency: input.currency, products: [...new Set(missing)] }, plan: null, lines };
    }
    const time = shopLocalDateTime(nowOf(ctx), opts.timezone).slice(11);
    const plan = planTryCart(opts.config, {
      lines: priced,
      currency: input.currency,
      countryCode: country,
      codes: input.codes,
      date: input.date,
      time,
      shopTimezone: opts.timezone,
      locale: input.locale,
      market: handle ? (opts.marketNames?.[handle] ?? handle) : null,
    });
    return { result: null, plan, lines };
  } catch (error) {
    if (error instanceof Response) throw error;
    if (error instanceof ShopifyReadError) return { result: { ok: false, reason: "shopify_unavailable", detail: error.message }, plan: null };
    throw error;
  }
}
