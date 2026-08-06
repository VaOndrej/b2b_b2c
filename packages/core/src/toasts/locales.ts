// Locale-as-data. The product ships ONE default language (en) as the fallback;
// merchants add any BCP-47 locales they want (tiered: Free 2, Pro many). The
// storefront resolves a shopper's locale against the merchant's per-locale
// strings with a language→default fallback chain. No specific non-default
// language is ever baked into the product (doctrine §5).

/** BCP-47 code the merchant edits/ships, plus the fallback pointer. */
export interface LocaleSettings {
  /** Locales the merchant edits; always includes `defaultLocale` as the first. */
  enabledLocales: string[];
  /** Fallback used when a shopper's locale has no string. */
  defaultLocale: string;
}

export const DEFAULT_LOCALE = "en";

export const DEFAULT_LOCALE_SETTINGS: LocaleSettings = {
  enabledLocales: [DEFAULT_LOCALE],
  defaultLocale: DEFAULT_LOCALE,
};

/** Per-plan cap on how many languages a merchant may ship. */
export const LOCALE_LIMIT_FREE = 2;
export const LOCALE_LIMIT_PRO = 20;

export function localeLimit(plan: "free" | "pro"): number {
  return plan === "pro" ? LOCALE_LIMIT_PRO : LOCALE_LIMIT_FREE;
}

/**
 * Normalise a locale tag for matching: trim, lowercase, hyphen-separated.
 * Returns "" for anything that isn't a plausible BCP-47 tag. Kept forgiving
 * (language + optional subtags) but bounded so junk can't become a key.
 */
export function normalizeLocale(code: unknown): string {
  if (typeof code !== "string") return "";
  const t = code.trim().toLowerCase().replace(/_/g, "-");
  if (!/^[a-z]{2,3}(-[a-z0-9]{2,8})*$/.test(t)) return "";
  return t;
}

/** Primary language subtag, e.g. "pt-br" → "pt". "" if invalid. */
export function localeLanguage(code: unknown): string {
  const n = normalizeLocale(code);
  return n ? n.split("-")[0] : "";
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Pick the best string for a shopper's locale from a per-locale map. Chain:
 * exact normalized locale → same language (any region) → default locale →
 * default language → (optionally) any non-empty → "".
 *
 * `allowAny` (default true) permits the final "any non-empty" catch-all. Callers
 * that have their own fallback (e.g. an announcement's base `message`) pass
 * `false` so an unrelated language never wins over that fallback — a German
 * shopper must see the English base, not a stray Czech string.
 */
export function resolveLocalizedText(
  byLocale: Partial<Record<string, string>> | undefined,
  shopperLocale: unknown,
  defaultLocale: unknown = DEFAULT_LOCALE,
  options: { allowAny?: boolean } = {},
): string {
  if (!isPlainObject(byLocale)) return "";
  const allowAny = options.allowAny !== false;
  const pick = (k: string): string => {
    const v = byLocale[k];
    return typeof v === "string" && v.trim() ? v : "";
  };

  const want = normalizeLocale(shopperLocale);
  if (want && pick(want)) return byLocale[want] as string;

  const lang = localeLanguage(shopperLocale);
  if (lang) {
    if (pick(lang)) return byLocale[lang] as string;
    for (const k of Object.keys(byLocale)) {
      if (localeLanguage(k) === lang && pick(k)) return byLocale[k] as string;
    }
  }

  const def = normalizeLocale(defaultLocale) || DEFAULT_LOCALE;
  if (pick(def)) return byLocale[def] as string;
  const defLang = localeLanguage(def);
  if (defLang && pick(defLang)) return byLocale[defLang] as string;

  if (allowAny) {
    for (const k of Object.keys(byLocale)) {
      if (pick(k)) return byLocale[k] as string;
    }
  }
  return "";
}

/** Keep the default locale + up to `limit` total, preserving order & dedup. */
export function capLocales(locales: string[], limit: number): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of locales) {
    const n = normalizeLocale(raw);
    if (n && !seen.has(n)) {
      seen.add(n);
      out.push(n);
    }
    if (out.length >= limit) break;
  }
  return out;
}

/**
 * Validate merchant locale settings: normalise + dedupe enabledLocales, force
 * the default locale to be present and first, and cap the count at the Pro
 * ceiling (the Free cap is applied later, per-plan, in gateConfigForPlan — same
 * pattern as milestones). Falls back to the English default when empty/invalid.
 */
export function sanitizeLocaleSettings(input: unknown): LocaleSettings {
  const obj = isPlainObject(input) ? input : {};
  const def = normalizeLocale(obj.defaultLocale) || DEFAULT_LOCALE;
  const rawList = Array.isArray(obj.enabledLocales) ? obj.enabledLocales : [];
  // Default always leads so it survives any cap and is never dropped.
  const enabled = capLocales([def, ...rawList], LOCALE_LIMIT_PRO);
  return { enabledLocales: enabled.length ? enabled : [DEFAULT_LOCALE], defaultLocale: def };
}

/** Apply a plan's language cap (keeps the default locale). */
export function capLocaleSettingsForPlan(
  settings: LocaleSettings,
  plan: "free" | "pro",
): LocaleSettings {
  const enabled = capLocales(
    [settings.defaultLocale, ...settings.enabledLocales],
    localeLimit(plan),
  );
  return { enabledLocales: enabled, defaultLocale: settings.defaultLocale };
}
