import { pruneCombinesWith, sanitizeDiscountRule } from "./codes.ts";
import { CONFIG_LIMITS } from "./limits.ts";
import { sanitizeGiftTier } from "./rewards.ts";
import {
  type IdAliases,
  isRecord,
  preview,
  pushIssue,
  sanitizeBool,
  sanitizeEntityId,
  sanitizeString,
  truncateKey,
} from "./sanitize-helpers.ts";
import { sanitizeTierSet } from "./tiers.ts";
import type { Campaign, ConfigIssue, DiscountRule, GiftTier, RuleOverride, TierSet } from "./types.ts";
import { isShopLocalDateTime } from "./validators.ts";

// A campaign override targets, by id, a discount rule, a tier set or a gift tier
// (spec §4.6: overrides across Slevy a kódy / Množstevní / Odměny). Its patch may
// only touch the fields listed here, and each patched value goes through the very
// sanitizer that guards the target itself — a campaign can never smuggle in a
// value (e.g. 1000 %) the module would have refused (audit P2-2, DATA-2).
// `method`/`codes`/`limits`/`origin` are excluded on purpose: they define the
// Shopify discount node, which a time window must not rewrite.
const OVERRIDE_FIELDS = {
  rule: ["enabled", "name", "value", "target", "minimum", "targeting", "combinesWith"],
  tierSet: ["countAcross", "breaks"],
  giftTier: ["threshold", "choices", "fallbackVariantId"],
} as const;

type OverrideTarget =
  | { kind: "rule"; value: DiscountRule }
  | { kind: "tierSet"; value: TierSet }
  | { kind: "giftTier"; value: GiftTier };

const OVERRIDE_TARGET_LABELS: Record<OverrideTarget["kind"], string> = {
  rule: "a discount rule",
  tierSet: "a tier set",
  giftTier: "a gift tier",
};

/**
 * What a campaign override can point at: every rule, tier set and gift tier by
 * its final id AND by the original id it had before sanitizeEntityId replaced
 * it (aliases), so an override written against the old id follows the entity.
 * An invalid original id can never equal a valid final id, so the two key
 * spaces never collide. `ruleIds`/`ruleAliases` prune `combinesWith` in patches.
 */
export interface OverrideContext {
  targets: Map<string, OverrideTarget[]>;
  ruleIds: ReadonlySet<string>;
  ruleAliases: ReadonlyMap<string, string>;
}

export function collectOverrideTargets(
  rules: DiscountRule[],
  sets: TierSet[],
  gifts: GiftTier[],
  aliases: { rules: IdAliases; sets: IdAliases; gifts: IdAliases },
): OverrideContext {
  const targets = new Map<string, OverrideTarget[]>();
  const add = (id: string, target: OverrideTarget) => {
    const list = targets.get(id);
    if (list) list.push(target);
    else targets.set(id, [target]);
  };
  const byId = <T extends { id: string }>(values: T[]) => new Map(values.map((value) => [value.id, value]));
  const rulesById = byId(rules);
  const setsById = byId(sets);
  const giftsById = byId(gifts);
  for (const value of rules) add(value.id, { kind: "rule", value });
  for (const value of sets) add(value.id, { kind: "tierSet", value });
  for (const value of gifts) add(value.id, { kind: "giftTier", value });
  for (const [raw, id] of aliases.rules) {
    const value = rulesById.get(id);
    if (value) add(raw, { kind: "rule", value });
  }
  for (const [raw, id] of aliases.sets) {
    const value = setsById.get(id);
    if (value) add(raw, { kind: "tierSet", value });
  }
  for (const [raw, id] of aliases.gifts) {
    const value = giftsById.get(id);
    if (value) add(raw, { kind: "giftTier", value });
  }
  return { targets, ruleIds: new Set(rulesById.keys()), ruleAliases: aliases.rules };
}

function sanitizeOverridePatch(
  target: OverrideTarget,
  rawPatch: Record<string, unknown>,
  issues: ConfigIssue[],
  path: string,
  ctx: OverrideContext,
): Record<string, unknown> {
  const allowed: readonly string[] = OVERRIDE_FIELDS[target.kind];
  // Start from the target's current (already sanitized) value so the target's own
  // sanitizer sees a complete object; only the patched keys are read back out.
  const merged: Record<string, unknown> = { ...(target.value as unknown as Record<string, unknown>) };
  const patched: string[] = [];
  for (const key of Object.keys(rawPatch)) {
    if (!allowed.includes(key)) {
      const safeKey = truncateKey(key);
      pushIssue(
        issues,
        `${path}.${safeKey}`,
        "override_field_not_allowed",
        `A campaign cannot change "${safeKey}" of ${OVERRIDE_TARGET_LABELS[target.kind]}; the field was ignored.`,
        { field: safeKey, target: target.kind },
      );
      continue;
    }
    merged[key] = rawPatch[key];
    patched.push(key);
  }
  if (patched.length === 0) return {};

  const sanitized: unknown =
    target.kind === "rule"
      ? sanitizeDiscountRule(merged, issues, path)
      : target.kind === "tierSet"
        ? sanitizeTierSet(merged, issues, path)
        : sanitizeGiftTier(merged, issues, path);
  if (!isRecord(sanitized)) return {};
  if (target.kind === "rule" && patched.includes("combinesWith")) {
    const combinesWith = (sanitized as unknown as DiscountRule).combinesWith;
    if (combinesWith) {
      combinesWith.ruleIds = pruneCombinesWith(
        combinesWith.ruleIds,
        ctx.ruleIds,
        ctx.ruleAliases,
        issues,
        `${path}.combinesWith.ruleIds`,
      );
    }
  }

  const out: Record<string, unknown> = {};
  for (const key of patched) {
    if (sanitized[key] !== undefined) out[key] = sanitized[key];
  }
  return out;
}

function sanitizeOverrides(
  v: unknown,
  issues: ConfigIssue[],
  path: string,
  ctx: OverrideContext,
): RuleOverride[] {
  const { targets } = ctx;
  if (!Array.isArray(v)) return [];
  const out: RuleOverride[] = [];
  let overLimit = 0;
  v.forEach((item, i) => {
    if (out.length >= CONFIG_LIMITS.overridesPerCampaign) {
      overLimit++;
      return;
    }
    if (!isRecord(item)) return;
    const itemPath = `${path}[${i}]`;
    const ruleId = typeof item.ruleId === "string" ? item.ruleId : "";
    const found = ruleId ? (targets.get(ruleId) ?? []) : [];
    if (found.length === 0) {
      pushIssue(
        issues,
        itemPath,
        "orphan_override",
        `Campaign override points to ${preview(ruleId, 60)}, which does not exist; the override was removed.`,
        { id: preview(ruleId, 60) },
      );
      return;
    }
    if (found.length > 1) {
      pushIssue(
        issues,
        itemPath,
        "ambiguous_override",
        `${preview(ruleId, 60)} matches more than one rule, tier set or gift tier; the override was removed.`,
        { id: preview(ruleId, 60) },
      );
      return;
    }
    const patch = sanitizeOverridePatch(found[0], isRecord(item.patch) ? item.patch : {}, issues, `${itemPath}.patch`, ctx);
    if (Object.keys(patch).length === 0) {
      pushIssue(issues, itemPath, "empty_override", "Campaign override changes nothing; it was removed.");
      return;
    }
    // Always the target's final id (an override written against an id that
    // sanitizeEntityId regenerated follows its entity).
    out.push({ ruleId: found[0].value.id, patch });
  });
  if (overLimit > 0) {
    pushIssue(
      issues,
      path,
      "too_many_overrides",
      `A campaign can have at most ${CONFIG_LIMITS.overridesPerCampaign} overrides; ${overLimit} more were dropped.`,
      { max: CONFIG_LIMITS.overridesPerCampaign, count: overLimit },
    );
  }
  return out;
}

function sanitizeCampaign(
  v: unknown,
  issues: ConfigIssue[],
  path: string,
  ctx: OverrideContext,
): Campaign | null {
  if (!isRecord(v)) return null;
  const entity = sanitizeEntityId(v.id, "campaign", issues, path);
  if (!entity) {
    pushIssue(issues, path, "missing_id", "Campaign without an id was dropped.", { kind: "campaign" });
    return null;
  }
  const { id } = entity;
  const name = sanitizeString(v.name, "");
  const window = isRecord(v.window) ? v.window : {};
  const start = isShopLocalDateTime(window.start) ? window.start : "";
  const end = isShopLocalDateTime(window.end) ? window.end : "";
  let killed = sanitizeBool(v.killed, false);
  // Same-shape strings compare chronologically, so `<` is a date comparison here.
  if (!start || !end || start >= end) {
    killed = true;
    pushIssue(
      issues,
      `${path}.window`,
      "invalid_campaign_window",
      `Campaign "${name || id}" needs a start before its end, both as YYYY-MM-DDTHH:MM:SS in shop time; the campaign was disabled.`,
      { campaign: name || id },
    );
  }
  return {
    id,
    name,
    window: { start, end },
    // Killed campaigns keep their overrides (the merchant may revive them), and
    // those go through exactly the same caps and sanitizers as live ones.
    overrides: sanitizeOverrides(v.overrides, issues, `${path}.overrides`, ctx),
    killed,
  };
}

/**
 * Campaigns must not overlap (A8): the function checks one window at a time (C4),
 * so two live windows would make "which overrides apply" ambiguous. The campaign
 * that starts earlier (array order on a tie) stays; a later overlapping one is
 * disabled with an issue rather than deleted, so the merchant keeps their work.
 */
function disableOverlappingCampaigns(entries: Array<{ campaign: Campaign; path: string }>, issues: ConfigIssue[]) {
  const live = entries
    .filter((e) => !e.campaign.killed)
    .sort((a, b) => (a.campaign.window.start < b.campaign.window.start ? -1 : a.campaign.window.start > b.campaign.window.start ? 1 : 0));
  const kept: Campaign[] = [];
  for (const { campaign, path } of live) {
    const clash = kept.find((k) => campaign.window.start < k.window.end && k.window.start < campaign.window.end);
    if (!clash) {
      kept.push(campaign);
      continue;
    }
    campaign.killed = true;
    pushIssue(
      issues,
      path,
      "overlapping_campaign",
      `Campaign "${campaign.name || campaign.id}" overlaps "${clash.name || clash.id}"; campaigns must not overlap, so the later one was disabled.`,
      { campaign: campaign.name || campaign.id, other: clash.name || clash.id },
    );
  }
}

export function sanitizeCampaigns(v: unknown, issues: ConfigIssue[], ctx: OverrideContext): Campaign[] {
  if (!Array.isArray(v)) return [];
  const entries: Array<{ campaign: Campaign; path: string }> = [];
  const ids = new Set<string>();
  let overLimit = 0;
  v.forEach((item, i) => {
    if (entries.length >= CONFIG_LIMITS.campaigns) {
      overLimit++;
      return;
    }
    const path = `campaigns[${i}]`;
    const campaign = sanitizeCampaign(item, issues, path, ctx);
    if (!campaign) return;
    if (ids.has(campaign.id)) {
      pushIssue(
        issues,
        path,
        "duplicate_campaign_id",
        `Another campaign already uses the id "${campaign.id}"; this duplicate was dropped.`,
        { id: campaign.id },
      );
      return;
    }
    ids.add(campaign.id);
    entries.push({ campaign, path });
  });
  if (overLimit > 0) {
    pushIssue(
      issues,
      "campaigns",
      "too_many_campaigns",
      `Only the first ${CONFIG_LIMITS.campaigns} campaigns are kept; ${overLimit} more were dropped.`,
      { max: CONFIG_LIMITS.campaigns, count: overLimit },
    );
  }
  disableOverlappingCampaigns(entries, issues);
  return entries.map((e) => e.campaign);
}
