// Shopify Markets → `config.markets[].countries` (Pro market targeting, T1 fix
// round: the engine matches the cart's country against each targeted market's
// countries, shipped in the shop payload as `marketCountries`). Countries are
// owned by Shopify Markets and change there, so the sync reads them fresh
// whenever a rule targets a market (read_markets scope) and builds the shop
// payload from a copy of the config with the countries filled in; the saved
// config is never rewritten by the sync. The admin can use loadShopMarkets to
// list the shop's markets (handle, name, currency, countries) in Settings.

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
  handle: string;
  name: string;
  status: string;
  currencySettings?: { baseCurrency?: { currencyCode?: string } | null } | null;
  conditions?: { regionsCondition?: { regions?: { nodes?: ({ __typename?: string; code?: string } | null)[] } | null } | null } | null;
}

export async function loadShopMarkets(transport: Transport): Promise<ShopMarket[]> {
  const out: ShopMarket[] = [];
  let after: string | null = null;
  for (;;) {
    const data: { markets: { pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: MarketNode[] } } = await transport.call(
      "markets",
      { after },
    );
    for (const node of data.markets.nodes) {
      const countries = (node.conditions?.regionsCondition?.regions?.nodes ?? [])
        .map((region) => (region?.__typename === "MarketRegionCountry" && typeof region.code === "string" ? region.code.toUpperCase() : null))
        .filter((code): code is string => code !== null && /^[A-Z]{2}$/.test(code));
      out.push({
        handle: node.handle,
        name: node.name,
        active: node.status === "ACTIVE",
        currency: node.currencySettings?.baseCurrency?.currencyCode ?? null,
        countries: [...new Set(countries)],
      });
    }
    if (!data.markets.pageInfo.hasNextPage) break;
    after = data.markets.pageInfo.endCursor;
  }
  return out;
}

const quiet: SyncLogger = { info() {}, warn() {}, error() {} };

/** For the admin (Settings): the shop's markets through an AdminClient, default retry policy. */
export function loadShopMarketsWith(client: AdminClient, logger: SyncLogger = quiet): Promise<ShopMarket[]> {
  return loadShopMarkets(new Transport(client, undefined, undefined, logger));
}

/** True when some rule (or a live campaign override) targets a market. */
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
 * `missing` (their rules then match no country unless countries were saved).
 */
export function withMarketCountries(config: ConfigView, markets: readonly ShopMarket[]): { config: ConfigView; missing: string[] } {
  const byHandle = new Map(markets.map((m) => [m.handle, m]));
  const missing: string[] = [];
  const merged = config.markets.map((market) => {
    const shopMarket = byHandle.get(market.handle);
    if (!shopMarket) {
      missing.push(market.handle);
      return market;
    }
    return { ...market, countries: shopMarket.countries.slice(0, CONFIG_LIMITS.listItems) };
  });
  return { config: { ...config, markets: merged }, missing };
}
