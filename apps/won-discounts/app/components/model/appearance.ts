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
} as const;

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
