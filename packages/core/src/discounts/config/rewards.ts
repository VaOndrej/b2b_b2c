import { DEFAULT_CONFIG } from "./defaults.ts";
import { CONFIG_LIMITS } from "./limits.ts";
import {
  type IdAliases,
  isRecord,
  pushIssue,
  rememberAlias,
  sanitizeBoolWithIssue,
  sanitizeEntityId,
  sanitizeMoney,
  sanitizeReference,
  sanitizeStringArray,
} from "./sanitize-helpers.ts";
import type { MoneyByCurrency } from "../money.ts";
import type { ConfigIssue, GiftTier, RewardsModule } from "./types.ts";

/**
 * A reward threshold (MVP 4, R1): whole positive minor units per currency. A
 * currency at 0 would offer the reward on an empty cart, so it is dropped with
 * an issue — the reward is then not offered in that currency (MKT-1).
 */
export function sanitizeThreshold(v: unknown, issues: ConfigIssue[], path: string): MoneyByCurrency {
  const money = sanitizeMoney(v, issues, path);
  const zero = Object.keys(money).filter((k) => !(money[k]! > 0));
  if (zero.length === 0) return money;
  pushIssue(issues, path, "threshold_not_positive", `A threshold must be above 0; ${zero.join(", ")} was dropped (the reward is not offered in that currency).`, {
    currencies: zero.join(", "),
    count: zero.length,
  });
  return Object.fromEntries(Object.entries(money).filter(([k]) => !zero.includes(k)));
}

export function sanitizeGiftTier(v: unknown, issues: ConfigIssue[], path: string): GiftTier | null {
  if (!isRecord(v)) return null;
  const entity = sanitizeEntityId(v.id, "gift", issues, path);
  if (!entity) return null;
  let choices = sanitizeStringArray(v.choices, issues, `${path}.choices`);
  if (choices.length > CONFIG_LIMITS.giftChoices) {
    pushIssue(
      issues,
      `${path}.choices`,
      "too_many_gift_choices",
      `A threshold offers at most ${CONFIG_LIMITS.giftChoices} gifts to choose from; ${choices.length - CONFIG_LIMITS.giftChoices} more were dropped.`,
      { max: CONFIG_LIMITS.giftChoices, count: choices.length - CONFIG_LIMITS.giftChoices },
    );
    choices = choices.slice(0, CONFIG_LIMITS.giftChoices);
  }
  const out: GiftTier = {
    id: entity.id,
    threshold: sanitizeThreshold(v.threshold, issues, `${path}.threshold`),
    choices,
  };
  const fallback = sanitizeReference(v.fallbackVariantId, issues, `${path}.fallbackVariantId`);
  if (fallback !== undefined && choices.includes(fallback)) {
    pushIssue(issues, `${path}.fallbackVariantId`, "gift_fallback_is_choice", "The fallback gift is already one of the gifts offered; it was dropped.", {});
  } else if (fallback !== undefined) {
    out.fallbackVariantId = fallback;
  }
  return out;
}

export function sanitizeRewards(v: unknown, issues: ConfigIssue[]): { rewards: RewardsModule; aliases: IdAliases } {
  const def = DEFAULT_CONFIG.modules.rewards;
  const rec = isRecord(v) ? v : {};
  const aliases: IdAliases = new Map();
  let gifts: GiftTier[] = [];
  if (Array.isArray(rec.gifts)) {
    rec.gifts.forEach((item, i) => {
      const gift = sanitizeGiftTier(item, issues, `modules.rewards.gifts[${i}]`);
      if (!gift) return;
      if (isRecord(item)) rememberAlias(aliases, item.id, gift.id);
      gifts.push(gift);
    });
  }
  if (gifts.length > CONFIG_LIMITS.giftTiers) {
    pushIssue(
      issues,
      "modules.rewards.gifts",
      "too_many_gift_tiers",
      `Only the first ${CONFIG_LIMITS.giftTiers} gift tiers are kept; ${gifts.length - CONFIG_LIMITS.giftTiers} more were dropped.`,
      { max: CONFIG_LIMITS.giftTiers, count: gifts.length - CONFIG_LIMITS.giftTiers },
    );
    gifts = gifts.slice(0, CONFIG_LIMITS.giftTiers);
  }
  const out: RewardsModule = {
    gifts,
    countOtherDiscounts: sanitizeBoolWithIssue(
      rec.countOtherDiscounts,
      def.countOtherDiscounts,
      "modules.rewards.countOtherDiscounts",
      issues,
    ),
    giftDeclinable: true,
  };
  if (isRecord(rec.freeShipping)) {
    out.freeShipping = {
      threshold: sanitizeThreshold(rec.freeShipping.threshold, issues, "modules.rewards.freeShipping.threshold"),
    };
  }
  return { rewards: out, aliases };
}
