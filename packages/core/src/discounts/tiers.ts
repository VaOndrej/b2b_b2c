// Quantity tiers (MVP 3, docs/plans/2026-09-30-won-discounts-mvp3.md, contracts
// K1–K3): which set applies to a product, and the compact form the sets take in
// the shared shop config (function-payload.ts). The sync (targeting.ts), the
// storefront config (storefront-config.ts) and the engine all go through here,
// so they agree on one reading.
//
// K1 — exactly ONE set applies to a product:
//   1. the first set (config order) whose `scope.productIds` lists the product;
//   2. else the first set whose `scope.collectionIds` lists one of its collections;
//   3. else the first set with `scope: "global"`; else none.
// Steps 1–2 are precomputed by the sync into the product metafield's `tierRef`
// (targeting.ts; absent = step 3). A `tierRef` naming a set the shop config does
// not carry gives the product NO tier (fail closed: less discount, never more).
// Free (plan-gate.ts) keeps scoped sets INERT (`breaks: []`) instead of
// removing them, so their products never fall back to the global set.
// A set no product can reach — a later global set, a scoped set listing
// nothing — is not shipped (reachableTierSets).
//
// --- The shop-config form (`modules.tiers`, the Rust function reads EXACTLY this) ---------------
//
//   { "global"?: "<set id>",                       K1 step 3; absent = no global set
//     "sets": [ [ "<set id>",                      [A-Za-z0-9_-]{1,64}
//                 "line" | "product" | "cart",     what counts toward minQty (K2)
//                 [ "CZK", "EUR", … ],             currencies of its amount breaks, sorted
//                 [ [minQty, value], … ] ],        ascending minQty (whole items ≥ 1)
//               … ] }                              the global set and every scoped set, config order
//
//   value = a number: percent off each item (0–100, as configured, e.g. 12.5), or
//         = an array aligned with the set's currencies: the amount off each item
//           in that currency, minor units, `null` = no amount there (the break is
//           not offered in that currency, MKT-1).
//
// Example (Pro): {"global":"g","sets":[["t_1","cart",["CZK","EUR"],[[2,5],[5,[5000,200]],[10,[12000,null]]]],["g","product",[],[[3,10]]]]}
// No scope id lists ever ship: targeting lives in the product metafield.
//
// Reading it (readTiersPayload; the tolerant reader — junk is skipped piece by
// piece, never thrown, never read as more discount):
//   - `modules.tiers` not an object, or `sets` not an array → no sets;
//   - a set entry is used only when it is an array whose [0] is a non-empty
//     string (the id) not seen before (the first of an id wins) and [1] is
//     exactly "line", "product" or "cart"; any other entry is skipped whole;
//   - [2] (currencies) not an array → no currency: every amount break is not
//     offered; the cart currency's index is its FIRST exact (case-sensitive)
//     match, none → not offered;
//   - [3] (breaks) not an array → no breaks (the set is inert);
//   - a break is used only when it is an array of ≥ 2 elements whose [0] is a
//     finite number with floor ≥ 1 (minQty = that floor) not already taken by an
//     earlier USED break of the set (the first one wins), and whose [1] is a
//     finite number (percent, clamped to 0–100) or an array (amounts); anything
//     else skips the break;
//   - an amount break reads its element at the cart currency's index: a finite
//     number ≥ 0 → floor(min(v, CONFIG_LIMITS.moneyMinorUnits)), offered; else
//     not offered (the break stays in the list, `offered: false`);
//   - breaks are then sorted ascending by minQty;
//   - `global` counts only when it is a string naming a set that was read.

import type { ReadonlyDeep, TierCountAcross, TierSet, TiersModule } from "./config.ts";
import { TIER_COUNT_ACROSS_MODES } from "./config/enums.ts";
import { CONFIG_LIMITS } from "./config/limits.ts";
import { moneyFor, splitAmountKey } from "./money.ts";

/** One break in the shop config: [minQty, percent] or [minQty, amounts aligned with the set's currencies]. */
export type FunctionTierBreak = [minQty: number, value: number | (number | null)[]];

/** One set in the shop config: [id, count mode, currencies of its amount breaks, breaks]. */
export type FunctionTierSet = [id: string, count: TierCountAcross, currencies: string[], breaks: FunctionTierBreak[]];

/** `modules.tiers` in the shared shop config (see the header). */
export interface FunctionTiersPayload {
  global?: string;
  sets: FunctionTierSet[];
}

type SetLike = ReadonlyDeep<TierSet>;
type ScopeLists = { productIds: readonly string[]; collectionIds: readonly string[] };

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

function scopeLists(set: SetLike): ScopeLists | null {
  if (set.scope === "global") return null;
  return { productIds: set.scope.productIds ?? [], collectionIds: set.scope.collectionIds ?? [] };
}

/** K1 step 3: the first set with scope "global" (config order), or null. */
export function globalTierSet<T extends SetLike>(sets: readonly T[]): T | null {
  return sets.find((set) => set.scope === "global") ?? null;
}

/**
 * The sets a product can reach (K1), config order: the first global set and
 * every scoped set that lists at least one product or collection; of sets
 * sharing an id only the first (the sanitizer never lets two through).
 */
export function reachableTierSets<T extends SetLike>(sets: readonly T[]): T[] {
  const global = globalTierSet(sets);
  const ids = new Set<string>();
  const out: T[] = [];
  for (const set of sets) {
    const lists = scopeLists(set);
    const reachable = set === global || (lists !== null && (lists.productIds.length > 0 || lists.collectionIds.length > 0));
    if (!reachable || ids.has(set.id)) continue;
    ids.add(set.id);
    out.push(set);
  }
  return out;
}

/**
 * K1 steps 1–2, for the sync: product → the id of its scoped set, undefined
 * when none lists it (the global set applies). Precomputed once per config:
 * O(total list items) to build, O(collections of the product) per product.
 */
export function scopedTierSetResolver(
  sets: readonly SetLike[],
): (product: { productId: string; collectionIds: readonly string[] }) => string | undefined {
  const scoped = reachableTierSets(sets).filter((set) => set.scope !== "global");
  const byProduct = new Map<string, number>();
  const byCollection = new Map<string, number>();
  scoped.forEach((set, i) => {
    const lists = scopeLists(set)!;
    for (const id of lists.productIds) if (!byProduct.has(id)) byProduct.set(id, i);
    for (const id of lists.collectionIds) if (!byCollection.has(id)) byCollection.set(id, i);
  });
  return (product) => {
    const listed = byProduct.get(product.productId);
    if (listed !== undefined) return scoped[listed].id;
    let first = -1;
    for (const id of product.collectionIds) {
      const i = byCollection.get(id);
      if (i !== undefined && (first === -1 || i < first)) first = i;
    }
    return first === -1 ? undefined : scoped[first].id;
  };
}

// --- The shop-config form ------------------------------------------------------------------------

function shipSet(set: SetLike): FunctionTierSet {
  const breaks = [...set.breaks].sort((a, b) => a.minQty - b.minQty);
  const amountBreak = (b: (typeof breaks)[number]) => typeof b.percent !== "number" && b.amountOff !== undefined;
  const currencies = [...new Set(breaks.flatMap((b) => (amountBreak(b) ? Object.keys(b.amountOff!) : [])))].sort();
  const shipped: FunctionTierBreak[] = [];
  for (const b of breaks) {
    if (typeof b.percent === "number") {
      shipped.push([b.minQty, b.percent]);
      continue;
    }
    // A market's column ("EUR@sk") holds its own amount, else its currency's: every break is read by the same column.
    const amounts = currencies.map((c) => {
      const key = splitAmountKey(c);
      return b.amountOff && key ? moneyFor(b.amountOff, key.currency, key.market) : null;
    });
    if (amounts.some((a) => a !== null)) shipped.push([b.minQty, amounts]);
  }
  return [set.id, set.countAcross, currencies, shipped];
}

/**
 * `modules.tiers` of the shared shop config (see the header): the reachable
 * sets only, without their scope lists. Build it from the GATED config.
 */
export function buildTiersPayload(tiers: ReadonlyDeep<TiersModule>): FunctionTiersPayload {
  const reachable = reachableTierSets(tiers.sets);
  const global = globalTierSet(reachable);
  const sets = reachable.map(shipSet);
  return global ? { global: global.id, sets } : { sets };
}

/** One break as the engine reads it for one cart currency. */
export interface TierBreakRead {
  minQty: number;
  /** Percent off each item (0–100); null for an amount break. */
  percent: number | null;
  /** Amount off each item in the cart currency, minor units; null for a percent break or when not offered. */
  amount: number | null;
  /** False when an amount break has no amount in the cart currency (MKT-1): not offered there. */
  offered: boolean;
}

export interface TierSetRead {
  id: string;
  count: TierCountAcross;
  /** Ascending minQty, unique. */
  breaks: TierBreakRead[];
}

export interface TiersRead {
  /** K1 step 3 (null = no global set). */
  global: string | null;
  /** Every set read, by id (payload order). */
  sets: Map<string, TierSetRead>;
}

function readBreaks(raw: unknown, currencyIndex: number): TierBreakRead[] {
  if (!Array.isArray(raw)) return [];
  const out: TierBreakRead[] = [];
  const taken = new Set<number>();
  for (const item of raw) {
    if (!Array.isArray(item) || item.length < 2) continue;
    const [qty, value] = item as unknown[];
    if (typeof qty !== "number" || !Number.isFinite(qty)) continue;
    const minQty = Math.floor(qty);
    if (minQty < 1 || taken.has(minQty)) continue;
    if (typeof value === "number") {
      if (!Number.isFinite(value)) continue;
      out.push({ minQty, percent: Math.min(100, Math.max(0, value)), amount: null, offered: true });
    } else if (Array.isArray(value)) {
      const v = currencyIndex >= 0 ? (value as unknown[])[currencyIndex] : undefined;
      const ok = typeof v === "number" && Number.isFinite(v) && v >= 0;
      out.push({ minQty, percent: null, amount: ok ? Math.floor(Math.min(v, CONFIG_LIMITS.moneyMinorUnits)) : null, offered: ok });
    } else {
      continue;
    }
    taken.add(minQty);
  }
  return out.sort((a, b) => a.minQty - b.minQty);
}

/** The tolerant reader of `modules.tiers` for one cart currency (rules in the header). Never throws. */
export function readTiersPayload(raw: unknown, currency: string): TiersRead {
  const sets = new Map<string, TierSetRead>();
  if (!isRecord(raw) || !Array.isArray(raw.sets)) return { global: null, sets };
  for (const entry of raw.sets as unknown[]) {
    if (!Array.isArray(entry)) continue;
    const [id, count, currencies, breaks] = entry as unknown[];
    if (typeof id !== "string" || id === "" || sets.has(id)) continue;
    if (!(TIER_COUNT_ACROSS_MODES as readonly unknown[]).includes(count)) continue;
    const currencyIndex = currency !== "" && Array.isArray(currencies) ? currencies.indexOf(currency) : -1;
    sets.set(id, { id, count: count as TierCountAcross, breaks: readBreaks(breaks, currencyIndex) });
  }
  const global = typeof raw.global === "string" && sets.has(raw.global) ? raw.global : null;
  return { global, sets };
}
