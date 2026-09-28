// Shopify Markets → `config.markets[].countries` (Pro market targeting: the
// engine matches the cart's country against each targeted market's countries,
// shipped in the shop payload as `marketCountries`).
//
// Countries are resolved at SAVE time (I2): saveAndSync reads the markets once
// when the config targets a market, merges their countries into the config
// BEFORE saveConfig measures the function budget, and saves them. The sync
// never swaps countries, so what was measured is exactly what ships — no
// accepted save can fail the sync budget. resyncShop refreshes them through
// the same save path when Shopify's markets changed (save-and-sync.server.ts).
//
// Cost (I1): Shopify refuses a query whose REQUESTED cost exceeds 1 000 points
// (connection = 2 + first × node cost). markets(first: 50) × regions(first:
// 250) requested ~12 500, so markets are paged 10 at a time without regions,
// and each market's countries are paged 50 at a time. read_markets scope.

import type { AdminClient } from "../admin-client.server";
import { CONFIG_LIMITS } from "@won/core/discounts/config";
import { Transport } from "./transport";
import type { ConfigView, SyncLogger } from "./types";

export interface ShopMarket {
  handle: string;
  name: string;
  /** Shopify MarketStatus ACTIVE. */
  active: boolean;
  currency: string | null;
  /** ISO 3166-1 alpha-2, upper-case. */
  countries: string[];
}

interface MarketNode {
  id: string;
  handle: string;
  name: string;
  status: string;
  currencySettings?: { baseCurrency?: { currencyCode?: string } | null } | null;
}

type Page<T> = { pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: T[] };

async function marketCountries(transport: Transport, id: string): Promise<string[]> {
  const out = new Set<string>();
  let after: string | null = null;
  for (;;) {
    const data: {
      market: { conditions?: { regionsCondition?: { regions?: Page<{ __typename?: string; code?: string } | null> | null } | null } | null } | null;
    } = await transport.call("marketRegions", { id, after });
    const regions = data.market?.conditions?.regionsCondition?.regions;
    if (!regions) break;
    for (const region of regions.nodes) {
      const code = region?.__typename === "MarketRegionCountry" && typeof region.code === "string" ? region.code.toUpperCase() : null;
      if (code && /^[A-Z]{2}$/.test(code)) out.add(code);
    }
    if (!regions.pageInfo.hasNextPage) break;
    after = regions.pageInfo.endCursor;
  }
  return [...out];
}

export async function loadShopMarkets(transport: Transport): Promise<ShopMarket[]> {
  const out: ShopMarket[] = [];
  let after: string | null = null;
  for (;;) {
    const data: { markets: Page<MarketNode> } = await transport.call("markets", { after });
    for (const node of data.markets.nodes) {
      out.push({
        handle: node.handle,
        name: node.name,
        active: node.status === "ACTIVE",
        currency: node.currencySettings?.baseCurrency?.currencyCode ?? null,
        countries: await marketCountries(transport, node.id),
      });
    }
    if (!data.markets.pageInfo.hasNextPage) break;
    after = data.markets.pageInfo.endCursor;
  }
  return out;
}

const quiet: SyncLogger = { info() {}, warn() {}, error() {} };

/** The shop's markets through an AdminClient, default retry policy (saveAndSync, Settings, scripts). */
export function loadShopMarketsWith(client: AdminClient, logger: SyncLogger = quiet): Promise<ShopMarket[]> {
  return loadShopMarkets(new Transport(client, undefined, undefined, logger));
}

/** True when some rule (or a not-killed campaign override) targets a market. */
export function targetsMarkets(config: ConfigView): boolean {
  const has = (targeting: unknown) => {
    const markets = (targeting as { markets?: unknown } | null | undefined)?.markets;
    return Array.isArray(markets) && markets.length > 0;
  };
  if (config.modules.codes.rules.some((rule) => has(rule.targeting))) return true;
  return config.campaigns.some(
    (campaign) => !campaign.killed && campaign.overrides.some((o) => has((o.patch as { targeting?: unknown }).targeting)),
  );
}

/**
 * A copy of `config` whose markets carry the countries Shopify has for the same
 * handle. Markets Shopify does not know keep what was saved and are reported in
 * `missing`; `changed` = some market's countries differ from the config's.
 */
export function withMarketCountries<C extends ConfigView>(
  config: C,
  markets: readonly ShopMarket[],
): { config: C; missing: string[]; changed: boolean } {
  const byHandle = new Map(markets.map((m) => [m.handle, m]));
  const missing: string[] = [];
  let changed = false;
  const merged = config.markets.map((market) => {
    const shopMarket = byHandle.get(market.handle);
    if (!shopMarket) {
      missing.push(market.handle);
      return market;
    }
    const countries = shopMarket.countries.slice(0, CONFIG_LIMITS.listItems);
    if ((market.countries ?? []).join(",") !== countries.join(",")) changed = true;
    return { ...market, countries };
  });
  return { config: { ...config, markets: merged }, missing, changed };
}
