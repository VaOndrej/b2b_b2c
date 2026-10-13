import { type CombineSetting, type CombineType, COMBINE_TYPES, normalizeCombineTypes, type RuleCombine } from "../combine.ts";
import { isRecord, listParams, listPreview, preview, pushIssue, sanitizeStringArray } from "./sanitize-helpers.ts";
import type { ConfigIssue } from "./types.ts";

/**
 * A list of types (combine.ts): known types only, each once, in the order of COMBINE_TYPES. Not an array →
 * `fallback` (a module that never stored its list); an unknown type is dropped with an issue.
 */
export function sanitizeCombineTypes(v: unknown, fallback: readonly CombineType[], path: string, issues: ConfigIssue[]): CombineType[] {
  if (!Array.isArray(v)) {
    if (v !== undefined && v !== null) pushIssue(issues, path, "invalid_combine_types", `The list of types to combine with is not a list; the default was used.`, {});
    return [...fallback];
  }
  const unknown = v.filter((x) => !(COMBINE_TYPES as readonly unknown[]).includes(x)).map((x) => preview(x, 40));
  if (unknown.length > 0) {
    pushIssue(issues, path, "unknown_combine_type", `Unknown type(s) to combine with (${listPreview(unknown)}) were removed.`, {
      ...listParams("types", unknown),
      count: unknown.length,
    });
  }
  return normalizeCombineTypes(v);
}

/** A module's list. A module stored without one gets `fallback` (its default). */
export function sanitizeCombineSetting(v: unknown, fallback: { readonly types: readonly CombineType[] }, path: string, issues: ConfigIssue[]): CombineSetting {
  return { types: sanitizeCombineTypes(isRecord(v) ? v.types : undefined, fallback.types, `${path}.types`, issues) };
}

/**
 * A rule's list and its exceptions. A rule stored without a list adds up with nothing. The exceptions are pruned
 * later (pruneCombineRules), once every rule id is known.
 */
export function sanitizeRuleCombine(v: unknown, path: string, issues: ConfigIssue[]): RuleCombine | undefined {
  if (!isRecord(v)) return undefined;
  const out: RuleCombine = { types: sanitizeCombineTypes(v.types, [], `${path}.types`, issues) };
  if (Array.isArray(v.rules)) {
    const rules = sanitizeStringArray(v.rules, issues, `${path}.rules`);
    if (rules.length > 0) out.rules = rules;
  }
  return out;
}

/**
 * Exceptions may only name rules that exist, and never the rule itself: ids of rules whose id was regenerated
 * are remapped, unknown ids are removed with an issue, duplicates are merged.
 */
export function pruneCombineRules(
  ruleIds: string[],
  self: string,
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
    if (id !== self && !out.includes(id)) out.push(id);
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
