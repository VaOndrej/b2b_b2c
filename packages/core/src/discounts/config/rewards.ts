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
import type { ConfigIssue, GiftTier, RewardsModule } from "./types.ts";

export function sanitizeGiftTier(v: unknown, issues: ConfigIssue[], path: string): GiftTier | null {
  if (!isRecord(v)) return null;
  const entity = sanitizeEntityId(v.id, "gift", issues, path);
  if (!entity) return null;
  const out: GiftTier = {
    id: entity.id,
    threshold: sanitizeMoney(v.threshold, issues, `${path}.threshold`),
    choices: sanitizeStringArray(v.choices, issues, `${path}.choices`),
  };
  const fallback = sanitizeReference(v.fallbackVariantId, issues, `${path}.fallbackVariantId`);
  if (fallback !== undefined) out.fallbackVariantId = fallback;
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
      threshold: sanitizeMoney(rec.freeShipping.threshold, issues, "modules.rewards.freeShipping.threshold"),
    };
  }
  return { rewards: out, aliases };
}
