// Vzhled (MVP 3, contract K7): the four ready-made looks of the quantity-tier
// block — the list is core's APPEARANCE_PRESETS (config.storefront.appearancePreset,
// the same values the storefront CSS knows as `won-tiers--<preset>`). Labels and
// details in the admin language (§4c); the form takes only one of the four
// (SEC-1). Pure; tests/ui/combination-appearance.test.ts.

import { APPEARANCE_PRESETS, type AppearancePreset } from "@won/core/discounts/config";

import type { MessageKey, Translator } from "../../i18n";
import type { FormDataLike } from "./rule-form";
import type { AppearancePresetView, FieldError } from "./types";

export const APPEARANCE_FIELD = {
  intent: "intent",
  configVersion: "configVersion",
  replaceUnreadable: "replaceUnreadable",
  preset: "preset",
  /** MVP 7: present when the form carries the fields below (an unchecked checkbox sends nothing). */
  extras: "extras",
  /** BETA: prices by quantity on product cards ("on"). */
  cardPrices: "cardPrices",
  /** The Pro custom look: colours `#rgb` / `#rrggbb`, the radius in px, the merchant's CSS. */
  accent: "look.accent",
  line: "look.line",
  tint: "look.tint",
  radius: "look.radius",
  css: "look.css",
  /** `tx.<lang>.<key>`: a storefront text the merchant changed ("" = the extension's own). */
  text: "tx.",
} as const;

export const TEXT_LANGS = ["cs", "sk", "en"] as const;
export type TextLang = (typeof TEXT_LANGS)[number];
/** core CONFIG_LIMITS.localeStringLength. */
export const TEXT_MAX_LENGTH = 500;
export const RADIUS_MAX = 32;

export interface AppearanceExtras {
  cardPrices: boolean;
  /** null = nothing set (no custom look). */
  custom: { vars: { accent?: string; line?: string; tint?: string; radius?: number }; css: string } | null;
  /** Per language, only the known keys; "" = back to the extension's own text. */
  texts: Record<TextLang, Record<string, string>>;
}

export const APPEARANCE_INTENT = { save: "save" } as const;

/** Where the Vzhled form posts. */
export const APPEARANCE_ACTION = "/app/appearance";

export function isAppearancePreset(v: unknown): v is AppearancePreset {
  return typeof v === "string" && (APPEARANCE_PRESETS as readonly string[]).includes(v);
}

/** A stored value → a preset; an unknown one reads as the default (what the storefront does, K7). */
export function presetOf(v: unknown): AppearancePresetView {
  return isAppearancePreset(v) ? v : "default";
}

export function presetLabel(preset: AppearancePresetView, tr: Translator): string {
  return tr.t(`appearance.preset.${preset}` as MessageKey);
}

export function presetDetails(preset: AppearancePresetView, tr: Translator): string {
  return tr.t(`appearance.preset.${preset}.details` as MessageKey);
}

export function readAppearanceForm(form: FormDataLike): { ok: true; preset: AppearancePresetView } | { ok: false; errors: FieldError[] } {
  const raw = form.get(APPEARANCE_FIELD.preset);
  const preset = typeof raw === "string" ? raw.trim() : "";
  return isAppearancePreset(preset) ? { ok: true, preset } : { ok: false, errors: [{ field: APPEARANCE_FIELD.preset, key: "appearance.error.preset" }] };
}

const COLOR = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

/**
 * MVP 7: the fields beyond the look — null when the form does not carry them (no `extras` marker). `textKeys` =
 * the extension's text keys; any other `tx.` field is ignored. Values are checked for shape here (the admin's
 * words on the field); whether the CSS can be scoped is core's call (the server).
 */
export function readAppearanceExtras(form: FormDataLike, textKeys: readonly string[]): { ok: true; extras: AppearanceExtras | null } | { ok: false; errors: FieldError[] } {
  if (form.get(APPEARANCE_FIELD.extras) === null) return { ok: true, extras: null };
  const text = (name: string) => String(form.get(name) ?? "").trim();
  const errors: FieldError[] = [];
  const vars: NonNullable<AppearanceExtras["custom"]>["vars"] = {};
  for (const key of ["accent", "line", "tint"] as const) {
    const value = text(APPEARANCE_FIELD[key]);
    if (value === "") continue;
    if (COLOR.test(value)) vars[key] = value.toLowerCase();
    else errors.push({ field: APPEARANCE_FIELD[key], key: "appearance.error.color" });
  }
  const radius = text(APPEARANCE_FIELD.radius);
  if (radius !== "") {
    if (/^\d{1,2}$/.test(radius) && Number(radius) <= RADIUS_MAX) vars.radius = Number(radius);
    else errors.push({ field: APPEARANCE_FIELD.radius, key: "appearance.error.radius", params: { max: RADIUS_MAX } });
  }
  // The CSS as typed (not trimmed inside): the merchant gets back exactly what they saved.
  const css = String(form.get(APPEARANCE_FIELD.css) ?? "");
  const texts: AppearanceExtras["texts"] = { cs: {}, sk: {}, en: {} };
  for (const lang of TEXT_LANGS) {
    for (const key of textKeys) {
      const field = `${APPEARANCE_FIELD.text}${lang}.${key}`;
      const raw = form.get(field);
      if (raw === null) continue;
      const value = String(raw).trim();
      if (value.length > TEXT_MAX_LENGTH) errors.push({ field, key: "appearance.error.text", params: { max: TEXT_MAX_LENGTH } });
      else texts[lang][key] = value;
    }
  }
  if (errors.length > 0) return { ok: false, errors };
  const custom = Object.keys(vars).length > 0 || css.trim() !== "" ? { vars, css: css.trim() === "" ? "" : css } : null;
  return { ok: true, extras: { cardPrices: form.get(APPEARANCE_FIELD.cardPrices) === "on", custom, texts } };
}
