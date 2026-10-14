// Umístění na webu (14 Oct 2026), balík B2: the line of a product card the PAGE could not compute. On a collection or
// search page the embed prints every card's text (snippets/won-card-tier.liquid); a `<won-discounts show="card-tier">`
// tag elsewhere (the home page, recommendations, a cart drawer) names a product the page does not list, and
// assets/won-discounts-tags.js asks the app proxy (GET /apps/won-discounts/card-tiers) for those handles at once.
// One brain: core cardTier — the decision the Liquid snippet is the twin of (property test against planCart) — over
// the SAME inputs the snippet reads: the LIVE storefront config (the app-data metafield the embed reads), each
// product's `$app:won_discounts/product` metafield (tierRef, marginRefs), its variants' sale flag and cost mirror,
// and its cheapest price in the page's currency (contextual pricing for the page's country). The answer is the break,
// never a cost or a margin; the script words it with the page's texts. Cached like cart-plan.server.ts: for
// CARD_TIERS_CACHE_MS per shop, dropped when the app writes to the shop (onAdminWrite), a shop's reads limited a minute.

import { cardTier, type CardTier, type CardTierInput } from "@won/core/discounts/card-tier";

import { onAdminWrite, type AdminClient } from "../admin-client.server";

export const CARD_TIERS_MAX_HANDLES = 50;
export const CARD_TIERS_CACHE_MS = 600_000;
/** Products cached at most for one shop, and entries for all shops together (a public endpoint: the handles come from the browser). */
export const CARD_TIERS_SHOP_MAX = 2_000;
export const CARD_TIERS_CACHE_MAX = 100_000;
/** Requests a minute per shop that may read Shopify (cached answers are not counted). */
export const CARD_TIERS_READS_PER_MINUTE = 30;
/** Liquid checks at most this many variants (snippets/won-card-tier.liquid): a product with more shows nothing. */
const MAX_VARIANTS = 50;

export class CardTiersRateLimited extends Error {}

export interface CardTiersRequest {
  handles: string[];
  /** The page's currency (cart.currency.iso_code). */
  currency: string;
  /** The storefront market's handle (Liquid localization.market.handle). */
  market: string | null;
  /** The page's country (Shopify.country): the cheapest price in the page's currency. */
  country: string;
}

export type CardTiersAnswer = { ok: true; cards: Record<string, Exclude<CardTier, null>> };

const HANDLE = /^[\p{L}\p{N}][\p{L}\p{N}_-]{0,254}$/u;
const CURRENCY = /^[A-Z]{3}$/;
const COUNTRY = /^[A-Z]{2}$/;
const MARKET = /^[\p{L}\p{N}_-]{1,64}$/u;

/** The query string the tags script sends; anything else is null (400). */
export function parseCardTiersRequest(params: URLSearchParams): CardTiersRequest | null {
  const handles = [...new Set((params.get("h") ?? "").split(",").filter(Boolean))];
  const currency = params.get("cur") ?? "";
  const market = params.get("mk") || null;
  const country = params.get("c") ?? "";
  if (handles.length === 0 || handles.length > CARD_TIERS_MAX_HANDLES || !handles.every((h) => HANDLE.test(h))) return null;
  if (!CURRENCY.test(currency) || (market !== null && !MARKET.test(market)) || !COUNTRY.test(country)) return null;
  return { handles, currency, market, country };
}

/** Validated against the Admin API (Shopify dev MCP). App-data metafields use a plain namespace (K5). */
export const CARD_TIERS_DOCUMENTS = Object.freeze({
  config: `query WonCardTiersConfig {
  currentAppInstallation {
    metafield(namespace: "won_discounts", key: "storefront_config") {
      jsonValue
    }
  }
}`,
  products: `query WonCardTiersProducts($query: String!, $country: CountryCode!) {
  products(first: 50, query: $query) {
    nodes {
      handle
      isGiftCard
      won: metafield(namespace: "$app:won_discounts", key: "product") {
        jsonValue
      }
      variantsCount {
        count
      }
      contextualPricing(context: { country: $country }) {
        minVariantPricing {
          price {
            amount
            currencyCode
          }
        }
      }
      priceRangeV2 {
        minVariantPrice {
          amount
          currencyCode
        }
      }
      variants(first: 50) {
        nodes {
          outlet: metafield(namespace: "$app:won_discounts", key: "outlet") {
            jsonValue
          }
          cost: metafield(namespace: "$app:won_discounts", key: "variant") {
            id
          }
          pdp: metafield(namespace: "$app:won_discounts", key: "pdp") {
            id
          }
        }
      }
    }
  }
}`,
});

/** What a product contributes to its card line, whatever the page's currency (the price is per currency, below). */
interface ProductFacts {
  product: CardTierInput["product"];
  costed: boolean;
  onSale: boolean;
  /** A gift card, or more variants than Liquid checks: the card says nothing. */
  silent: boolean;
  /** The cheapest variant's price in Liquid money units, by currency (the shop's, and the country's asked for). */
  priceMin: Record<string, number>;
}

type CacheEntry<T> = { at: number; value: T };
interface ShopCache {
  config?: CacheEntry<CardTierInput["cfg"] | null>;
  /** `<country>|<handle>` → facts; null = no such product. */
  products: Map<string, CacheEntry<ProductFacts | null>>;
  dropped?: true;
}
const shopCaches = new Map<string, ShopCache>();
let cached = 0;
const readWindows = new Map<string, { start: number; count: number }>();
let now = () => Date.now();

/** Tests: a fixed clock and empty caches. */
export function setCardTiersClock(clock: () => number): void {
  now = clock;
}
export function clearCardTiersCache(): void {
  for (const shop of [...shopCaches.keys()]) invalidateCardTiers(shop);
  readWindows.clear();
}

export function invalidateCardTiers(shop: string): void {
  const cache = shopCaches.get(shop);
  if (!cache) return;
  cache.dropped = true;
  cached -= cache.products.size + (cache.config ? 1 : 0);
  shopCaches.delete(shop);
}
onAdminWrite(invalidateCardTiers);

function cacheOf(shop: string): ShopCache {
  let cache = shopCaches.get(shop);
  if (!cache) shopCaches.set(shop, (cache = { products: new Map() }));
  return cache;
}

function trim(keep: ShopCache): void {
  for (const [shop, cache] of shopCaches) {
    if (cached <= CARD_TIERS_CACHE_MAX) return;
    if (cache !== keep) invalidateCardTiers(shop);
  }
}

function remember(cache: ShopCache, key: string, value: ProductFacts | null): void {
  if (cache.dropped) return;
  if (!cache.products.delete(key)) cached += 1;
  cache.products.set(key, { at: now(), value });
  if (cache.products.size > CARD_TIERS_SHOP_MAX) {
    cache.products.delete(cache.products.keys().next().value!);
    cached -= 1;
  }
  trim(cache);
}

function takeRead(shop: string): void {
  const t = now();
  const window = readWindows.get(shop);
  if (!window || t - window.start >= 60_000) {
    readWindows.set(shop, { start: t, count: 1 });
    if (readWindows.size > CARD_TIERS_CACHE_MAX) readWindows.delete(readWindows.keys().next().value!);
    return;
  }
  if (window.count >= CARD_TIERS_READS_PER_MINUTE) throw new CardTiersRateLimited(shop);
  window.count += 1;
}

const fresh = <T>(entry: CacheEntry<T> | undefined): entry is CacheEntry<T> => entry !== undefined && now() - entry.at < CARD_TIERS_CACHE_MS;

/** A sale variant: the metafield `outlet` the sale writes (true, or the flags 2, 4, 6 — snippets/won-card-tier.liquid). */
const onSale = (value: unknown) => value === true || value === 2 || value === 4 || value === 6;

/** A decimal amount → Liquid money units (major × 100, also for a currency without decimals: Liquid counts yen × 100). */
const liquidUnits = (amount: string) => Math.round(Number(amount) * 100);

type ProductNode = {
  handle?: string;
  isGiftCard?: boolean;
  won?: { jsonValue: unknown } | null;
  variantsCount?: { count: number } | null;
  contextualPricing?: { minVariantPricing?: { price?: { amount: string; currencyCode: string } | null } | null } | null;
  priceRangeV2?: { minVariantPrice?: { amount: string; currencyCode: string } | null } | null;
  variants?: { nodes: { outlet?: { jsonValue: unknown } | null; cost?: { id: string } | null; pdp?: { id: string } | null }[] } | null;
};

/** One product's facts (pure). */
export function productFacts(node: ProductNode): ProductFacts {
  const variants = node.variants?.nodes ?? [];
  const priceMin: Record<string, number> = {};
  const shopPrice = node.priceRangeV2?.minVariantPrice;
  if (shopPrice) priceMin[shopPrice.currencyCode] = liquidUnits(shopPrice.amount);
  const pagePrice = node.contextualPricing?.minVariantPricing?.price;
  if (pagePrice) priceMin[pagePrice.currencyCode] = liquidUnits(pagePrice.amount);
  const won = node.won?.jsonValue;
  return {
    product: won && typeof won === "object" ? (won as CardTierInput["product"]) : null,
    costed: variants.some((v) => v.cost != null || v.pdp != null),
    onSale: variants.some((v) => onSale(v.outlet?.jsonValue)),
    silent: node.isGiftCard === true || (node.variantsCount?.count ?? variants.length) > MAX_VARIANTS,
    priceMin,
  };
}

async function readConfig(client: AdminClient, cache: ShopCache): Promise<CardTierInput["cfg"] | null> {
  if (fresh(cache.config)) return cache.config.value;
  const result = await client.graphql<{ currentAppInstallation: { metafield: { jsonValue: unknown } | null } | null }>(CARD_TIERS_DOCUMENTS.config, {});
  const raw = result.data?.currentAppInstallation?.metafield?.jsonValue;
  // What the embed reads: a config it would not read (another version, no tiers) shows nothing.
  const value = raw && typeof raw === "object" && (raw as { v?: unknown }).v === 1 && (raw as { tiers?: unknown }).tiers ? (raw as CardTierInput["cfg"]) : null;
  if (!cache.dropped) {
    if (!cache.config) cached += 1;
    cache.config = { at: now(), value };
  }
  return value;
}

async function readProducts(client: AdminClient, cache: ShopCache, handles: readonly string[], country: string): Promise<Map<string, ProductFacts | null>> {
  const out = new Map<string, ProductFacts | null>();
  const missing: string[] = [];
  for (const handle of handles) {
    const entry = cache.products.get(`${country}|${handle}`);
    if (fresh(entry)) out.set(handle, entry.value);
    else missing.push(handle);
  }
  if (missing.length > 0) {
    const query = missing.map((h) => `handle:${h}`).join(" OR ");
    const result = await client.graphql<{ products: { nodes: ProductNode[] } }>(CARD_TIERS_DOCUMENTS.products, { query, country });
    const found = new Map((result.data?.products?.nodes ?? []).filter((n) => typeof n.handle === "string").map((n) => [n.handle!, productFacts(n)]));
    for (const handle of missing) {
      const facts = found.get(handle) ?? null;
      remember(cache, `${country}|${handle}`, facts);
      out.set(handle, facts);
    }
  }
  return out;
}

/** The card lines of `request.handles` for `shop` (the app proxy's authenticated shop, SEC-2). */
export async function runCardTiers(client: AdminClient, shop: string, request: CardTiersRequest): Promise<CardTiersAnswer> {
  const cache = cacheOf(shop);
  const { country } = request;
  const needsRead = !fresh(cache.config) || request.handles.some((h) => !fresh(cache.products.get(`${country}|${h}`)));
  if (needsRead) takeRead(shop);
  const cfg = await readConfig(client, cache);
  const cards: CardTiersAnswer["cards"] = {};
  if (!cfg || cfg.cards !== 1) return { ok: true, cards };
  const facts = await readProducts(client, cache, request.handles, country);
  for (const [handle, f] of facts) {
    if (!f || f.silent) continue;
    // No price in the page's currency: an amount break is not promised (cardTier then shows nothing for it).
    const tier = cardTier({ cfg, currency: request.currency, market: request.market, product: f.product, costed: f.costed, onSale: f.onSale, priceMin: f.priceMin[request.currency] ?? 0 });
    if (tier) cards[handle] = tier;
  }
  return { ok: true, cards };
}
