// The admin's state-at-rest formatters (doctrine §17 / §17a): the ONE place that
// turns a discount rule into human words. Every screen that shows what a rule
// is set to (Přehled, the list, the editor's live summary, warnings) calls these,
// so two screens can never describe one rule differently. Pure functions, unit
// tested (tests/ui/describe.test.ts): no raw enum key ever comes out (§4c).
//
// Seam: @won/core/discounts ships describeRule() for the engine's own messages.
// While the engine surface is being finished, the admin formats here, with the
// same wording and money format; the integration step can switch
// describeValue/describeMethod/describeMinimum to the core formatter without
// touching any screen.

import type { DiscountRule } from "@won/core/discounts/config";

import type { Translator } from "../../i18n";
import { formatDate, formatMoney, formatPercent } from "./money";

const SEP = " · ";
const MAX_CODES_SHOWN = 3;

export function ruleName(rule: Pick<DiscountRule, "name">, tr: Translator): string {
  return rule.name.trim() || tr.t("common.untitled");
}

/** Currencies to show, in market order, plus any the amount carries that no market uses. */
function orderedCurrencies(amount: Readonly<Record<string, number>>, currencies: readonly string[]): string[] {
  const extra = Object.keys(amount).filter((c) => !currencies.includes(c));
  return [...currencies, ...extra].filter((c) => typeof amount[c] === "number");
}

function amounts(amount: Readonly<Record<string, number>>, currencies: readonly string[], tr: Translator): string {
  return orderedCurrencies(amount, currencies)
    .map((c) => formatMoney(amount[c], c, tr.locale))
    .join(" / ");
}

/** "10 % z objednávky" · "100 Kč / 4 € z objednávky" · "Doprava zdarma". */
export function describeValue(rule: DiscountRule, tr: Translator, currencies: readonly string[]): string {
  const value = rule.value;
  if (value.kind === "freeShipping") return tr.t("describe.freeShipping");
  const target = rule.target.kind;
  if (value.kind === "percentage") {
    return tr.t(`describe.percentage.${target}`, { value: formatPercent(value.percent, tr.locale) });
  }
  const text = amounts(value.amount, currencies, tr);
  if (!text) return tr.t("describe.fixedNoValue");
  return tr.t(`describe.fixed.${target}`, { value: text });
}

/** "automaticky" · "kód VIP10" · "kódy A, B, C a 2 další" · "kódem, zatím bez kódu". */
export function describeMethod(rule: DiscountRule, tr: Translator): string {
  if (rule.method === "automatic") return tr.t("describe.method.automatic");
  const codes = rule.codes ?? [];
  if (codes.length === 0) return tr.t("describe.method.codeNone");
  if (codes.length === 1) return tr.t("describe.method.codeOne", { codes: codes[0] });
  const shown = codes.slice(0, MAX_CODES_SHOWN).join(", ");
  const more = codes.length - MAX_CODES_SHOWN;
  const list = more > 0 ? tr.t("describe.method.codesMore", { codes: shown, n: more }) : shown;
  return tr.t("describe.method.codeMany", { codes: list });
}

function hasSubtotal(rule: DiscountRule): boolean {
  return Object.keys(rule.minimum?.subtotal ?? {}).length > 0;
}

/** "od 1 000 Kč / 40 € · od 3 kusů", or "" with no minimum. */
export function describeMinimum(rule: DiscountRule, tr: Translator, currencies: readonly string[]): string {
  const parts: string[] = [];
  const subtotal = rule.minimum?.subtotal;
  if (subtotal && hasSubtotal(rule)) {
    const text = amounts(subtotal, currencies, tr);
    if (text) parts.push(tr.t("describe.minimum.subtotal", { value: text }));
  }
  const quantity = rule.minimum?.quantity ?? 0;
  if (quantity > 0) parts.push(tr.tp("describe.minimum.quantity", quantity));
  return parts.join(SEP);
}

/** Last live day of a schedule end written at midnight (the admin writes "day after, 00:00"). */
export function scheduleEndDay(endsAt: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?/.exec(endsAt);
  if (!m) return endsAt.slice(0, 10);
  const midnight = m[4] === "00" && m[5] === "00" && (m[6] ?? "00") === "00";
  if (!midnight) return `${m[1]}-${m[2]}-${m[3]}`;
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) - 1)).toISOString().slice(0, 10);
}

/** "1. 11. 2026 až 30. 11. 2026" · "od 1. 11. 2026" · "do 30. 11. 2026" · "" (always). */
export function describeSchedule(rule: DiscountRule, tr: Translator): string {
  const start = rule.schedule?.startsAt ? formatDate(rule.schedule.startsAt.slice(0, 10), tr.locale) : null;
  const end = rule.schedule?.endsAt ? formatDate(scheduleEndDay(rule.schedule.endsAt), tr.locale) : null;
  if (start && end) return tr.t("describe.schedule.range", { start, end });
  if (start) return tr.t("describe.schedule.from", { date: start });
  if (end) return tr.t("describe.schedule.until", { date: end });
  return "";
}

/** Usage limits apply to code discounts only (Shopify): "1× na zákazníka · nejvýš 100× celkem". */
export function describeLimits(rule: DiscountRule, tr: Translator): string {
  if (rule.method !== "code") return "";
  const parts: string[] = [];
  if (rule.limits?.oncePerCustomer) parts.push(tr.t("describe.limits.once"));
  if (rule.limits?.usageLimit) parts.push(tr.t("describe.limits.usage", { n: rule.limits.usageLimit }));
  return parts.join(SEP);
}

/**
 * Currencies of the shop's markets where the rule is NOT offered: a fixed value
 * without that currency, or a minimum subtotal set for other currencies but not
 * this one (MKT-1: never a converted or foreign number, the market just doesn't
 * get the discount).
 */
export function missingCurrencies(rule: DiscountRule, currencies: readonly string[]): string[] {
  const missing = new Set<string>();
  if (rule.value.kind === "fixed") {
    for (const c of currencies) if (typeof rule.value.amount[c] !== "number") missing.add(c);
  }
  const subtotal = rule.minimum?.subtotal;
  if (subtotal && hasSubtotal(rule)) {
    for (const c of currencies) if (typeof subtotal[c] !== "number") missing.add(c);
  }
  return currencies.filter((c) => missing.has(c));
}

/** The rule's one-line state (§17 slot 2): value · method · minimum · schedule · not offered in. */
export function describeRuleLine(rule: DiscountRule, tr: Translator, currencies: readonly string[]): string {
  const missing = missingCurrencies(rule, currencies);
  return [
    describeValue(rule, tr, currencies),
    describeMethod(rule, tr),
    describeMinimum(rule, tr, currencies),
    describeSchedule(rule, tr),
    missing.length > 0 ? tr.t("describe.notOfferedIn", { currencies: tr.list(missing) }) : "",
  ]
    .filter(Boolean)
    .join(SEP);
}

/** Summary of the collapsed "Další možnosti" block (§9d: collapsed still tells the truth). */
export function describeMoreOptions(rule: DiscountRule, tr: Translator, currencies: readonly string[]): string {
  const parts = [
    describeMinimum(rule, tr, currencies) || tr.t("describe.minimum.none"),
    describeSchedule(rule, tr) || tr.t("describe.schedule.always"),
  ];
  if (rule.method === "code") parts.push(describeLimits(rule, tr) || tr.t("describe.limits.none"));
  return parts.join(SEP);
}

/** What the Pro block is set to (§17c: states what is stored; entitlement gates it at emission). */
export function describeProSettings(
  rule: DiscountRule,
  tr: Translator,
  ruleNames: ReadonlyMap<string, string>,
): string {
  const markets = rule.targeting?.markets ?? [];
  const segments = rule.targeting?.segments ?? [];
  const who = markets.length > 0 ? tr.t("describe.targeting.markets", { markets: tr.list(markets) }) : tr.t("describe.targeting.all");
  const parts = [who];
  if (segments.length > 0) parts.push(tr.t("describe.targeting.segments"));
  const names = (rule.combinesWith?.ruleIds ?? []).map((id) => ruleNames.get(id)).filter((n): n is string => !!n);
  parts.push(names.length > 0 ? tr.t("describe.combines.some", { names: tr.list(names) }) : tr.t("describe.combines.default"));
  return parts.join(SEP);
}

export type RuleWarningKind = "missingCurrency" | "noCode" | "noTarget";

export interface RuleWarning {
  kind: RuleWarningKind;
  ruleId: string;
  ruleName: string;
  currencies?: string[];
  /** Editor field the fix link jumps to (§13c: deep-link to the control, not the page). */
  field: string;
}

/** Problems of live rules that the merchant must fix, each with its target field. */
export function collectWarnings(rules: readonly DiscountRule[], currencies: readonly string[]): RuleWarning[] {
  const out: RuleWarning[] = [];
  for (const rule of rules) {
    if (!rule.enabled) continue;
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
