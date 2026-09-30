import {
  DISCOUNT_METHODS,
  DISCOUNT_TARGET_KINDS,
  DISCOUNT_VALUE_KINDS,
  MINIMUM_SCOPES,
  type DiscountTargetKind,
  type DiscountValueKind,
} from "./enums.ts";
import { CONFIG_LIMITS } from "./limits.ts";
import {
  type IdAliases,
  isRecord,
  listParams,
  listPreview,
  preview,
  pushIssue,
  rememberAlias,
  sanitizeBoolWithIssue,
  sanitizeEntityId,
  sanitizeEnum,
  sanitizeMoney,
  sanitizePercent,
  sanitizeString,
  sanitizeStringArray,
} from "./sanitize-helpers.ts";
import type { ConfigIssue, DiscountRule, DiscountRuleValue, DiscountTarget } from "./types.ts";
import { isIsoDateTime, NATIVE_DISCOUNT_GID_RE } from "./validators.ts";

/** True when `v` is one of the runtime `as const` values (the list IS the validation). */
function isOneOf<T extends string>(v: unknown, allowed: readonly T[]): v is T {
  return typeof v === "string" && (allowed as readonly string[]).includes(v);
}

type Sanitizer<Out> = (v: Record<string, unknown>, issues: ConfigIssue[], path: string) => Out;

// One sanitizer per kind, keyed by the exported kind list: adding a kind to
// DISCOUNT_VALUE_KINDS / DISCOUNT_TARGET_KINDS without handling it here is a type
// error, and a kind handled here but missing from the list is never accepted.
const VALUE_SANITIZERS: { readonly [K in DiscountValueKind]: Sanitizer<Extract<DiscountRuleValue, { kind: K }>> } = {
  percentage: (v, issues, path) => ({
    kind: "percentage",
    percent: sanitizePercent(v.percent, 0, `${path}.percent`, issues),
  }),
  fixed: (v, issues, path) => ({ kind: "fixed", amount: sanitizeMoney(v.amount, issues, `${path}.amount`) }),
  freeShipping: () => ({ kind: "freeShipping" }),
};

const TARGET_SANITIZERS: { readonly [K in DiscountTargetKind]: Sanitizer<Extract<DiscountTarget, { kind: K }>> } = {
  order: () => ({ kind: "order" }),
  shipping: () => ({ kind: "shipping" }),
  products: (v, issues, path) => ({
    kind: "products",
    productIds: sanitizeStringArray(v.productIds, issues, `${path}.productIds`),
    variantIds: sanitizeStringArray(v.variantIds, issues, `${path}.variantIds`),
  }),
  collections: (v, issues, path) => ({ kind: "collections", ids: sanitizeStringArray(v.ids, issues, `${path}.ids`) }),
};

function sanitizeDiscountRuleValue(
  v: unknown,
  issues: ConfigIssue[],
  path: string,
): DiscountRuleValue {
  if (isRecord(v) && isOneOf(v.kind, DISCOUNT_VALUE_KINDS)) {
    return VALUE_SANITIZERS[v.kind](v, issues, path);
  }
  pushIssue(
    issues,
    path,
    "invalid_value",
    `Invalid discount value${isRecord(v) ? ` ${preview(v.kind, 40)}` : ""}; expected one of ${DISCOUNT_VALUE_KINDS.join(", ")}. Defaulted to 0% off.`,
    { ...(isRecord(v) ? { value: preview(v.kind, 40) } : {}), allowed: DISCOUNT_VALUE_KINDS.join(", "), percent: 0 },
  );
  return { kind: "percentage", percent: 0 };
}

function sanitizeDiscountTarget(
  v: unknown,
  issues: ConfigIssue[],
  path: string,
): DiscountTarget {
  if (isRecord(v) && isOneOf(v.kind, DISCOUNT_TARGET_KINDS)) {
    return TARGET_SANITIZERS[v.kind](v, issues, path);
  }
  pushIssue(
    issues,
    path,
    "invalid_target",
    `Invalid discount target${isRecord(v) ? ` ${preview(v.kind, 40)}` : ""}; expected one of ${DISCOUNT_TARGET_KINDS.join(", ")}. Defaulted to order.`,
    { ...(isRecord(v) ? { value: preview(v.kind, 40) } : {}), allowed: DISCOUNT_TARGET_KINDS.join(", "), fallback: "order" },
  );
  return { kind: "order" };
}

/**
 * Free shipping has exactly one sensible target (shipping); any other target is
 * a contradiction the merchant cannot have meant, so the value wins, with an issue.
 */
function reconcileValueAndTarget(
  value: DiscountRuleValue,
  target: DiscountTarget,
  issues: ConfigIssue[],
  path: string,
): DiscountTarget {
  if (value.kind !== "freeShipping" || target.kind === "shipping") return target;
  pushIssue(
    issues,
    `${path}.target`,
    "value_target_mismatch",
    `Free shipping always applies to shipping; the target "${target.kind}" was changed to shipping.`,
    { from: target.kind, to: "shipping" },
  );
  return { kind: "shipping" };
}

/**
 * Tie-break priority (spec §3 A1: `priority desc, id asc`): an optional integer
 * 0..CONFIG_LIMITS.rulePriority. Absent = 0. Only a finite `number` is accepted
 * (no string coercion); fractions are floored, out of range is clamped.
 */
function sanitizePriority(v: unknown, issues: ConfigIssue[], path: string): number | undefined {
  if (v === undefined || v === null) return undefined;
  if (typeof v !== "number" || !Number.isFinite(v)) {
    pushIssue(issues, path, "invalid_priority", `Priority must be a number, got ${preview(v, 40)}; it was removed.`, { value: preview(v, 40) });
    return undefined;
  }
  const n = Math.floor(v);
  const clamped = Math.min(CONFIG_LIMITS.rulePriority, Math.max(0, n));
  if (clamped !== n) {
    pushIssue(
      issues,
      path,
      "clamped_priority",
      `Priority ${n} is out of range 0-${CONFIG_LIMITS.rulePriority}; clamped to ${clamped}.`,
      { value: n, min: 0, max: CONFIG_LIMITS.rulePriority, to: clamped },
    );
  }
  return clamped;
}

/**
 * Discount codes are case-insensitive in Shopify, so they are stored trimmed and
 * upper-cased, once each, and never longer than CONFIG_LIMITS.codeLength (64,
 * audit round 6; Shopify itself accepts 255, audit P3-10).
 */
function sanitizeCodes(v: unknown[], issues: ConfigIssue[], path: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  let duplicates = 0;
  let tooLong = 0;
  let overLimit = 0;
  for (const raw of v) {
    if (typeof raw !== "string") continue;
    const code = raw.trim().toUpperCase();
    if (!code) continue;
    if (code.length > CONFIG_LIMITS.codeLength) {
      tooLong++;
      continue;
    }
    if (seen.has(code)) {
      duplicates++;
      continue;
    }
    if (out.length >= CONFIG_LIMITS.codesPerRule) {
      overLimit++;
      continue;
    }
    seen.add(code);
    out.push(code);
  }
  if (tooLong > 0) {
    pushIssue(
      issues,
      path,
      "code_too_long",
      `${tooLong} code(s) longer than ${CONFIG_LIMITS.codeLength} characters were dropped.`,
      { count: tooLong, max: CONFIG_LIMITS.codeLength },
    );
  }
  if (duplicates > 0) {
    pushIssue(
      issues,
      path,
      "duplicate_code",
      `${duplicates} duplicate code(s) were merged (codes are not case-sensitive).`,
      { reason: "merged", count: duplicates },
    );
  }
  if (overLimit > 0) {
    pushIssue(
      issues,
      path,
      "too_many_codes",
      `A rule can have at most ${CONFIG_LIMITS.codesPerRule} codes; ${overLimit} more were dropped.`,
      { max: CONFIG_LIMITS.codesPerRule, count: overLimit },
    );
  }
  return out;
}

/**
 * A rule's schedule becomes startsAt/endsAt of its Shopify discount node, so both
 * must be ISO 8601 date-times with a zone and start < end. A schedule that is
 * supplied but wrong is removed AND the rule is disabled (with an issue): running
 * a time-limited discount forever is worse than not running it until fixed.
 */
function sanitizeSchedule(
  v: unknown,
  issues: ConfigIssue[],
  path: string,
): { ok: true; schedule?: DiscountRule["schedule"] } | { ok: false } {
  if (v === undefined || v === null) return { ok: true };
  const fail = (why: string, params: NonNullable<ConfigIssue["params"]>) => {
    pushIssue(
      issues,
      path,
      "invalid_schedule",
      `${why} Use ISO 8601 date-times with a time zone (e.g. 2026-11-27T00:00:00+01:00) and a start before the end; the schedule was removed and the rule disabled.`,
      params,
    );
    return { ok: false as const };
  };
  if (!isRecord(v)) return fail("The schedule is not an object.", { reason: "not_object" });
  const schedule: NonNullable<DiscountRule["schedule"]> = {};
  for (const key of ["startsAt", "endsAt"] as const) {
    const value = v[key];
    if (value === undefined || value === null) continue;
    if (!isIsoDateTime(value)) return fail(`${key} ${preview(value, 40)} is not a valid date-time.`, { reason: "invalid_date", field: key, value: preview(value, 40) });
    schedule[key] = value;
  }
  if (schedule.startsAt && schedule.endsAt && Date.parse(schedule.startsAt) >= Date.parse(schedule.endsAt)) {
    return fail("The schedule ends before (or when) it starts.", { reason: "ends_before_start" });
  }
  // An empty schedule means "always"; it is simply omitted.
  return schedule.startsAt || schedule.endsAt ? { ok: true, schedule } : { ok: true };
}

export function sanitizeDiscountRule(v: unknown, issues: ConfigIssue[], path: string): DiscountRule | null {
  if (!isRecord(v)) return null;
  const entity = sanitizeEntityId(v.id, "rule", issues, path);
  if (!entity) {
    pushIssue(issues, path, "missing_id", "Discount rule without an id was dropped.", { kind: "rule" });
    return null;
  }
  const { id } = entity;

  const value = sanitizeDiscountRuleValue(v.value, issues, `${path}.value`);
  const rule: DiscountRule = {
    id,
    enabled: sanitizeBoolWithIssue(v.enabled, true, `${path}.enabled`, issues),
    name: sanitizeString(v.name, ""),
    method: sanitizeEnum(v.method, DISCOUNT_METHODS, "automatic", `${path}.method`, issues),
    value,
    target: reconcileValueAndTarget(value, sanitizeDiscountTarget(v.target, issues, `${path}.target`), issues, path),
  };

  const priority = sanitizePriority(v.priority, issues, `${path}.priority`);
  if (priority !== undefined) rule.priority = priority;

  if (Array.isArray(v.codes)) rule.codes = sanitizeCodes(v.codes, issues, `${path}.codes`);

  if (isRecord(v.minimum)) {
    const minimum: DiscountRule["minimum"] = {};
    if (v.minimum.subtotal !== undefined) {
      minimum.subtotal = sanitizeMoney(v.minimum.subtotal, issues, `${path}.minimum.subtotal`);
    }
    if (typeof v.minimum.quantity === "number" && Number.isFinite(v.minimum.quantity)) {
      minimum.quantity = Math.max(0, Math.floor(v.minimum.quantity));
    }
    // What the minimum is measured on (audit MVP 1 native F5): the whole cart
    // unless the rule says its entitled lines (a migrated native's semantics).
    minimum.scope = sanitizeEnum(v.minimum.scope, MINIMUM_SCOPES, "cart", `${path}.minimum.scope`, issues);
    rule.minimum = minimum;
  }

  const schedule = sanitizeSchedule(v.schedule, issues, `${path}.schedule`);
  if (!schedule.ok) rule.enabled = false;
  else if (schedule.schedule) rule.schedule = schedule.schedule;

  if (isRecord(v.limits)) {
    const limits: DiscountRule["limits"] = {};
    if (typeof v.limits.usageLimit === "number" && Number.isFinite(v.limits.usageLimit)) {
      limits.usageLimit = Math.max(0, Math.floor(v.limits.usageLimit));
    }
    if (typeof v.limits.oncePerCustomer === "boolean") limits.oncePerCustomer = v.limits.oncePerCustomer;
    rule.limits = limits;
  }

  if (isRecord(v.targeting)) {
    const targeting: DiscountRule["targeting"] = {};
    if (Array.isArray(v.targeting.segments)) {
      targeting.segments = sanitizeStringArray(v.targeting.segments, issues, `${path}.targeting.segments`);
    }
    if (Array.isArray(v.targeting.markets)) {
      targeting.markets = sanitizeStringArray(v.targeting.markets, issues, `${path}.targeting.markets`);
    }
    rule.targeting = targeting;
  }

  // Orphaned rule ids are pruned later (pruneCombinesWith), once every rule id is known.
  if (isRecord(v.combinesWith) && Array.isArray(v.combinesWith.ruleIds)) {
    rule.combinesWith = {
      ruleIds: sanitizeStringArray(v.combinesWith.ruleIds, issues, `${path}.combinesWith.ruleIds`),
    };
  }

  if (isRecord(v.origin)) {
    if (typeof v.origin.nativeId === "string" && NATIVE_DISCOUNT_GID_RE.test(v.origin.nativeId)) {
      rule.origin = { nativeId: v.origin.nativeId };
    } else {
      pushIssue(
        issues,
        `${path}.origin.nativeId`,
        "invalid_origin",
        `Native discount link ${preview(v.origin.nativeId, 60)} is not a Shopify discount node id (gid://shopify/DiscountCodeNode/…); the link was removed.`,
        { value: preview(v.origin.nativeId, 60) },
      );
    }
  }

  return rule;
}

/**
 * `combinesWith.ruleIds` may only name rules that exist (audit P2-2): ids of
 * rules whose id was regenerated are remapped, unknown ids are removed with an
 * issue, duplicates are merged.
 */
export function pruneCombinesWith(
  ruleIds: string[],
  known: ReadonlySet<string>,
  aliases: ReadonlyMap<string, string>,
  issues: ConfigIssue[],
  path: string,
): string[] {
  const out: string[] = [];
  const orphans: string[] = [];
  for (const raw of ruleIds) {
    const id = known.has(raw) ? raw : aliases.get(raw);
    if (id === undefined) {
      orphans.push(raw);
      continue;
    }
    if (!out.includes(id)) out.push(id);
  }
  if (orphans.length > 0) {
    pushIssue(
      issues,
      path,
      "orphan_combines_with",
      `Combines-with points to rule(s) that do not exist (${listPreview(orphans.map((o) => preview(o, 40)))}); they were removed.`,
      { ...listParams("ids", orphans.map((o) => preview(o, 40))), count: orphans.length },
    );
  }
  return out;
}

/**
 * Rules list: capped, one rule per id (the first wins, so the node-per-code-rule
 * mapping in MVP 1 can key on `id`), and every code owned by exactly one rule —
 * Shopify refuses the same code on two discount nodes.
 */
export function sanitizeRules(v: unknown, issues: ConfigIssue[]): { rules: DiscountRule[]; aliases: IdAliases } {
  const aliases: IdAliases = new Map();
  if (!Array.isArray(v)) return { rules: [], aliases };
  const out: DiscountRule[] = [];
  const paths: string[] = [];
  const ids = new Set<string>();
  const usedCodes = new Set<string>();
  let overLimit = 0;
  v.forEach((item, i) => {
    if (out.length >= CONFIG_LIMITS.rules) {
      overLimit++;
      return;
    }
    const path = `modules.codes.rules[${i}]`;
    const rule = sanitizeDiscountRule(item, issues, path);
    if (!rule) return;
    if (ids.has(rule.id)) {
      pushIssue(
        issues,
        path,
        "duplicate_rule_id",
        `Another rule already uses the id "${rule.id}"; this duplicate was dropped.`,
        { id: rule.id },
      );
      return;
    }
    ids.add(rule.id);
    if (isRecord(item)) rememberAlias(aliases, item.id, rule.id);
    if (rule.codes) {
      const taken = rule.codes.filter((code) => usedCodes.has(code));
      if (taken.length > 0) {
        rule.codes = rule.codes.filter((code) => !usedCodes.has(code));
        pushIssue(
          issues,
          `${path}.codes`,
          "duplicate_code",
          `Code(s) ${listPreview(taken)} already belong to an earlier rule and were removed from this one.`,
          { reason: "taken", ...listParams("codes", taken), count: taken.length },
        );
      }
      for (const code of rule.codes) usedCodes.add(code);
    }
    out.push(rule);
    paths.push(path);
  });
  if (overLimit > 0) {
    pushIssue(
      issues,
      "modules.codes.rules",
      "too_many_rules",
      `Only the first ${CONFIG_LIMITS.rules} discount rules are kept; ${overLimit} more were dropped.`,
      { max: CONFIG_LIMITS.rules, count: overLimit },
    );
  }
  out.forEach((rule, i) => {
    if (rule.combinesWith) {
      rule.combinesWith.ruleIds = pruneCombinesWith(
        rule.combinesWith.ruleIds,
        ids,
        aliases,
        issues,
        `${paths[i]}.combinesWith.ruleIds`,
      );
    }
  });
  return { rules: out, aliases };
}
