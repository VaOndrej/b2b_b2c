// Vzhled (MVP 3, contract K7): the four ready-made looks of the quantity-tier
// block (config.storefront.appearancePreset — the storefront config carries it,
// the sync writes it, K5). The page shows every look on the shop's own theme
// (integration/themes.server.ts readThemeLook: the MAIN theme's tokens, the same
// CSS the storefront loads), with the set the shop's PLAN runs (BILL-1: the
// global one, else the first with tiers; an inert Pro set on Free is not one —
// none → an example the screen labels) and a real product that set applies to
// (themes.server.ts readPreviewProduct). Saved
// like every admin change (settings.server.ts saveConfigSection: lock, F12,
// unreadable guard, saveAndSync). MVP 7: the Pro custom look (variables + CSS scoped by core), card prices (BETA)
// and the storefront texts are saved by the same form.

import { readFileSync } from "node:fs";
import path from "node:path";

import type { WonDiscountsConfig } from "@won/core/discounts/config";
import { CUSTOM_LOOK_VARS, customLookCss, customLookIssue } from "@won/core/discounts/custom-look";
import { gateConfigForPlan, type ShopPlan } from "@won/core/discounts/plan-gate";
import { CUSTOM_CSS_MAX_LENGTH } from "@won/core/discounts/scope-css";
import { buildStorefrontConfig } from "@won/core/discounts/storefront-config";

import {
  APPEARANCE_FIELD,
  APPEARANCE_INTENT,
  presetOf,
  readAppearanceExtras,
  readAppearanceForm,
  TEXT_LANGS,
  type AppearanceExtras,
  type TextLang,
} from "../../components/model/appearance";
import { cardBlockAddUrl } from "../../components/model/embed";
import type { FormDataLike } from "../../components/model/rule-form";
import { tierSetView } from "../../components/model/tiers";
import type { AppearancePresetView, AppearanceScreenData, PreviewLookView, TierSetView, UiResult } from "../../components/model/types";
import { loadConfig } from "../config.server";
import { STOREFRONT_CONFIG_MAX_BYTES } from "../sync/storefront";
import { loadAdminSignals } from "../ui-actions.server";
import { graphqlOf, type ShopCtx } from "./context.server";
import { readSaveOptions, saveConfigSection, type SaveOptions } from "./settings.server";
import { ctxPlan } from "./sync-status.server";
import { readPreviewProduct, readThemeLook } from "./themes.server";

// --- Storefront texts (MVP 7): the extension's own, read once from its locale files ----------------------------

const LOCALE_FILES: Record<TextLang, string> = { cs: "cs.json", sk: "sk.json", en: "en.default.json" };
/** Texts Shopify fills in itself (`{{ count }}` plurals): not editable here. */
const NOT_EDITABLE = new Set(["outlet.left"]);
let extensionTexts: Record<TextLang, Record<string, string>> | null = null;

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
 * language: the editor then shows keys without placeholders, never a wrong default.
 */
export function storefrontTextDefaults(): Record<TextLang, Record<string, string>> {
  if (extensionTexts) return extensionTexts;
  const out = { cs: {}, sk: {}, en: {} } as Record<TextLang, Record<string, string>>;
  for (const lang of TEXT_LANGS) {
    try {
      out[lang] = flatten(JSON.parse(readFileSync(path.resolve(process.cwd(), "extensions/won-discounts-storefront/locales", LOCALE_FILES[lang]), "utf8")));
    } catch {
      out[lang] = {};
    }
  }
  extensionTexts = out;
  return out;
}

/** The keys the editor offers: the English file's, in its order. */
export function storefrontTextKeys(): string[] {
  return Object.keys(storefrontTextDefaults().en).filter((key) => !NOT_EDITABLE.has(key));
}

/** Class names a custom look can style (the extension's CSS; tests/contracts pin the list to the files). */
export const STOREFRONT_CLASSES = [
  ".won-tiers", ".won-tiers--default", ".won-tiers--highlight", ".won-tiers--chips", ".won-tiers--tiles", ".won-tiers__heading", ".won-tiers__list",
  ".won-tiers__row", ".won-tiers__qty", ".won-tiers__save", ".won-tiers__unit", ".won-tiers__live", ".won-tiers__next",
  ".won-cart", ".won-cart-slot", ".won-cart__row", ".won-cart__bar", ".won-cart__code", ".won-cart__applied", ".won-cart__warn", ".won-cart__saved",
  ".won-outlet", ".won-outlet__row", ".won-outlet__badge", ".won-outlet__variant", ".won-outlet__left", ".won-card-tier",
  ".won-progress", ".won-progress--center", ".won-progress__row", ".won-progress__track",
  ".won-campaign", ".won-campaign--center", ".won-campaign__title", ".won-campaign__time", ".won-topbar",
] as const;

/** The brief a merchant hands to an AI (English: the code speaks it); the full page is docs/reference/storefront-contract. */
export function aiPrompt(): string {
  return [
    "Write CSS for the Won Discounts storefront blocks of my Shopify store.",
    "CSS only: no HTML, no JavaScript, no url(), no @import, no @font-face, no @keyframes; @media, @supports and @container are allowed.",
    `At most ${CUSTOM_CSS_MAX_LENGTH} characters. Selectors are relative to a block; :root means the block itself.`,
    "Blocks: .won-tiers (quantity discount table on the product page; the active row has data-active=\"true\"), .won-cart (cart panel), .won-outlet (sale badge), .won-card-tier (line on a product card), .won-progress (progress to free shipping / a gift), .won-campaign (campaign banner with a countdown), .won-topbar (the bar at the top of the store).",
    `CSS variables you may set on :root: ${Object.values(CUSTOM_LOOK_VARS).join(", ")}.`,
    `Classes: ${STOREFRONT_CLASSES.join(", ")}.`,
    "The look I want: <describe it here>.",
  ].join("\n");
}

/** The set the previews show: the global one with tiers, else the first set with tiers; null = none (an example is shown). */
export function sampleSet(config: WonDiscountsConfig): TierSetView | null {
  const sets = config.modules.tiers.sets.filter((s) => s.breaks.length > 0);
  const chosen = sets.find((s) => s.scope === "global") ?? sets[0];
  return chosen ? tierSetView(chosen, new Map()) : null;
}

/**
 * What the stored config adds to the faithful preview on this plan (pure; Množstevní slevy uses it too): the custom
 * look exactly as the storefront config carries it (BILL-1: the gate removes it on Free) and the texts the merchant
 * changed.
 */
export function previewLookOf(stored: WonDiscountsConfig, plan: ShopPlan): PreviewLookView {
  const gated = gateConfigForPlan(stored, plan).config;
  const texts: PreviewLookView["texts"] = {};
  for (const lang of TEXT_LANGS) {
    const changed = Object.fromEntries(Object.entries(gated.locales[lang] ?? {}).filter(([, text]) => typeof text === "string" && text !== ""));
    if (Object.keys(changed).length > 0) texts[lang] = changed;
  }
  return { customCss: customLookCss(gated.storefront.custom) || null, texts, ...(gated.storefront.accent ? { accent: gated.storefront.accent } : {}) };
}

/**
 * Save only the look (the switcher on Množstevní slevy): the same validated value and the same config field as
 * this page's form — `config` with the look set, everything else of the storefront untouched.
 */
export function withAppearancePreset(config: WonDiscountsConfig, preset: AppearancePresetView): WonDiscountsConfig {
  return applyAppearance(config, preset, null, "free");
}

export async function loadAppearanceScreen(ctx: ShopCtx, opts: { scopes: string; fresh?: boolean }): Promise<AppearanceScreenData> {
  const [loaded, plan] = await Promise.all([loadConfig(ctx.db, ctx.shop), ctxPlan(ctx)]);
  // BILL-1 (review fix 2): the set the PLAN runs — an inert Pro set on Free is never shown as the shop's table.
  const sample = sampleSet(gateConfigForPlan(loaded.config, plan).config);
  const [look, product, signals] = await Promise.all([
    readThemeLook(ctx, { scopes: opts.scopes, fresh: opts.fresh }),
    readPreviewProduct(ctx, sample?.scope ?? null),
    loadAdminSignals({ shop: ctx.shop, scopes: opts.scopes, apiKey: ctx.apiKey, graphql: graphqlOf(ctx), fresh: opts.fresh }),
  ]);
  const custom = loaded.config.storefront.custom;
  const issue = customLookIssue(custom);
  const defaults = storefrontTextDefaults();
  return {
    plan,
    configVersion: loaded.version ?? null,
    preset: presetOf(loaded.config.storefront.appearancePreset),
    tokens: look.tokens,
    sample,
    product,
    block: look.block,
    embed: signals.embed,
    cardPrices: loaded.config.storefront.cardPricesEnabled === true,
    custom: {
      accent: custom?.vars.accent ?? "",
      line: custom?.vars.line ?? "",
      tint: custom?.vars.tint ?? "",
      radius: custom?.vars.radius === undefined ? "" : String(custom.vars.radius),
      css: custom?.css ?? "",
    },
    customIssue: issue ? issue.reason : null,
    texts: storefrontTextKeys().map((key) => ({
      key,
      defaults: { cs: defaults.cs[key] ?? "", sk: defaults.sk[key] ?? "", en: defaults.en[key] ?? "" },
      values: { cs: loaded.config.locales.cs?.[key] ?? "", sk: loaded.config.locales.sk?.[key] ?? "", en: loaded.config.locales.en?.[key] ?? "" },
    })),
    cardBlockUrl: cardBlockAddUrl(ctx.shop, ctx.apiKey),
    aiPrompt: aiPrompt(),
    previewLook: previewLookOf(loaded.config, plan),
  };
}

/** Room left under Shopify's json metafield limit for what the sync adds (the version token, gift handles). */
export const STOREFRONT_CONFIG_HEADROOM_BYTES = 4_000;

/** The part of the config the Vzhled page owns (the F12 base check compares it). */
function appearancePart(config: WonDiscountsConfig) {
  const keys = storefrontTextKeys();
  const texts = Object.fromEntries(TEXT_LANGS.map((lang) => [lang, Object.fromEntries(keys.map((key) => [key, config.locales[lang]?.[key] ?? ""]))]));
  return { preset: presetOf(config.storefront.appearancePreset), cards: config.storefront.cardPricesEnabled === true, custom: config.storefront.custom ?? null, texts };
}

/** `config` with the page's changes: the look, and (MVP 7) card prices, the custom look (Pro only) and the texts. */
function applyAppearance(config: WonDiscountsConfig, preset: AppearancePresetView, extras: AppearanceExtras | null, plan: ShopPlan): WonDiscountsConfig {
  if (!extras) return { ...config, storefront: { ...config.storefront, appearancePreset: preset } };
  const storefront: WonDiscountsConfig["storefront"] = { ...config.storefront, appearancePreset: preset, cardPricesEnabled: extras.cardPrices };
  // BILL-1: only a Pro shop writes the custom look; on Free the stored one stays exactly as it is.
  if (plan === "pro") {
    if (extras.custom) storefront.custom = extras.custom;
    else delete storefront.custom;
  }
  const locales = { ...config.locales } as Record<string, Record<string, string>>;
  for (const lang of TEXT_LANGS) {
    const next = { ...(locales[lang] ?? {}) };
    for (const [key, value] of Object.entries(extras.texts[lang])) {
      if (value === "") delete next[key];
      else next[key] = value;
    }
    locales[lang] = next;
  }
  return { ...config, storefront, locales: locales as WonDiscountsConfig["locales"] };
}

export function saveAppearance(ctx: ShopCtx, preset: AppearancePresetView, opts: SaveOptions, extras: AppearanceExtras | null = null, plan: ShopPlan = "free"): Promise<UiResult> {
  return saveConfigSection(ctx, {
    ...opts,
    path: "storefront",
    pick: (config) => (extras ? appearancePart(config) : presetOf(config.storefront.appearancePreset)),
    apply: (config) => applyAppearance(config, preset, extras, plan),
  });
}

/**
 * The Vzhled action: `intent=save` with one of the four looks and (MVP 7, with the `extras` marker) card prices,
 * the custom look and the storefront texts — parsed on the server (SEC-1). CSS that cannot be scoped under the
 * blocks is refused on its field (SEC-3); a storefront config that would pass Shopify's metafield limit is refused
 * before the save (it used to be a failed sync step only).
 */
export async function appearanceAction(ctx: ShopCtx, form: FormDataLike, opts: { maxStorefrontBytes?: number } = {}): Promise<UiResult> {
  if (form.get(APPEARANCE_FIELD.intent) !== APPEARANCE_INTENT.save) return { ok: false, reason: "bad_request" };
  const parsed = readAppearanceForm(form);
  if (!parsed.ok) return { ok: false, reason: "invalid", errors: parsed.errors };
  const read = readAppearanceExtras(form, storefrontTextKeys());
  if (!read.ok) return { ok: false, reason: "invalid", errors: read.errors };
  const extras = read.extras;
  if (!extras) return saveAppearance(ctx, parsed.preset, readSaveOptions(form));
  const [plan, loaded] = await Promise.all([ctxPlan(ctx), loadConfig(ctx.db, ctx.shop)]);
  if (plan === "pro") {
    const issue = customLookIssue(extras.custom);
    if (issue) return { ok: false, reason: "invalid", errors: [{ field: APPEARANCE_FIELD.css, key: `appearance.error.css.${issue.reason}`, params: { detail: issue.detail ?? "" } }] };
  }
  const next = buildStorefrontConfig(gateConfigForPlan(applyAppearance(loaded.config, parsed.preset, extras, plan), plan).config, { configVersion: "" });
  const bytes = new TextEncoder().encode(JSON.stringify(next)).length;
  // The live config also carries a version token and gift handles: leave them room under Shopify's limit.
  const max = opts.maxStorefrontBytes ?? STOREFRONT_CONFIG_MAX_BYTES - STOREFRONT_CONFIG_HEADROOM_BYTES;
  if (bytes > max) return { ok: false, reason: "invalid", errors: [{ field: APPEARANCE_FIELD.css, key: "appearance.error.tooLarge", params: { bytes, max } }] };
  return saveAppearance(ctx, parsed.preset, readSaveOptions(form), extras, plan);
}
