// What the sanitizer adjusted in a save, in the admin language (§4c, A10).
// The core's ConfigIssue carries a stable `code`, a `path`, structured
// `params` (the values it names: limits, counts, the value given and the one
// kept — packages/core/src/discounts/config) and an English `message` for
// logs. The admin words an issue from `code` + `params` ONLY: every code the
// sanitizer can emit has its own i18n key `fix.<code>`; the English message is
// never read and never shown. A code this table does not know — or a known
// code without the params its sentence needs — gets the generic `fix.unknown`
// sentence (no English inside); `unworded` tells the caller to log it.
// Pure; tests/integration/issue-copy.test.ts.

import type { ConfigIssue } from "@won/core/discounts/config";

import { t, type Locale, type MessageKey, type MessageParams } from "../../i18n";

/** One code: its key, the params its sentence needs, and how to name them for it. */
interface IssueCopy {
  key: MessageKey;
  /** Sentence placeholder → the core's param name (the same name when omitted). */
  params?: Readonly<Record<string, string>>;
}

const limit: IssueCopy["params"] = { max: "max", count: "count" };

const COPY: Readonly<Record<string, IssueCopy | ((issue: ConfigIssue) => IssueCopy)>> = {
  ambiguous_override: { key: "fix.ambiguous_override" },
  clamped_money: { key: "fix.clamped_money" },
  clamped_percent: { key: "fix.clamped_percent", params: { from: "value", max: "max", to: "to" } },
  clamped_priority: { key: "fix.clamped_priority", params: { from: "value", max: "max", to: "to" } },
  code_too_long: { key: "fix.code_too_long", params: limit },
  duplicate_campaign_id: { key: "fix.duplicate_campaign_id" },
  // Two cases share the code (params.reason): repeats merged within a rule, or codes an earlier rule already has.
  duplicate_code: (issue): IssueCopy =>
    issue.params?.reason === "taken" ? { key: "fix.duplicate_code_taken", params: { codes: "codes" } } : { key: "fix.duplicate_code", params: { count: "count" } },
  duplicate_rule_id: { key: "fix.duplicate_rule_id" },
  empty_override: { key: "fix.empty_override" },
  invalid_boolean: { key: "fix.invalid_boolean" },
  invalid_campaign_window: { key: "fix.invalid_campaign_window" },
  invalid_country: { key: "fix.invalid_country" },
  invalid_currency: { key: "fix.invalid_currency" },
  invalid_enum: { key: "fix.invalid_enum" },
  invalid_id: { key: "fix.invalid_id" },
  invalid_origin: { key: "fix.invalid_origin" },
  invalid_percent: { key: "fix.invalid_percent", params: { max: "max" } },
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
  rounded_percent: { key: "fix.rounded_percent", params: { from: "value", to: "to" } },
  too_many_campaigns: { key: "fix.too_many_campaigns", params: limit },
  too_many_codes: { key: "fix.too_many_codes", params: limit },
  too_many_currencies: { key: "fix.too_many_currencies", params: limit },
  too_many_gift_tiers: { key: "fix.too_many_gift_tiers", params: limit },
  too_many_items: { key: "fix.too_many_items", params: limit },
  too_many_locale_keys: { key: "fix.too_many_locale_keys", params: limit },
  too_many_margin_overrides: { key: "fix.too_many_margin_overrides", params: limit },
  too_many_markets: { key: "fix.too_many_markets", params: limit },
  too_many_overrides: { key: "fix.too_many_overrides", params: limit },
  too_many_rules: { key: "fix.too_many_rules", params: limit },
  too_many_tier_breaks: { key: "fix.too_many_tier_breaks", params: limit },
  too_many_tier_sets: { key: "fix.too_many_tier_sets", params: limit },
  unknown_onboarding_goal: { key: "fix.unknown_onboarding_goal" },
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
  const params: Record<string, string | number> = {};
  for (const [placeholder, name] of Object.entries(copy.params)) {
    const value = issue.params?.[name];
    if (value === undefined) return { text: t(locale, "fix.unknown"), unworded: true };
    params[placeholder] = value;
  }
  return { text: t(locale, copy.key, params as MessageParams), unworded: false };
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
