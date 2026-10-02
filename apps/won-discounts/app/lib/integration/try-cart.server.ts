// Vyzkoušet košík, the Shopify part: the cart the merchant built (validated
// by the server form parser, SEC-1: only variant ids, quantities, a known
// currency/market, codes, a day) gets its real data from the Admin API —
//   prices     ProductVariant.contextualPricing(context: { country }) for a
//              country of the chosen market, so the price is the one that
//              market's buyers pay, in its currency (a currency Shopify does
//              not price in = "unknown", never 0 and never converted);
//   products   each variant's product (the form's product id is not trusted)
//              and the refs its `$app:won_discounts/product` metafield holds —
//              exactly what checkout reads (item 2: never a fresh recompute of
//              collection membership, which could promise a discount checkout
//              does not give yet, or hide one it still gives). While the
//              targeting is being refreshed, the product's collections are
//              read LIVE as well, only to say where Shopify and checkout
//              differ right now (a fresh joiner / a leaver);
//   costs      (margin protection on, MVP 2) each variant's purchase cost as
//              the cost mirror wrote it into the variant metafield checkout
//              reads (VariantCost.metafieldValue — no Shopify read); a cart in
//              another currency than the shop's converts it with a rate
//              ESTIMATED from market prices (median of market price / base
//              price over the cart's variants) — checkout uses Shopify's own
//              presentmentCurrencyRate, and the view says so (`rateEstimated`);
//   gifts      (rewards, MVP 4) each gift tier's first variant in the same
//              read, priced like the cart: a reached tier gets the gift line
//              the cart on the website adds (R8);
// then planTryCart on the config gated for the shop's plan (BILL-1), with
// checkout's own output mapping (item 8), and warnings when the last sync
// failed, the stored config is not in Shopify yet, or the targeting is being
// refreshed. All documents are validated against Admin 2026-04 (Shopify dev
// MCP) and request ≤ 1 000 points (tests/integration/try-cart.test.ts).

import type { WonDiscountsConfig } from "@won/core/discounts/config";
import { toMinorUnits } from "@won/core/discounts/money";
import { gateConfigForPlan } from "@won/core/discounts/plan-gate";

import { AdminTransportError } from "../admin-client.server";
import type { ShopPlan } from "@won/core/discounts/plan-gate";
import { t } from "../../i18n";
import { foldedForCheckout } from "../sync/margin-fold";
import { targetScopes } from "../sync/products";
import { appliedPlanOf, storedConfigNotApplied } from "../sync/runs";
import { canReadMarkets, loadSyncStatus } from "../sync/save-and-sync.server";
import { loadShopSyncFacts } from "../sync/sync-state.server";
import { shopLocalDateTime } from "../sync/sync.server";
import type { TryCartInput } from "../../components/model/try-cart-form";
import type { CartPlanView, TryCartLineView, UiResult, UiText } from "../../components/model/types";
import { nowOf, type ShopCtx } from "./context.server";
import { ctxPlan } from "./sync-status.server";
import { parseProductRefs, planTryCart, type PricedLine, type ProductRefs } from "./try-cart-plan";
import { parseCostValue } from "../sync/costs";

/** Variants per WonTryCartVariants call (≤ 1 000 requested points; tests/integration/try-cart.test.ts). */
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
        wonRefs: metafield(namespace: "$app:won_discounts", key: "product") {
          value
        }
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

/** The shop's markets with one country each (read_markets — optional; cached 60 s; [] without it or when unreadable). */
export async function readMarketCountries(ctx: ShopCtx): Promise<MarketCountry[]> {
  if (!canReadMarkets(ctx.scopes)) return [];
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
    wonRefs?: { value?: string | null } | null;
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
  /** The variant's base price (shop currency), for the rate estimate. */
  basePrice: string | null;
  /** The refs the product's metafield holds (what checkout reads). */
  refs: ProductRefs;
  /** The collections the product is in NOW in Shopify (read only with `withCollections`). */
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
  opts: { locale: "cs" | "en"; currency: string; country: string | null; shopCurrency: string | null; withCollections: boolean },
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
        // Never a raw GID in the merchant's text (audit fix round 2): an untitled product is said as such.
        title: node.product.title?.trim() || t(opts.locale, "common.untitledProduct"),
        variantTitle: node.title && node.title !== "Default Title" ? node.title : null,
        amount,
        basePrice: typeof node.price === "string" ? node.price : null,
        refs: parseProductRefs(node.product.wonRefs?.value ?? null),
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

/**
 * What the simulation cannot vouch for right now (item 8): the last sync
 * failed, the stored config is not in Shopify yet — or checkout still runs a
 * config built with Pro settings the shop's plan no longer runs (I-2) — and
 * whether the product targeting is being refreshed (`targetingStale`: the
 * plan warns only when the cart involves a collection rule). `stripped` =
 * what the plan gate takes out now.
 */
export async function tryCartSyncWarnings(
  ctx: Pick<ShopCtx, "db" | "shop">,
  opts: { plan?: ShopPlan; stripped?: number } = {},
): Promise<{ warnings: UiText[]; targetingStale: boolean }> {
  const [status, notApplied, facts, applied] = await Promise.all([
    loadSyncStatus(ctx.db, ctx.shop),
    storedConfigNotApplied(ctx.db, ctx.shop, opts.plan ? { plan: opts.plan } : {}),
    loadShopSyncFacts(ctx.db, ctx.shop),
    appliedPlanOf(ctx.db, ctx.shop),
  ]);
  const out: UiText[] = [];
  const proStillLive = opts.plan === "free" && applied === "pro" && (opts.stripped ?? 0) > 0;
  if (status && !status.ok) out.push({ key: "tryCart.warning.syncFailed" });
  else if (proStillLive) out.push({ key: "tryCart.warning.planPending" });
  else if (!status || notApplied) out.push({ key: "tryCart.warning.notApplied" });
  // The targeting warning is the plan's to give: only when the cart involves a collection rule (planTryCart).
  const targetingStale = facts.targetingStaleAt !== null || (status?.pending.includes("products_in_progress") ?? false);
  return { warnings: out, targetingStale };
}

// --- Margin protection (MVP 2) -------------------------------------------------------------------

/** The purchase costs checkout reads (the variant metafield the mirror wrote), by variant id. */
export async function mirroredCosts(ctx: Pick<ShopCtx, "db" | "shop">, variantIds: readonly string[]): Promise<Map<string, { cost: number; cur: string }>> {
  const rows = await ctx.db.variantCost.findMany({
    where: { shop: ctx.shop, variantId: { in: [...variantIds] }, metafieldValue: { not: null } },
    select: { variantId: true, metafieldValue: true },
  });
  const out = new Map<string, { cost: number; cur: string }>();
  for (const row of rows) {
    const value = parseCostValue(row.metafieldValue);
    if (value) out.set(row.variantId, value);
  }
  return out;
}

/**
 * Shop currency → cart currency: 1 in the shop currency; otherwise the median
 * of market price / base price over the given variants (an ESTIMATE: market
 * price adjustments and rounding are in it) — null when none has both.
 */
export function estimateShopToCartRate(
  variants: readonly { amount: string | null; basePrice: string | null }[],
  opts: { currency: string; shopCurrency: string | null },
): { rate: number | null; estimated: boolean } {
  if (opts.shopCurrency && opts.currency === opts.shopCurrency) return { rate: 1, estimated: false };
  const ratios = variants
    .map((v) => (v.amount !== null && v.basePrice !== null ? Number(v.amount) / Number(v.basePrice) : NaN))
    .filter((r) => Number.isFinite(r) && r > 0)
    .sort((a, b) => a - b);
  if (ratios.length === 0) return { rate: null, estimated: false };
  const mid = Math.floor(ratios.length / 2);
  const rate = ratios.length % 2 === 1 ? ratios[mid]! : (ratios[mid - 1]! + ratios[mid]!) / 2;
  return { rate, estimated: true };
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
    // MVP 6: the chosen time of day (a campaign's window), else the time now.
    const time = input.time ? `${input.time}:00` : shopLocalDateTime(nowOf(ctx), opts.timezone).slice(11);
    const plan0 = await ctxPlan(ctx);
    // K3: on Free the campaigns finishing after a downgrade still run (like the sync's gate).
    const finishing = (await loadShopSyncFacts(ctx.db, ctx.shop).catch(() => null))?.campaignsFinishing ?? [];
    const gate = gateConfigForPlan(opts.config, plan0, { now: `${input.date}T${time}`, finishing });
    // What checkout runs: a margin collection too large to read is folded into the whole store's values (P1-1).
    const gated = await foldedForCheckout(ctx.db, ctx.shop, gate.config);
    const { warnings, targetingStale } = await tryCartSyncWarnings(ctx, { plan: plan0, stripped: gate.stripped.length });
    // While collection membership is being refreshed, the products' collections are read LIVE too:
    // a fresh joiner (no ref yet) or a leaver (still a ref) is then said per line.
    const liveCollections = targetingStale && targetScopes(gated).collectionIds.size > 0;
    const markets = await readMarketCountries(ctx);
    const { country, handle } = countryFor(opts.config, markets, input.currency, input.market ?? null);
    // MVP 4 (R8): each gift tier offered in this currency → its first variant, the line the cart on the website adds.
    const giftTiers = gated.modules.rewards.gifts.filter((tier) => typeof tier.threshold[input.currency] === "number" && tier.choices.length > 0);
    const variants = await readVariants(ctx, [...new Set([...input.lines.map((l) => l.variantId), ...giftTiers.map((tier) => tier.choices[0]!)])], {
      locale: input.locale,
      currency: input.currency,
      country,
      shopCurrency: opts.shopCurrency,
      withCollections: liveCollections,
    });
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
    const giftCandidates = new Map<string, PricedLine & { choices: number }>();
    for (const tier of giftTiers) {
      const v = variants.get(tier.choices[0]!);
      const minor = v && v.amount !== null ? toMinorUnits(v.amount, input.currency) : null;
      if (!v || minor === null) continue;
      giftCandidates.set(tier.id, {
        variantId: v.variantId,
        productId: v.productId,
        title: v.variantTitle ? `${v.title} (${v.variantTitle})` : v.title,
        quantity: 1,
        unitPrice: minor,
        collectionIds: v.collectionIds,
        giftTierId: tier.id,
        choices: tier.choices.length,
      });
    }
    const productRefs = new Map([...variants.values()].map((v) => [v.productId, v.refs]));
    // Margin protection: costs as checkout reads them, and the shop → cart rate (estimated outside the shop currency).
    let margin: { shopToCartRate: number | null; rateEstimated: boolean } = { shopToCartRate: null, rateEstimated: false };
    if (gated.modules.margin.enabled) {
      const costs = await mirroredCosts(ctx, priced.map((line) => line.variantId));
      for (const line of priced) {
        const cost = costs.get(line.variantId);
        if (cost) Object.assign(line, { unitCost: cost.cost, unitCostCurrency: cost.cur });
      }
      const estimate = estimateShopToCartRate(input.lines.map((l) => variants.get(l.variantId)!), { currency: input.currency, shopCurrency: opts.shopCurrency });
      margin = { shopToCartRate: estimate.rate, rateEstimated: estimate.estimated };
    }
    const plan = planTryCart(gated, {
      shopCurrency: opts.shopCurrency,
      ...margin,
      productRefs,
      warnings,
      targetingStale,
      liveCollections,
      lines: priced,
      currency: input.currency,
      countryCode: country,
      codes: input.codes,
      date: input.date,
      time,
      shopTimezone: opts.timezone,
      locale: input.locale,
      market: handle ? (opts.marketNames?.[handle] ?? handle) : null,
      giftCandidates,
    });
    return { result: null, plan, lines };
  } catch (error) {
    if (error instanceof Response) throw error;
    if (error instanceof ShopifyReadError) return { result: { ok: false, reason: "shopify_unavailable", detail: error.message }, plan: null };
    throw error;
  }
}
