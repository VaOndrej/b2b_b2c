// Human formatting shared by explainPlan, checkout messages and admin headers
// (doctrine §4c: never an enum key on screen; §17a: describe*() formatters live
// in core). No `Intl`: this code also runs inside the Shopify JS function, whose
// runtime is not guaranteed to ship it, so money/percent/date are formatted by hand.

import type { PlanLocale } from "./cart.ts";
import type { DiscountMethod, DiscountRuleValue, DiscountTargetKind } from "./config.ts";
import { currencyExponent, type MoneyByCurrency, moneyFor } from "./money.ts";

export type UiLocale = PlanLocale;

const NBSP = " ";

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
  minimum?: { readonly subtotal?: MoneyByCurrency; readonly quantity?: number };
}

function firstCurrency(amount: MoneyByCurrency): string | undefined {
  return Object.keys(amount)[0];
}

/** "10 % z objednávky" / "10% off the order" — value and target only. */
function describeValue(rule: DescribableRule, locale: UiLocale, currency: string | undefined): string {
  const cs = locale === "cs";
  const target = rule.target.kind;
  const value = rule.value;
  if (value.kind === "freeShipping") return cs ? "Doprava zdarma" : "Free shipping";
  if (value.kind === "percentage") {
    const p = formatPercent(value.percent, locale);
    if (cs) {
      return {
        order: `${p} z objednávky`,
        products: `${p} na vybrané produkty`,
        collections: `${p} na vybrané kolekce`,
        shipping: `${p} z dopravy`,
      }[target];
    }
    return {
      order: `${p} off the order`,
      products: `${p} off selected products`,
      collections: `${p} off selected collections`,
      shipping: `${p} off shipping`,
    }[target];
  }
  const code = currency ?? firstCurrency(value.amount);
  const minor = code ? moneyFor(value.amount, code) : null;
  if (code === undefined || minor === null) {
    const which = code ?? "";
    return cs ? `Pevná sleva (pro ${which} bez hodnoty)` : `Fixed amount (no value for ${which})`;
  }
  const m = formatMoney(minor, code, locale);
  if (cs) {
    return {
      order: `${m} z objednávky`,
      products: `${m} z každého kusu vybraných produktů`,
      collections: `${m} z každého kusu z vybraných kolekcí`,
      shipping: `${m} z dopravy`,
    }[target];
  }
  return {
    order: `${m} off the order`,
    products: `${m} off each selected item`,
    collections: `${m} off each item in selected collections`,
    shipping: `${m} off shipping`,
  }[target];
}

const MAX_CODES_SHOWN = 3;

function describeMethod(rule: DescribableRule, locale: UiLocale): string {
  const cs = locale === "cs";
  if (rule.method === "automatic") return cs ? "automaticky" : "automatic";
  const codes = rule.codes ?? [];
  if (codes.length === 0) return cs ? "kódem" : "by code";
  const shown = codes.slice(0, MAX_CODES_SHOWN).join(", ");
  const more = codes.length - MAX_CODES_SHOWN;
  const tail = more > 0 ? (cs ? ` a ${more} další` : ` and ${more} more`) : "";
  const label = codes.length === 1 ? (cs ? "kód" : "code") : cs ? "kódy" : "codes";
  return `${label} ${shown}${tail}`;
}

/**
 * One-line summary of a rule for admin headers (§17a) — "10 % z objednávky · kódy
 * LETO, ZIMA · od 1 000 Kč". `currency` picks which per-currency amount to show
 * (the first one when omitted). `short` gives just the value and target, used as
 * the checkout message fallback when a rule has no name.
 */
export function describeRule(
  rule: DescribableRule,
  locale: UiLocale,
  currency?: string,
  opts: { short?: boolean } = {},
): string {
  const parts = [describeValue(rule, locale, currency)];
  if (opts.short) return parts[0];
  parts.push(describeMethod(rule, locale));
  const cs = locale === "cs";
  const subtotal = rule.minimum?.subtotal;
  if (subtotal && Object.keys(subtotal).length > 0) {
    const code = currency ?? firstCurrency(subtotal);
    const minor = code ? moneyFor(subtotal, code) : null;
    if (code && minor !== null) {
      parts.push(cs ? `od ${formatMoney(minor, code, locale)}` : `orders from ${formatMoney(minor, code, locale)}`);
    } else if (code) {
      parts.push(cs ? `v ${code} se nenabízí (minimum bez hodnoty)` : `not offered in ${code} (no minimum amount)`);
    }
  }
  const quantity = rule.minimum?.quantity ?? 0;
  if (quantity > 0) parts.push(cs ? `od ${quantity} ks` : `from ${quantity} ${enPlural(quantity, "item", "items")}`);
  return parts.join(" · ");
}
