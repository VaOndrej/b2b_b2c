// explainPlan — "what applies and why" as human sentences (doctrine §4c: never an
// enum key on screen). Used by the admin "Vyzkoušet košík" and, later, the cart
// in the storefront, which must say honestly why an entered code did nothing
// (Shopify only shows `applicable: false`, spec §3).

import { csPlural, describeRule, enPlural, formatDate, formatMoney, formatPercent, type UiLocale } from "./describe.ts";
import type { CartPlan, CodeOutcome, RuleOutcome, ShippingValue } from "./plan.ts";

export interface ExplainItem {
  /** success = saves money now; warning = an entered code does nothing; info = context and hints. */
  tone: "success" | "info" | "warning";
  text: string;
  ruleId?: string;
  code?: string;
  lineIds?: string[];
}

const q = (text: string, locale: UiLocale) => (locale === "cs" ? `„${text}“` : `“${text}”`);

function labelOf(rule: RuleOutcome, plan: CartPlan, locale: UiLocale): string {
  return rule.name || describeRule(rule.describable, locale, plan.currency, { short: true });
}

function shippingPhrase(value: ShippingValue, plan: CartPlan, locale: UiLocale): string {
  const cs = locale === "cs";
  if (value.percent !== undefined) {
    if (value.percent >= 100) return cs ? "doprava zdarma" : "free shipping";
    return cs ? `${formatPercent(value.percent, locale)} z dopravy` : `${formatPercent(value.percent, locale)} off shipping`;
  }
  const m = formatMoney(value.fixedTotal, plan.currency, locale);
  return cs ? `${m} z dopravy` : `${m} off shipping`;
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function item(tone: ExplainItem["tone"], text: string, refs: { ruleId?: string; code?: string; lineIds?: string[] }): ExplainItem {
  const out: ExplainItem = { tone, text };
  if (refs.ruleId) out.ruleId = refs.ruleId;
  if (refs.code) out.code = refs.code;
  if (refs.lineIds && refs.lineIds.length > 0) out.lineIds = [...refs.lineIds];
  return out;
}

/** Sentences for a rule that saves money now. */
function applied(rule: RuleOutcome, plan: CartPlan, locale: UiLocale): string {
  const cs = locale === "cs";
  const money = formatMoney(rule.amount, plan.currency, locale);
  const code = rule.method === "code" ? rule.enteredCodes[0] : undefined;
  if (rule.discountClass === "shipping" && plan.shipping?.ruleId === rule.ruleId) {
    const phrase = shippingPhrase(plan.shipping.value, plan, locale);
    if (code) return cs ? `Kód ${code}: ${phrase}.` : `Code ${code}: ${phrase}.`;
    const name = q(labelOf(rule, plan, locale), locale);
    if (phrase === "doprava zdarma") return `Doprava zdarma díky slevě ${name}.`;
    if (phrase === "free shipping") return `Free shipping thanks to ${name}.`;
    return cs ? `Sleva ${name}: ${phrase}.` : `${name}: ${phrase}.`;
  }
  if (code) return cs ? `Kód ${code}: ušetříš ${money}.` : `Code ${code}: you save ${money}.`;
  const name = q(labelOf(rule, plan, locale), locale);
  if (rule.discountClass === "order") return cs ? `Sleva ${name} ušetří ${money} z objednávky.` : `${name} saves ${money} on the order.`;
  const n = rule.lineIds.length;
  return cs
    ? `Sleva ${name} ušetří ${money} na ${n} ${n === 1 ? "položce" : "položkách"}.`
    : `${name} saves ${money} on ${n} ${enPlural(n, "item", "items")}.`;
}

function betterName(rule: RuleOutcome, plan: CartPlan, locale: UiLocale): string | null {
  const id = rule.betterRuleIds?.[0];
  const better = id ? plan.rules.find((r) => r.ruleId === id) : undefined;
  return better ? q(labelOf(better, plan, locale), locale) : null;
}

/** Why an entered Won code does nothing (warning), or a note when it counts only inside another stack. */
function codeSentences(code: CodeOutcome, plan: CartPlan, locale: UiLocale): ExplainItem[] {
  const cs = locale === "cs";
  const c = code.code;
  const rule = code.ruleId ? plan.rules.find((r) => r.ruleId === code.ruleId) : undefined;
  const refs = { ruleId: code.ruleId ?? undefined, code: c };
  const warn = (text: string) => [item("warning", text, refs)];
  if (!rule) return [item("info", cs ? `Kód ${c} nespravuje Won Discounts.` : `Code ${c} is not managed by Won Discounts.`, refs)];
  switch (code.state) {
    case "applied":
      return [];
    case "combined": {
      const owner = plan.rules.find((r) => r.ruleId === rule.combinedInto);
      const name = owner ? q(labelOf(owner, plan, locale), locale) : "";
      return [item("info", cs ? `Kód ${c} je započtený ve slevě ${name}.` : `Code ${c} is included in ${name}.`, refs)];
    }
    case "same_rule": {
      const first = rule.enteredCodes[0];
      return warn(
        cs
          ? `Kód ${c} patří ke stejné slevě jako kód ${first}; uplatní se jen jeden.`
          : `Code ${c} belongs to the same discount as code ${first}; only one applies.`,
      );
    }
    case "outranked": {
      const better = betterName(rule, plan, locale);
      if (cs) return warn(`Kód ${c} se neuplatní: máš výhodnější slevu${better ? ` ${better}` : ""}.`);
      return warn(`Code ${c} is not applied: you already have a better discount${better ? ` (${better})` : ""}.`);
    }
    case "no_target_lines":
      return warn(cs ? `Kód ${c} se na tyto produkty nevztahuje.` : `Code ${c} does not apply to these products.`);
    case "outlet_only":
      return warn(cs ? `Kód ${c} se nevztahuje na zboží ve výprodeji.` : `Code ${c} does not apply to sale items.`);
    case "below_minimum": {
      const out: ExplainItem[] = [];
      const m = rule.missing ?? {};
      if (m.subtotal !== undefined) {
        const missing = formatMoney(m.subtotal, plan.currency, locale);
        const minimum = formatMoney(m.minimumSubtotal ?? 0, plan.currency, locale);
        out.push(item("warning", cs ? `Ke kódu ${c} chybí ${missing} do minima ${minimum}.` : `Code ${c} needs ${missing} more (minimum ${minimum}).`, refs));
      }
      if (m.quantity !== undefined) {
        const n = m.quantity;
        out.push(
          item(
            "warning",
            cs
              ? `Ke kódu ${c} chybí ${n} ks do minima ${m.minimumQuantity} ks.`
              : `Code ${c} needs ${n} more ${enPlural(n, "item", "items")} (minimum ${m.minimumQuantity}).`,
            refs,
          ),
        );
      }
      return out;
    }
    case "currency_missing":
      return warn(cs ? `Kód ${c} v měně ${plan.currency} neplatí.` : `Code ${c} is not valid in ${plan.currency}.`);
    case "not_started":
      return warn(
        cs ? `Kód ${c} platí až od ${formatDate(rule.startsOn ?? "", locale)}.` : `Code ${c} is valid from ${formatDate(rule.startsOn ?? "", locale)}.`,
      );
    case "ended":
      return warn(
        cs ? `Platnost kódu ${c} skončila ${formatDate(rule.endsOn ?? "", locale)}.` : `Code ${c} expired on ${formatDate(rule.endsOn ?? "", locale)}.`,
      );
    case "schedule_unknown":
      return warn(cs ? `U kódu ${c} teď nejde ověřit platnost.` : `Code ${c} cannot be checked right now.`);
    case "market":
      return warn(cs ? `Kód ${c} v tomto trhu neplatí.` : `Code ${c} is not valid in this market.`);
    case "segment":
      return warn(cs ? `Kód ${c} je jen pro vybrané zákazníky.` : `Code ${c} is only for selected customers.`);
    case "disabled":
      return warn(cs ? `Kód ${c} je vypnutý.` : `Code ${c} is turned off.`);
    case "not_combinable":
      return warn(
        cs
          ? `Kód ${c} se nekombinuje s ostatními slevami v košíku, které jsou výhodnější.`
          : `Code ${c} does not combine with the other discounts in the cart, which save more.`,
      );
    case "zero_value":
    case "code_not_entered":
    case "unknown":
      return warn(cs ? `Kód ${c} tu nic neušetří.` : `Code ${c} saves nothing here.`);
  }
}

/** Hints about automatic rules that do not apply (info); silent for states a shopper cannot act on. */
function automaticSentences(rule: RuleOutcome, plan: CartPlan, locale: UiLocale): ExplainItem[] {
  const cs = locale === "cs";
  const name = q(labelOf(rule, plan, locale), locale);
  const refs = { ruleId: rule.ruleId };
  const info = (text: string) => [item("info", text, refs)];
  switch (rule.state) {
    case "combined": {
      const owner = plan.rules.find((r) => r.ruleId === rule.combinedInto);
      const ownerName = owner ? q(labelOf(owner, plan, locale), locale) : "";
      return info(cs ? `Sleva ${name} je započtená ve slevě ${ownerName}.` : `${name} is included in ${ownerName}.`);
    }
    case "outranked": {
      const better = betterName(rule, plan, locale);
      if (!better) return info(cs ? `Sleva ${name} se neuplatní: máš výhodnější slevu.` : `${name} is not applied: another discount is better.`);
      return info(cs ? `Sleva ${name} se neuplatní: výhodnější je ${better}.` : `${name} is not applied: ${better} is better.`);
    }
    case "below_minimum": {
      const out: ExplainItem[] = [];
      const m = rule.missing ?? {};
      if (m.subtotal !== undefined) {
        const missing = formatMoney(m.subtotal, plan.currency, locale);
        out.push(item("info", cs ? `Do slevy ${name} chybí ${missing}.` : `${name} needs ${missing} more.`, refs));
      }
      if (m.quantity !== undefined) {
        const n = m.quantity;
        out.push(item("info", cs ? `Do slevy ${name} chybí ${n} ks.` : `${name} needs ${n} more ${enPlural(n, "item", "items")}.`, refs));
      }
      return out;
    }
    case "currency_missing":
      return info(
        cs
          ? `Sleva ${name} nemá hodnotu pro měnu ${plan.currency}, proto se tu nenabízí.`
          : `${name} has no amount for ${plan.currency}, so it is not offered here.`,
      );
    case "not_combinable":
      return info(cs ? `Sleva ${name} se nekombinuje s ostatními slevami v košíku.` : `${name} does not combine with the other discounts in the cart.`);
    case "not_started":
      return info(cs ? `Sleva ${name} začne ${formatDate(rule.startsOn ?? "", locale)}.` : `${name} starts on ${formatDate(rule.startsOn ?? "", locale)}.`);
    case "ended":
      return info(cs ? `Sleva ${name} skončila ${formatDate(rule.endsOn ?? "", locale)}.` : `${name} ended on ${formatDate(rule.endsOn ?? "", locale)}.`);
    case "zero_value":
      return info(cs ? `Sleva ${name} tu nic neušetří.` : `${name} saves nothing here.`);
    default:
      return [];
  }
}

function outletSentence(plan: CartPlan, locale: UiLocale): ExplainItem[] {
  const outlet = plan.lines.filter((l) => l.excluded === "outlet");
  const n = outlet.length;
  if (n === 0) return [];
  const relevant = plan.rules.some(
    (r) => r.discountClass !== "shipping" && r.state !== "disabled" && r.state !== "code_not_entered",
  );
  if (!relevant) return [];
  const text =
    locale === "cs"
      ? `${n} ${csPlural(n, ["položka", "položky", "položek"])} ve výprodeji se s dalšími slevami ${n >= 2 && n <= 4 ? "nekombinují" : "nekombinuje"}.`
      : `${n} ${enPlural(n, "item", "items")} on sale ${n === 1 ? "does" : "do"} not combine with other discounts.`;
  return [item("info", text, { lineIds: outlet.map((l) => l.lineId) })];
}

export function explainPlan(plan: CartPlan, locale: UiLocale): ExplainItem[] {
  const cs = locale === "cs";
  if (plan.reason) {
    return [
      item(
        "warning",
        plan.reason === "config_missing"
          ? cs
            ? "Nastavení slev se nepodařilo načíst, žádná sleva se teď neuplatní."
            : "The discount settings could not be loaded; no discount applies right now."
          : cs
            ? "Košík se nepodařilo spočítat, žádná sleva se teď neuplatní."
            : "The cart could not be evaluated; no discount applies right now.",
        {},
      ),
    ];
  }
  const out: ExplainItem[] = [];
  for (const rule of plan.rules) {
    if (rule.state !== "applied") continue;
    out.push(item("success", capitalize(applied(rule, plan, locale)), {
      ruleId: rule.ruleId,
      code: rule.method === "code" ? rule.enteredCodes[0] : undefined,
      lineIds: rule.lineIds,
    }));
  }
  for (const code of plan.codes) out.push(...codeSentences(code, plan, locale));
  for (const rule of plan.rules) {
    if (rule.method === "code" || rule.state === "applied") continue;
    out.push(...automaticSentences(rule, plan, locale));
  }
  out.push(...outletSentence(plan, locale));
  return out;
}
