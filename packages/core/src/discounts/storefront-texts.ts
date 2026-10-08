// The storefront texts a merchant changed, per language (feedback 2026-10-06, body 11–14; measured in
// docs/won-discounts/navrh-preklady-a-vzhled.md). Stored in the config as `locales[<locale>][<text key>]`, with
// `storefront.languages` = the languages the merchant translates, the shop's default first.
//
// On the storefront every language is its OWN app-data metafield (`won_discounts` / `tx_<locale>`): one language
// alone can take 57 kB, and a page reads only the one it is shown in. The storefront config carries no texts.
//
//   textLanguages(config)             the languages in the merchant's order (then any stored one not listed);
//   languagesForPlan(config, plan)    the ones the plan ships: Free the first LANGUAGE_LIMIT_FREE, Pro all;
//   storefrontTexts(gated)            {locale: {key: text}} of the GATED config — only non-empty texts, a language
//                                     without one is left out (the sync then removes its metafield);
//   storefrontTextIssue(key, ref, t)  why a text cannot be saved (a placeholder missing or added, …), or null.

import { capLocales } from "../toasts/locales.ts";
import { CONFIG_LIMITS } from "./config/limits.ts";
import type { ReadonlyDeep, WonDiscountsConfig } from "./config/types.ts";

/** App-data metafield key of one language's texts: `tx_<locale>` (namespace STOREFRONT_CONFIG_NAMESPACE). */
export const STOREFRONT_TEXTS_KEY_PREFIX = "tx_";

/** Languages a Free shop's storefront gets: the default one and one more. Pro: every language. */
export const LANGUAGE_LIMIT_FREE = 2;

export function storefrontTextsKey(locale: string): string {
  return `${STOREFRONT_TEXTS_KEY_PREFIX}${locale}`;
}

type TextsConfig = ReadonlyDeep<Pick<WonDiscountsConfig, "storefront" | "locales">>;

const hasText = (texts: ReadonlyDeep<Record<string, string>> | undefined): boolean => Object.values(texts ?? {}).some((text) => typeof text === "string" && text !== "");

/**
 * The languages the merchant translates, in their order: `storefront.languages` (the shop's default first), then
 * any language with a stored text that the list does not name (a config older than the list) in stored order.
 */
export function textLanguages(config: TextsConfig): string[] {
  const stored = Object.keys(config.locales).filter((locale) => hasText(config.locales[locale]));
  return capLocales([...(config.storefront.languages ?? []), ...stored], CONFIG_LIMITS.languages);
}

/** The languages whose texts the plan puts on the storefront. */
export function languagesForPlan(config: TextsConfig, plan: "free" | "pro"): string[] {
  const all = textLanguages(config);
  return plan === "pro" ? all : all.slice(0, LANGUAGE_LIMIT_FREE);
}

/** Per language the texts the storefront gets: non-empty ones; a language without any is absent. Pure. */
export function storefrontTexts(gated: TextsConfig): Record<string, Record<string, string>> {
  const out: Record<string, Record<string, string>> = {};
  for (const locale of textLanguages(gated)) {
    const changed: Record<string, string> = {};
    for (const [key, text] of Object.entries(gated.locales[locale] ?? {})) {
      if (typeof text === "string" && text !== "" && key !== "__proto__") changed[key] = text;
    }
    if (Object.keys(changed).length > 0) out[locale] = changed;
  }
  return out;
}

// --- What a text may say ---------------------------------------------------------------------------

/**
 * A merchant's own name of a Milníky discount step, per language: the text key `cart.ms_name.<rule id>`. The
 * ladder shows it instead of "Sleva {value}"; it may use `{value}` and nothing else.
 */
export const MILESTONE_NAME_KEY = "cart.ms_name.";

export function milestoneNameKey(ruleId: string): string {
  return `${MILESTONE_NAME_KEY}${ruleId}`;
}

/** The `{name}` parts of a text, each once, sorted. */
export function placeholdersOf(text: string): string[] {
  return [...new Set(Array.from(text.matchAll(/\{([a-z_]+)\}/g), (m) => m[1]))].sort();
}

export type StorefrontTextIssue =
  | { reason: "too_long"; max: number }
  /** `{…}` parts the extension's text has and this one lacks / has on top. */
  | { reason: "placeholders"; missing: string[]; extra: string[] }
  /** `campaign.units`: the countdown needs exactly four units separated by commas. */
  | { reason: "units" };

/**
 * Why `text` cannot replace the extension's `reference` under `key`, or null. An empty text is always fine (it
 * means "the extension's own"). The storefront fills the `{…}` parts in by name, so a text must use exactly the
 * reference's: one missing would drop the price or the amount, an unknown one would be shown as typed.
 */
export function storefrontTextIssue(key: string, reference: string, text: string): StorefrontTextIssue | null {
  if (text === "") return null;
  if (text.length > CONFIG_LIMITS.localeStringLength) return { reason: "too_long", max: CONFIG_LIMITS.localeStringLength };
  if (key === "campaign.units") return text.split(",").length === 4 && text.split(",").every((unit) => unit.trim() !== "") ? null : { reason: "units" };
  const used = placeholdersOf(text);
  if (key.startsWith(MILESTONE_NAME_KEY)) {
    const extra = used.filter((name) => name !== "value");
    return extra.length > 0 ? { reason: "placeholders", missing: [], extra } : null;
  }
  const wanted = placeholdersOf(reference);
  const missing = wanted.filter((name) => !used.includes(name));
  const extra = used.filter((name) => !wanted.includes(name));
  return missing.length > 0 || extra.length > 0 ? { reason: "placeholders", missing, extra } : null;
}
