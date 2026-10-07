// The admin's state-at-rest lines (doctrine §17 / §17a). The rule's own wording
// — value, method, minimum, "v EUR se nenabízí", schedule days — comes from the
// ONE formatter the engine also uses (@won/core/discounts/describe), so the
// admin header, explainPlan and the checkout message can never describe a rule
// differently (DATA-4). This module only adds the admin chrome around it
// (limits, market targeting, combinations, the generated rule name, warnings),
// in the admin language from app/i18n. Pure, unit tested (tests/ui/describe.test.ts).

import type { DiscountRule } from "@won/core/discounts/config";
import {
  currenciesWithoutValue,
  describeItemMinimumsSummary,
  describeRuleParts,
  describeSchedule as describeDays,
  type ScheduleDays,
} from "@won/core/discounts/describe";
import { ruleHasCodes } from "@won/core/discounts/code-batch";
import { shopLocalDates } from "@won/core/discounts/function-payload";
import { unsupportedInFunction } from "@won/core/discounts/plan";

import type { Translator } from "../../i18n";
import type { MarketNames } from "./markets";
import { amountLabelsOf, marketView } from "./markets";

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

function parts(rule: DiscountRule, tr: Translator, currencies: readonly string[], marketNames?: MarketNames) {
  // Amounts per market: an amount that differs between two markets of a currency says whose it is, by the market's name.
  return describeRuleParts(rule, tr.locale, { currencies, codesKnown: true, labels: amountLabelsOf(currencies, marketNames) });
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

/**
 * The generated rule name (P5): the core value + target phrase and the minimum —
 * "10 % z objednávky", "100 Kč z dopravy", "Doprava zdarma od 1 000 Kč". The
 * editor keeps a rule's name on it until the merchant types their own
 * (model/rule-form.ts FIELD.nameAuto); the parser stores it, because checkout
 * shows the name to customers.
 */
export function autoRuleName(rule: DiscountRule, tr: Translator, currencies: readonly string[]): string {
  const p = parts(rule, tr, currencies);
  if (p.minimum.length === 0) return p.value;
  const lineTarget = rule.target.kind === "products" || rule.target.kind === "collections";
  return `${p.value}${tr.locale === "cs" && !lineTarget ? " " : ", "}${p.minimum.join(", ")}`;
}

/** Names the one-line state may use; without them it falls back to handles and a count. */
export interface RuleLineNames {
  marketNames?: MarketNames;
  ruleNames?: ReadonlyMap<string, string>;
}

/** "jen trhy Česko a Slovensko", or "" when the rule is not limited to markets. */
export function describeMarkets(rule: DiscountRule, tr: Translator, marketNames: MarketNames = {}): string {
  const markets = (rule.targeting?.markets ?? []).map((h) => marketView(h, marketNames).name);
  return markets.length > 0 ? tr.t("describe.line.markets", { markets: tr.list(markets) }) : "";
}

/** "sčítá se s Podzimní sleva a VIP10" (or with a count when the names are not known), "" with no combination. */
export function describeCombines(rule: DiscountRule, tr: Translator, ruleNames?: ReadonlyMap<string, string>): string {
  const ids = rule.combinesWith?.ruleIds ?? [];
  if (ids.length === 0) return "";
  if (!ruleNames) return tr.t("describe.line.combinesCount", { n: ids.length });
  const names = ids.map((id) => ruleNames.get(id)).filter((n): n is string => n !== undefined).map((n) => n.trim() || tr.t("common.untitled"));
  return names.length > 0 ? tr.t("describe.line.combines", { names: tr.list(names) }) : "";
}

/**
 * The rule's one-line state (§17 slot 2): value · method · minimum · schedule ·
 * usage limits · market targeting · combinations · not offered in. The first
 * four and the last are the core formatter's; the rest is set only when the
 * rule has it (P5).
 */
/** "vlastní minimum u 2 produktů" — the per-item minimums of a product / collection rule (Pro, bod 8), or "". */
export function describeItemMinimums(rule: DiscountRule, tr: Translator): string {
  const target = rule.target;
  if (target.kind !== "products" && target.kind !== "collections") return "";
  return describeItemMinimumsSummary(target.kind, target.itemMinimums?.length ?? 0, tr.locale) ?? "";
}

export function describeRuleLine(
  rule: DiscountRule,
  tr: Translator,
  currencies: readonly string[],
  timezone: string | null,
  names: RuleLineNames = {},
): string {
  const p = parts(rule, tr, currencies, names.marketNames);
  return [
    p.value,
    p.method,
    ...p.minimum,
    describeItemMinimums(rule, tr),
    describeSchedule(rule, tr, timezone),
    describeLimits(rule, tr),
    describeMarkets(rule, tr, names.marketNames),
    describeCombines(rule, tr, names.ruleNames),
    p.notOffered ?? "",
  ]
    .filter(Boolean)
    .join(SEP);
}

/**
 * What the Pro block is set to (§17c: what is stored; what checkout cannot
 * evaluate yet is said, never sold as working). Without a combination it says
 * what really happens: discounts of the same kind never add up, the better one
 * for the customer applies (core plan.ts planProducts / planOrderStage).
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
  out.push(describeCombines(rule, tr, ruleNames) || tr.t("describe.combines.default"));
  return out.join(SEP);
}

/**
 * Anchors of the rule editor (deep links `/app/discounts/<id>#<anchor>`, §13c):
 * `value` the amount / percent fields, `target` the product / collection
 * picker, `conditions` the minimum, `codes` how it applies (codes, limits),
 * `schedule` the dates, `pro` the Pro section with `markets`, `segments` and
 * `combines` inside it. `more` is the retired "Další možnosti": old links land
 * on `conditions`.
 */
export type EditorAnchor = "value" | "target" | "conditions" | "codes" | "schedule" | "pro" | "markets" | "segments" | "combines";
export const EDITOR_ANCHOR_ALIASES: Readonly<Record<string, EditorAnchor>> = { more: "conditions" };

/** Where a rule not offered in some currency is fixed: the amounts, or the minimum. */
export function missingValueAnchor(rule: DiscountRule, currencies: readonly string[]): "value" | "conditions" | null {
  const missing = missingCurrencies(rule, currencies);
  if (missing.length === 0) return null;
  const value = rule.value;
  return value.kind === "fixed" && missing.some((c) => typeof value.amount[c] !== "number") ? "value" : "conditions";
}

/** Market currencies a fixed amount has no value for. */
export function missingAmountCurrencies(rule: DiscountRule, currencies: readonly string[]): string[] {
  const value = rule.value;
  return value.kind === "fixed" ? currencies.filter((c) => typeof value.amount[c] !== "number") : [];
}

/** Market currencies the minimum subtotal lacks while it is set for others. */
export function missingMinimumCurrencies(rule: DiscountRule, currencies: readonly string[]): string[] {
  const subtotal = rule.minimum?.subtotal;
  if (!subtotal || Object.keys(subtotal).length === 0) return [];
  return currencies.filter((c) => typeof subtotal[c] !== "number");
}

export type RuleWarningKind = "missingCurrency" | "noCode" | "noTarget" | "unsupported" | "marketOff";

export interface RuleWarning {
  kind: RuleWarningKind;
  ruleId: string;
  ruleName: string;
  currencies?: string[];
  /** Editor anchor the fix link jumps to (§13c: deep-link to the control, not the page). `more` is no longer produced. */
  field: EditorAnchor | "more";
}

/**
 * Problems of switched-on rules that the merchant must fix, each with its
 * target field. `enabledMarkets` (handles) adds `marketOff` — a rule limited to
 * markets that are all switched off (B3); without it that check is skipped.
 */
/** How many warnings each rule has (same order as `rules`): what the Slevy a kódy tile counts next to stopped rules (N4). */
export function warningCounts(rules: readonly { id: string }[], warnings: readonly RuleWarning[]): number[] {
  return rules.map((rule) => warnings.filter((w) => w.ruleId === rule.id).length);
}

export function collectWarnings(
  rules: readonly DiscountRule[],
  currencies: readonly string[],
  opts: { enabledMarkets?: readonly string[] } = {},
): RuleWarning[] {
  const out: RuleWarning[] = [];
  for (const rule of rules) {
    if (!rule.enabled) continue;
    if (unsupportedInFunction(rule).length > 0) {
      out.push({ kind: "unsupported", ruleId: rule.id, ruleName: rule.name, field: "segments" });
    }
    const missing = missingCurrencies(rule, currencies);
    if (missing.length > 0) {
      out.push({ kind: "missingCurrency", ruleId: rule.id, ruleName: rule.name, currencies: missing, field: missingValueAnchor(rule, currencies) ?? "value" });
    }
    if (rule.method === "code" && !ruleHasCodes(rule)) {
      out.push({ kind: "noCode", ruleId: rule.id, ruleName: rule.name, field: "codes" });
    }
    const target = rule.target;
    if (
      (target.kind === "products" && target.productIds.length === 0 && target.variantIds.length === 0) ||
      (target.kind === "collections" && target.ids.length === 0)
    ) {
      out.push({ kind: "noTarget", ruleId: rule.id, ruleName: rule.name, field: "target" });
    }
    const markets = rule.targeting?.markets ?? [];
    if (opts.enabledMarkets && markets.length > 0 && !markets.some((m) => opts.enabledMarkets!.includes(m))) {
      out.push({ kind: "marketOff", ruleId: rule.id, ruleName: rule.name, field: "markets" });
    }
  }
  return out;
}
