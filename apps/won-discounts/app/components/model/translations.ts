// Překlady (feedback 2026-10-06, body 11, 12, 14): the texts a customer sees, one table per storefront language.
// A row is one text of the theme app extension, named by where it shows (never by its key), with the extension's
// own text as the default; an empty field = that default. Rules a text must keep (the `{…}` parts, the length) are
// core's (storefront-texts.ts): the page says them next to the field, the server refuses the save.
// Export and import as CSV are Pro; an import is planned first (what changes, what is refused and why) and saved
// only when the merchant confirms. Pure; tests/ui/translations.test.ts.

import { CONFIG_LIMITS } from "@won/core/discounts/config";
import { LANGUAGE_LIMIT_FREE, MILESTONE_NAME_KEY, storefrontTextIssue } from "@won/core/discounts/storefront-texts";
import { normalizeLocale } from "@won/core/toasts/locales";

import type { MessageKey, Translator } from "../../i18n";
import type { FormDataLike } from "./rule-form";
import type { FieldError } from "./types";

export const TRANSLATIONS_ACTION = "/app/translations";

export const TRANSLATIONS_FIELD = {
  intent: "intent",
  configVersion: "configVersion",
  replaceUnreadable: "replaceUnreadable",
  /** One per table, in the page's order (the shop's default language first). */
  language: "lang",
  /** `tx.<locale>.<key>`: a text the merchant changed ("" = the extension's own). */
  text: "tx.",
  /** The CSV text of an import. */
  csv: "csv",
} as const;

export const TRANSLATIONS_INTENT = { save: "save", exportCsv: "export", importPreview: "import-preview", importApply: "import-apply", scopes: "scopes" } as const;

/** Where a text shows on the storefront: the tables' sections, in the page's order. */
export const TEXT_GROUPS = ["tiers", "milestones", "cart", "outlet", "campaigns", "cards"] as const;
export type TextGroup = (typeof TEXT_GROUPS)[number];

export function textGroup(key: string): TextGroup {
  if (key.startsWith("tiers.")) return "tiers";
  if (key.startsWith("cart.ms_")) return "milestones";
  if (key.startsWith("outlet.")) return "outlet";
  if (key.startsWith("campaign.")) return "campaigns";
  if (key.startsWith("cards.")) return "cards";
  return "cart";
}

/** The languages the extension has its own texts in; every other language shows the English ones. */
export const DEFAULT_TEXT_LANGS = ["cs", "sk", "en"] as const;
export type DefaultTextLang = (typeof DEFAULT_TEXT_LANGS)[number];

export interface TextRow {
  key: string;
  /** The extension's own text per language it ships. */
  defaults: Record<DefaultTextLang, string>;
  /** A Milníky discount step's own name (`cart.ms_name.<id>`): the step in words ("Sleva 10 % od 2 000 Kč"). */
  step?: string;
}

/** The extension's language a storefront language falls back to: its own, else English (what Shopify does). */
export function defaultTextLang(locale: string): DefaultTextLang {
  const base = locale.split("-")[0];
  return base === "cs" || base === "sk" ? base : "en";
}

/** Does the extension ship its own texts in this language (else the storefront falls back to its English ones)? */
export function isDefaultTextLang(locale: string): boolean {
  return (DEFAULT_TEXT_LANGS as readonly string[]).includes(locale.split("-")[0] ?? "");
}

/** The text the storefront shows in `locale` while the merchant's field is empty. */
export function textDefault(row: TextRow, locale: string): string {
  return row.defaults[defaultTextLang(locale)];
}

/** A text's name for the merchant: where the customer sees it. */
export function textLabel(row: TextRow, tr: Translator): string {
  if (row.key.startsWith(MILESTONE_NAME_KEY)) return tr.t("translations.text.cart.ms_name", { step: row.step ?? "" });
  return tr.t(`translations.text.${row.key}` as MessageKey);
}

export function groupLabel(group: TextGroup, tr: Translator): string {
  return tr.t(`translations.group.${group}` as MessageKey);
}

/** A language's name in the admin language ("slovenština"); the code when the browser has no name for it. */
export function languageName(code: string, tr: Translator): string {
  try {
    const name = new Intl.DisplayNames([tr.locale], { type: "language" }).of(code);
    return name && name.toLowerCase() !== code.toLowerCase() ? name : code;
  } catch {
    return code;
  }
}

export function textField(locale: string, key: string): string {
  return `${TRANSLATIONS_FIELD.text}${locale}.${key}`;
}

/** Storefront languages a plan may add; null = no limit. Languages stored before a downgrade stay editable. */
export function languageLimit(plan: "free" | "pro"): number | null {
  return plan === "pro" ? null : LANGUAGE_LIMIT_FREE;
}

/** The languages past the plan's limit: stored, but the storefront shows the extension's own text for them. */
export function languagesNotShipped(languages: readonly string[], plan: "free" | "pro"): string[] {
  const limit = languageLimit(plan);
  return limit === null ? [] : languages.slice(limit);
}

/** Why a text cannot be saved, in the admin's words; null = fine. `reference` = the extension's own text. */
export function textError(key: string, reference: string, value: string): Omit<FieldError, "field"> | null {
  const issue = storefrontTextIssue(key, reference, value);
  if (!issue) return null;
  if (issue.reason === "too_long") return { key: "translations.error.tooLong", params: { max: issue.max } };
  if (issue.reason === "units") return { key: "translations.error.units" };
  const braces = (names: string[]) => names.map((name) => `{${name}}`).join(", ");
  if (issue.missing.length > 0) return { key: "translations.error.missing", params: { parts: braces(issue.missing) } };
  return { key: "translations.error.extra", params: { parts: braces(issue.extra) } };
}

export interface TranslationsForm {
  /** The tables, in the page's order. */
  languages: string[];
  /** Per language the fields the form carried (trimmed; "" = back to the extension's own). */
  texts: Record<string, Record<string, string>>;
}

/**
 * The form as the server reads it (SEC-1): the languages are locale codes, each once, at most
 * CONFIG_LIMITS.languages; only the rows' keys are read; every text is checked against the extension's own.
 */
export function readTranslationsForm(form: FormDataLike, rows: readonly TextRow[]): { ok: true; form: TranslationsForm } | { ok: false; errors: FieldError[] } {
  const errors: FieldError[] = [];
  const languages: string[] = [];
  for (const raw of form.getAll(TRANSLATIONS_FIELD.language)) {
    const locale = normalizeLocale(raw);
    if (locale === "" || languages.length >= CONFIG_LIMITS.languages) errors.push({ field: TRANSLATIONS_FIELD.language, key: "translations.error.language" });
    else if (!languages.includes(locale)) languages.push(locale);
  }
  const texts: TranslationsForm["texts"] = {};
  for (const locale of languages) {
    texts[locale] = {};
    for (const row of rows) {
      const field = textField(locale, row.key);
      const raw = form.get(field);
      if (raw === null) continue;
      const value = String(raw).trim();
      const error = textError(row.key, textDefault(row, locale), value);
      if (error) errors.push({ field, ...error });
      else texts[locale][row.key] = value;
    }
  }
  return errors.length > 0 ? { ok: false, errors } : { ok: true, form: { languages, texts } };
}

/** How many texts are changed (non-empty) in one language. */
export function changedCount(values: Readonly<Record<string, string>> | undefined, rows: readonly TextRow[]): number {
  return rows.filter((row) => (values?.[row.key] ?? "").trim() !== "").length;
}

/**
 * How many texts a customer reading `locale` gets in another language (feedback 9 Oct 2026: "jestli mám překlady
 * hotové"). A language the extension has its own texts in is always complete; any other one shows the English
 * text wherever the merchant has none of their own. `own` = the merchant's texts in that language (the rows'
 * values, or their count when only the count is known).
 */
export function missingTexts(locale: string, own: Readonly<Record<string, string>> | number | undefined, rows: readonly TextRow[] | number): number {
  if (isDefaultTextLang(locale)) return 0;
  const total = typeof rows === "number" ? rows : rows.length;
  const have = typeof own === "number" ? own : typeof rows === "number" ? Object.values(own ?? {}).filter((text) => text.trim() !== "").length : changedCount(own, rows);
  return Math.max(0, total - have);
}

/** A language's state in one sentence: "Hotovo" / "Chybí 4 texty". */
export function languageProgressText(missing: number, tr: Translator): string {
  return missing > 0 ? tr.tp("translations.lang.missing", missing) : tr.t("translations.lang.done");
}

// --- CSV (Pro) -----------------------------------------------------------------------------------------

const CSV_KEY = "key";
const CSV_PLACE = "place";
const CSV_DEFAULT = "default";

function csvCell(value: string): string {
  return /[",;\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/**
 * The export: one row a text — its key, where it shows, the extension's own text in the default language, and a
 * column per language with the merchant's text. Starts with a byte order mark so a spreadsheet reads the accents.
 */
export function exportCsv(rows: readonly TextRow[], languages: readonly string[], values: Readonly<Record<string, Readonly<Record<string, string>>>>, tr: Translator): string {
  const lines = [[CSV_KEY, CSV_PLACE, CSV_DEFAULT, ...languages]];
  for (const row of rows) {
    lines.push([row.key, `${groupLabel(textGroup(row.key), tr)}: ${textLabel(row, tr)}`, languages[0] ? textDefault(row, languages[0]) : row.defaults.en, ...languages.map((locale) => values[locale]?.[row.key] ?? "")]);
  }
  return `\uFEFF${lines.map((cells) => cells.map(csvCell).join(",")).join("\r\n")}\r\n`;
}

/** CSV text → rows of cells. The separator is the header's (a comma, or the semicolon Czech spreadsheets write). */
export function parseCsv(text: string): string[][] {
  const source = text.replace(/^\uFEFF/, "");
  const header = source.split(/\r?\n/, 1)[0] ?? "";
  const separator = header.includes(";") && !header.includes(",") ? ";" : ",";
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i];
    if (quoted) {
      if (ch === '"' && source[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"' && cell === "") quoted = true;
    else if (ch === separator) {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && source[i + 1] === "\n") i += 1;
      row.push(cell);
      cell = "";
      rows.push(row);
      row = [];
    } else cell += ch;
  }
  if (cell !== "" || row.length > 0) rows.push([...row, cell]);
  return rows.filter((cells) => cells.some((c) => c.trim() !== ""));
}

export type ImportRefusal =
  | { reason: "header" }
  | { reason: "language"; column: string }
  | { reason: "key"; line: number; key: string }
  | { reason: "text"; line: number; key: string; locale: string; error: Omit<FieldError, "field"> };

export interface ImportChange {
  key: string;
  locale: string;
  from: string;
  to: string;
}

export interface ImportPlan {
  changes: ImportChange[];
  refused: ImportRefusal[];
  /** Cells that already say what is stored. */
  unchanged: number;
}

/**
 * What an import would do, without doing it: every cell of a known text in one of the page's languages that
 * differs from what is stored is a change; a row with an unknown key, a column that is not one of the languages
 * and a text that breaks a rule are refused, each with its reason. An empty cell puts the extension's own text back.
 */
export function planImport(csv: string, rows: readonly TextRow[], languages: readonly string[], values: Readonly<Record<string, Readonly<Record<string, string>>>>): ImportPlan {
  const plan: ImportPlan = { changes: [], refused: [], unchanged: 0 };
  const [header, ...lines] = parseCsv(csv);
  const names = (header ?? []).map((name) => name.trim());
  if (names[0]?.toLowerCase() !== CSV_KEY) {
    plan.refused.push({ reason: "header" });
    return plan;
  }
  const columns: { index: number; locale: string }[] = [];
  names.forEach((name, index) => {
    if (index === 0 || name === "" || [CSV_PLACE, CSV_DEFAULT].includes(name.toLowerCase())) return;
    const locale = normalizeLocale(name);
    if (locale !== "" && languages.includes(locale)) columns.push({ index, locale });
    else plan.refused.push({ reason: "language", column: name });
  });
  const byKey = new Map(rows.map((row) => [row.key, row]));
  lines.forEach((cells, i) => {
    const line = i + 2;
    const key = (cells[0] ?? "").trim();
    const row = byKey.get(key);
    if (!row) {
      plan.refused.push({ reason: "key", line, key });
      return;
    }
    for (const { index, locale } of columns) {
      const to = (cells[index] ?? "").trim();
      const from = values[locale]?.[key] ?? "";
      if (to === from) {
        plan.unchanged += 1;
        continue;
      }
      const error = textError(key, textDefault(row, locale), to);
      if (error) plan.refused.push({ reason: "text", line, key, locale, error });
      else plan.changes.push({ key, locale, from, to });
    }
  });
  return plan;
}

/** The planned changes as the texts a save takes. */
export function importTexts(plan: ImportPlan): Record<string, Record<string, string>> {
  const out: Record<string, Record<string, string>> = {};
  for (const change of plan.changes) (out[change.locale] ??= {})[change.key] = change.to;
  return out;
}
