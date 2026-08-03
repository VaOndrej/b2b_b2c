// Message templates — merchant-editable toast text with placeholders, plus
// correct pluralization for cs/sk/en. Pure + tested; used by the storefront
// renderer, the admin preview, and the message editor.

export type TemplateLocale = "cs" | "sk" | "en";

export type TemplateVars = Record<string, string | number | null | undefined>;

const PLACEHOLDER = /\{(\w+)\}/g;

/** Substitute {placeholders}; unknown/undefined vars render as empty string. */
export function renderTemplate(template: string, vars: TemplateVars): string {
  if (typeof template !== "string") return "";
  return template.replace(PLACEHOLDER, (_, key: string) => {
    const value = vars[key];
    return value === undefined || value === null ? "" : String(value);
  });
}

export type PluralCategory = "one" | "few" | "many" | "other";

/**
 * CLDR-ish plural category for the count. English collapses to one/other; Czech
 * and Slovak use one (1), few (2–4), other (0, 5+). Decimals fall back to other.
 */
export function pluralCategory(
  count: number,
  locale: TemplateLocale,
): PluralCategory {
  const n = Math.abs(count);
  if (!Number.isInteger(n)) return "other";
  if (locale === "en") return n === 1 ? "one" : "other";
  // cs + sk share this rule for integers
  if (n === 1) return "one";
  if (n >= 2 && n <= 4) return "few";
  return "other";
}

/** Pick the correct plural form for a count and locale. */
export function plural(
  count: number,
  forms: Partial<Record<PluralCategory, string>>,
  locale: TemplateLocale,
): string {
  const category = pluralCategory(count, locale);
  return forms[category] ?? forms.other ?? forms.one ?? "";
}
