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
// market, MKT-1). Breaks are unique and ascending by `minQty` (whole items,
// 1–CONFIG_LIMITS.tierMinQty); set ids are unique (the engine's candidate id is
// `tier:<setId>` and a product metafield names its set by id, K3).
// A set is of ONE kind — all percent or all amount, the kind of its lowest
// break — and its values never fall as the quantity grows: a percent is ≥ every
// lower break's, an amount ≥ the lower breaks' amounts in each of its
// currencies (fix round 1, review I1). Together with the engine's selection
// (the highest break OFFERED in the cart currency) a tier is then monotone in
// the count, so counting fewer items (Free: per product instead of across the
// cart) never gives more. Every change is reported with structured params (the
// admin words it from code + params only):
//   tier_break_without_quantity  no usable minQty → the break is dropped;
//   clamped_tier_quantity        a fractional, < 1 or > tierMinQty minQty → floored / clamped {value, to, min, max};
//   tier_break_without_value     no percent and no amount in any currency → dropped {minQty};
//   tier_break_two_values        a percent AND an amount → the percent is kept {minQty};
//   duplicate_tier_break         a minQty already given → the later break is dropped {minQty};
//   tier_break_other_kind        not the kind of the set's lowest break → dropped {minQty};
//   tier_break_lower_value       worth less than a lower break (in some currency) → dropped {minQty};
//   duplicate_tier_set_id        an id already used → the later set is dropped {id}.
// A percent outside 0–100 is clamped (clamped_percent); a percent that is not
// a number is 0 with invalid_percent (as a rule's value); `percent: null` is no
// percent; an amount goes through sanitizeMoney (clamped_money, too_many_currencies).

/** Whole items, 1–CONFIG_LIMITS.tierMinQty; anything else adjusted with `clamped_tier_quantity`. */
function sanitizeMinQty(v: number, issues: ConfigIssue[], path: string): number {
  const to = Math.min(CONFIG_LIMITS.tierMinQty, Math.max(1, Math.floor(v)));
  if (to !== v) {
    pushIssue(
      issues,
      `${path}.minQty`,
      "clamped_tier_quantity",
      `A break's quantity must be a whole number of items from 1 to ${CONFIG_LIMITS.tierMinQty}; ${v} became ${to}.`,
      { value: v, to, min: 1, max: CONFIG_LIMITS.tierMinQty },
    );
  }
  return to;
}

function sanitizeTierBreak(v: unknown, issues: ConfigIssue[], path: string): TierBreak | null {
  if (!isRecord(v)) return null;
  if (typeof v.minQty !== "number" || !Number.isFinite(v.minQty)) {
    pushIssue(issues, path, "tier_break_without_quantity", "A quantity break without a minimum quantity was dropped.");
    return null;
  }
  const minQty = sanitizeMinQty(v.minQty, issues, path);
  // Absent or null = no percent; anything else is one (junk → 0 with invalid_percent, as a rule's value).
  const percent = v.percent === undefined || v.percent === null ? undefined : sanitizePercent(v.percent, 0, `${path}.percent`, issues);
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

type PathedBreak = { b: TierBreak; path: string };

/**
 * One kind (the lowest break's) and values that never fall, walking the breaks
 * ascending: a break of the other kind, or worth less than the highest value
 * kept so far (a percent; an amount in any of its currencies), is dropped.
 */
function monotoneBreaks(sorted: PathedBreak[], issues: ConfigIssue[]): TierBreak[] {
  const out: TierBreak[] = [];
  const percentKind = sorted.length > 0 && sorted[0].b.percent !== undefined;
  let topPercent = -1;
  const topAmount = new Map<string, number>();
  for (const { b, path } of sorted) {
    if ((b.percent !== undefined) !== percentKind) {
      pushIssue(
        issues,
        path,
        "tier_break_other_kind",
        `The break from ${b.minQty} items is ${percentKind ? "an amount" : "a percent"} in a set of ${percentKind ? "percents" : "amounts"}; it was dropped.`,
        { minQty: b.minQty },
      );
      continue;
    }
    const lower =
      b.percent !== undefined
        ? b.percent < topPercent
        : Object.entries(b.amountOff ?? {}).some(([currency, amount]) => amount < (topAmount.get(currency) ?? -1));
    if (lower) {
      pushIssue(
        issues,
        path,
        "tier_break_lower_value",
        `The break from ${b.minQty} items is worth less than a break for fewer items; it was dropped.`,
        { minQty: b.minQty },
      );
      continue;
    }
    if (b.percent !== undefined) topPercent = b.percent;
    for (const [currency, amount] of Object.entries(b.amountOff ?? {})) topAmount.set(currency, amount);
    out.push(b);
  }
  return out;
}

/**
 * The breaks: one value each, unique by minQty (the first given wins), the
 * first CONFIG_LIMITS.breaksPerTierSet given, ascending, of one kind, values
 * never falling (see the header).
 */
function sanitizeTierBreaks(v: unknown, issues: ConfigIssue[], path: string): TierBreak[] {
  if (!Array.isArray(v)) return [];
  let breaks: PathedBreak[] = [];
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
    breaks.push({ b, path: itemPath });
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
  return monotoneBreaks(
    breaks.sort((x, y) => x.b.minQty - y.b.minQty),
    issues,
  );
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
