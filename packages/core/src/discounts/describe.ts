// Human formatting shared by explainPlan, checkout messages and admin headers
// (doctrine §4c: never an enum key on screen; §17a: describe*() formatters live
// in core). No `Intl`: this code also runs inside the Shopify JS function, whose
// runtime is not guaranteed to ship it, so money/percent/date are formatted by hand.

import type { PlanLocale } from "./cart.ts";
import type { DiscountMethod, DiscountRuleValue, DiscountTargetKind, MinimumScope } from "./config.ts";
import { currencyExponent, type MoneyByCurrency, moneyFor } from "./money.ts";

export type UiLocale = PlanLocale;

const NBSP = " ";

/** Longest code echoed back into any text (codes are customer input; render as text only). */
export const MAX_ECHOED_CODE_LENGTH = 64;

/** A code as it may be shown: at most MAX_ECHOED_CODE_LENGTH characters, then "…". */
export function echoCode(code: string): string {
  return code.length > MAX_ECHOED_CODE_LENGTH ? `${code.slice(0, MAX_ECHOED_CODE_LENGTH)}…` : code;
}

/** Symbols we are sure about per locale; any other currency prints its ISO code. */
const CS_SYMBOLS: Readonly<Record<string, string>> = { CZK: "Kč", EUR: "€" };
const EN_PREFIX_SYMBOLS: Readonly<Record<string, string>> = { EUR: "€", USD: "$", GBP: "£" };

function groupThousands(digits: string, separator: string): string {
  let out = "";
  for (let i = 0; i < digits.length; i++) {
    if (i > 0 && (digits.length - i) % 3 === 0) out += separator;
    out += digits[i];
  }
  return out;
}

/** 123450 minor units of CZK → "1 234,50 Kč" (cs) / "CZK 1,234.50" (en); whole amounts drop the decimals. */
export function formatMoney(minor: number, currency: string, locale: UiLocale): string {
  const code = currency.toUpperCase();
  const digits = currencyExponent(code);
  const n = Math.round(Math.abs(minor));
  const scale = 10 ** digits;
  const major = Math.floor(n / scale);
  const fraction = n % scale;
  const sign = minor < 0 ? "-" : "";
  const cs = locale === "cs";
  let number = groupThousands(String(major), cs ? NBSP : ",");
  if (fraction > 0) number += (cs ? "," : ".") + String(fraction).padStart(digits, "0");
  if (cs) return `${sign}${number}${NBSP}${CS_SYMBOLS[code] ?? code}`;
  const symbol = EN_PREFIX_SYMBOLS[code];
  return symbol ? `${sign}${symbol}${number}` : `${sign}${code} ${number}`;
}

/** 12.5 → "12,5 %" (cs) / "12.5%" (en). */
export function formatPercent(percent: number, locale: UiLocale): string {
  const text = String(Math.round(percent * 100) / 100);
  return locale === "cs" ? `${text.replace(".", ",")}${NBSP}%` : `${text}%`;
}

const EN_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-11-27" → "27. 11. 2026" (cs) / "27 Nov 2026" (en). */
export function formatDate(isoDate: string, locale: UiLocale): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  if (!y || !m || !d) return isoDate;
  return locale === "cs" ? `${d}. ${m}. ${y}` : `${d} ${EN_MONTHS[m - 1]} ${y}`;
}

/** Czech noun forms by count: [1, 2-4, 5+ / 0]. */
export function csPlural(n: number, forms: readonly [string, string, string]): string {
  if (n === 1) return forms[0];
  if (n >= 2 && n <= 4) return forms[1];
  return forms[2];
}

export function enPlural(n: number, one: string, many: string): string {
  return n === 1 ? one : many;
}

/** The fields of a rule a description needs (a config rule, a payload rule, or an override result). */
export interface DescribableRule {
  method: DiscountMethod;
  codes?: readonly string[];
  value: DiscountRuleValue;
  target: { readonly kind: DiscountTargetKind };
  minimum?: { readonly subtotal?: MoneyByCurrency; readonly quantity?: number; readonly scope?: MinimumScope };
}

function firstCurrency(amount: MoneyByCurrency): string | undefined {
  return Object.keys(amount)[0];
}

/** "A a B" / "A and B"; three or more: "A, B a C". */
function joinWords(items: readonly string[], locale: UiLocale): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")}${locale === "cs" ? " a " : " and "}${items[items.length - 1]}`;
}

/** The listed currencies (the shop's markets, in order) that the amount has a value for. */
function shownCurrencies(amount: MoneyByCurrency, currencies: readonly string[]): string[] {
  return currencies.filter((c) => moneyFor(amount, c) !== null);
}

/**
 * "100 Kč / 4 €": an amount in each listed market currency it has a value for
 * (admin view, MKT-1 — each market its own number, never converted). A value in
 * a currency no enabled market uses is not offered anywhere, so it is not shown
 * here (the editor lists it separately). "" when none.
 */
export function formatAmounts(amount: MoneyByCurrency, currencies: readonly string[], locale: UiLocale): string {
  return shownCurrencies(amount, currencies)
    .map((c) => formatMoney(moneyFor(amount, c) ?? 0, c, locale))
    .join(" / ");
}

/**
 * Market currencies a rule is NOT offered in (MKT-1): a fixed value without that
 * currency, or a minimum subtotal set for other currencies but not this one. An
 * empty minimum map means "no minimum", not "offered nowhere".
 */
export function currenciesWithoutValue(rule: DescribableRule, currencies: readonly string[]): string[] {
  const missing = new Set<string>();
  const value = rule.value;
  if (value.kind === "fixed") {
    for (const c of currencies) if (moneyFor(value.amount, c) === null) missing.add(c);
  }
  const subtotal = rule.minimum?.subtotal;
  if (subtotal && Object.keys(subtotal).length > 0) {
    for (const c of currencies) if (moneyFor(subtotal, c) === null) missing.add(c);
  }
  return currencies.filter((c) => missing.has(c));
}

/** The value + target phrase around an already formatted value (`m`). */
function valuePhrase(kind: "percentage" | "fixed", target: DiscountTargetKind, m: string, locale: UiLocale): string {
  if (locale === "cs") {
    if (kind === "percentage") {
      return {
        order: `${m} z objednávky`,
        products: `${m} na vybrané produkty`,
        collections: `${m} na vybrané kolekce`,
        shipping: `${m} z dopravy`,
      }[target];
    }
    return {
      order: `${m} z objednávky`,
      products: `${m} z každého kusu vybraných produktů`,
      collections: `${m} z každého kusu z vybraných kolekcí`,
      shipping: `${m} z dopravy`,
    }[target];
  }
  if (kind === "percentage") {
    return {
      order: `${m} off the order`,
      products: `${m} off selected products`,
      collections: `${m} off selected collections`,
      shipping: `${m} off shipping`,
    }[target];
  }
  return {
    order: `${m} off the order`,
    products: `${m} off each selected item`,
    collections: `${m} off each item in selected collections`,
    shipping: `${m} off shipping`,
  }[target];
}

/**
 * "10 % z objednávky" / "10% off the order" — value and target only. `currency`
 * picks one per-currency amount (engine: the cart currency); `currencies` (admin
 * view) shows every one that has a value.
 */
function describeValue(
  rule: DescribableRule,
  locale: UiLocale,
  currency: string | undefined,
  currencies: readonly string[] | undefined,
): string {
  const cs = locale === "cs";
  const target = rule.target.kind;
  const value = rule.value;
  if (value.kind === "freeShipping") return cs ? "Doprava zdarma" : "Free shipping";
  if (value.kind === "percentage") return valuePhrase("percentage", target, formatPercent(value.percent, locale), locale);
  if (currency === undefined && currencies) {
    const all = formatAmounts(value.amount, currencies, locale);
    if (!all) return cs ? "Pevná sleva zatím bez hodnoty" : "Fixed amount, no value yet";
    return valuePhrase("fixed", target, all, locale);
  }
  const code = currency ?? firstCurrency(value.amount);
  const minor = code ? moneyFor(value.amount, code) : null;
  if (code === undefined || minor === null) {
    const which = code ?? "";
    return cs ? `Pevná sleva (pro ${which} bez hodnoty)` : `Fixed amount (no value for ${which})`;
  }
  return valuePhrase("fixed", target, formatMoney(minor, code, locale), locale);
}

const MAX_CODES_SHOWN = 3;

/**
 * "automaticky" · "kód VIP10" · "kódy A, B, C a 2 další". A code rule with no code
 * reads "kódem" — the engine only knows code hashes, not the codes — unless the
 * caller knows the codes (`codesKnown`, the admin), where it reads "kódem, zatím
 * bez kódu".
 */
function describeMethod(rule: DescribableRule, locale: UiLocale, codesKnown: boolean): string {
  const cs = locale === "cs";
  if (rule.method === "automatic") return cs ? "automaticky" : "automatic";
  const codes = rule.codes ?? [];
  if (codes.length === 0) {
    if (codesKnown) return cs ? "kódem, zatím bez kódu" : "by code, no code yet";
    return cs ? "kódem" : "by code";
  }
  const shown = codes.slice(0, MAX_CODES_SHOWN).map(echoCode).join(", ");
  const more = codes.length - MAX_CODES_SHOWN;
  const tail = more > 0 ? (cs ? ` a ${more} další` : ` and ${more} more`) : "";
  const label = codes.length === 1 ? (cs ? "kód" : "code") : cs ? "kódy" : "codes";
  return `${label} ${shown}${tail}`;
}

/**
 * "z vybraných produktů" / "of selected products": what an entitled minimum
 * counts (MinimumScope "entitled" on a product or collection rule), else null.
 */
export function entitledMinimumPhrase(target: DiscountTargetKind): { cs: string; en: string } | null {
  if (target === "products") return { cs: "z vybraných produktů", en: "of selected products" };
  if (target === "collections") return { cs: "z vybraných kolekcí", en: "in selected collections" };
  return null;
}

/**
 * The minimum, in the words of what it is measured on:
 *   - order / shipping rules: "od 1 000 Kč", "od 3 ks" (the order is the cart);
 *   - product / collection rules, cart scope: "košík od 1 000 Kč", "košík od 3 ks";
 *   - entitled scope: "nákup od 1 000 Kč z vybraných produktů", "od 3 ks z vybraných produktů".
 * Engine: the cart currency; admin: "od 1 000 Kč / 40 €".
 */
function describeMinimum(
  rule: DescribableRule,
  locale: UiLocale,
  currency: string | undefined,
  currencies: readonly string[] | undefined,
): string[] {
  const cs = locale === "cs";
  const target = rule.target.kind;
  const lineTarget = target === "products" || target === "collections";
  const entitled = rule.minimum?.scope === "entitled" ? entitledMinimumPhrase(target) : null;
  const moneyPhrase = (m: string) => {
    if (entitled) return cs ? `nákup od ${m} ${entitled.cs}` : `from ${m} ${entitled.en}`;
    if (lineTarget) return cs ? `košík od ${m}` : `cart from ${m}`;
    return cs ? `od ${m}` : `orders from ${m}`;
  };
  const parts: string[] = [];
  const subtotal = rule.minimum?.subtotal;
  if (subtotal && Object.keys(subtotal).length > 0) {
    if (currency === undefined && currencies) {
      const all = formatAmounts(subtotal, currencies, locale);
      if (all) parts.push(moneyPhrase(all));
    } else {
      const code = currency ?? firstCurrency(subtotal);
      const minor = code ? moneyFor(subtotal, code) : null;
      if (code && minor !== null) {
        parts.push(moneyPhrase(formatMoney(minor, code, locale)));
      } else if (code) {
        parts.push(cs ? `v ${code} se nenabízí (minimum bez hodnoty)` : `not offered in ${code} (no minimum amount)`);
      }
    }
  }
  const quantity = rule.minimum?.quantity ?? 0;
  if (quantity > 0) {
    const items = enPlural(quantity, "item", "items");
    if (entitled) {
      parts.push(
        cs
          ? `od ${quantity} ks ${entitled.cs}`
          : target === "collections"
            ? `from ${quantity} ${items} ${entitled.en}`
            : `from ${quantity} selected ${items}`,
      );
    } else if (lineTarget) {
      parts.push(cs ? `košík od ${quantity} ks` : `cart from ${quantity} ${items}`);
    } else {
      parts.push(cs ? `od ${quantity} ks` : `from ${quantity} ${items}`);
    }
  }
  return parts;
}

export interface DescribeRuleOptions {
  /** Just value and target (the checkout message fallback). */
  short?: boolean;
  /**
   * Admin view (when no single `currency` is given): amounts in every listed
   * market currency ("100 Kč / 4 €") and a closing "v EUR se nenabízí" for the
   * currencies the rule has no value for.
   */
  currencies?: readonly string[];
  /** The caller knows the rule's codes (admin): a code rule without one says "zatím bez kódu". */
  codesKnown?: boolean;
}

export interface RuleDescriptionParts {
  value: string;
  method: string;
  minimum: string[];
  /** "v EUR se nenabízí" (admin view only), else null. */
  notOffered: string | null;
}

/** The pieces describeRule joins, for admin blocks that show one piece on its own. */
export function describeRuleParts(
  rule: DescribableRule,
  locale: UiLocale,
  opts: DescribeRuleOptions & { currency?: string } = {},
): RuleDescriptionParts {
  const list = opts.currency === undefined ? opts.currencies : undefined;
  const missing = list ? currenciesWithoutValue(rule, list) : [];
  return {
    value: describeValue(rule, locale, opts.currency, list),
    method: describeMethod(rule, locale, opts.codesKnown === true),
    minimum: describeMinimum(rule, locale, opts.currency, list),
    notOffered:
      missing.length === 0
        ? null
        : locale === "cs"
          ? `v ${joinWords(missing, locale)} se nenabízí`
          : `not offered in ${joinWords(missing, locale)}`,
  };
}

/**
 * One-line summary of a rule for admin headers (§17a) — "10 % z objednávky · kódy
 * LETO, ZIMA · od 1 000 Kč". `currency` picks which per-currency amount to show
 * (the first one when omitted and no `currencies` list is given). `short` gives
 * just the value and target, used as the checkout message fallback when a rule
 * has no name.
 */
export function describeRule(
  rule: DescribableRule,
  locale: UiLocale,
  currency?: string,
  opts: DescribeRuleOptions = {},
): string {
  const parts = describeRuleParts(rule, locale, { ...opts, currency });
  if (opts.short) return parts.value;
  return [parts.value, parts.method, ...parts.minimum, parts.notOffered].filter((p): p is string => !!p).join(" · ");
}

// --- Schedules (shop-local days, the engine's day gate) -----------------------------------

/** A rule schedule as shop-local calendar days (function-payload `shopLocalDates`). */
export interface ScheduleDays {
  startsOn?: string | null;
  endsOn?: string | null;
}

export type ScheduleState = "always" | "not_started" | "live" | "ended" | "unknown";

/**
 * Where `today` (shop-local `YYYY-MM-DD`) falls in a schedule — the same day gate
 * planCart applies (start and end days inclusive). No schedule → "always"; a
 * schedule without a known today → "unknown".
 */
export function ruleScheduleState(days: ScheduleDays | null | undefined, today: string | null): ScheduleState {
  const startsOn = days?.startsOn ?? null;
  const endsOn = days?.endsOn ?? null;
  if (!startsOn && !endsOn) return "always";
  if (!today) return "unknown";
  if (startsOn && today < startsOn) return "not_started";
  if (endsOn && today > endsOn) return "ended";
  return "live";
}

/** "27. 11. 2026 až 30. 11. 2026" · "od 27. 11. 2026" · "do 30. 11. 2026" · "" (no schedule). */
export function describeSchedule(days: ScheduleDays | null | undefined, locale: UiLocale): string {
  const cs = locale === "cs";
  const start = days?.startsOn ? formatDate(days.startsOn, locale) : null;
  const end = days?.endsOn ? formatDate(days.endsOn, locale) : null;
  if (start && end) return cs ? `${start} až ${end}` : `${start} to ${end}`;
  if (start) return cs ? `od ${start}` : `from ${start}`;
  if (end) return cs ? `do ${end}` : `until ${end}`;
  return "";
}
