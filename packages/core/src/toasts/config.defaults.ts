// Canonical defaults + safe resolver for Won Toasts config. Both the admin and
// the storefront import these — so an empty or partial/older stored config
// always resolves to a complete, valid, render-safe config. This is what makes
// "config is the single source of truth" hold even for a fresh install.

import type {
  GlobalSettings,
  GroupingSettings,
  StoredToastConfig,
  ToastAppConfig,
  ToastSemanticType,
  ToastTheme,
} from "./config.types.ts";

/** Current config schema version. Bump when the shape changes incompatibly. */
export const TOAST_CONFIG_VERSION = 1;

export const DEFAULT_GROUPING: GroupingSettings = {
  mode: "by-product",
  burstWindowMs: 600,
  mergeDeltas: true,
  dedupeWindowMs: 1000,
  rateLimitPerMin: 30,
};

export const DEFAULT_GLOBAL: GlobalSettings = {
  position: "top-right",
  offsetTop: 16,
  offsetInline: 16,
  durationMs: 3500,
  autoDismiss: true,
  pauseOnHover: true,
  closeable: true,
  clickAction: "open-cart",
  maxVisible: 3,
  overflowStrategy: "collapse",
  stackDirection: "newest-top",
  grouping: DEFAULT_GROUPING,
  summarizeConcurrent: true,
};

export const DEFAULT_ACCENT: Record<ToastSemanticType, string> = {
  added: "#1f8f5f",
  removed: "#c0392b",
  increased: "#1f8f5f",
  decreased: "#b7791f",
  gift: "#b8860b",
  shipping: "#2d6cdf",
  discount: "#7a3ea1",
  info: "#4a5568",
};

export const DEFAULT_THEME: ToastTheme = {
  mode: "system",
  colorBg: "#ffffff",
  colorText: "#1a1f24",
  accent: DEFAULT_ACCENT,
  cornerRadius: 12,
  shadow: "md",
  border: false,
  borderColor: "#e2e6ea",
  backdropBlur: false,
  width: 340,
  minWidth: 260,
  maxWidth: 480,
  gap: 10,
  density: "comfortable",
  animationIn: "slide",
  animationOut: "fade",
  animationMs: 220,
  showImage: true,
  showPrice: true,
  showDelta: true,
  showIcon: true,
  iconSet: "line",
  fontMode: "system",
  customCss: "",
};

export const DEFAULT_TOAST_CONFIG: ToastAppConfig = {
  version: TOAST_CONFIG_VERSION,
  enabled: false,
  plan: "free",
  global: DEFAULT_GLOBAL,
  theme: DEFAULT_THEME,
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" && value !== null && !Array.isArray(value)
  );
}

/**
 * Resolve a partial/stored config into a complete config by layering it over
 * defaults. Unknown/absent keys fall back to defaults; nested objects
 * (`global`, `global.grouping`, `theme`, `theme.accent`) merge deeply. This is
 * intentionally forgiving: a storefront must never crash on an older or
 * incomplete config.
 */
export function resolveToastConfig(
  stored: StoredToastConfig | null | undefined,
): ToastAppConfig {
  const input: StoredToastConfig = isPlainObject(stored) ? stored : {};

  const grouping: GroupingSettings = {
    ...DEFAULT_GROUPING,
    ...(isPlainObject(input.global?.grouping) ? input.global!.grouping : {}),
  };

  const global: GlobalSettings = {
    ...DEFAULT_GLOBAL,
    ...(isPlainObject(input.global) ? input.global : {}),
    grouping,
  };

  const accent: Record<ToastSemanticType, string> = {
    ...DEFAULT_ACCENT,
    ...(isPlainObject(input.theme?.accent) ? input.theme!.accent : {}),
  };

  const theme: ToastTheme = {
    ...DEFAULT_THEME,
    ...(isPlainObject(input.theme) ? input.theme : {}),
    accent,
  };

  return {
    version: TOAST_CONFIG_VERSION,
    enabled: input.enabled === true,
    plan: input.plan === "pro" ? "pro" : "free",
    global,
    theme,
  };
}
