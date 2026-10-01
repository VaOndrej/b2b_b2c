// Rewards in planCart (MVP 4, contracts R1–R4). Pure functions over the plan's
// work lines; plan.ts calls them in this order:
//   1. rewardBase      — R1: the non-gift lines before every discount;
//   2. shippingReward  — R2: a shipping candidate `reward:shipping` (100 %) that
//                        planShipping ranks with the shipping rules;
//   3. planGifts       — R3: after margin and the order stage (the gift is
//                        outside both), one item of a reached tier's first gift
//                        line free (`fixedTotal` = its price);
//   4. rewardsProgress — R4: progress and warnings for the storefront/admin.
// The Rust function ports 1–3 (src/engine/rewards.rs); 4 is TypeScript only.

import type { PlanLocale } from "./cart.ts";
import type { WorkLine } from "./plan-internal.ts";
import type { PlanGift, PlanGiftProgress, PlanStack, PlanWarning, ShippingValue } from "./plan.ts";
import type { RewardsRead } from "./rewards.ts";

export const SHIPPING_REWARD_ID = "reward:shipping";
export const GIFT_CANDIDATE_PREFIX = "gift:";
export const giftCandidateId = (tierId: string) => `${GIFT_CANDIDATE_PREFIX}${tierId}`;

export const GIFT_LABEL: Record<PlanLocale, string> = { cs: "Dárek zdarma", en: "Free gift" };
export const SHIPPING_REWARD_LABEL: Record<PlanLocale, string> = { cs: "Doprava zdarma", en: "Free shipping" };

/** R1: Σ subtotal of the non-gift lines, minor units of the cart currency, before every discount. */
export function rewardBase(work: readonly WorkLine[]): number {
  let base = 0;
  for (const w of work) if (!w.line.gift) base += w.line.subtotal;
  return base;
}

/** The numeric tail of a variant GID (what the function compares); null when it has none. */
function variantNumber(id: string): number | null {
  const m = /(\d+)$/.exec(id);
  return m ? Number(m[1]) : null;
}

/** R2: the shipping reward when the base reaches the threshold in the cart currency, else null. */
export function shippingReward(read: RewardsRead, base: number, currency: string): { value: ShippingValue } | null {
  const threshold = read.shipping?.[currency];
  if (threshold === undefined || base < threshold) return null;
  return { value: { percent: 100 } };
}

export interface GiftsStage {
  gifts: PlanGift[];
  warnings: PlanWarning[];
}

/**
 * R3: sets `product` on the gift lines that are free and returns one PlanGift
 * per tier (config order) and the warnings, in the order the tiers and lines
 * come. Never touches a non-gift line.
 */
export function planGifts(work: WorkLine[], read: RewardsRead, base: number, currency: string, locale: PlanLocale): GiftsStage {
  const gifts: PlanGift[] = [];
  const warnings: PlanWarning[] = [];
  const known = new Set(read.tiers.map((t) => t.id));
  for (const tier of read.tiers) {
    const id = giftCandidateId(tier.id);
    const threshold = tier.threshold[currency];
    const offered = threshold !== undefined;
    const reached = offered && base >= threshold;
    const variants = new Set(tier.variants);
    const lines = work.filter((w) => w.line.gift && w.line.giftTierId === tier.id);
    const valid = lines.filter((w) => variants.has(variantNumber(w.line.variantId) ?? -1));
    const first = valid[0];
    if (!offered) warnings.push({ code: "market_missing_threshold", ruleId: id });
    if (reached && first) {
      const amount = first.line.unitPrice;
      const stack: PlanStack = {
        components: [{ ruleId: id, method: "automatic", module: "rewards", amount }],
        amount,
        ownerRuleId: id,
        ownerMethod: "automatic",
        value: { fixedTotal: amount },
        message: GIFT_LABEL[locale],
      };
      first.product = stack;
      gifts.push({ tierId: tier.id, lineId: first.line.id, state: "earned" });
      if (first.line.quantity > 1 || valid.length > 1) warnings.push({ code: "gift_extra_paid", ruleId: id });
    } else {
      const state: PlanGift["state"] = !offered ? "not_offered" : reached ? "missing" : "below";
      gifts.push(first ? { tierId: tier.id, lineId: first.line.id, state } : { tierId: tier.id, state });
      // A paid gift line of an offered tier (below it, or a variant it does not offer) is said once.
      if (offered && (lines.length > valid.length || (!reached && valid.length > 0))) warnings.push({ code: "gift_not_earned", ruleId: id });
    }
  }
  const unknown = new Set<string>();
  for (const w of work) {
    const tierId = w.line.giftTierId;
    if (w.line.gift && tierId !== null && !known.has(tierId) && !unknown.has(tierId)) {
      unknown.add(tierId);
      warnings.push({ code: "gift_not_earned", ruleId: giftCandidateId(tierId) });
    }
  }
  return { gifts, warnings };
}

export interface RewardsProgress {
  freeShipping?: { threshold: number; remaining: number; reached: boolean };
  gifts?: PlanGiftProgress[];
  warnings: PlanWarning[];
}

/**
 * R4: progress toward the thresholds of the cart currency, from the base; with
 * countOtherDiscounts also from the base after the discounts the plan gives
 * the non-gift lines (`afterBase`), and `code_loses_gift` for a tier reached
 * only before them. The function never reads this: at checkout the gift
 * counts before discounts (rozhodnuti.md "Dárky vs. další slevy").
 */
export function rewardsProgress(read: RewardsRead, base: number, afterBase: number, currency: string): RewardsProgress {
  const out: RewardsProgress = { warnings: [] };
  const ship = read.shipping?.[currency];
  if (ship !== undefined) out.freeShipping = { threshold: ship, remaining: Math.max(0, ship - base), reached: base >= ship };
  const gifts: PlanGiftProgress[] = [];
  for (const tier of read.tiers) {
    const threshold = tier.threshold[currency];
    if (threshold === undefined) continue;
    const reached = base >= threshold;
    const entry: PlanGiftProgress = { tierId: tier.id, threshold, remaining: Math.max(0, threshold - base), reached };
    if (read.countOther) {
      const after = afterBase >= threshold;
      entry.afterDiscounts = { remaining: Math.max(0, threshold - afterBase), reached: after };
      if (reached && !after) out.warnings.push({ code: "code_loses_gift", ruleId: giftCandidateId(tier.id) });
    }
    gifts.push(entry);
  }
  if (gifts.length > 0) out.gifts = gifts;
  return out;
}
