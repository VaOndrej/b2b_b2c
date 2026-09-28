// The admin's state-at-rest lines (doctrine §17 / §17a). The rule's own wording
// — value, method, minimum, "v EUR se nenabízí", schedule days — comes from the
// ONE formatter the engine also uses (@won/core/discounts/describe), so the
// admin header, explainPlan and the checkout message can never describe a rule
// differently (DATA-4). This module only adds the admin chrome around it
// (limits, the collapsed "Další možnosti" summary, Pro targeting, warnings), in
// the admin language from app/i18n. Pure, unit tested (tests/ui/describe.test.ts).

import type { DiscountRule } from "@won/core/discounts/config";
import {
  currenciesWithoutValue,
  describeRuleParts,
  describeSchedule as describeDays,
  type ScheduleDays,
} from "@won/core/discounts/describe";
import { shopLocalDates } from "@won/core/discounts/function-payload";
import { unsupportedInFunction } from "@won/core/discounts/plan";

import type { Translator } from "../../i18n";
import type { MarketNames } from "./markets";
import { marketView } from "./markets";

const SEP = " · ";

export function ruleName(rule: Pick<DiscountRule, "name">, tr: Translator): string {
  return rule.name.trim() || tr.t("common.untitled");
}

/** The days a schedule was written for: the date as written, an end at midnight = the day before. */
export function writtenDays(rule: Pick<DiscountRule, "schedule">): ScheduleDays {
  const out: ScheduleDays = {};
  const start = rule.schedule?.startsAt;
  const end = rule.schedule?.endsAt;
  if (start) out.startsOn = start.slice(0, 10);
  if (end) {
    const midnight = /T00:00(?::00(?:\.0+)?)?(?:Z|[+-]\d{2}:\d{2})$/.test(end);
    if (!midnight) out.endsOn = end.slice(0, 10);
    else {
      const [y, m, d] = end.slice(0, 10).split("-").map(Number);
      out.endsOn = new Date(Date.UTC(y, m - 1, d - 1)).toISOString().slice(0, 10);
    }
  }
  return out;
}

/**
 * A rule's schedule as the shop's calendar days — exactly what the sync ships to
 * the function (function-payload `shopLocalDates`). With the shop zone unknown
 * (or unreadable), the days it was written for: the editor writes shop-local
 * midnights with their offset, so that is the shop's day too.
 */
export function ruleDays(rule: Pick<DiscountRule, "schedule">, timezone: string | null): ScheduleDays {
  if (!rule.schedule) return {};
  if (!timezone) return writtenDays(rule);
  try {
    return shopLocalDates(rule.schedule, timezone);
  } catch {
    return writtenDays(rule);
  }
}

function parts(rule: DiscountRule, tr: Translator, currencies: readonly string[]) {
  return describeRuleParts(rule, tr.locale, { currencies, codesKnown: true });
}

/** "10 % z objednávky" · "100 Kč / 4 € z objednávky" · "Doprava zdarma". */
export function describeValue(rule: DiscountRule, tr: Translator, currencies: readonly string[]): string {
  return parts(rule, tr, currencies).value;
}

/** "automaticky" · "kód VIP10" · "kódy A, B, C a 2 další" · "kódem, zatím bez kódu". */
export function describeMethod(rule: DiscountRule, tr: Translator): string {
  return parts(rule, tr, []).method;
}

/** "od 1 000 Kč / 40 € · od 3 ks", or "" with no minimum. */
export function describeMinimum(rule: DiscountRule, tr: Translator, currencies: readonly string[]): string {
  return parts(rule, tr, currencies).minimum.join(SEP);
}

/** "27. 11. 2026 až 30. 11. 2026" · "od …" · "do …" · "" (always). */
export function describeSchedule(rule: DiscountRule, tr: Translator, timezone: string | null): string {
  return describeDays(ruleDays(rule, timezone), tr.locale);
}

/** Usage limits apply to code discounts only (Shopify): "1× na zákazníka · nejvýš 100× celkem". */
export function describeLimits(rule: DiscountRule, tr: Translator): string {
  if (rule.method !== "code") return "";
  const out: string[] = [];
  if (rule.limits?.oncePerCustomer) out.push(tr.t("describe.limits.once"));
  if (rule.limits?.usageLimit) out.push(tr.t("describe.limits.usage", { n: rule.limits.usageLimit }));
  return out.join(SEP);
}

/** Market currencies the rule is NOT offered in (MKT-1), the engine's own rule. */
export function missingCurrencies(rule: DiscountRule, currencies: readonly string[]): string[] {
  return currenciesWithoutValue(rule, currencies);
}

/** The rule's one-line state (§17 slot 2): value · method · minimum · schedule · not offered in. */
export function describeRuleLine(
  rule: DiscountRule,
  tr: Translator,
  currencies: readonly string[],
  timezone: string | null,
): string {
  const p = parts(rule, tr, currencies);
  return [p.value, p.method, ...p.minimum, describeSchedule(rule, tr, timezone), p.notOffered ?? ""]
    .filter(Boolean)
    .join(SEP);
}

/** Summary of the collapsed "Další možnosti" block (§9d: collapsed still tells the truth). */
export function describeMoreOptions(
  rule: DiscountRule,
  tr: Translator,
  currencies: readonly string[],
  timezone: string | null,
): string {
  const out = [
    describeMinimum(rule, tr, currencies) || tr.t("describe.minimum.none"),
    describeSchedule(rule, tr, timezone) || tr.t("describe.schedule.always"),
  ];
  if (rule.method === "code") out.push(describeLimits(rule, tr) || tr.t("describe.limits.none"));
  return out.join(SEP);
}

/**
 * What the Pro block is set to (§17c: what is stored; what checkout cannot
 * evaluate yet is said, never sold as working).
 */
export function describeProSettings(
  rule: DiscountRule,
  tr: Translator,
  ruleNames: ReadonlyMap<string, string>,
  marketNames: MarketNames = {},
): string {
  const markets = (rule.targeting?.markets ?? []).map((h) => marketView(h, marketNames).name);
  const out = [markets.length > 0 ? tr.t("describe.targeting.markets", { markets: tr.list(markets) }) : tr.t("describe.targeting.all")];
  if (unsupportedInFunction(rule).length > 0) out.push(tr.t("describe.targeting.segments"));
  const names = (rule.combinesWith?.ruleIds ?? []).map((id) => ruleNames.get(id)).filter((n): n is string => !!n);
  out.push(names.length > 0 ? tr.t("describe.combines.some", { names: tr.list(names) }) : tr.t("describe.combines.default"));
  return out.join(SEP);
}

export type RuleWarningKind = "missingCurrency" | "noCode" | "noTarget" | "unsupported";

export interface RuleWarning {
  kind: RuleWarningKind;
  ruleId: string;
  ruleName: string;
  currencies?: string[];
  /** Editor anchor the fix link jumps to (§13c: deep-link to the control, not the page). */
  field: "value" | "more" | "codes" | "target" | "pro";
}

/** Problems of switched-on rules that the merchant must fix, each with its target field. */
export function collectWarnings(rules: readonly DiscountRule[], currencies: readonly string[]): RuleWarning[] {
  const out: RuleWarning[] = [];
  for (const rule of rules) {
    if (!rule.enabled) continue;
    if (unsupportedInFunction(rule).length > 0) {
      out.push({ kind: "unsupported", ruleId: rule.id, ruleName: rule.name, field: "pro" });
    }
    const missing = missingCurrencies(rule, currencies);
    if (missing.length > 0) {
      const value = rule.value;
      const onValue = value.kind === "fixed" && missing.some((c) => typeof value.amount[c] !== "number");
      out.push({ kind: "missingCurrency", ruleId: rule.id, ruleName: rule.name, currencies: missing, field: onValue ? "value" : "more" });
    }
    if (rule.method === "code" && (rule.codes ?? []).length === 0) {
      out.push({ kind: "noCode", ruleId: rule.id, ruleName: rule.name, field: "codes" });
    }
    const target = rule.target;
    if (
      (target.kind === "products" && target.productIds.length === 0 && target.variantIds.length === 0) ||
      (target.kind === "collections" && target.ids.length === 0)
    ) {
      out.push({ kind: "noTarget", ruleId: rule.id, ruleName: rule.name, field: "target" });
    }
  }
  return out;
}
