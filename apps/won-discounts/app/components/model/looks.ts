// The look of each storefront element (feedback 2026-10-06, bod 13): the quantity table, the Milníky ladder, the
// sale badge and the campaign banner each have their own — a ready-made look and a highlight colour on every
// plan, own colours and CSS on Pro — set on the page of the module it belongs to (components/looks/LookSection).
// The lists are core's (looks.ts LOOK_PRESETS, ACCENT_PRESETS); labels in the admin language (§4c); the form takes
// only known values (SEC-1), and whether the CSS can be confined to the element is core's call (the server).
// Pure; tests/ui/looks.test.ts.

import { ACCENT_PRESETS, APPEARANCE_PRESETS, type AccentPreset, type AppearancePreset } from "@won/core/discounts/config";
import { customLookCss, LOOK_ELEMENTS, LOOK_ROOT, type LookElement } from "@won/core/discounts/custom-look";
import { LOOK_PRESETS } from "@won/core/discounts/looks";

import type { MessageKey, Translator } from "../../i18n";
import type { FormDataLike } from "./rule-form";
import type { AppearancePresetView, FieldError } from "./types";

/** Where every element's look is saved (a route with an action only). */
export const LOOKS_ACTION = "/app/looks";

export const LOOK_FIELD = {
  intent: "intent",
  configVersion: "configVersion",
  /** One of LOOK_ELEMENTS. */
  element: "element",
  /** The ready-made look (the table's is saved with its page's form: model/tiers.ts). */
  preset: "preset",
  /** The ready-made highlight colour (ACCENT_PRESETS). */
  accentPreset: "accent",
  /** Milníky: the flash of a step just reached ("on"). */
  blink: "blink",
  /** The Pro custom look: colours `#rgb` / `#rrggbb`, the radius in px, the merchant's CSS. */
  accent: "look.accent",
  line: "look.line",
  tint: "look.tint",
  radius: "look.radius",
  css: "look.css",
  /** BETA: prices by quantity on product cards ("on"; intent `cards`). */
  cardPrices: "cardPrices",
} as const;

export const LOOK_INTENT = { save: "save", cards: "cards" } as const;

export const RADIUS_MAX = 32;

export function isLookElement(v: unknown): v is LookElement {
  return typeof v === "string" && (LOOK_ELEMENTS as readonly string[]).includes(v);
}

export function isAppearancePreset(v: unknown): v is AppearancePreset {
  return typeof v === "string" && (APPEARANCE_PRESETS as readonly string[]).includes(v);
}

/** A stored value → the table's look; an unknown one reads as the default (what the storefront does, K7). */
export function presetOf(v: unknown): AppearancePresetView {
  return isAppearancePreset(v) ? v : "default";
}

/** A ready-made look's name ("Štítky", "Odškrtávací seznam"). */
export function presetLabel(element: LookElement, preset: string, tr: Translator): string {
  return tr.t(`looks.${element}.${preset}` as MessageKey);
}

/** …and what it is, in one line. */
export function presetDetails(element: LookElement, preset: string, tr: Translator): string {
  return tr.t(`looks.${element}.${preset}.details` as MessageKey);
}

/** The table's look out of its page's form (the preview's switcher). */
export function readAppearanceForm(form: FormDataLike): { ok: true; preset: AppearancePresetView } | { ok: false; errors: FieldError[] } {
  const raw = form.get(LOOK_FIELD.preset);
  const preset = typeof raw === "string" ? raw.trim() : "";
  return isAppearancePreset(preset) ? { ok: true, preset } : { ok: false, errors: [{ field: LOOK_FIELD.preset, key: "looks.error.preset" }] };
}

export interface CustomLookForm {
  vars: { accent?: string; line?: string; tint?: string; radius?: number };
  css: string;
}

export interface LookForm {
  element: LookElement;
  /** Absent for the table (its look and colour are saved with its page). */
  preset?: string;
  accent?: AccentPreset;
  blink?: boolean;
  /** null = nothing set (no custom look). */
  custom: CustomLookForm | null;
}

const COLOR = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

/**
 * One element's look as its section posts it. Values are checked for shape here (the admin's words on the
 * field); whether the plan may save a custom look and whether its CSS can be confined is the server's call.
 */
export function readLookForm(form: FormDataLike): { ok: true; look: LookForm } | { ok: false; errors: FieldError[] } {
  const text = (name: string) => String(form.get(name) ?? "").trim();
  const element = text(LOOK_FIELD.element);
  if (!isLookElement(element)) return { ok: false, errors: [{ field: LOOK_FIELD.element, key: "looks.error.preset" }] };
  const errors: FieldError[] = [];
  const look: LookForm = { element, custom: null };
  if (element !== "tiers") {
    const preset = text(LOOK_FIELD.preset);
    if ((LOOK_PRESETS[element] as readonly string[]).includes(preset)) look.preset = preset;
    else errors.push({ field: LOOK_FIELD.preset, key: "looks.error.preset" });
    const accent = text(LOOK_FIELD.accentPreset) || "theme";
    if ((ACCENT_PRESETS as readonly string[]).includes(accent)) look.accent = accent as AccentPreset;
    else errors.push({ field: LOOK_FIELD.accentPreset, key: "looks.error.accent" });
    if (element === "milestones") look.blink = form.get(LOOK_FIELD.blink) === "on";
  }
  const vars: CustomLookForm["vars"] = {};
  for (const key of ["accent", "line", "tint"] as const) {
    const value = text(LOOK_FIELD[key]);
    if (value === "") continue;
    if (COLOR.test(value)) vars[key] = value.toLowerCase();
    else errors.push({ field: LOOK_FIELD[key], key: "looks.error.color" });
  }
  const radius = text(LOOK_FIELD.radius);
  if (radius !== "") {
    if (/^\d{1,2}$/.test(radius) && Number(radius) <= RADIUS_MAX) vars.radius = Number(radius);
    else errors.push({ field: LOOK_FIELD.radius, key: "looks.error.radius", params: { max: RADIUS_MAX } });
  }
  // The CSS as typed (not trimmed inside): the merchant gets back exactly what they saved.
  const css = String(form.get(LOOK_FIELD.css) ?? "");
  if (errors.length > 0) return { ok: false, errors };
  if (Object.keys(vars).length > 0 || css.trim() !== "") look.custom = { vars, css: css.trim() === "" ? "" : css };
  return { ok: true, look };
}

// --- The live form (P5): what the section says and previews follows what is typed --------------------------

/** Is anything of the custom look set (a colour, the radius, CSS)? `value(field)` = the field as typed or as stored. */
export function customLookSet(value: (field: string) => string): boolean {
  return [LOOK_FIELD.accent, LOOK_FIELD.line, LOOK_FIELD.tint, LOOK_FIELD.radius, LOOK_FIELD.css].some((field) => value(field).trim() !== "");
}

/**
 * The custom look as the storefront would get it from what is typed (core customLookCss: the variables on the
 * element's root + the CSS scoped under it), for the live preview. A value the server would refuse is left out
 * (a colour that is not a hex, a radius out of range, CSS that cannot be scoped) — the preview never shows what
 * cannot be saved. "" = nothing to add.
 */
export function liveCustomLookCss(element: LookElement, value: (field: string) => string): string {
  const vars: CustomLookForm["vars"] = {};
  for (const key of ["accent", "line", "tint"] as const) {
    const v = value(LOOK_FIELD[key]).trim();
    if (COLOR.test(v)) vars[key] = v.toLowerCase();
  }
  const radius = value(LOOK_FIELD.radius).trim();
  if (/^\d{1,2}$/.test(radius) && Number(radius) <= RADIUS_MAX) vars.radius = Number(radius);
  return customLookCss({ vars, css: value(LOOK_FIELD.css) }, LOOK_ROOT[element]);
}
