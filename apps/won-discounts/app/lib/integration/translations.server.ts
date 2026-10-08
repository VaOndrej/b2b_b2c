// Překlady (feedback 2026-10-06, body 11, 12, 14): the storefront texts per language. Stored in the config as
// `locales[<locale>]` with `storefront.languages` = the page's tables in order (the shop's default language
// first); each language reaches the storefront as its own metafield (core storefront-texts.ts, the sync writes
// them). The shop's languages come from Shopify (`shopLocales`, the optional scope read_locales): without it the
// page works with the languages it has stored and says what is missing.
// The plan's limit (Free: the default language and one more) holds here as on the page: a language past it is
// refused unless it was already stored (after a downgrade it stays editable; the storefront does not get it).
// Export and import (CSV) are Pro, checked here.

import { readFileSync } from "node:fs";
import path from "node:path";

import type { WonDiscountsConfig } from "@won/core/discounts/config";
import { milestoneSteps } from "@won/core/discounts/milestones";
import type { ShopPlan } from "@won/core/discounts/plan-gate";
import { milestoneNameKey, textLanguages } from "@won/core/discounts/storefront-texts";

import { translator } from "../../i18n";
import { milestoneStepView, stepSummary } from "../../components/model/milestones";
import type { FormDataLike } from "../../components/model/rule-form";
import {
  DEFAULT_TEXT_LANGS,
  exportCsv,
  importTexts,
  languageLimit,
  planImport,
  readTranslationsForm,
  TRANSLATIONS_FIELD,
  TRANSLATIONS_INTENT,
  type DefaultTextLang,
  type ImportPlan,
  type TextRow,
  type TranslationsForm,
} from "../../components/model/translations";
import type { FieldError, TranslationsScreenData, UiResult } from "../../components/model/types";
import { loadConfig } from "../config.server";
import { graphqlOf, type ShopCtx } from "./context.server";
import { readSaveOptions, saveConfigSection, type SaveOptions } from "./settings.server";
import { ctxPlan } from "./sync-status.server";
import { readShopLanguages, type ShopLanguage } from "./themes.server";

// --- The extension's own texts, read once from its locale files ------------------------------------------

const LOCALE_FILES: Record<DefaultTextLang, string> = { cs: "cs.json", sk: "sk.json", en: "en.default.json" };
/** Not a merchant's to change: a plural Shopify fills in (`{{ count }}`), and what only the theme editor shows. */
const NOT_EDITABLE = new Set(["outlet.left", "progress.empty", "campaign.sample"]);
let extensionTexts: Record<DefaultTextLang, Record<string, string>> | null = null;

/** `{group: {key: text}}` → `{"group.key": text}`. */
function flatten(value: unknown, prefix = "", out: Record<string, string> = {}): Record<string, string> {
  if (typeof value !== "object" || value === null) return out;
  for (const [key, v] of Object.entries(value)) {
    if (typeof v === "string") out[`${prefix}${key}`] = v;
    else flatten(v, `${prefix}${key}.`, out);
  }
  return out;
}

/**
 * The theme app extension's texts per language (extensions/won-discounts-storefront/locales, relative to the app's
 * working directory — the same in dev, tests and the image). A file that cannot be read gives no texts for that
 * language: the page then shows rows without a default, never a wrong one.
 */
export function storefrontTextDefaults(): Record<DefaultTextLang, Record<string, string>> {
  if (extensionTexts) return extensionTexts;
  const out = { cs: {}, sk: {}, en: {} } as Record<DefaultTextLang, Record<string, string>>;
  for (const lang of DEFAULT_TEXT_LANGS) {
    try {
      out[lang] = flatten(JSON.parse(readFileSync(path.resolve(process.cwd(), "extensions/won-discounts-storefront/locales", LOCALE_FILES[lang]), "utf8")));
    } catch {
      out[lang] = {};
    }
  }
  extensionTexts = out;
  return out;
}

/** The extension's keys a merchant can change: the English file's, in its order. */
export function storefrontTextKeys(): string[] {
  return Object.keys(storefrontTextDefaults().en).filter((key) => !NOT_EDITABLE.has(key));
}

/**
 * The page's rows: the extension's texts, and after the ladder's own a name for every Milníky discount step of
 * the stored config (its default is what the ladder says without one: "Sleva {value}").
 */
export function textRows(config: WonDiscountsConfig, locale: ShopCtx["locale"]): TextRow[] {
  const defaults = storefrontTextDefaults();
  const row = (key: string, from = key): TextRow => ({ key, defaults: { cs: defaults.cs[from] ?? "", sk: defaults.sk[from] ?? "", en: defaults.en[from] ?? "" } });
  const tr = translator(locale);
  const names = milestoneSteps(config)
    .filter((step) => step.kind === "discount")
    .map((step): TextRow => {
      const view = milestoneStepView(step, new Map());
      return { ...row(milestoneNameKey(step.id), "cart.ms_disc"), step: stepSummary(view, Object.keys(view.threshold).sort(), tr) };
    });
  const rows: TextRow[] = [];
  for (const key of storefrontTextKeys()) {
    rows.push(row(key));
    if (key === "cart.ms_disc") rows.push(...names);
  }
  return rows;
}

// --- The page ----------------------------------------------------------------------------------------------

/**
 * The page's tables, the shop's default language first: Shopify's default (when the app may read it), then what
 * the merchant has listed or stored. Without anything to go by, the admin's own language.
 */
export function tableLanguages(config: WonDiscountsConfig, shop: readonly ShopLanguage[] | null, fallback: string): string[] {
  const stored = textLanguages(config);
  const primary = shop?.find((x) => x.primary)?.code ?? stored[0] ?? fallback;
  return [primary, ...stored.filter((locale) => locale !== primary)];
}

function valuesOf(config: WonDiscountsConfig, languages: readonly string[], rows: readonly TextRow[]): Record<string, Record<string, string>> {
  return Object.fromEntries(languages.map((locale) => [locale, Object.fromEntries(rows.flatMap((row) => (config.locales[locale]?.[row.key] ? [[row.key, config.locales[locale][row.key]]] : [])))]));
}

/** The page from what is stored and what Shopify says about the shop's languages (pure; the dev harness uses it too). */
export function translationsScreenData(config: WonDiscountsConfig, opts: { plan: ShopPlan; configVersion: string | null; shop: readonly ShopLanguage[] | null; locale: ShopCtx["locale"] }): TranslationsScreenData {
  const rows = textRows(config, opts.locale);
  const languages = tableLanguages(config, opts.shop, opts.locale);
  return {
    plan: opts.plan,
    configVersion: opts.configVersion,
    shopLanguages: opts.shop ? opts.shop.map((x) => x.code) : null,
    languages,
    limit: languageLimit(opts.plan),
    rows,
    values: valuesOf(config, languages, rows),
  };
}

export async function loadTranslationsScreen(ctx: ShopCtx, opts: { fresh?: boolean } = {}): Promise<TranslationsScreenData> {
  const [loaded, plan, shop] = await Promise.all([loadConfig(ctx.db, ctx.shop), ctxPlan(ctx), readShopLanguages(graphqlOf(ctx), ctx.shop, ctx.scopes, opts)]);
  return translationsScreenData(loaded.config, { plan, configVersion: loaded.version ?? null, shop, locale: ctx.locale });
}

/** The part of the config the page owns (the F12 base check compares it). */
function translationsPart(config: WonDiscountsConfig) {
  return { languages: config.storefront.languages ?? [], locales: config.locales };
}

/**
 * `config` with the page's tables: the languages in the page's order and, per language, the fields the form
 * carried ("" removes the text; a key the form did not carry stays). A language the page no longer lists loses
 * its texts.
 */
export function applyTranslations(config: WonDiscountsConfig, form: TranslationsForm): WonDiscountsConfig {
  const locales: Record<string, Record<string, string>> = {};
  for (const locale of form.languages) {
    const next = { ...(config.locales[locale] ?? {}) };
    for (const [key, value] of Object.entries(form.texts[locale] ?? {})) {
      if (value === "") delete next[key];
      else next[key] = value;
    }
    locales[locale] = next;
  }
  return { ...config, storefront: { ...config.storefront, languages: [...form.languages] }, locales };
}

/** Why the languages of a save cannot be taken, as a field error; null = fine. */
function languagesError(languages: readonly string[], stored: readonly string[], shop: readonly ShopLanguage[] | null, plan: ShopPlan): Omit<FieldError, "field"> | null {
  if (languages.length === 0) return { key: "translations.error.language" };
  const added = languages.filter((locale) => !stored.includes(locale));
  // A language Shopify does not have switched on would never be shown; the first table is exempt (the default).
  if (shop && added.some((locale) => !shop.some((x) => x.code === locale))) return { key: "translations.error.notInShop" };
  if (!shop && added.some((locale) => locale !== languages[0])) return { key: "translations.error.notInShop" };
  const limit = languageLimit(plan);
  if (limit !== null && added.some((locale) => languages.indexOf(locale) >= limit)) return { key: "translations.error.limit", params: { max: limit } };
  return null;
}

function save(ctx: ShopCtx, form: TranslationsForm, opts: SaveOptions): Promise<UiResult> {
  return saveConfigSection(ctx, { ...opts, path: "locales", pick: translationsPart, apply: (config) => applyTranslations(config, form) });
}

/** An import larger than every language at its limit is not one of ours. */
const CSV_MAX_LENGTH = 2_000_000;

export type TranslationsResult = UiResult | { ok: true; message: "export"; csv: string } | { ok: true; message: "import-preview"; plan: ImportPlan; csv: string };

/**
 * The Překlady action. `save`: the tables as the form carries them. `export` / `import-preview` / `import-apply`
 * (Pro): the CSV of every table; an import is planned against what is stored and saved only by `import-apply`,
 * which plans it again and takes the changes that pass (the refused rows were shown with their reasons).
 */
export async function translationsAction(ctx: ShopCtx, form: FormDataLike): Promise<TranslationsResult> {
  const intent = form.get(TRANSLATIONS_FIELD.intent);
  const [loaded, plan] = await Promise.all([loadConfig(ctx.db, ctx.shop), ctxPlan(ctx)]);
  const rows = textRows(loaded.config, ctx.locale);
  const shop = await readShopLanguages(graphqlOf(ctx), ctx.shop, ctx.scopes);
  const stored = tableLanguages(loaded.config, shop, ctx.locale);

  if (intent === TRANSLATIONS_INTENT.save) {
    const parsed = readTranslationsForm(form, rows);
    if (!parsed.ok) return { ok: false, reason: "invalid", errors: parsed.errors };
    const refused = languagesError(parsed.form.languages, stored, shop, plan);
    if (refused) return { ok: false, reason: "invalid", errors: [{ field: TRANSLATIONS_FIELD.language, ...refused }] };
    return save(ctx, parsed.form, readSaveOptions(form));
  }

  if (intent !== TRANSLATIONS_INTENT.exportCsv && intent !== TRANSLATIONS_INTENT.importPreview && intent !== TRANSLATIONS_INTENT.importApply) return { ok: false, reason: "bad_request" };
  if (plan !== "pro") return { ok: false, reason: "invalid", errors: [{ field: TRANSLATIONS_FIELD.csv, key: "translations.error.pro" }] };
  const values = valuesOf(loaded.config, stored, rows);
  if (intent === TRANSLATIONS_INTENT.exportCsv) return { ok: true, message: "export", csv: exportCsv(rows, stored, values, translator(ctx.locale)) };

  const csv = String(form.get(TRANSLATIONS_FIELD.csv) ?? "");
  if (csv.length > CSV_MAX_LENGTH) return { ok: false, reason: "invalid", errors: [{ field: TRANSLATIONS_FIELD.csv, key: "translations.error.csvTooLarge" }] };
  const planned = planImport(csv, rows, stored, values);
  if (intent === TRANSLATIONS_INTENT.importPreview) return { ok: true, message: "import-preview", plan: planned, csv };
  if (planned.changes.length === 0) return { ok: false, reason: "invalid", errors: [{ field: TRANSLATIONS_FIELD.csv, key: "translations.error.nothingToImport" }] };
  return save(ctx, { languages: stored, texts: importTexts(planned) }, readSaveOptions(form));
}
