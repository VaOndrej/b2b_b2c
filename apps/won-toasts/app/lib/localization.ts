import type { ToastMessages } from "@won/core/toasts/config.types";

// Languages offered as one-click checkboxes on the Languages page. Any other
// locale can still be typed in freely (locale-as-data).
export const COMMON_LOCALES: { code: string; label: string }[] = [
  { code: "en", label: "English" },
  { code: "cs", label: "Čeština" },
  { code: "sk", label: "Slovenčina" },
  { code: "de", label: "Deutsch" },
  { code: "fr", label: "Français" },
  { code: "es", label: "Español" },
  { code: "it", label: "Italiano" },
  { code: "pl", label: "Polski" },
  { code: "nl", label: "Nederlands" },
  { code: "pt-br", label: "Português (BR)" },
  { code: "hu", label: "Magyar" },
  { code: "ro", label: "Română" },
];

// Message ownership is split across two pages: the Toasts page edits the DEFAULT
// locale (the source copy, kept compact), and the Languages page edits the
// translations. Each save must therefore MERGE its slice into the stored map —
// a full replace would drop the locales the other page owns. `edits` carries the
// exact locales the saving page touched; an empty string clears that cell.
export function mergeMessages(
  base: ToastMessages,
  edits: Record<string, Record<string, string>>,
): ToastMessages {
  const out: Record<string, Record<string, string>> = {};
  for (const [type, perLocale] of Object.entries(base ?? {})) {
    out[type] = { ...(perLocale as Record<string, string>) };
  }
  for (const [type, localeEdits] of Object.entries(edits)) {
    const current = { ...(out[type] ?? {}) };
    for (const [locale, raw] of Object.entries(localeEdits)) {
      const value = raw.trim();
      if (value) current[locale] = value;
      else delete current[locale];
    }
    if (Object.keys(current).length > 0) out[type] = current;
    else delete out[type];
  }
  return out as ToastMessages;
}

// Compute the announcement rule's per-locale translation map after a Languages
// save. The default copy lives in the rule's `message` (edited on Toasts), so
// this map holds ONLY translations: the default locale is stripped, blanks are
// cleared, and removed languages are dropped. Returns undefined when empty (so the
// stored rule stays clean). Pure so the save path can be unit-tested.
export function updateAnnouncementTranslations(
  existing: Record<string, string | undefined> | undefined,
  edits: Record<string, string>,
  defaultLocale: string,
  enabledLocales: string[],
): Record<string, string> | undefined {
  const out: Record<string, string> = {};
  for (const [locale, value] of Object.entries(existing ?? {})) {
    if (typeof value === "string") out[locale] = value;
  }
  for (const [locale, raw] of Object.entries(edits)) {
    const value = raw.trim();
    if (value) out[locale] = value;
    else delete out[locale];
  }
  delete out[defaultLocale];
  const allowed = new Set(enabledLocales);
  for (const locale of Object.keys(out)) {
    if (!allowed.has(locale)) delete out[locale];
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

// Drop translations for locales the merchant no longer has enabled, so removing a
// language doesn't leave dead copy behind in the stored config.
export function pruneMessages(
  messages: ToastMessages,
  allowedLocales: string[],
): ToastMessages {
  const allowed = new Set(allowedLocales);
  const out: Record<string, Record<string, string>> = {};
  for (const [type, perLocale] of Object.entries(messages ?? {})) {
    const kept: Record<string, string> = {};
    for (const [locale, value] of Object.entries(perLocale as Record<string, string>)) {
      if (allowed.has(locale)) kept[locale] = value;
    }
    if (Object.keys(kept).length > 0) out[type] = kept;
  }
  return out as ToastMessages;
}
