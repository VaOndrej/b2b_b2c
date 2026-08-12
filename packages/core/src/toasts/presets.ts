// MVP7 — named look & behaviour presets. One click applies a curated set of
// fields over the merchant's current config; "Customize" then reveals Advanced.
// Framework-free and deterministic (pure merges) so admin + tests agree.

import type { GlobalSettings, ToastTheme } from "./config.types.ts";
import type { SanitizedGlobal } from "./config.defaults.ts";

// Each look is a COMPLETE visual set — including a distinct accent palette — so
// applying one visibly switches the whole colour scheme, not just the shape.
export const PRESET_LOOKS = {
  minimal: {
    mode: "system",
    shadow: "sm",
    cornerRadius: 8,
    border: true,
    borderColor: "#e2e6ea",
    backdropBlur: false,
    iconSet: "none",
    accent: {
      added: "#3a7d5d",
      removed: "#b45555",
      increased: "#3a7d5d",
      decreased: "#9a7b3f",
      gift: "#6b6f76",
      shipping: "#5a6b8a",
      discount: "#6b6f76",
      info: "#6b6f76",
    },
  },
  bold: {
    mode: "dark",
    shadow: "lg",
    cornerRadius: 14,
    border: false,
    iconSet: "line",
    accent: {
      added: "#22c55e",
      removed: "#ef4444",
      increased: "#22c55e",
      decreased: "#f59e0b",
      gift: "#a855f7",
      shipping: "#3b82f6",
      discount: "#f43f5e",
      info: "#94a3b8",
    },
  },
  luxury: {
    mode: "light",
    shadow: "md",
    cornerRadius: 2,
    border: true,
    borderColor: "#111111",
    iconSet: "none",
    fontMode: "inherit-theme",
    accent: {
      added: "#0f766e",
      removed: "#7f1d1d",
      increased: "#0f766e",
      decreased: "#b8860b",
      gift: "#b8860b",
      shipping: "#1e3a5f",
      discount: "#7f1d1d",
      info: "#57534e",
    },
  },
  playful: {
    mode: "system",
    shadow: "lg",
    cornerRadius: 24,
    animationIn: "pop",
    iconSet: "emoji",
    accent: {
      added: "#10b981",
      removed: "#f43f5e",
      increased: "#14b8a6",
      decreased: "#f59e0b",
      gift: "#d946ef",
      shipping: "#3b82f6",
      discount: "#ec4899",
      info: "#8b5cf6",
    },
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
