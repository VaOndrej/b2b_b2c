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

const POSITIONS: readonly GlobalSettings["position"][] = [
  "top-left",
  "top-center",
  "top-right",
  "middle-left",
  "middle-center",
  "middle-right",
  "bottom-left",
  "bottom-center",
  "bottom-right",
];
const CLICK_ACTIONS: readonly GlobalSettings["clickAction"][] = [
  "none",
  "open-cart",
  "go-to-product",
];
const OVERFLOW: readonly GlobalSettings["overflowStrategy"][] = [
  "queue",
  "collapse",
];
const STACK: readonly GlobalSettings["stackDirection"][] = [
  "newest-top",
  "newest-bottom",
];

function clampInt(value: unknown, min: number, max: number): number | undefined {
  const n = Number(value);
  if (!Number.isFinite(n)) return undefined;
  return Math.min(max, Math.max(min, Math.round(n)));
}
function oneOf<T extends string>(
  value: unknown,
  allowed: readonly T[],
): T | undefined {
  return typeof value === "string" && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : undefined;
}

/**
 * Validate/clamp a partial GlobalSettings from admin input. Invalid or unknown
 * fields are DROPPED (not defaulted) so callers can merge the result onto the
 * shop's current config without clobbering unrelated values. This is the single
 * guardrail that keeps a merchant from saving an unusable config.
 */
export function sanitizeGlobalSettings(
  input: unknown,
): Partial<GlobalSettings> {
  if (!isPlainObject(input)) return {};
  const out: Partial<GlobalSettings> = {};

  const position = oneOf(input.position, POSITIONS);
  if (position) out.position = position;

  const offsetTop = clampInt(input.offsetTop, 0, 400);
  if (offsetTop !== undefined) out.offsetTop = offsetTop;
  const offsetInline = clampInt(input.offsetInline, 0, 400);
  if (offsetInline !== undefined) out.offsetInline = offsetInline;

  // durationMs floor of 800ms is a guardrail: shorter is unreadable.
  const durationMs = clampInt(input.durationMs, 800, 60000);
  if (durationMs !== undefined) out.durationMs = durationMs;

  const maxVisible = clampInt(input.maxVisible, 1, 6);
  if (maxVisible !== undefined) out.maxVisible = maxVisible;

  if (typeof input.autoDismiss === "boolean") out.autoDismiss = input.autoDismiss;
  if (typeof input.pauseOnHover === "boolean")
    out.pauseOnHover = input.pauseOnHover;
  if (typeof input.closeable === "boolean") out.closeable = input.closeable;

  const clickAction = oneOf(input.clickAction, CLICK_ACTIONS);
  if (clickAction) out.clickAction = clickAction;
  const overflowStrategy = oneOf(input.overflowStrategy, OVERFLOW);
  if (overflowStrategy) out.overflowStrategy = overflowStrategy;
  const stackDirection = oneOf(input.stackDirection, STACK);
  if (stackDirection) out.stackDirection = stackDirection;

  return out;
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
