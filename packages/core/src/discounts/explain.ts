// explainPlan — "what applies and why" as human sentences (doctrine §4c: never an
// enum key on screen). Used by the admin "Vyzkoušet košík" and, later, the cart
// in the storefront, which must say honestly why an entered code did nothing
// (Shopify only shows `applicable: false`, spec §3).
//
// Quantity tiers (MVP 3): what a tier saves (with the break when every line
// reached the same one), why it does not apply, and the hint "Přidej 1 ks a
// dostaneš −15 %" (plan.progress.tierHint). A set has no name: it is "the
// quantity discount"; items carry `tierSetId`, never a rule id.
//
// Margin protection (MVP 2): a lowered line, a lowered order discount, lines the
// order discount leaves out and a rule margin zeroed are all said in words. The
// REASON with numbers (cost price, minimum margin, the % ceiling) is for the
// admin only (`audience: "admin"`); a shopper (the default) only hears that the
// store set a lowest price — never its costs or margins.

import {
  csPlural,
  describeMarginReason,
  describeRule,
  describeTierBreak,
  describeTierValue,
  echoCode as echo,
  entitledMinimumPhrase,
  enPlural,
  formatDate,
  formatMoney,
  formatPercent,
  MAX_ECHOED_CODE_LENGTH,
  type UiLocale,
} from "./describe.ts";
import {
  type CartPlan,
  type CodeOutcome,
  MAX_ENTERED_CODES,
  type PlanLine,
  type RuleOutcome,
  type ShippingValue,
  TIER_CANDIDATE_PREFIX,
  TIER_LABEL,
  type TierOutcome,
  tierStepBreak,
} from "./plan.ts";
import { GIFT_CANDIDATE_PREFIX, SHIPPING_REWARD_ID, SHIPPING_REWARD_LABEL } from "./plan-rewards.ts";

/**
 * One explanation line. `text` (and `code`) can contain what a shopper typed or
 * what arrived via a `/discount/<code>` link: consumers must render it as TEXT,
 * never as HTML. Echoed codes are capped at MAX_ECHOED_CODE_LENGTH characters.
 * Shopper-facing text never names the app.
 */
export interface ExplainItem {
  /** success = saves money now; warning = an entered code does nothing; info = context and hints. */
  tone: "success" | "info" | "warning";
  text: string;
  ruleId?: string;
  code?: string;
  lineIds?: string[];
  /** A quantity tier set's id (MVP 3): the item is about that set, not about a rule. */
  tierSetId?: string;
}

export interface ExplainOptions {
  /**
   * Who reads it. "shopper" (default: the storefront cart) never hears a cost
   * price or a margin; "admin" ("Vyzkoušet košík") hears why margin protection
   * lowered a discount, with the numbers.
   */
  audience?: "admin" | "shopper";
}

const q = (text: string, locale: UiLocale) => (locale === "cs" ? `„${text}“` : `“${text}”`);

/** Why a rule margin zeroed gives nothing (no numbers: shoppers read it too). */
const AT_MINIMUM = { cs: "ceny položek jsou už na nastaveném minimu", en: "the item prices are already at the set minimum" };

export { MAX_ECHOED_CODE_LENGTH };

/** How to name the owner of a stack another rule is part of: its code when it is a code rule. */
function ownerReference(owner: RuleOutcome, plan: CartPlan, locale: UiLocale): { code?: string; name: string } {
  const code = owner.method === "code" ? owner.enteredCodes[0] : undefined;
  return code ? { code: echo(code), name: echo(code) } : { name: q(labelOf(owner, plan, locale), locale) };
}

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

/** " z vybraných produktů" / " of selected products" when only the rule's own lines count toward its minimum, else "". */
function entitledTail(rule: RuleOutcome, locale: UiLocale): string {
  if (rule.missing?.scope !== "entitled") return "";
  const phrase = entitledMinimumPhrase(rule.describable.target.kind);
  return phrase ? ` ${locale === "cs" ? phrase.cs : phrase.en}` : "";
}

/** "1 more selected item" (products, entitled) / "1 more item in selected collections" / "1 more item". */
function moreItems(n: number, rule: RuleOutcome): string {
  const items = enPlural(n, "item", "items");
  if (rule.missing?.scope !== "entitled") return `${n} more ${items}`;
  if (rule.describable.target.kind === "collections") return `${n} more ${items} in selected collections`;
  return `${n} more selected ${items}`;
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function item(
  tone: ExplainItem["tone"],
  text: string,
  refs: { ruleId?: string; code?: string; lineIds?: string[]; tierSetId?: string },
): ExplainItem {
  const out: ExplainItem = { tone, text };
  if (refs.ruleId) out.ruleId = refs.ruleId;
  if (refs.code) out.code = refs.code;
  if (refs.tierSetId) out.tierSetId = refs.tierSetId;
  if (refs.lineIds && refs.lineIds.length > 0) out.lineIds = [...refs.lineIds];
  return out;
}

/** Sentences for a rule that saves money now. */
function applied(rule: RuleOutcome, plan: CartPlan, locale: UiLocale): string {
  const cs = locale === "cs";
  const money = formatMoney(rule.amount, plan.currency, locale);
  const entered = rule.method === "code" ? rule.enteredCodes[0] : undefined;
  const code = entered === undefined ? undefined : echo(entered);
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

/** The name of what beat a rule or a tier: a rule's label, or "Množstevní sleva" for a tier (`tier:<set>`). */
function betterName(outcome: { betterRuleIds?: string[] }, plan: CartPlan, locale: UiLocale): string | null {
  const id = outcome.betterRuleIds?.[0];
  if (id?.startsWith(TIER_CANDIDATE_PREFIX)) return q(TIER_LABEL[locale], locale);
  if (id === SHIPPING_REWARD_ID) return q(SHIPPING_REWARD_LABEL[locale], locale);
  const better = id ? plan.rules.find((r) => r.ruleId === id) : undefined;
  return better ? q(labelOf(better, plan, locale), locale) : null;
}

// --- Quantity tiers (MVP 3) -----------------------------------------------------------------------

/**
 * The break every contributing line reached ("od 3 ks −10 %"), or null when
 * they differ; without its value ("od 3 ks") when margin protection lowered it
 * on some line — never a value a line does not get.
 */
function uniformBreak(tier: TierOutcome, plan: CartPlan, locale: UiLocale): string | null {
  const contributing = new Set(tier.lineIds);
  const reached = tier.groups.filter((g) => g.lineIds.some((id) => contributing.has(id))).map((g) => g.reached);
  const first = reached[0];
  if (!first || reached.some((r) => r?.minQty !== first.minQty)) return null;
  const capped = plan.lines.some((l) => contributing.has(l.lineId) && l.marginCapped);
  if (capped) return locale === "cs" ? `od ${first.minQty} ks` : `from ${first.minQty} ${enPlural(first.minQty, "item", "items")}`;
  const text = describeTierBreak(tierStepBreak(first, plan.currency), { locale, currency: plan.currency });
  return text.charAt(0).toLowerCase() + text.slice(1);
}

function tierSentences(tier: TierOutcome, plan: CartPlan, locale: UiLocale): ExplainItem[] {
  const cs = locale === "cs";
  // Applied: the lines it discounts; otherwise the lines it counted (its groups).
  const lineIds = tier.state === "applied" ? tier.lineIds : tier.groups.flatMap((g) => g.lineIds);
  const refs = { tierSetId: tier.setId, lineIds };
  const info = (text: string) => [item("info", text, refs)];
  const subject = cs ? "Množstevní sleva" : "The quantity discount";
  switch (tier.state) {
    case "applied": {
      const money = formatMoney(tier.amount, plan.currency, locale);
      const n = tier.lineIds.length;
      const which = uniformBreak(tier, plan, locale);
      const named = which ? `${subject} (${which})` : subject;
      return [
        item(
          "success",
          cs
            ? `${named} ušetří ${money} na ${n} ${n === 1 ? "položce" : "položkách"}.`
            : `${named} saves ${money} on ${n} ${enPlural(n, "item", "items")}.`,
          refs,
        ),
      ];
    }
    case "outranked": {
      const better = betterName(tier, plan, locale);
      if (!better) return info(cs ? `${subject} se neuplatní: máš výhodnější slevu.` : `${subject} is not applied: another discount is better.`);
      return info(cs ? `${subject} se neuplatní: výhodnější je ${better}.` : `${subject} is not applied: ${better} is better.`);
    }
    case "currency_missing":
      return info(
        cs
          ? `${subject} nemá hodnotu pro měnu ${plan.currency}, proto se tu nenabízí.`
          : `${subject} has no amount for ${plan.currency}, so it is not offered here.`,
      );
    case "not_combinable":
      return info(cs ? `${subject} se nekombinuje s ostatními slevami v košíku.` : `${subject} does not combine with the other discounts in the cart.`);
    case "margin_floor":
      return info(cs ? `${subject} se neuplatní: ${AT_MINIMUM.cs}.` : `${subject} is not applied: ${AT_MINIMUM.en}.`);
    case "zero_value":
      return info(cs ? `${subject} tu nic neušetří.` : `${subject} saves nothing here.`);
    default:
      // disabled, no_target_lines, outlet_only (the outlet sentence covers it), below_tier (the hint says what is missing)
      return [];
  }
}

/** "Přidej 1 ks a dostaneš −15 %." — plan.progress.tierHint in words. */
function tierHintSentence(plan: CartPlan, locale: UiLocale): ExplainItem[] {
  const hint = plan.progress.tierHint;
  if (!hint) return [];
  const n = hint.missing;
  // Margin protection lowers the next tier there (MVP 4): promise a lower price, never a value.
  const text = hint.marginCapped
    ? locale === "cs"
      ? `Přidej ${n} ks a dostaneš nižší cenu.`
      : `Add ${n} more ${enPlural(n, "item", "items")} for a lower price.`
    : (() => {
        const value = describeTierValue(tierStepBreak(hint.next, plan.currency), { locale, currency: plan.currency });
        return locale === "cs" ? `Přidej ${n} ks a dostaneš ${value}.` : `Add ${n} more ${enPlural(n, "item", "items")} to get ${value}.`;
      })();
  return [item("info", text, { tierSetId: hint.setId, lineIds: hint.lineIds })];
}

// --- Rewards (MVP 4) -------------------------------------------------------------------------------

/** Free shipping and gifts: what the cart gets, what is missing, and what the plan warns about. */
function rewardSentences(plan: CartPlan, locale: UiLocale): ExplainItem[] {
  const cs = locale === "cs";
  const money = (minor: number) => formatMoney(minor, plan.currency, locale);
  const out: ExplainItem[] = [];
  const warned = (code: string, ruleId: string) => plan.warnings.some((w) => w.code === code && w.ruleId === ruleId);
  const ship = plan.progress.freeShipping;
  if (plan.shipping?.ruleId === SHIPPING_REWARD_ID && ship) {
    out.push(item("success", cs ? `Doprava zdarma: nákup od ${money(ship.threshold)}.` : `Free shipping: orders from ${money(ship.threshold)}.`, { ruleId: SHIPPING_REWARD_ID }));
  } else if (ship && !ship.reached) {
    out.push(item("info", cs ? `Do dopravy zdarma zbývá ${money(ship.remaining)}.` : `${money(ship.remaining)} more for free shipping.`, { ruleId: SHIPPING_REWARD_ID }));
  } else if (warned("reward_not_combinable", SHIPPING_REWARD_ID)) {
    out.push(
      item(
        "info",
        cs
          ? "Doprava zdarma se tu nesčítá s ostatními slevami (přepínače kombinování v Nastavení)."
          : "Free shipping does not combine with the other discounts here (the combination switches in Settings).",
        { ruleId: SHIPPING_REWARD_ID },
      ),
    );
  }
  if (warned("market_missing_threshold", SHIPPING_REWARD_ID)) {
    out.push(item("info", cs ? `Doprava zdarma nemá práh v ${plan.currency}, v tomto trhu se nenabízí.` : `Free shipping has no threshold in ${plan.currency}; it is not offered in this market.`, { ruleId: SHIPPING_REWARD_ID }));
  }
  const progressOf = (tierId: string) => plan.progress.gifts?.find((g) => g.tierId === tierId);
  for (const gift of plan.gifts) {
    const id = `${GIFT_CANDIDATE_PREFIX}${gift.tierId}`;
    const p = progressOf(gift.tierId);
    const lineIds = gift.lineId ? [gift.lineId] : undefined;
    if (gift.state === "earned") {
      out.push(item("success", cs ? `Dárek zdarma${p ? `: nákup od ${money(p.threshold)}` : ""}.` : `Free gift${p ? `: orders from ${money(p.threshold)}` : ""}.`, { ruleId: id, lineIds }));
    } else if (gift.state === "missing") {
      out.push(item("info", cs ? "Nákup má nárok na dárek zdarma, v košíku ale dárek není." : "The order qualifies for a free gift, but the gift is not in the cart.", { ruleId: id }));
    } else if (gift.state === "below" && p) {
      out.push(item("info", cs ? `Do dárku zdarma zbývá ${money(p.remaining)}.` : `${money(p.remaining)} more for the free gift.`, { ruleId: id }));
    } else if (gift.state === "not_offered") {
      out.push(item("info", cs ? `Dárek nemá práh v ${plan.currency}, v tomto trhu se nenabízí.` : `The gift has no threshold in ${plan.currency}; it is not offered in this market.`, { ruleId: id }));
    }
    if (warned("gift_not_earned", id)) {
      out.push(
        item(
          "warning",
          cs
            ? "Dárek v košíku se zaplatí: nákup nedosáhl prahu, nebo to není nabízený dárek."
            : "The gift in the cart will be paid: the order is below the threshold, or it is not a gift offered.",
          { ruleId: id, lineIds },
        ),
      );
    }
    if (warned("gift_extra_paid", id)) {
      out.push(item("info", cs ? "Zdarma je jen 1 kus dárku, další kusy se platí." : "Only 1 gift item is free; the others are paid.", { ruleId: id, lineIds }));
    }
    if (warned("code_loses_gift", id)) {
      out.push(
        item(
          "warning",
          cs
            ? "Se slevami klesne nákup pod práh dárku: košík zákazníka varuje, v pokladně by dárek zůstal zdarma."
            : "With the discounts the order drops below the gift threshold: the cart warns the customer; at checkout the gift would stay free.",
          { ruleId: id },
        ),
      );
    }
  }
  return out;
}

/** Why an entered Won code does nothing (warning), or a note when it counts only inside another stack. */
function codeSentences(code: CodeOutcome, plan: CartPlan, locale: UiLocale): ExplainItem[] {
  const cs = locale === "cs";
  const c = echo(code.code);
  const rule = code.ruleId ? plan.rules.find((r) => r.ruleId === code.ruleId) : undefined;
  const refs = { ruleId: code.ruleId ?? undefined, code: c };
  const warn = (text: string) => [item("warning", text, refs)];
  if (!rule) {
    // Another store discount (native Shopify, another app): never brand, just say it is not counted here.
    return [item("info", cs ? `Kód ${c} je jiná sleva obchodu, tady se nepočítá.` : `Code ${c} is another store discount and is not counted here.`, refs)];
  }
  switch (code.state) {
    case "applied":
      return [];
    case "combined": {
      // Known limitation (two codes in one Pro stack): only the owner's code is
      // emitted, so Shopify shows this one as not applicable and does not count its use.
      const owner = plan.rules.find((r) => r.ruleId === rule.combinedInto);
      if (!owner) return [];
      const ref = ownerReference(owner, plan, locale);
      if (ref.code) {
        return [item("info", cs ? `Kód ${c} se uplatnil společně s kódem ${ref.code}.` : `Code ${c} was applied together with code ${ref.code}.`, refs)];
      }
      return [item("info", cs ? `Kód ${c} je započtený ve slevě ${ref.name}.` : `Code ${c} is included in ${ref.name}.`, refs)];
    }
    case "same_rule": {
      const first = echo(rule.enteredCodes[0]);
      return warn(
        cs
          ? `Kód ${c} patří ke stejné slevě jako kód ${first}; uplatní se jen jeden.`
          : `Code ${c} belongs to the same discount as code ${first}; only one applies.`,
      );
    }
    case "outranked": {
      // Also a Pro partner left out of a stack only by the stack cap (plan.ts
      // MAX_STACK_CANDIDATES): every member of that stack gives more than it.
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
      const tail = entitledTail(rule, locale);
      if (m.subtotal !== undefined) {
        const missing = formatMoney(m.subtotal, plan.currency, locale);
        const minimum = formatMoney(m.minimumSubtotal ?? 0, plan.currency, locale);
        out.push(
          item(
            "warning",
            cs ? `Ke kódu ${c} chybí ${missing}${tail} do minima ${minimum}.` : `Code ${c} needs ${missing} more${tail} (minimum ${minimum}).`,
            refs,
          ),
        );
      }
      if (m.quantity !== undefined) {
        const n = m.quantity;
        out.push(
          item(
            "warning",
            cs
              ? `Ke kódu ${c} chybí ${n} ks${tail} do minima ${m.minimumQuantity} ks.`
              : `Code ${c} needs ${moreItems(n, rule)} (minimum ${m.minimumQuantity}).`,
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
    case "unsupported":
      return warn(
        cs ? `Kód ${c} se neuplatní: cílení na segment zatím není k dispozici.` : `Code ${c} is not applied: segment targeting is not available yet.`,
      );
    case "disabled":
      return warn(cs ? `Kód ${c} je vypnutý.` : `Code ${c} is turned off.`);
    case "not_combinable":
      return warn(cs ? `Kód ${c} se nekombinuje s ostatními slevami v košíku.` : `Code ${c} does not combine with the other discounts in the cart.`);
    case "margin_floor":
      return warn(cs ? `Kód ${c} tu nic neušetří: ${AT_MINIMUM.cs}.` : `Code ${c} saves nothing here: ${AT_MINIMUM.en}.`);
    case "zero_value":
    case "code_not_entered":
    case "unknown":
      return warn(cs ? `Kód ${c} tu nic neušetří.` : `Code ${c} saves nothing here.`);
    case "over_limit":
      return []; // said once for all of them (overLimitSentence)
  }
}

/** One warning when codes beyond the first MAX_ENTERED_CODES were entered: they are not counted. */
function overLimitSentence(plan: CartPlan, locale: UiLocale): ExplainItem[] {
  if (!plan.codes.some((code) => code.state === "over_limit")) return [];
  return [
    item(
      "warning",
      locale === "cs"
        ? `Zadaných kódů je víc než ${MAX_ENTERED_CODES}, další se už nezapočítají.`
        : `More than ${MAX_ENTERED_CODES} codes were entered; the rest aren't counted.`,
      {},
    ),
  ];
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
      if (!owner) return [];
      const ref = ownerReference(owner, plan, locale);
      if (ref.code) return info(cs ? `Sleva ${name} je započtená v kódu ${ref.code}.` : `${name} is included in code ${ref.code}.`);
      return info(cs ? `Sleva ${name} je započtená ve slevě ${ref.name}.` : `${name} is included in ${ref.name}.`);
    }
    case "outranked": {
      // Also a Pro partner left out of a stack only by the stack cap (plan.ts
      // MAX_STACK_CANDIDATES): every member of that stack gives more than it.
      const better = betterName(rule, plan, locale);
      if (!better) return info(cs ? `Sleva ${name} se neuplatní: máš výhodnější slevu.` : `${name} is not applied: another discount is better.`);
      return info(cs ? `Sleva ${name} se neuplatní: výhodnější je ${better}.` : `${name} is not applied: ${better} is better.`);
    }
    case "below_minimum": {
      const out: ExplainItem[] = [];
      const m = rule.missing ?? {};
      const tail = entitledTail(rule, locale);
      if (m.subtotal !== undefined) {
        const missing = formatMoney(m.subtotal, plan.currency, locale);
        out.push(item("info", cs ? `Do slevy ${name} chybí ${missing}${tail}.` : `${name} needs ${missing} more${tail}.`, refs));
      }
      if (m.quantity !== undefined) {
        const n = m.quantity;
        out.push(item("info", cs ? `Do slevy ${name} chybí ${n} ks${tail}.` : `${name} needs ${moreItems(n, rule)}.`, refs));
      }
      return out;
    }
    case "unsupported":
      return info(
        cs ? `Sleva ${name} se neuplatní: cílení na segment zatím není k dispozici.` : `${name} is not applied: segment targeting is not available yet.`,
      );
    case "currency_missing":
      return info(
        cs
          ? `Sleva ${name} nemá hodnotu pro měnu ${plan.currency}, proto se tu nenabízí.`
          : `${name} has no amount for ${plan.currency}, so it is not offered here.`,
      );
    case "not_combinable":
      return info(cs ? `Sleva ${name} se nekombinuje s ostatními slevami v košíku.` : `${name} does not combine with the other discounts in the cart.`);
    case "margin_floor":
      return info(cs ? `Sleva ${name} se neuplatní: ${AT_MINIMUM.cs}.` : `${name} is not applied: ${AT_MINIMUM.en}.`);
    case "not_started":
      return info(cs ? `Sleva ${name} začne ${formatDate(rule.startsOn ?? "", locale)}.` : `${name} starts on ${formatDate(rule.startsOn ?? "", locale)}.`);
    case "ended":
      return info(cs ? `Sleva ${name} skončila ${formatDate(rule.endsOn ?? "", locale)}.` : `${name} ended on ${formatDate(rule.endsOn ?? "", locale)}.`);
    case "zero_value":
      return info(cs ? `Sleva ${name} tu nic neušetří.` : `${name} saves nothing here.`);
    case "schedule_unknown":
      return info(
        cs ? `Sleva ${name} se neuplatní: její platnost teď nejde ověřit.` : `${name} is not applied: its dates cannot be checked right now.`,
      );
    default:
      return [];
  }
}

function outletSentence(plan: CartPlan, locale: UiLocale): ExplainItem[] {
  const outlet = plan.lines.filter((l) => l.excluded === "outlet");
  const n = outlet.length;
  if (n === 0) return [];
  const relevant =
    plan.rules.some((r) => r.discountClass !== "shipping" && r.state !== "disabled" && r.state !== "code_not_entered") ||
    (plan.tiers ?? []).some((t) => t.state !== "disabled" && t.state !== "currency_missing");
  if (!relevant) return [];
  const text =
    locale === "cs"
      ? `${n} ${csPlural(n, ["položka", "položky", "položek"])} ve výprodeji se s dalšími slevami ${n >= 2 && n <= 4 ? "nekombinují" : "nekombinuje"}.`
      : `${n} ${enPlural(n, "item", "items")} on sale ${n === 1 ? "does" : "do"} not combine with other discounts.`;
  return [item("info", text, { lineIds: outlet.map((l) => l.lineId) })];
}

/** A line whose product discount margin protection lowered: from → to, and why (numbers for the admin only). */
function cappedLineSentence(line: PlanLine, plan: CartPlan, locale: UiLocale, admin: boolean): ExplainItem[] {
  const capped = line.marginCapped;
  if (!capped) return [];
  const cs = locale === "cs";
  const before = formatMoney(capped.before, plan.currency, locale);
  const why = admin
    ? describeMarginReason(capped, locale)
    : cs
      ? "obchod u ní má nastavenou nejnižší cenu"
      : "the store has set a lowest price for it";
  let text: string;
  if (capped.after > 0) {
    const after = formatMoney(capped.after, plan.currency, locale);
    text = cs ? `Sleva na položce je snížená z ${before} na ${after}: ${why}.` : `The discount on an item is lowered from ${before} to ${after}: ${why}.`;
  } else {
    text = cs ? `Sleva ${before} na položce se neuplatní: ${why}.` : `The ${before} discount on an item does not apply: ${why}.`;
  }
  return [item("info", text, { lineIds: [line.lineId] })];
}

/** The order discount margin protection lowered, and the lines it leaves out. */
function marginOrderSentences(plan: CartPlan, locale: UiLocale): ExplainItem[] {
  const order = plan.order;
  if (!order) return [];
  const cs = locale === "cs";
  const out: ExplainItem[] = [];
  if (order.marginCapped) {
    const before = formatMoney(order.marginCapped.before, plan.currency, locale);
    const after = formatMoney(order.marginCapped.after, plan.currency, locale);
    out.push(
      item(
        "info",
        cs
          ? `Sleva z objednávky je snížená z ${before} na ${after}, aby cena položek neklesla pod nastavené minimum.`
          : `The order discount is lowered from ${before} to ${after} so item prices do not drop below the set minimum.`,
        { ruleId: order.ownerRuleId },
      ),
    );
  }
  const n = order.marginExcludedLineIds.length;
  if (n > 0) {
    out.push(
      item(
        "info",
        cs
          ? `Sleva z objednávky se nevztahuje na ${n} ${csPlural(n, ["položku", "položky", "položek"])}, ${n === 1 ? "její" : "jejich"} cena je už na nastaveném minimu.`
          : `The order discount does not apply to ${n} ${enPlural(n, "item", "items")} already at ${n === 1 ? "its" : "their"} set minimum price.`,
        { ruleId: order.ownerRuleId, lineIds: order.marginExcludedLineIds },
      ),
    );
  }
  return out;
}

export function explainPlan(plan: CartPlan, locale: UiLocale, opts: ExplainOptions = {}): ExplainItem[] {
  const cs = locale === "cs";
  const admin = opts.audience === "admin";
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
  const tiers = plan.tiers ?? [];
  for (const rule of plan.rules) {
    if (rule.state !== "applied") continue;
    out.push(item("success", capitalize(applied(rule, plan, locale)), {
      ruleId: rule.ruleId,
      code: rule.method === "code" && rule.enteredCodes[0] !== undefined ? echo(rule.enteredCodes[0]) : undefined,
      lineIds: rule.lineIds,
    }));
  }
  for (const tier of tiers) if (tier.state === "applied") out.push(...tierSentences(tier, plan, locale));
  out.push(...tierHintSentence(plan, locale));
  out.push(...rewardSentences(plan, locale));
  for (const code of plan.codes) out.push(...codeSentences(code, plan, locale));
  out.push(...overLimitSentence(plan, locale));
  for (const rule of plan.rules) {
    if (rule.method === "code" || rule.state === "applied") continue;
    out.push(...automaticSentences(rule, plan, locale));
  }
  // Sets that do not apply: one sentence per distinct text (two sets missing EUR say it once, for both sets' lines).
  const said = new Map<string, ExplainItem>();
  for (const tier of tiers) {
    if (tier.state === "applied") continue;
    for (const sentence of tierSentences(tier, plan, locale)) {
      const earlier = said.get(sentence.text);
      if (!earlier) {
        said.set(sentence.text, sentence);
        out.push(sentence);
      } else if (sentence.lineIds) {
        earlier.lineIds = [...(earlier.lineIds ?? []), ...sentence.lineIds];
      }
    }
  }
  for (const line of plan.lines) out.push(...cappedLineSentence(line, plan, locale, admin));
  out.push(...marginOrderSentences(plan, locale));
  out.push(...outletSentence(plan, locale));
  return out;
}
