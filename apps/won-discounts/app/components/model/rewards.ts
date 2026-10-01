// Odměny (MVP 4) — the form model shared by the screen (live draft) and the
// server (SEC-1: the action parses exactly these fields). Amounts are typed per
// market currency (MKT-1: an empty field = not offered in that market, never a
// converted value) and stored as minor units. On Free the gift tiers past the
// first stay as stored (kept by id, §14a): the sync gates them (BILL-1).

import { CONFIG_LIMITS } from "@won/core/discounts/config";
import type { GiftTier, RewardsModule } from "@won/core/discounts/config";

import { minorToInput, parseMoneyInput, type FormDataLike } from "./rule-form";
import type { FieldError, GiftTierView, GiftVariantView } from "./types";

export const REWARDS_ACTION = "/app/rewards";
export const REWARDS_INTENT = { save: "save" } as const;

export const REWARDS_FIELD = {
  intent: "intent",
  shipOn: "rw.ship.on",
  shipAmount: (currency: string) => `rw.ship.${currency}`,
  /** Tier ids in order (one value per tier). */
  tier: "rw.tier",
  /** Tiers kept as stored (Free: past the first). */
  kept: "rw.kept",
  tierAmount: (id: string, currency: string) => `rw.${id}.amount.${currency}`,
  /** Gift variant GIDs (one value per choice). */
  choice: (id: string) => `rw.${id}.choice`,
  fallback: (id: string) => `rw.${id}.fallback`,
  other: "rw.other",
} as const;

const TIER_ID = /^[A-Za-z0-9_-]{1,64}$/;
const VARIANT = /^gid:\/\/shopify\/ProductVariant\/\d{1,20}$/;

export function newGiftTierId(): string {
  return `gift-${Math.random().toString(36).slice(2, 10)}`;
}

export interface RewardsFormContext {
  /** Currencies of the enabled markets. */
  currencies: readonly string[];
  /** Stored amounts in currencies whose market is off: kept (§14a). */
  kept: { shipping: Record<string, number>; tiers: ReadonlyMap<string, Record<string, number>> };
  /** A stored tier by id (the form keeps it as stored). */
  keep: (id: string) => GiftTier | undefined;
}

export interface RewardsFormResult {
  rewards: RewardsModule;
  errors: FieldError[];
}

const str = (v: unknown) => (typeof v === "string" ? v : "");

function readAmounts(
  form: FormDataLike,
  field: (currency: string) => string,
  currencies: readonly string[],
  errors: FieldError[],
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const currency of currencies) {
    const raw = str(form.get(field(currency)));
    const minor = parseMoneyInput(raw, currency);
    if (minor === null) continue;
    if (!Number.isFinite(minor) || minor <= 0 || minor > CONFIG_LIMITS.moneyMinorUnits) {
      errors.push({ field: field(currency), key: "rewards.error.amount" });
      continue;
    }
    out[currency] = minor;
  }
  return out;
}

/** The page's form → the rewards module to store, or the errors (server and live draft alike). */
export function readRewardsForm(form: FormDataLike, ctx: RewardsFormContext): RewardsFormResult {
  const errors: FieldError[] = [];
  const F = REWARDS_FIELD;
  const rewards: RewardsModule = { gifts: [], countOtherDiscounts: form.get(F.other) === "1", giftDeclinable: true };
  if (form.get(F.shipOn) === "1") {
    const threshold = { ...ctx.kept.shipping, ...readAmounts(form, F.shipAmount, ctx.currencies, errors) };
    if (Object.keys(threshold).length === 0) errors.push({ field: F.shipAmount(ctx.currencies[0] ?? ""), key: "rewards.error.shippingAmount" });
    rewards.freeShipping = { threshold };
  }
  const kept = new Set(form.getAll(F.kept).map(str));
  const seen = new Set<string>();
  for (const id of form.getAll(F.tier).map(str)) {
    if (!TIER_ID.test(id) || seen.has(id)) continue;
    seen.add(id);
    const stored = kept.has(id) ? ctx.keep(id) : undefined;
    if (stored) {
      rewards.gifts.push(stored);
      continue;
    }
    const threshold = { ...(ctx.kept.tiers.get(id) ?? {}), ...readAmounts(form, (c) => F.tierAmount(id, c), ctx.currencies, errors) };
    if (Object.keys(threshold).length === 0) errors.push({ field: F.tierAmount(id, ctx.currencies[0] ?? ""), key: "rewards.error.giftAmount" });
    const choices = [...new Set(form.getAll(F.choice(id)).map(str).filter((v) => VARIANT.test(v)))];
    if (choices.length === 0) errors.push({ field: F.choice(id), key: "rewards.error.giftChoice" });
    if (choices.length > CONFIG_LIMITS.giftChoices) errors.push({ field: F.choice(id), key: "rewards.error.tooManyChoices", params: { max: CONFIG_LIMITS.giftChoices } });
    const fallback = str(form.get(F.fallback(id)));
    const tier: GiftTier = { id, threshold, choices: choices.slice(0, CONFIG_LIMITS.giftChoices) };
    if (VARIANT.test(fallback) && !choices.includes(fallback)) tier.fallbackVariantId = fallback;
    rewards.gifts.push(tier);
  }
  if (rewards.gifts.length > CONFIG_LIMITS.giftTiers) {
    errors.push({ field: F.tier, key: "rewards.error.tooManyTiers", params: { max: CONFIG_LIMITS.giftTiers } });
  }
  return { rewards, errors };
}

/** A stored tier as the screen edits it (titles from Shopify; an unknown variant keeps its id, titled ""). */
export function giftTierView(tier: GiftTier, titles: ReadonlyMap<string, string>): GiftTierView {
  const variant = (id: string): GiftVariantView => ({ id, title: titles.get(id) ?? "" });
  return {
    id: tier.id,
    threshold: { ...tier.threshold },
    choices: tier.choices.map(variant),
    fallback: tier.fallbackVariantId ? variant(tier.fallbackVariantId) : null,
  };
}

/** The editable value of an amount ("" = none). */
export function amountInput(amounts: Record<string, number> | null | undefined, currency: string): string {
  const v = amounts?.[currency];
  return typeof v === "number" ? minorToInput(v, currency) : "";
}

/** Currencies of enabled markets a threshold has no value for (MKT-1: not offered there; the screen says which). */
export function missingCurrencies(amounts: Record<string, number> | null | undefined, currencies: readonly string[]): string[] {
  return currencies.filter((c) => typeof amounts?.[c] !== "number");
}
