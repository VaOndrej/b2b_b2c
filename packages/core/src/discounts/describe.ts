// Human formatting shared by explainPlan, checkout messages and admin headers
// (doctrine §4c: never an enum key on screen; §17a: describe*() formatters live
// in core). No `Intl`: this code also runs inside the Shopify JS function, whose
// runtime is not guaranteed to ship it, so money/percent/date are formatted by hand.

import type { PlanLocale } from "./cart.ts";
import type { DiscountMethod, DiscountRuleValue, DiscountTargetKind, MinimumScope } from "./config.ts";
import { amountKeyCurrency, currencyExponent, type MoneyByCurrency, moneyFor } from "./money.ts";

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
  // An amount key ("EUR@sk") is formatted in its currency.
  const code = amountKeyCurrency(currency).toUpperCase();
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
  /** Generated code batches (code-batch.ts): only what a description needs. */
  codeBatches?: readonly { readonly count: number; readonly removed?: readonly number[] }[];
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
export function formatAmounts(amount: MoneyByCurrency, currencies: readonly string[], locale: UiLocale, labels?: AmountLabels): string {
  // Amounts per market (7 Oct 2026): two markets of one currency with the same amount ("EUR@sk", "EUR@de") are
  // said once; with different amounts each says whose it is — "16 € (Slovensko) / 20 € (Německo)".
  const shown = shownCurrencies(amount, currencies).map((key) => ({ key, text: formatMoney(moneyFor(amount, key) ?? 0, key, locale) }));
  const texts = new Map<string, Set<string>>();
  for (const item of shown) texts.set(amountKeyCurrency(item.key), (texts.get(amountKeyCurrency(item.key)) ?? new Set()).add(item.text));
  const out = shown.map((item) => ((texts.get(amountKeyCurrency(item.key))?.size ?? 0) > 1 ? `${item.text} (${amountLabel(item.key, labels)})` : item.text));
  return [...new Set(out)].join(" / ");
}

/** Names of the amount keys' markets ("EUR@sk" → "Slovensko"), as the caller knows them. */
export type AmountLabels = Readonly<Record<string, string>>;

/** An amount key in words: its market's name (else the market's handle), a plain currency as its code. */
export function amountLabel(key: string, labels?: AmountLabels): string {
  const named = labels && Object.hasOwn(labels, key) ? labels[key] : undefined;
  if (named) return named;
  const at = key.indexOf("@");
  return at < 0 ? key : key.slice(at + 1);
}

/** "v EUR se nenabízí" for currencies; once a key is one market's ("EUR@sk"): "pro Slovensko se nenabízí". */
function notOfferedPhrase(missing: readonly string[], locale: UiLocale, labels?: AmountLabels): string {
  const words = [...new Set(missing.map((key) => amountLabel(key, labels)))];
  // Named by the market wherever the caller knows its name ("pro Slovensko"), also for a currency one market sells in.
  const perMarket = missing.some((key) => key.includes("@") || (labels !== undefined && Object.hasOwn(labels, key)));
  if (locale === "cs") return perMarket ? `pro ${joinWords(words, locale)} se nenabízí` : `v ${joinWords(words, locale)} se nenabízí`;
  return perMarket ? `not offered for ${joinWords(words, locale)}` : `not offered in ${joinWords(words, locale)}`;
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
  labels?: AmountLabels,
): string {
  const cs = locale === "cs";
  const target = rule.target.kind;
  const value = rule.value;
  if (value.kind === "freeShipping") return cs ? "Doprava zdarma" : "Free shipping";
  if (value.kind === "percentage") return valuePhrase("percentage", target, formatPercent(value.percent, locale), locale);
  if (currency === undefined && currencies) {
    const all = formatAmounts(value.amount, currencies, locale, labels);
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
  // Generated batches (plan 2026-10-06 dávka 4): counted, never listed.
  let generated = 0;
  for (const batch of rule.codeBatches ?? []) generated += Math.max(0, batch.count - (batch.removed?.length ?? 0));
  if (codes.length === 0) {
    if (generated > 0) return describeGeneratedCodes(generated, locale);
    if (codesKnown) return cs ? "kódem, zatím bez kódu" : "by code, no code yet";
    return cs ? "kódem" : "by code";
  }
  const shown = codes.slice(0, MAX_CODES_SHOWN).map(echoCode).join(", ");
  const more = codes.length - MAX_CODES_SHOWN;
  const tail = more > 0 ? (cs ? ` a ${more} další` : ` and ${more} more`) : "";
  const label = codes.length === 1 ? (cs ? "kód" : "code") : cs ? "kódy" : "codes";
  const batches = generated > 0 ? ` + ${describeGeneratedCodes(generated, locale)}` : "";
  return `${label} ${shown}${tail}${batches}`;
}

/** "1 vygenerovaný kód" · "3 vygenerované kódy" · "100 vygenerovaných kódů" / "100 generated codes". */
export function describeGeneratedCodes(count: number, locale: UiLocale): string {
  if (locale === "cs") return `${count} ${csPlural(count, ["vygenerovaný kód", "vygenerované kódy", "vygenerovaných kódů"])}`;
  return `${count} generated ${enPlural(count, "code", "codes")}`;
}

// --- Per-item minimum quantity (plan 2026-10-06 bod 8) ---------------------------------------------

/** What an item with its own minimum is: a selected product, or a selected collection. */
export type ItemMinimumKind = "products" | "collections";

const ITEM_NOUN = {
  products: { cs: "Produkt", en: "Product" },
  collections: { cs: "Kolekce", en: "Collection" },
} as const;

/** "Produkt Tričko" / "Kolekce Léto" — or just "Produkt" when the caller has no name for it. */
function itemLabel(kind: ItemMinimumKind, name: string | undefined, locale: UiLocale): string {
  const noun = ITEM_NOUN[kind][locale === "cs" ? "cs" : "en"];
  return name ? `${noun} ${name}` : noun;
}

/**
 * One item's own minimum, for the admin summary: "Produkt Tričko od 3 ks" /
 * "Product Tričko from 3 items". Without a name: "Produkt od 3 ks".
 */
export function describeItemMinimum(item: { kind: ItemMinimumKind; minimum: number; name?: string }, locale: UiLocale): string {
  const label = itemLabel(item.kind, item.name, locale);
  return locale === "cs" ? `${label} od ${item.minimum} ks` : `${label} from ${item.minimum} ${enPlural(item.minimum, "item", "items")}`;
}

/**
 * How many selected items have their own minimum, as one part of a rule's
 * summary: "vlastní minimum u 2 produktů" / "own minimum for 2 products";
 * null when none has.
 */
export function describeItemMinimumsSummary(kind: ItemMinimumKind, count: number, locale: UiLocale): string | null {
  if (count <= 0) return null;
  if (locale === "cs") {
    const noun = kind === "products" ? csPlural(count, ["produktu", "produktů", "produktů"]) : csPlural(count, ["kolekce", "kolekcí", "kolekcí"]);
    return `vlastní minimum u ${count} ${noun}`;
  }
  return `own minimum for ${count} ${kind === "products" ? enPlural(count, "product", "products") : enPlural(count, "collection", "collections")}`;
}

/**
 * Why an item's lines do not get the discount yet (explain.ts says it for a
 * cart): "Produkt B: v košíku 1 ks, sleva platí od 4 ks." / "Product B: 1 item
 * in the cart, the discount applies from 4 items."
 */
export function describeItemMinimumGap(item: { kind: ItemMinimumKind; minimum: number; count: number; name?: string }, locale: UiLocale): string {
  const label = itemLabel(item.kind, item.name, locale);
  if (locale === "cs") return `${label}: v košíku ${item.count} ks, sleva platí od ${item.minimum} ks.`;
  return `${label}: ${item.count} ${enPlural(item.count, "item", "items")} in the cart, the discount applies from ${item.minimum} ${enPlural(item.minimum, "item", "items")}.`;
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
  labels?: AmountLabels,
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
      const all = formatAmounts(subtotal, currencies, locale, labels);
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
  /** Names of the markets of the amount keys ("EUR@sk" → "Slovensko"), for amounts that differ within a currency. */
  labels?: AmountLabels;
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
    value: describeValue(rule, locale, opts.currency, list, opts.labels),
    method: describeMethod(rule, locale, opts.codesKnown === true),
    minimum: describeMinimum(rule, locale, opts.currency, list, opts.labels),
    notOffered: missing.length === 0 ? null : notOfferedPhrase(missing, locale, opts.labels),
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

// --- Quantity tiers (MVP 3) -------------------------------------------------------------------

/** The fields of a tier break a description needs (config TierBreak). */
export interface DescribableTierBreak {
  minQty: number;
  percent?: number;
  amountOff?: MoneyByCurrency;
}

export interface DescribeTierOptions {
  locale: UiLocale;
  /** One currency (the engine: the cart's): an amount break without it reads "not offered in …". */
  currency?: string;
  /**
   * Admin view, when no `currency` is given: amounts in each listed market
   * currency ("50 Kč / 2 €"), the listed ones without an amount named. Neither
   * given: every currency the amount has.
   */
  currencies?: readonly string[];
  /** Names of the amount keys' markets ("EUR@sk" → "Slovensko"); absent = the market's handle. */
  labels?: AmountLabels;
}

/** The currencies a tier break's amount is described in (`opts`), and those of them it has an amount for. */
function tierCurrencies(b: DescribableTierBreak, opts: DescribeTierOptions): { listed: string[]; shown: string[] } {
  const amount = b.amountOff ?? {};
  const listed = opts.currency !== undefined ? [opts.currency] : [...(opts.currencies ?? Object.keys(amount))];
  return { listed, shown: shownCurrencies(amount, listed) };
}

/**
 * What a tier break takes off each item: "−10 %" · "−10%" · "−50 Kč za kus" ·
 * "−CZK 50 / €2 per item" (the currencies as describeTierBreak picks them);
 * "" when none of them has an amount. A percent wins over an amount.
 */
export function describeTierValue(b: DescribableTierBreak, opts: DescribeTierOptions): string {
  const { locale } = opts;
  if (typeof b.percent === "number") return `−${formatPercent(b.percent, locale)}`;
  const { shown } = tierCurrencies(b, opts);
  if (shown.length === 0) return "";
  return `−${formatAmounts(b.amountOff ?? {}, shown, locale, opts.labels)} ${locale === "cs" ? "za kus" : "per item"}`;
}

/** "od 3 ks −10 %" (lower case: describeTierSet joins them; describeTierBreak capitalizes). */
function tierBreakPhrase(b: DescribableTierBreak, opts: DescribeTierOptions): string {
  const { locale } = opts;
  const cs = locale === "cs";
  const from = cs ? `od ${b.minQty} ks` : `from ${b.minQty} ${enPlural(b.minQty, "item", "items")}`;
  // A percent wins over an amount (config/tiers.ts keeps the percent).
  if (typeof b.percent === "number") return `${from} ${describeTierValue(b, opts)}`;
  const { listed, shown } = tierCurrencies(b, opts);
  const missing = listed.filter((c) => !shown.includes(c));
  const notOffered = missing.length === 0 ? "" : ` (${notOfferedPhrase(missing, locale, opts.labels)})`;
  if (shown.length === 0) return missing.length > 0 ? `${from}${notOffered}` : `${from} ${cs ? "(bez hodnoty)" : "(no value)"}`;
  return `${from} ${describeTierValue(b, opts)}${notOffered}`;
}

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/**
 * A tier break margin protection lowered (MVP 3 audit, E2E): its name without
 * a value, so a checkout message never states more than the line gets —
 * "Množstevní sleva od 5 ks" / "Quantity discount from 5 items".
 */
export function describeCappedTierBreak(b: { minQty: number }, opts: { locale: UiLocale }): string {
  return opts.locale === "cs"
    ? `Množstevní sleva od ${b.minQty} ks`
    : `Quantity discount from ${b.minQty} ${enPlural(b.minQty, "item", "items")}`;
}

/**
 * One quantity break in words: "Od 3 ks −10 %" · "From 3 items −10%" ·
 * "Od 2 ks −50 Kč za kus" · "From 5 items (not offered in EUR)" (MKT-1).
 */
export function describeTierBreak(b: DescribableTierBreak, opts: DescribeTierOptions): string {
  return capitalize(tierBreakPhrase(b, opts));
}

/**
 * A tier set's breaks in one line, ascending (admin headers §17a, explain):
 * "Od 3 ks −10 %, od 5 ks −15 %" / "From 3 items −10%, from 5 items −15%";
 * an amount per item in the given currency (or the listed ones, admin view);
 * no break: "Bez množstevních slev" / "No quantity tiers".
 */
export function describeTierSet(set: { readonly breaks: readonly DescribableTierBreak[] }, opts: DescribeTierOptions): string {
  if (set.breaks.length === 0) return opts.locale === "cs" ? "Bez množstevních slev" : "No quantity tiers";
  const phrases = [...set.breaks].sort((a, b) => a.minQty - b.minQty).map((b) => tierBreakPhrase(b, opts));
  return capitalize(phrases.join(", "));
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

// --- Margin protection (MVP 2) -----------------------------------------------------------------

/** Why margin protection lowered a discount (plan.ts PlanLineMarginCap carries these fields). */
export interface MarginReason {
  basis: "cost" | "max_percent";
  minMarginPercent?: number;
  maxDiscountPercent?: number;
  source: "global" | "collection";
}

/**
 * The reason in words, for the admin (it names the cost price and the margin,
 * which a shopper must never see): "cena neklesne pod nákupní cenu s minimální
 * marží 20 %" · "položka nemá nákupní cenu, proto je sleva nejvýš 30 %", plus
 * " (nastavení kolekce)" when a collection's own setting applied.
 */
export function describeMarginReason(reason: MarginReason, locale: UiLocale): string {
  const cs = locale === "cs";
  let text: string;
  if (reason.basis === "cost") {
    const m = reason.minMarginPercent ?? 0;
    text = cs ? "cena neklesne pod nákupní cenu" : "the price stays above the cost price";
    if (m > 0) {
      const percent = formatPercent(m, locale);
      text += cs ? ` s minimální marží ${percent}` : ` with a minimum margin of ${percent}`;
    }
  } else {
    const percent = formatPercent(reason.maxDiscountPercent ?? 0, locale);
    text = cs ? `položka nemá nákupní cenu, proto je sleva nejvýš ${percent}` : `the item has no cost price, so the discount is at most ${percent}`;
  }
  if (reason.source === "collection") text += cs ? " (nastavení kolekce)" : " (collection setting)";
  return text;
}

/** The fields of the margin module a one-line summary needs (config MarginModule). */
export interface DescribableMargin {
  enabled: boolean;
  global: { readonly minMarginPercent?: number; readonly maxDiscountPercent: number };
  perCollection: readonly unknown[];
}

/**
 * The margin module in one line for admin headers (§17a): "Ochrana marže je
 * vypnutá" · "Min. marže 20 % · bez nákupní ceny sleva nejvýš 40 % · 1 kolekce
 * s vlastním nastavením".
 */
export function describeMarginSettings(margin: DescribableMargin, locale: UiLocale): string {
  const cs = locale === "cs";
  if (!margin.enabled) return cs ? "Ochrana marže je vypnutá" : "Margin protection is off";
  const m = margin.global.minMarginPercent ?? 0;
  const p = formatPercent(margin.global.maxDiscountPercent, locale);
  const parts = [
    m > 0
      ? cs
        ? `Min. marže ${formatPercent(m, locale)}`
        : `Minimum margin ${formatPercent(m, locale)}`
      : cs
        ? "Nikdy pod nákupní cenu"
        : "Never below the cost price",
    cs ? `bez nákupní ceny sleva nejvýš ${p}` : `without a cost price at most ${p} off`,
  ];
  const n = margin.perCollection.length;
  if (n > 0) {
    parts.push(
      cs
        ? `${n} ${csPlural(n, ["kolekce", "kolekce", "kolekcí"])} s vlastním nastavením`
        : `${n} ${enPlural(n, "collection", "collections")} with ${n === 1 ? "its" : "their"} own setting`,
    );
  }
  return parts.join(" · ");
}
