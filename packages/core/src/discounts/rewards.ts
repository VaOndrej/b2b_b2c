// Rewards in the shared function config (MVP 4, contract R5): compact, because
// the Rust function reads every byte of the 9 000 B payload (~235 instructions
// a byte on the tier payload, MVP 3). Variants go as numbers (the tail of their
// GID, what the function compares with the cart line's merchandise id), the
// fallback after the choices: the function only asks "is this variant a gift of
// that tier", never which one.
//
//   { "s": { "CZK": 100000 },                        free shipping: threshold per currency (minor units)
//     "g": [ ["gift-1", { "CZK": 150000 }, [11, 12, 13]] ],   tiers in config order
//     "o": 1 }                                       countOtherDiscounts (TS warnings only; absent = off)
//
// readRewardsPayload is the tolerant reader the engine (and its Rust port)
// use: anything it does not understand offers nothing (fail closed — the
// customer gets less, never more).

import type { ReadonlyDeep } from "./config/types.ts";
import type { RewardsModule } from "./config/types.ts";
import type { MoneyByCurrency } from "./money.ts";

export type FunctionRewardTier = [id: string, threshold: MoneyByCurrency, variants: number[]];

export interface FunctionRewardsPayload {
  s?: MoneyByCurrency;
  g: FunctionRewardTier[];
  o?: 1;
}

/** The numeric id of a variant GID (or a bare numeric id); null for anything else. */
export function variantNumber(id: string): number | null {
  const m = /^(?:gid:\/\/shopify\/ProductVariant\/)?([1-9]\d{0,15})$/.exec(id);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isSafeInteger(n) ? n : null;
}

const hasThreshold = (money: MoneyByCurrency | undefined): money is MoneyByCurrency => !!money && Object.keys(money).length > 0;

export function buildRewardsPayload(rewards: ReadonlyDeep<RewardsModule>): FunctionRewardsPayload {
  const out: FunctionRewardsPayload = { g: [] };
  if (hasThreshold(rewards.freeShipping?.threshold as MoneyByCurrency | undefined)) out.s = { ...(rewards.freeShipping!.threshold as MoneyByCurrency) };
  for (const tier of rewards.gifts) {
    const variants: number[] = [];
    for (const id of [...tier.choices, ...(tier.fallbackVariantId ? [tier.fallbackVariantId] : [])]) {
      const n = variantNumber(id);
      if (n !== null && !variants.includes(n)) variants.push(n);
    }
    out.g.push([tier.id, { ...(tier.threshold as MoneyByCurrency) }, variants]);
  }
  if (rewards.countOtherDiscounts) out.o = 1;
  return out;
}

export interface RewardTierRead {
  id: string;
  threshold: MoneyByCurrency;
  variants: number[];
}

export interface RewardsRead {
  /** Free-shipping threshold per currency; null = none. */
  shipping: MoneyByCurrency | null;
  tiers: RewardTierRead[];
  countOther: boolean;
}

type Rec = Record<string, unknown>;
const isRecord = (v: unknown): v is Rec => typeof v === "object" && v !== null && !Array.isArray(v);

/** Whole positive amounts only (a threshold of 0 or junk offers nothing in that currency). */
function readThreshold(v: unknown): MoneyByCurrency {
  const out: Record<string, number> = {};
  if (!isRecord(v)) return out;
  for (const [cur, amount] of Object.entries(v)) {
    // An own entry even for a key like "__proto__" (junk payload): never the prototype.
    if (typeof amount === "number" && Number.isSafeInteger(amount) && amount > 0) {
      Object.defineProperty(out, cur, { value: amount, enumerable: true, writable: true, configurable: true });
    }
  }
  return out;
}

export function readRewardsPayload(v: unknown): RewardsRead {
  const out: RewardsRead = { shipping: null, tiers: [], countOther: false };
  if (!isRecord(v)) return out;
  const shipping = readThreshold(v.s);
  if (Object.keys(shipping).length > 0) out.shipping = shipping;
  if (Array.isArray(v.g)) {
    for (const raw of v.g) {
      // A malformed entry (not [id, threshold map, variant list]) is skipped whole.
      if (!Array.isArray(raw) || typeof raw[0] !== "string" || raw[0] === "" || !isRecord(raw[1]) || !Array.isArray(raw[2])) continue;
      const variants = raw[2].filter((n): n is number => typeof n === "number" && Number.isSafeInteger(n) && n > 0);
      out.tiers.push({ id: raw[0], threshold: readThreshold(raw[1]), variants });
    }
  }
  out.countOther = v.o === 1;
  return out;
}
