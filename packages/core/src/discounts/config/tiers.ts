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
  sanitizePercent,
  sanitizeStringArray,
} from "./sanitize-helpers.ts";
import type { ConfigIssue, TierBreak, TierSet, TierSetScope } from "./types.ts";

// Quantity tier sets (MVP 3, contracts K1/K2). A break has EXACTLY one value:
// a percent off each item, or an amount off each item per currency (minor
// units; a currency without an amount = the break is not offered in that
// market, MKT-1). Breaks are unique and ascending by `minQty` (≥ 1, whole
// items); set ids are unique (the engine's candidate id is `tier:<setId>` and a
// product metafield names its set by id, K3). Every change is reported with
// structured params (the admin words it from code + params only):
//   tier_break_without_quantity  no usable minQty → the break is dropped;
//   tier_break_without_value     no percent and no amount in any currency → dropped {minQty};
//   tier_break_two_values        a percent AND an amount → the percent is kept {minQty};
//   duplicate_tier_break         a minQty already given → the later break is dropped {minQty};
//   duplicate_tier_set_id        an id already used → the later set is dropped {id}.
// A percent outside 0–100 is clamped (clamped_percent); an amount goes through
// sanitizeMoney (clamped_money, too_many_currencies).

function sanitizeTierBreak(v: unknown, issues: ConfigIssue[], path: string): TierBreak | null {
  if (!isRecord(v)) return null;
  if (typeof v.minQty !== "number" || !Number.isFinite(v.minQty)) {
    pushIssue(issues, path, "tier_break_without_quantity", "A quantity break without a minimum quantity was dropped.");
    return null;
  }
  const minQty = Math.max(1, Math.floor(v.minQty));
  const percent =
    typeof v.percent === "number" && Number.isFinite(v.percent) ? sanitizePercent(v.percent, 0, `${path}.percent`, issues) : undefined;
  const amountOff = v.amountOff !== undefined ? sanitizeMoney(v.amountOff, issues, `${path}.amountOff`) : undefined;
  const hasAmount = amountOff !== undefined && Object.keys(amountOff).length > 0;
  if (percent !== undefined) {
    if (hasAmount) {
      pushIssue(
        issues,
        path,
        "tier_break_two_values",
        `The break from ${minQty} items had both a percent and an amount; the percent was kept.`,
        { minQty },
      );
    }
    return { minQty, percent };
  }
  if (hasAmount) return { minQty, amountOff };
  pushIssue(
    issues,
    path,
    "tier_break_without_value",
    `The break from ${minQty} items had neither a percent nor an amount; it was dropped.`,
    { minQty },
  );
  return null;
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

/** The breaks: one value each, unique by minQty (the first given wins), the first CONFIG_LIMITS.breaksPerTierSet, ascending. */
function sanitizeTierBreaks(v: unknown, issues: ConfigIssue[], path: string): TierBreak[] {
  if (!Array.isArray(v)) return [];
  let breaks: TierBreak[] = [];
  const seen = new Set<number>();
  v.forEach((item, j) => {
    const itemPath = `${path}[${j}]`;
    const b = sanitizeTierBreak(item, issues, itemPath);
    if (!b) return;
    if (seen.has(b.minQty)) {
      pushIssue(
        issues,
        itemPath,
        "duplicate_tier_break",
        `Another break of this set already starts at ${b.minQty} items; this one was dropped.`,
        { minQty: b.minQty },
      );
      return;
    }
    seen.add(b.minQty);
    breaks.push(b);
  });
  if (breaks.length > CONFIG_LIMITS.breaksPerTierSet) {
    pushIssue(
      issues,
      path,
      "too_many_tier_breaks",
      `A tier set can have at most ${CONFIG_LIMITS.breaksPerTierSet} quantity breaks; ${breaks.length - CONFIG_LIMITS.breaksPerTierSet} more were dropped.`,
      { max: CONFIG_LIMITS.breaksPerTierSet, count: breaks.length - CONFIG_LIMITS.breaksPerTierSet },
    );
    breaks = breaks.slice(0, CONFIG_LIMITS.breaksPerTierSet);
  }
  return breaks.sort((a, b) => a.minQty - b.minQty);
}

export function sanitizeTierSet(v: unknown, issues: ConfigIssue[], path: string): TierSet | null {
  if (!isRecord(v)) return null;
  const entity = sanitizeEntityId(v.id, "tier", issues, path);
  if (!entity) {
    pushIssue(issues, path, "missing_id", "Tier set without an id was dropped.", { kind: "tier_set" });
    return null;
  }
  return {
    id: entity.id,
    scope: sanitizeTierSetScope(v.scope, issues, `${path}.scope`),
    countAcross: sanitizeEnum(v.countAcross, TIER_COUNT_ACROSS_MODES, "line", `${path}.countAcross`, issues),
    breaks: sanitizeTierBreaks(v.breaks, issues, `${path}.breaks`),
  };
}

export function sanitizeTierSets(v: unknown, issues: ConfigIssue[]): { sets: TierSet[]; aliases: IdAliases } {
  const aliases: IdAliases = new Map();
  if (!Array.isArray(v)) return { sets: [], aliases };
  const out: TierSet[] = [];
  const ids = new Set<string>();
  let overLimit = 0;
  v.forEach((item, i) => {
    if (out.length >= CONFIG_LIMITS.tierSets) {
      overLimit++;
      return;
    }
    const path = `modules.tiers.sets[${i}]`;
    const set = sanitizeTierSet(item, issues, path);
    if (!set) return;
    if (ids.has(set.id)) {
      pushIssue(
        issues,
        path,
        "duplicate_tier_set_id",
        `Another tier set already uses the id "${set.id}"; this duplicate was dropped.`,
        { id: set.id },
      );
      return;
    }
    ids.add(set.id);
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
