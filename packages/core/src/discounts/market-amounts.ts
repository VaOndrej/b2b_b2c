// Amounts per market (7 Oct 2026; docs/won-discounts/navrh-castky-podle-trhu.md).
//
// Stored and shipped, an amount map has a key per currency ("EUR": every market selling in it without a key of its
// own) and, only where markets of one currency differ, a key per market ("EUR@sk"). An admin form works with ONE
// KEY PER MARKET (expandMarketAmounts), a save turns that back into the shortest map that says the same
// (collapseMarketAmounts), and a cart reads its own market's amount first (marketAmountsView). A config stored
// before this has currency keys only: it expands to "every market has its currency's amount" and collapses back
// to itself, byte for byte.

import type { MarketSetting } from "./config/types.ts";
import { marketAmountKey, splitAmountKey, type MoneyByCurrency } from "./money.ts";

type Markets = readonly Pick<MarketSetting, "handle" | "currency" | "enabled">[];
type Rec = Record<string, unknown>;

const isRecord = (v: unknown): v is Rec => typeof v === "object" && v !== null && !Array.isArray(v);
const own = (m: MoneyByCurrency, key: string): number | undefined => (Object.hasOwn(m, key) && typeof m[key] === "number" ? m[key] : undefined);

/** The enabled markets, the first of a handle (a handle names one market). */
function enabledMarkets(markets: Markets): Markets {
  const seen = new Set<string>();
  return markets.filter((m) => m.enabled && !seen.has(m.handle) && seen.add(m.handle));
}

/** True when the map has an amount of one market only ("EUR@sk"). */
export function hasMarketAmount(money: MoneyByCurrency | undefined | null): boolean {
  return !!money && Object.keys(money).some((key) => splitAmountKey(key)?.market != null);
}

/**
 * The map as an admin form holds it: one key per ENABLED market ("EUR@sk"), with the market's own amount or its
 * currency's. Every other key is kept as it is, after them: a currency no enabled market sells in, and the own
 * amount of a market that is switched off (§14a: off ≠ erased).
 */
export function expandMarketAmounts(money: MoneyByCurrency | undefined | null, markets: Markets): Record<string, number> {
  const out: Record<string, number> = {};
  const source = money ?? {};
  const enabled = enabledMarkets(markets);
  const covered = new Set<string>();
  for (const market of enabled) {
    const key = marketAmountKey(market.currency, market.handle);
    covered.add(key).add(market.currency);
    const value = own(source, key) ?? own(source, market.currency);
    if (value !== undefined) out[key] = value;
  }
  for (const [key, value] of Object.entries(source)) if (!covered.has(key) && typeof value === "number") out[key] = value;
  return out;
}

/**
 * The shortest map that says the same as an expanded one: where every enabled market of a currency has the same
 * amount, one key of that currency; where they differ (or one has none), a key per market that has an amount.
 * Keys of nothing enabled are kept. `collapseMarketAmounts(expandMarketAmounts(m, markets), markets)` is `m` for
 * every map with currency keys only.
 */
export function collapseMarketAmounts(money: MoneyByCurrency | undefined | null, markets: Markets): Record<string, number> {
  const source = expandMarketAmounts(money, markets);
  const enabled = enabledMarkets(markets);
  const out: Record<string, number> = {};
  const done = new Set<string>();
  for (const market of enabled) {
    if (done.has(market.currency)) continue;
    done.add(market.currency);
    const group = enabled.filter((m) => m.currency === market.currency);
    const values = group.map((m) => own(source, marketAmountKey(m.currency, m.handle)));
    if (values.every((v) => v !== undefined && v === values[0])) out[market.currency] = values[0]!;
    else group.forEach((m, i) => values[i] !== undefined && (out[marketAmountKey(m.currency, m.handle)] = values[i]!));
  }
  const handled = new Set(enabled.flatMap((m) => [marketAmountKey(m.currency, m.handle)]));
  for (const [key, value] of Object.entries(source)) if (!handled.has(key) && !Object.hasOwn(out, key)) out[key] = value;
  return out;
}

/**
 * The amounts of a whole tier set, collapsed TOGETHER: a currency is one key in every break, or a key per market
 * in every break (the checkout reads a set's amounts by column — a break with "EUR" next to one with "EUR@sk"
 * would leave the first one without an amount for Slovakia).
 */
export function collapseTierAmounts<B extends { amountOff?: MoneyByCurrency }>(breaks: readonly B[], markets: Markets): B[] {
  const enabled = enabledMarkets(markets);
  const expanded = breaks.map((b) => (b.amountOff ? expandMarketAmounts(b.amountOff, markets) : undefined));
  const split = new Set<string>();
  for (const market of enabled) {
    const group = enabled.filter((m) => m.currency === market.currency);
    const differs = expanded.some((e) => e !== undefined && new Set(group.map((m) => own(e, marketAmountKey(m.currency, m.handle)))).size > 1);
    if (differs) split.add(market.currency);
  }
  return breaks.map((b, i) => {
    const e = expanded[i];
    if (!e) return b;
    const out: Record<string, number> = {};
    const handled = new Set<string>();
    for (const market of enabled) {
      const key = marketAmountKey(market.currency, market.handle);
      handled.add(key);
      const value = own(e, key);
      if (value === undefined) continue;
      if (split.has(market.currency)) out[key] = value;
      else out[market.currency] = value;
    }
    for (const [key, value] of Object.entries(e)) if (!handled.has(key) && !Object.hasOwn(out, key)) out[key] = value;
    return { ...b, amountOff: out };
  });
}

/** True when anything in the value is an amount of one market only (a key "EUR@sk", or that key in a list of a tier set's columns). */
export function usesMarketAmounts(value: unknown): boolean {
  if (typeof value === "string") return splitAmountKey(value)?.market != null;
  if (Array.isArray(value)) return value.some(usesMarketAmounts);
  if (!isRecord(value)) return false;
  for (const [key, v] of Object.entries(value)) {
    if (typeof v === "number" && splitAmountKey(key)?.market != null) return true;
    if (typeof v === "object" && v !== null && usesMarketAmounts(v)) return true;
  }
  return false;
}

/** The handles of the markets some amount in the value is the own amount of. */
export function marketsWithOwnAmounts(value: unknown, into: Set<string> = new Set()): Set<string> {
  if (typeof value === "string") {
    const market = splitAmountKey(value)?.market;
    if (market) into.add(market);
  } else if (Array.isArray(value)) {
    for (const v of value) if (typeof v === "string" || (typeof v === "object" && v !== null)) marketsWithOwnAmounts(v, into);
  } else if (isRecord(value)) {
    for (const [key, v] of Object.entries(value)) {
      const market = typeof v === "number" ? splitAmountKey(key)?.market : null;
      if (market) into.add(market);
      if (typeof v === "object" && v !== null) marketsWithOwnAmounts(v, into);
    }
  }
  return into;
}

/**
 * The shop config as ONE cart reads it (the planner's first step; the Rust function does the same while it reads,
 * engine/config.rs MARKET_KEY): with `am: true` and the cart's country in a shipped market, that market's own
 * amount ("EUR@sk") stands in for its currency's ("EUR") — in every amount map, and as the column of a tier set.
 * Without the flag, a country or a market the config is returned as it is. Never another market's amount.
 */
export function marketAmountsView<T>(config: T, cart: { currency: string; countryCode: string | null }): T {
  if (!isRecord(config) || config.am !== true || !cart.currency || !cart.countryCode || !isRecord(config.marketCountries)) return config;
  let handle: string | null = null;
  for (const [h, countries] of Object.entries(config.marketCountries)) {
    if (Array.isArray(countries) && countries.some((c) => typeof c === "string" && c.toUpperCase() === cart.countryCode)) {
      handle = h;
      break;
    }
  }
  if (handle === null) return config;
  const key = marketAmountKey(cart.currency, handle);
  const walk = (value: unknown): unknown => {
    if (Array.isArray(value)) {
      // A tier set's columns: the market's column is read as the currency's.
      const at = value.indexOf(key);
      if (at >= 0 && value.every((v) => typeof v === "string")) return value.map((v, i) => (i === at ? cart.currency : v === cart.currency ? `${v}${"\u0000"}` : v));
      let changed = false;
      const next = value.map((v) => {
        const w = typeof v === "object" && v !== null ? walk(v) : v;
        if (w !== v) changed = true;
        return w;
      });
      return changed ? next : value;
    }
    if (!isRecord(value)) return value;
    let out: Rec | null = null;
    for (const [k, v] of Object.entries(value)) {
      const w = typeof v === "object" && v !== null ? walk(v) : v;
      if (w !== v) (out ??= { ...value })[k] = w;
    }
    const mine = Object.hasOwn(value, key) ? value[key] : undefined;
    if (typeof mine === "number" && Number.isFinite(mine)) (out ??= { ...value })[cart.currency] = mine;
    return out ?? value;
  };
  return walk(config) as T;
}
