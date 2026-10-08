// What the sanitizer adjusted in a save, in the admin language (§4c, A10).
// The core's ConfigIssue carries a stable `code`, a `path`, structured
// `params` (the values it names: limits, counts, the value given and the one
// kept — packages/core/src/discounts/config) and an English `message` for
// logs. The admin words an issue from `code` + `params` ONLY: every code the
// sanitizer can emit has its own i18n key `fix.<code>`; the English message is
// never read and never shown. A code this table does not know — or a known
// code without the params its sentence needs — gets the generic `fix.unknown`
// sentence (no English inside); `unworded` tells the caller to log it.
// Numbers are written the admin's way (cs: decimal comma, grouped thousands;
// a percent with its sign, as the margin screen's formatPercent writes it); a
// list the core cut short (`more` > 0) ends "a další N" / "and N more".
// Pure; tests/integration/issue-copy.test.ts.

import type { ConfigIssue } from "@won/core/discounts/config";

import { t, tp, type Locale, type MessageKey, type MessageParams } from "../../i18n";

/** How one placeholder is filled: a core param as a number / text, as a percent, or as a list the core may have cut short. */
type ParamSpec = string | { param: string; as: "percent" | "list" };

/** One code: its key, the params its sentence needs, and how to name them for it. */
interface IssueCopy {
  key: MessageKey;
  /** Sentence placeholder → the core param that fills it. */
  params?: Readonly<Record<string, ParamSpec>>;
}

const limit: IssueCopy["params"] = { max: "max", count: "count" };
const percent = (param: string): ParamSpec => ({ param, as: "percent" });
const list = (param: string): ParamSpec => ({ param, as: "list" });

const NBSP = "\u00a0";

/** A number in the admin language: cs "12,35" / "10 000", en "12.35" / "10,000" (exact, never rounded). */
export function issueNumber(n: number, locale: Locale): string {
  return new Intl.NumberFormat(locale === "cs" ? "cs-CZ" : "en-US", { maximumFractionDigits: 20 }).format(n);
}

/** A percent as the margin screen writes it (core formatPercent): cs "12,5 %", en "12.5%" — exact, never rounded. */
export function issuePercent(n: number, locale: Locale): string {
  const number = issueNumber(n, locale);
  return locale === "cs" ? `${number}${NBSP}%` : `${number}%`;
}

const COPY: Readonly<Record<string, IssueCopy | ((issue: ConfigIssue) => IssueCopy)>> = {
  ambiguous_override: { key: "fix.ambiguous_override" },
  clamped_money: { key: "fix.clamped_money" },
  clamped_percent: { key: "fix.clamped_percent", params: { from: percent("value"), max: percent("max"), to: percent("to") } },
  clamped_priority: { key: "fix.clamped_priority", params: { from: "value", max: "max", to: "to" } },
  code_too_long: { key: "fix.code_too_long", params: limit },
  duplicate_campaign_id: { key: "fix.duplicate_campaign_id" },
  // Two cases share the code (params.reason): repeats merged within a rule, or codes an earlier rule already has.
  duplicate_code: (issue): IssueCopy =>
    issue.params?.reason === "taken" ? { key: "fix.duplicate_code_taken", params: { codes: list("codes") } } : { key: "fix.duplicate_code", params: { count: "count" } },
  duplicate_rule_id: { key: "fix.duplicate_rule_id" },
  empty_override: { key: "fix.empty_override" },
  invalid_boolean: { key: "fix.invalid_boolean" },
  invalid_campaign_window: { key: "fix.invalid_campaign_window" },
  invalid_country: { key: "fix.invalid_country" },
  invalid_currency: { key: "fix.invalid_currency" },
  invalid_enum: { key: "fix.invalid_enum" },
  invalid_id: { key: "fix.invalid_id" },
  invalid_origin: { key: "fix.invalid_origin" },
  // A collection's field falls back to the store-wide setting (params.fallback "global"); a store-wide field to its default.
  // A tier break with junk for a percent keeps its amount (params.fallback "amount", minQty — MVP 3).
  invalid_percent: (issue): IssueCopy =>
    issue.params?.fallback === "global"
      ? { key: "fix.invalid_percent_global", params: { max: percent("max") } }
      : issue.params?.fallback === "amount"
        ? { key: "fix.invalid_percent_amount", params: { min: "minQty" } }
        : { key: "fix.invalid_percent", params: { max: percent("max"), fallback: percent("fallback") } },
  invalid_priority: { key: "fix.invalid_priority" },
  invalid_schedule: { key: "fix.invalid_schedule" },
  invalid_target: { key: "fix.invalid_target" },
  invalid_value: { key: "fix.invalid_value" },
  issues_truncated: { key: "fix.issues_truncated", params: { count: "count" } },
  locale_text_too_long: { key: "fix.locale_text_too_long", params: { max: "max" } },
  missing_handle: { key: "fix.missing_handle" },
  missing_id: { key: "fix.missing_id" },
  orphan_combines_with: { key: "fix.orphan_combines_with" },
  orphan_override: { key: "fix.orphan_override" },
  overlapping_campaign: { key: "fix.overlapping_campaign" },
  override_field_not_allowed: { key: "fix.override_field_not_allowed" },
  reference_too_long: { key: "fix.reference_too_long", params: { max: "max" } },
  rounded_percent: { key: "fix.rounded_percent", params: { from: percent("value"), to: percent("to") } },
  too_many_campaigns: { key: "fix.too_many_campaigns", params: limit },
  too_many_codes: { key: "fix.too_many_codes", params: limit },
  too_many_currencies: { key: "fix.too_many_currencies", params: limit },
  too_many_gift_tiers: { key: "fix.too_many_gift_tiers", params: limit },
  too_many_gift_choices: { key: "fix.too_many_gift_choices", params: limit },
  gift_fallback_is_choice: { key: "fix.gift_fallback_is_choice" },
  threshold_not_positive: { key: "fix.threshold_not_positive", params: { currencies: "currencies" } },
  too_many_items: { key: "fix.too_many_items", params: limit },
  too_many_locale_keys: { key: "fix.too_many_locale_keys", params: limit },
  too_many_margin_overrides: { key: "fix.too_many_margin_overrides", params: limit },
  too_many_markets: { key: "fix.too_many_markets", params: limit },
  too_many_overrides: { key: "fix.too_many_overrides", params: limit },
  too_many_rules: { key: "fix.too_many_rules", params: limit },
  too_many_tier_breaks: { key: "fix.too_many_tier_breaks", params: limit },
  too_many_tier_sets: { key: "fix.too_many_tier_sets", params: limit },
  // MVP 3 (core config/tiers.ts, config/presentation.ts).
  tier_break_without_quantity: { key: "fix.tier_break_without_quantity" },
  tier_break_without_value: { key: "fix.tier_break_without_value", params: { min: "minQty" } },
  tier_break_two_values: { key: "fix.tier_break_two_values", params: { min: "minQty" } },
  duplicate_tier_break: { key: "fix.duplicate_tier_break", params: { min: "minQty" } },
  duplicate_tier_set_id: { key: "fix.duplicate_tier_set_id" },
  tier_break_other_kind: { key: "fix.tier_break_other_kind", params: { min: "minQty" } },
  tier_break_lower_value: { key: "fix.tier_break_lower_value", params: { min: "minQty" } },
  clamped_tier_quantity: { key: "fix.clamped_tier_quantity", params: { from: "value", to: "to", min: "min", max: "max" } },
  unknown_look: { key: "fix.unknown_look" },
  unknown_accent: { key: "fix.unknown_accent" },
  unknown_language: { key: "fix.unknown_language" },
  // Plan 2026-10-06 (core config/codes.ts): a minimum quantity per item, generated code batches.
  orphan_item_minimum: { key: "fix.orphan_item_minimum", params: { count: "count" } },
  duplicate_item_minimum: { key: "fix.duplicate_item_minimum", params: { count: "count" } },
  clamped_item_minimum: { key: "fix.clamped_item_minimum", params: { count: "count", max: "max" } },
  invalid_code_batch: { key: "fix.invalid_code_batch" },
  too_many_batch_codes: { key: "fix.too_many_batch_codes", params: { count: "count", max: "max" } },
  too_many_code_batches: { key: "fix.too_many_code_batches", params: { count: "count", max: "max" } },
  code_batch_prefix_taken: { key: "fix.code_batch_prefix_taken", params: { prefix: "prefix", other: "other" } },
  unknown_onboarding_goal: { key: "fix.unknown_onboarding_goal" },
  // Audit fix MVP 3 (core): a tier scope neither "global" nor a selection → an inert set; margin collections over the limit folded.
  invalid_tier_scope: { key: "fix.invalid_tier_scope" },
  margin_overrides_folded: {
    key: "fix.margin_overrides_folded",
    params: { max: "max", count: "count", min: percent("minMarginPercent"), ceiling: percent("maxDiscountPercent") },
  },
  value_target_mismatch: { key: "fix.value_target_mismatch" },
};

/** Every issue code this table words (tests pin it against the core's codes). */
export const WORDED_ISSUE_CODES: readonly string[] = Object.keys(COPY);

export interface WordedIssue {
  text: string;
  /** True when the generic sentence stood in (an unknown code, or params missing): log the issue. */
  unworded: boolean;
}

/** One sanitizer issue as a sentence in `locale`, from its code and params only. */
export function wordIssue(issue: ConfigIssue, locale: Locale): WordedIssue {
  const entry = COPY[issue.code];
  const copy = typeof entry === "function" ? entry(issue) : entry;
  if (!copy) return { text: t(locale, "fix.unknown"), unworded: true };
  if (!copy.params) return { text: t(locale, copy.key), unworded: false };
  const params: Record<string, string> = {};
  for (const [placeholder, spec] of Object.entries(copy.params)) {
    const text = paramText(issue, spec, locale);
    if (text === null) return { text: t(locale, "fix.unknown"), unworded: true };
    params[placeholder] = text;
  }
  return { text: t(locale, copy.key, params as MessageParams), unworded: false };
}

/** One placeholder's text in `locale`, or null when the issue lacks the param (or a percent is not a number). */
function paramText(issue: ConfigIssue, spec: ParamSpec, locale: Locale): string | null {
  const name = typeof spec === "string" ? spec : spec.param;
  const value = issue.params?.[name];
  if (value === undefined) return null;
  if (typeof spec === "string") return typeof value === "number" ? issueNumber(value, locale) : value;
  if (spec.as === "percent") return typeof value === "number" ? issuePercent(value, locale) : null;
  // A list: the values the core names, then how many it left out (`more`; absent = none).
  const more = issue.params?.more;
  const shown = String(value);
  return typeof more === "number" && more > 0 ? tp(locale, "fix.andMore", more, { list: shown, n: issueNumber(more, locale) }) : shown;
}

/** The sentence alone (see wordIssue). */
export function issueText(issue: ConfigIssue, locale: Locale): string {
  return wordIssue(issue, locale).text;
}

/**
 * A save's issues as sentences in `locale`; an issue that only got the
 * generic sentence is logged (code, path and the English message — for
 * support, never for the merchant).
 */
export function wordIssues(
  issues: readonly ConfigIssue[],
  locale: Locale,
  log: (message: string) => void = (message) => console.warn(`[won-save] ${message}`),
): string[] {
  return issues.map((issue) => {
    const worded = wordIssue(issue, locale);
    if (worded.unworded) log(`issue without its own sentence: ${issue.code} at ${issue.path || "(root)"}: ${issue.message}`);
    return worded.text;
  });
}
