// Admin i18n (doctrine A10): Czech or English, following the Shopify admin
// language. Pure functions only (no React) so loaders, actions, formatters and
// tests share one lookup; the React side lives in ./context.tsx.

import { amountKeyCurrency } from "@won/core/discounts/money";
import { cs } from "./cs";
import { en } from "./en";

export type Locale = "cs" | "en";
export type MessageKey = keyof typeof cs;
export type MessageParams = Readonly<Record<string, string | number>>;

export const DEFAULT_LOCALE: Locale = "cs";

export const CATALOGUES: Readonly<Record<Locale, Readonly<Record<MessageKey, string>>>> = { cs, en };

/**
 * The admin language Shopify hands the embedded app (`?locale=cs`, `cs-CZ`, …)
 * → our catalogue. Czech for Czech; Slovak admins also get Czech (closer to
 * them than English, and the app's home market); everything else English. An
 * absent value keeps the default (the harness and unit renders).
 */
export function resolveLocale(raw: string | null | undefined): Locale {
  if (!raw) return DEFAULT_LOCALE;
  const base = raw.trim().toLowerCase().split(/[-_]/)[0];
  if (base === "cs" || base === "sk") return "cs";
  return base ? "en" : DEFAULT_LOCALE;
}

const NUMBER_FORMATS: Readonly<Record<Locale, Intl.NumberFormat>> = {
  cs: new Intl.NumberFormat("cs-CZ", { maximumFractionDigits: 6 }),
  en: new Intl.NumberFormat("en-US", { maximumFractionDigits: 6 }),
};

/**
 * A NUMERIC param in the admin's number format (MVP 2 audit fix round 2):
 * cs "1 240" (a no-break space groups thousands) and "12,5"; en "1,240".
 * Ids, codes, years and versions are passed as STRINGS, so they are never
 * grouped; a string param is inserted as it is.
 */
export function formatNumberParam(locale: Locale, value: number): string {
  return Number.isFinite(value) ? (NUMBER_FORMATS[locale] ?? NUMBER_FORMATS[DEFAULT_LOCALE]).format(value) : String(value);
}

/** `{name}` → params.name (numbers in the admin's format). An unknown placeholder stays visible, never silently empty. */
function interpolate(locale: Locale, template: string, params?: MessageParams): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (whole, name: string) => {
    if (!Object.prototype.hasOwnProperty.call(params, name)) return whole;
    const value = params[name];
    // An amount key of one market ("EUR@sk", amounts per market) is said as its currency: the market is named next to it.
    if (name === "currency" && typeof value === "string") return amountKeyCurrency(value);
    return typeof value === "number" ? formatNumberParam(locale, value) : String(value);
  });
}

export function t(locale: Locale, key: MessageKey, params?: MessageParams): string {
  const catalogue = CATALOGUES[locale] ?? CATALOGUES[DEFAULT_LOCALE];
  return interpolate(CATALOGUES[locale] ? locale : DEFAULT_LOCALE, catalogue[key] ?? CATALOGUES[DEFAULT_LOCALE][key] ?? key, params);
}

/** Plural category: Czech 1 / 2–4 / other; English 1 / other (`.few` repeats `.other`). */
export function pluralCategory(locale: Locale, n: number): "one" | "few" | "other" {
  const abs = Math.abs(n);
  if (abs === 1) return "one";
  if (locale === "cs" && Number.isInteger(abs) && abs >= 2 && abs <= 4) return "few";
  return "other";
}

/** Keys that have `.one/.few/.other` variants, without the suffix. */
export type PluralBase = {
  [K in MessageKey]: K extends `${infer Base}.one` ? Base : never;
}[MessageKey];

/** Plural lookup: tp("cs", "count.rule", 2) → "2 pravidla". `{n}` is always filled. */
export function tp(locale: Locale, base: PluralBase, n: number, params?: MessageParams): string {
  const key = `${base}.${pluralCategory(locale, n)}` as MessageKey;
  return t(locale, key, { n, ...params });
}

/** "A, B a C" / "A, B and C". */
export function joinList(locale: Locale, items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  const head = items.slice(0, -1).join(t(locale, "common.listJoin"));
  return `${head}${t(locale, "common.listLast")}${items[items.length - 1]}`;
}

/** A locale bound to the lookups, for formatters and components. */
export interface Translator {
  locale: Locale;
  t: (key: MessageKey, params?: MessageParams) => string;
  tp: (base: PluralBase, n: number, params?: MessageParams) => string;
  list: (items: readonly string[]) => string;
}

export function translator(locale: Locale): Translator {
  return {
    locale,
    t: (key, params) => t(locale, key, params),
    tp: (base, n, params) => tp(locale, base, n, params),
    list: (items) => joinList(locale, items),
  };
}
