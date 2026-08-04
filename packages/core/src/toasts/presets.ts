// MVP7 — named look & behaviour presets. One click applies a curated set of
// fields over the merchant's current config; "Customize" then reveals Advanced.
// Framework-free and deterministic (pure merges) so admin + tests agree.

import type { GlobalSettings, ToastTheme } from "./config.types.ts";
import type { SanitizedGlobal } from "./config.defaults.ts";

export const PRESET_LOOKS = {
  minimal: {
    mode: "system",
    shadow: "sm",
    cornerRadius: 8,
    border: true,
    borderColor: "#e2e6ea",
    backdropBlur: false,
    iconSet: "none",
    showImage: false,
  },
  bold: {
    mode: "dark",
    shadow: "lg",
    cornerRadius: 14,
    border: false,
    iconSet: "line",
    showImage: true,
    showDelta: true,
  },
  luxury: {
    mode: "light",
    shadow: "md",
    cornerRadius: 2,
    border: true,
    borderColor: "#111111",
    iconSet: "none",
    fontMode: "inherit-theme",
  },
  playful: {
    mode: "system",
    shadow: "lg",
    cornerRadius: 24,
    animationIn: "pop",
    iconSet: "emoji",
    showImage: true,
  },
} satisfies Record<string, Partial<ToastTheme>>;

export const PRESET_BEHAVIORS = {
  subtle: {
    position: "bottom-right",
    durationMs: 2500,
    maxVisible: 2,
    autoDismiss: true,
    pauseOnHover: true,
    grouping: { mode: "by-product", mergeDeltas: true },
  },
  standard: {
    position: "top-right",
    durationMs: 3500,
    maxVisible: 3,
  },
  "high-urgency": {
    position: "top-center",
    durationMs: 6000,
    maxVisible: 4,
    grouping: { mode: "by-type" },
  },
} satisfies Record<string, SanitizedGlobal>;

export type LookPresetId = keyof typeof PRESET_LOOKS;
export type BehaviorPresetId = keyof typeof PRESET_BEHAVIORS;

/** Apply a named look preset over a base theme. Unknown id → base unchanged. */
export function applyLookPreset(base: ToastTheme, id: string): ToastTheme {
  const preset = PRESET_LOOKS[id as LookPresetId] as Partial<ToastTheme> | undefined;
  if (!preset) return base;
  return {
    ...base,
    ...preset,
    accent: { ...base.accent, ...(preset.accent ?? {}) },
  };
}

/** Apply a named behaviour preset over a base global. Unknown id → base. */
export function applyBehaviorPreset(
  base: GlobalSettings,
  id: string,
): GlobalSettings {
  const preset = PRESET_BEHAVIORS[id as BehaviorPresetId] as
    | SanitizedGlobal
    | undefined;
  if (!preset) return base;
  return {
    ...base,
    ...preset,
    grouping: { ...base.grouping, ...(preset.grouping ?? {}) },
    frequency: { ...base.frequency, ...(preset.frequency ?? {}) },
  };
}
