// What the sanitizer adjusted in a save, in the admin language (§4c, A10).
// The core's ConfigIssue carries a stable `code`, a `path` and an English
// `message` (packages/core/src/discounts/config/*, never shown as is in the
// cs admin): every code the sanitizer can emit has its own i18n key
// `fix.<code>`; the few numbers worth saying (a percent rounded to, a limit, a
// count) are read from the core's message by a per-code pattern. A code this
// table does not know — or a message whose numbers cannot be read — falls back
// to `fix.unknown` with the technical detail in parentheses (never hidden,
// like the sync problems). Pure; tests/integration/issue-copy.test.ts.

import type { ConfigIssue } from "@won/core/discounts/config";

import { t, type Locale, type MessageKey, type MessageParams } from "../../i18n";

/** One code: its key, and (optionally) how to read its params from the core's English message. */
interface IssueCopy {
  key: MessageKey;
  re?: RegExp;
  params?: (m: RegExpExecArray) => MessageParams;
}

const limitCount = (m: RegExpExecArray) => ({ max: m[1]!, count: m[2]! });

const COPY: Readonly<Record<string, IssueCopy | ((issue: ConfigIssue) => IssueCopy)>> = {
  ambiguous_override: { key: "fix.ambiguous_override" },
  clamped_money: { key: "fix.clamped_money" },
  clamped_percent: {
    key: "fix.clamped_percent",
    re: /Percent (\S+) is out of range 0-(\S+); clamped to (\S+?)\.?$/,
    params: (m) => ({ from: m[1]!, max: m[2]!, to: m[3]! }),
  },
  clamped_priority: {
    key: "fix.clamped_priority",
    re: /Priority (\S+) is out of range 0-(\S+); clamped to (\S+?)\.?$/,
    params: (m) => ({ from: m[1]!, max: m[2]!, to: m[3]! }),
  },
  code_too_long: { key: "fix.code_too_long", re: /^(\d+) code\(s\) longer than (\d+)/, params: (m) => ({ count: m[1]!, max: m[2]! }) },
  duplicate_campaign_id: { key: "fix.duplicate_campaign_id" },
  // Two sentences share the code: merged repeats within a rule, or codes an earlier rule already has.
  duplicate_code: (issue) =>
    /already belong to an earlier rule/.test(issue.message)
      ? { key: "fix.duplicate_code_taken", re: /^Code\(s\) (.+) already belong/, params: (m) => ({ codes: m[1]! }) }
      : { key: "fix.duplicate_code", re: /^(\d+) duplicate code/, params: (m) => ({ count: m[1]! }) },
  duplicate_rule_id: { key: "fix.duplicate_rule_id" },
  empty_override: { key: "fix.empty_override" },
  invalid_boolean: { key: "fix.invalid_boolean" },
  invalid_campaign_window: { key: "fix.invalid_campaign_window" },
  invalid_country: { key: "fix.invalid_country" },
  invalid_currency: { key: "fix.invalid_currency" },
  invalid_enum: { key: "fix.invalid_enum" },
  invalid_id: { key: "fix.invalid_id" },
  invalid_origin: { key: "fix.invalid_origin" },
  invalid_percent: { key: "fix.invalid_percent", re: /between 0 and (\d+)/, params: (m) => ({ max: m[1]! }) },
  invalid_priority: { key: "fix.invalid_priority" },
  invalid_schedule: { key: "fix.invalid_schedule" },
  invalid_target: { key: "fix.invalid_target" },
  invalid_value: { key: "fix.invalid_value" },
  issues_truncated: { key: "fix.issues_truncated", re: /^(\d+) more problem/, params: (m) => ({ count: m[1]! }) },
  locale_text_too_long: { key: "fix.locale_text_too_long", re: /longer than (\d+) characters/, params: (m) => ({ max: m[1]! }) },
  missing_handle: { key: "fix.missing_handle" },
  missing_id: { key: "fix.missing_id" },
  orphan_combines_with: { key: "fix.orphan_combines_with" },
  orphan_override: { key: "fix.orphan_override" },
  overlapping_campaign: { key: "fix.overlapping_campaign" },
  override_field_not_allowed: { key: "fix.override_field_not_allowed" },
  reference_too_long: { key: "fix.reference_too_long", re: /longer than (\d+) characters/, params: (m) => ({ max: m[1]! }) },
  rounded_percent: { key: "fix.rounded_percent", re: /; (\S+) was rounded to (\S+) /, params: (m) => ({ from: m[1]!, to: m[2]! }) },
  too_many_campaigns: { key: "fix.too_many_campaigns", re: /first (\d+) campaigns are kept; (\d+) more/, params: limitCount },
  too_many_codes: { key: "fix.too_many_codes", re: /at most (\d+) codes; (\d+) more/, params: limitCount },
  too_many_currencies: { key: "fix.too_many_currencies", re: /at most (\d+) currencies; (\d+) more/, params: limitCount },
  too_many_gift_tiers: { key: "fix.too_many_gift_tiers", re: /first (\d+) gift tiers are kept; (\d+) more/, params: limitCount },
  too_many_items: { key: "fix.too_many_items", re: /at most (\d+) items; (\d+) more/, params: limitCount },
  too_many_locale_keys: { key: "fix.too_many_locale_keys", re: /first (\d+) texts per language are kept; (\d+) more/, params: limitCount },
  too_many_margin_overrides: { key: "fix.too_many_margin_overrides", re: /first (\d+) are kept, (\d+) more/, params: limitCount },
  too_many_markets: { key: "fix.too_many_markets", re: /first (\d+) markets are kept; (\d+) more/, params: limitCount },
  too_many_overrides: { key: "fix.too_many_overrides", re: /at most (\d+) overrides; (\d+) more/, params: limitCount },
  too_many_rules: { key: "fix.too_many_rules", re: /first (\d+) discount rules are kept; (\d+) more/, params: limitCount },
  too_many_tier_breaks: { key: "fix.too_many_tier_breaks", re: /at most (\d+) quantity breaks; (\d+) more/, params: limitCount },
  too_many_tier_sets: { key: "fix.too_many_tier_sets", re: /first (\d+) tier sets are kept; (\d+) more/, params: limitCount },
  unknown_onboarding_goal: { key: "fix.unknown_onboarding_goal" },
  value_target_mismatch: { key: "fix.value_target_mismatch" },
};

/** Every issue code this table words (tests pin it against the core's codes). */
export const WORDED_ISSUE_CODES: readonly string[] = Object.keys(COPY);

const DETAIL_MAX = 180;
const short = (text: string) => (text.length > DETAIL_MAX ? `${text.slice(0, DETAIL_MAX - 1)}…` : text);

/** One sanitizer issue as a sentence in `locale`. */
export function issueText(issue: ConfigIssue, locale: Locale): string {
  const entry = COPY[issue.code];
  const copy = typeof entry === "function" ? entry(issue) : entry;
  if (!copy) return t(locale, "fix.unknown", { detail: short(issue.message) });
  if (!copy.re) return t(locale, copy.key);
  const match = copy.re.exec(issue.message);
  if (!match || !copy.params) return t(locale, "fix.unknown", { detail: short(issue.message) });
  return t(locale, copy.key, copy.params(match));
}
