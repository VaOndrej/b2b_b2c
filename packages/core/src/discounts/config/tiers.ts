import { TIER_COUNT_ACROSS_MODES } from "./enums.ts";
import { CONFIG_LIMITS } from "./limits.ts";
import {
  type IdAliases,
  isRecord,
  pushIssue,
  rememberAlias,
  sanitizeEntityId,
  sanitizeEnum,
  sanitizeMoney,
  sanitizeStringArray,
} from "./sanitize-helpers.ts";
import type { ConfigIssue, TierBreak, TierSet, TierSetScope } from "./types.ts";

function sanitizeTierBreak(v: unknown, issues: ConfigIssue[], path: string): TierBreak | null {
  if (!isRecord(v)) return null;
  if (typeof v.minQty !== "number" || !Number.isFinite(v.minQty)) return null;
  const out: TierBreak = { minQty: Math.max(1, Math.floor(v.minQty)) };
  if (typeof v.percent === "number" && Number.isFinite(v.percent)) {
    out.percent = Math.min(100, Math.max(0, v.percent));
  }
  if (v.amountOff !== undefined) out.amountOff = sanitizeMoney(v.amountOff, issues, `${path}.amountOff`);
  return out;
}

function sanitizeTierSetScope(v: unknown, issues: ConfigIssue[], path: string): TierSetScope {
  if (v === "global") return "global";
  if (isRecord(v)) {
    const out: { productIds?: string[]; collectionIds?: string[] } = {};
    if (Array.isArray(v.productIds)) out.productIds = sanitizeStringArray(v.productIds, issues, `${path}.productIds`);
    if (Array.isArray(v.collectionIds)) {
      out.collectionIds = sanitizeStringArray(v.collectionIds, issues, `${path}.collectionIds`);
    }
    return out;
  }
  return "global";
}

export function sanitizeTierSet(v: unknown, issues: ConfigIssue[], path: string): TierSet | null {
  if (!isRecord(v)) return null;
  const entity = sanitizeEntityId(v.id, "tier", issues, path);
  if (!entity) {
    pushIssue(issues, path, "missing_id", "Tier set without an id was dropped.", { kind: "tier_set" });
    return null;
  }
  const { id } = entity;
  let breaks = Array.isArray(v.breaks)
    ? v.breaks
        .map((b, j) => sanitizeTierBreak(b, issues, `${path}.breaks[${j}]`))
        .filter((b): b is TierBreak => b !== null)
    : [];
  if (breaks.length > CONFIG_LIMITS.breaksPerTierSet) {
    pushIssue(
      issues,
      `${path}.breaks`,
      "too_many_tier_breaks",
      `A tier set can have at most ${CONFIG_LIMITS.breaksPerTierSet} quantity breaks; ${breaks.length - CONFIG_LIMITS.breaksPerTierSet} more were dropped.`,
      { max: CONFIG_LIMITS.breaksPerTierSet, count: breaks.length - CONFIG_LIMITS.breaksPerTierSet },
    );
    breaks = breaks.slice(0, CONFIG_LIMITS.breaksPerTierSet);
  }
  return {
    id,
    scope: sanitizeTierSetScope(v.scope, issues, `${path}.scope`),
    countAcross: sanitizeEnum(v.countAcross, TIER_COUNT_ACROSS_MODES, "line", `${path}.countAcross`, issues),
    breaks,
  };
}

export function sanitizeTierSets(v: unknown, issues: ConfigIssue[]): { sets: TierSet[]; aliases: IdAliases } {
  const aliases: IdAliases = new Map();
  if (!Array.isArray(v)) return { sets: [], aliases };
  const out: TierSet[] = [];
  let overLimit = 0;
  v.forEach((item, i) => {
    if (out.length >= CONFIG_LIMITS.tierSets) {
      overLimit++;
      return;
    }
    const set = sanitizeTierSet(item, issues, `modules.tiers.sets[${i}]`);
    if (!set) return;
    if (isRecord(item)) rememberAlias(aliases, item.id, set.id);
    out.push(set);
  });
  if (overLimit > 0) {
    pushIssue(
      issues,
      "modules.tiers.sets",
      "too_many_tier_sets",
      `Only the first ${CONFIG_LIMITS.tierSets} tier sets are kept; ${overLimit} more were dropped.`,
      { max: CONFIG_LIMITS.tierSets, count: overLimit },
    );
  }
  return { sets: out, aliases };
}
