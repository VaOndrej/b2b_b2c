// Canonical defaults + safe resolver for Won Toasts config. Both the admin and
// the storefront import these — so an empty or partial/older stored config
// always resolves to a complete, valid, render-safe config. This is what makes
// "config is the single source of truth" hold even for a fresh install.

import type {
  ClickAction,
  FrequencySettings,
  GlobalSettings,
  GroupingSettings,
  MilestoneRuleConfig,
  StoredToastConfig,
  ToastAppConfig,
  ToastMessages,
  ToastSemanticType,
  ToastTheme,
  ToastTypeBehaviorOverride,
  ToastTypeKey,
  ToastTypeOverride,
} from "./config.types.ts";
import { TOAST_TYPE_KEYS } from "./type-style.ts";
import {
  DEFAULT_LOCALE_SETTINGS,
  normalizeLocale,
  sanitizeLocaleSettings,
} from "./locales.ts";
import {
  DEFAULT_TARGETING,
  type CustomerTarget,
  type DeviceTarget,
  type PageType,
  type ToastTargeting,
} from "./targeting.ts";
import {
  DEFAULT_NOTIFICATIONS,
  sanitizeNotifications,
} from "./notifications.ts";
import {
  DEFAULT_EXCLUSIONS,
  sanitizeExclusions,
} from "./exclusions.ts";

const SEMANTIC_TYPES: readonly ToastSemanticType[] = [
  "added",
  "removed",
  "increased",
  "decreased",
  "gift",
  "shipping",
  "discount",
  "info",
];

/** Current config schema version. Bump when the shape changes incompatibly. */
export const TOAST_CONFIG_VERSION = 1;

export const DEFAULT_GROUPING: GroupingSettings = {
  mode: "by-product",
  burstWindowMs: 600,
  mergeDeltas: true,
  dedupeWindowMs: 1000,
  rateLimitPerMin: 30,
};

export const DEFAULT_FREQUENCY: FrequencySettings = {
  maxPerSession: 0,
  cooldownMs: 0,
  suppressAfterDismissMs: 0,
  quietMode: false,
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
  frequency: DEFAULT_FREQUENCY,
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
  gradient: false,
  gradientColor: "#f2f4f7",
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
  // Icons off by default — cleaner out of the box; merchants opt into a dot or
  // their own emoji per event in Design → Branding.
  iconSet: "none",
  fontMode: "system",
  fontFamily: "",
  customCss: "",
};

// The product ships ONE default language (English) as the fallback. Every other
// language is merchant-supplied DATA (locale-as-data, doctrine §5) — no cs/sk/…
// is baked in. Merchants add their own via the Languages settings.
export const DEFAULT_MESSAGES: ToastMessages = {
  added: { en: "Added to cart" },
  removed: { en: "Removed" },
  increased: { en: "Updated" },
  decreased: { en: "Updated" },
  gift: { en: "Gift unlocked" },
  shipping: { en: "You’ve got free shipping!" },
};

export const DEFAULT_MILESTONES: MilestoneRuleConfig[] = [];

export const DEFAULT_TOAST_CONFIG: ToastAppConfig = {
  version: TOAST_CONFIG_VERSION,
  enabled: false,
  plan: "free",
  global: DEFAULT_GLOBAL,
  theme: DEFAULT_THEME,
  byType: {},
  cartEvents: {},
  messages: DEFAULT_MESSAGES,
  locales: DEFAULT_LOCALE_SETTINGS,
  milestones: DEFAULT_MILESTONES,
  targeting: DEFAULT_TARGETING,
  notifications: DEFAULT_NOTIFICATIONS,
  exclusions: DEFAULT_EXCLUSIONS,
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" && value !== null && !Array.isArray(value)
  );
}

export const POSITIONS: readonly GlobalSettings["position"][] = [
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
export const CLICK_ACTIONS: readonly GlobalSettings["clickAction"][] = [
  "none",
  "open-cart",
  "go-to-product",
];
export const OVERFLOW: readonly GlobalSettings["overflowStrategy"][] = [
  "queue",
  "collapse",
];
export const STACK: readonly GlobalSettings["stackDirection"][] = [
  "newest-top",
  "newest-bottom",
];
export const GROUPING_MODES: readonly GroupingSettings["mode"][] = [
  "off",
  "by-product",
  "by-variant",
  "by-type",
];

/** Sanitized partial global; `grouping`/`frequency` may themselves be partial. */
export type SanitizedGlobal = Omit<
  Partial<GlobalSettings>,
  "grouping" | "frequency"
> & {
  grouping?: Partial<GroupingSettings>;
  frequency?: Partial<FrequencySettings>;
};

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
 * Validate a per-currency thresholds map: keys must be ISO 4217-shaped (3 ASCII
 * letters, upper-cased), values non-negative integer minor units. Drops junk;
 * returns undefined when nothing valid remains (so we never store an empty map).
 */
function sanitizeCurrencyThresholds(
  input: unknown,
): Record<string, number> | undefined {
  if (!isPlainObject(input)) return undefined;
  const out: Record<string, number> = {};
  let count = 0;
  for (const [rawCode, rawAmount] of Object.entries(input)) {
    const code = String(rawCode).trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(code)) continue;
    const amount = clampInt(rawAmount, 0, 100_000_000);
    if (amount === undefined) continue;
    out[code] = amount;
    if (++count >= 25) break; // Markets caps at 50; 25 currencies is plenty
  }
  return count ? out : undefined;
}

/**
 * Validate/clamp a partial GlobalSettings from admin input. Invalid or unknown
 * fields are DROPPED (not defaulted) so callers can merge the result onto the
 * shop's current config without clobbering unrelated values. This is the single
 * guardrail that keeps a merchant from saving an unusable config.
 */
export function sanitizeGlobalSettings(input: unknown): SanitizedGlobal {
  if (!isPlainObject(input)) return {};
  const out: SanitizedGlobal = {};

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

  if (isPlainObject(input.grouping)) {
    const g = input.grouping;
    const gr: Partial<GroupingSettings> = {};
    const mode = oneOf(g.mode, GROUPING_MODES);
    if (mode) gr.mode = mode;
    const burstWindowMs = clampInt(g.burstWindowMs, 0, 5000);
    if (burstWindowMs !== undefined) gr.burstWindowMs = burstWindowMs;
    const dedupeWindowMs = clampInt(g.dedupeWindowMs, 0, 10000);
    if (dedupeWindowMs !== undefined) gr.dedupeWindowMs = dedupeWindowMs;
    const rateLimitPerMin = clampInt(g.rateLimitPerMin, 0, 240);
    if (rateLimitPerMin !== undefined) gr.rateLimitPerMin = rateLimitPerMin;
    if (typeof g.mergeDeltas === "boolean") gr.mergeDeltas = g.mergeDeltas;
    if (Object.keys(gr).length > 0) out.grouping = gr;
  }

  if (isPlainObject(input.frequency)) {
    const fr = input.frequency;
    const freq: Partial<FrequencySettings> = {};
    const maxPerSession = clampInt(fr.maxPerSession, 0, 100);
    if (maxPerSession !== undefined) freq.maxPerSession = maxPerSession;
    const cooldownMs = clampInt(fr.cooldownMs, 0, 3_600_000);
    if (cooldownMs !== undefined) freq.cooldownMs = cooldownMs;
    const suppressAfterDismissMs = clampInt(fr.suppressAfterDismissMs, 0, 86_400_000);
    if (suppressAfterDismissMs !== undefined)
      freq.suppressAfterDismissMs = suppressAfterDismissMs;
    if (typeof fr.quietMode === "boolean") freq.quietMode = fr.quietMode;
    if (Object.keys(freq).length > 0) out.frequency = freq;
  }

  return out;
}

export const THEME_MODES: readonly ToastTheme["mode"][] = [
  "system",
  "light",
  "dark",
  "custom",
];
export const SHADOW_LEVELS: readonly ToastTheme["shadow"][] = ["none", "sm", "md", "lg"];
export const DENSITIES: readonly ToastTheme["density"][] = ["compact", "comfortable"];
export const ANIMATIONS: readonly ToastTheme["animationIn"][] = [
  "slide",
  "fade",
  "pop",
  "slide-scale",
];
export const ICON_SETS: readonly ToastTheme["iconSet"][] = ["emoji", "line", "none"];
const FONT_MODES: readonly ToastTheme["fontMode"][] = [
  "system",
  "inherit-theme",
  "custom",
];

const HEX = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
// Colours are stored canonically in lowercase. Admin colour inputs (s-color-field)
// emit uppercase hex; without normalising, every "unchanged" colour would look
// different from the lowercase defaults and get written as a spurious per-type
// override on every save. Canonical case keeps stored config clean and diffable.
function hex(value: unknown): string | undefined {
  return typeof value === "string" && HEX.test(value.trim())
    ? value.trim().toLowerCase()
    : undefined;
}

/**
 * Validate/clamp a partial ToastTheme from the design studio. Invalid values
 * are dropped (not defaulted) so the result can merge onto the shop's current
 * theme. Guardrail: colours must be valid hex; sizes are clamped to sane ranges.
 */
// SEC-3 (defense-in-depth): merchant custom CSS is injected as <style> textContent
// inside a shadow root, so it can't break out today — but a dangerous state must be
// unrepresentable even if a future surface injects it differently. Valid CSS never
// contains `<` or `>`, so stripping them fully prevents tag/`</style>` breakout;
// we also neutralize the `javascript:` scheme and legacy CSS `expression()`.
export function sanitizeCustomCss(raw: string): string {
  return raw
    .replace(/[<>]/g, "")
    .replace(/javascript:/gi, "")
    .replace(/expression\s*\(/gi, "")
    .slice(0, 4000);
}

export function sanitizeTheme(input: unknown): Partial<ToastTheme> {
  if (!isPlainObject(input)) return {};
  const out: Partial<ToastTheme> = {};

  const mode = oneOf(input.mode, THEME_MODES);
  if (mode) out.mode = mode;

  const colorBg = hex(input.colorBg);
  if (colorBg) out.colorBg = colorBg;
  const colorText = hex(input.colorText);
  if (colorText) out.colorText = colorText;

  if (isPlainObject(input.accent)) {
    const accent: Partial<Record<ToastSemanticType, string>> = {};
    for (const type of SEMANTIC_TYPES) {
      const value = hex((input.accent as Record<string, unknown>)[type]);
      if (value) accent[type] = value;
    }
    if (Object.keys(accent).length > 0) {
      out.accent = accent as ToastTheme["accent"];
    }
  }

  const cornerRadius = clampInt(input.cornerRadius, 0, 32);
  if (cornerRadius !== undefined) out.cornerRadius = cornerRadius;
  const width = clampInt(input.width, 240, 600);
  if (width !== undefined) out.width = width;
  const minWidth = clampInt(input.minWidth, 200, 600);
  if (minWidth !== undefined) out.minWidth = minWidth;
  const maxWidth = clampInt(input.maxWidth, 240, 720);
  if (maxWidth !== undefined) out.maxWidth = maxWidth;
  const gap = clampInt(input.gap, 0, 40);
  if (gap !== undefined) out.gap = gap;
  const animationMs = clampInt(input.animationMs, 0, 1200);
  if (animationMs !== undefined) out.animationMs = animationMs;

  const shadow = oneOf(input.shadow, SHADOW_LEVELS);
  if (shadow) out.shadow = shadow;
  const density = oneOf(input.density, DENSITIES);
  if (density) out.density = density;
  const animationIn = oneOf(input.animationIn, ANIMATIONS);
  if (animationIn) out.animationIn = animationIn;
  const animationOut = oneOf(input.animationOut, ANIMATIONS);
  if (animationOut) out.animationOut = animationOut;
  const iconSet = oneOf(input.iconSet, ICON_SETS);
  if (iconSet) out.iconSet = iconSet;
  if (isPlainObject(input.iconEmojis)) {
    const iconEmojis: Partial<Record<ToastSemanticType, string>> = {};
    for (const type of SEMANTIC_TYPES) {
      const v = (input.iconEmojis as Record<string, unknown>)[type];
      if (typeof v === "string" && v.trim()) {
        iconEmojis[type] = v.replace(/[<>{}]/g, "").trim().slice(0, 12);
      }
    }
    if (Object.keys(iconEmojis).length > 0) out.iconEmojis = iconEmojis;
  }
  const fontMode = oneOf(input.fontMode, FONT_MODES);
  if (fontMode) out.fontMode = fontMode;
  if (typeof input.fontFamily === "string") {
    // Custom font family: strip characters that could break out of the CSS
    // value (no braces/semicolons/angle brackets), cap length.
    out.fontFamily = input.fontFamily.replace(/[<>{};]/g, "").slice(0, 120);
  }

  if (typeof input.gradient === "boolean") out.gradient = input.gradient;
  const gradientColor = hex(input.gradientColor);
  if (gradientColor) out.gradientColor = gradientColor;
  if (typeof input.border === "boolean") out.border = input.border;
  const borderColor = hex(input.borderColor);
  if (borderColor) out.borderColor = borderColor;
  if (typeof input.backdropBlur === "boolean")
    out.backdropBlur = input.backdropBlur;
  if (typeof input.showImage === "boolean") out.showImage = input.showImage;
  if (typeof input.showPrice === "boolean") out.showPrice = input.showPrice;
  if (typeof input.showDelta === "boolean") out.showDelta = input.showDelta;
  if (typeof input.showIcon === "boolean") out.showIcon = input.showIcon;

  if (typeof input.customCss === "string") {
    out.customCss = sanitizeCustomCss(input.customCss);
  }

  return out;
}

function sanitizeTypeBehavior(input: unknown): ToastTypeBehaviorOverride | undefined {
  if (!isPlainObject(input)) return undefined;
  const out: ToastTypeBehaviorOverride = {};
  const durationMs = clampInt(input.durationMs, 800, 60000);
  if (durationMs !== undefined) out.durationMs = durationMs;
  if (CLICK_ACTIONS.includes(input.clickAction as ClickAction)) {
    out.clickAction = input.clickAction as ClickAction;
  }
  if (typeof input.autoDismiss === "boolean") out.autoDismiss = input.autoDismiss;
  if (typeof input.pauseOnHover === "boolean") out.pauseOnHover = input.pauseOnHover;
  if (typeof input.closeable === "boolean") out.closeable = input.closeable;
  return Object.keys(out).length > 0 ? out : undefined;
}

/** The cart events that can be individually turned off (deltas). gift/shipping
 *  are gated by their milestone toggles, not here. */
const CART_EVENT_TYPES: readonly ToastSemanticType[] = [
  "added",
  "removed",
  "increased",
  "decreased",
];

/** Sanitize per cart-event on/off: only known event types, only booleans, and
 *  only store the OFF ones (default is on) so the map stays sparse. */
export function sanitizeCartEvents(
  input: unknown,
): Partial<Record<ToastSemanticType, boolean>> {
  const out: Partial<Record<ToastSemanticType, boolean>> = {};
  if (!isPlainObject(input)) return out;
  for (const type of CART_EVENT_TYPES) {
    if (input[type] === false) out[type] = false;
  }
  return out;
}

/** Is this cart event enabled? Absent = on (back-compat). */
export function cartEventEnabled(
  config: { cartEvents: Partial<Record<ToastSemanticType, boolean>> },
  type: ToastSemanticType,
): boolean {
  return config.cartEvents[type] !== false;
}

/** Sanitize the per-type override map: each type keeps only valid theme/behaviour
 *  overrides; empty overrides are dropped so byType stays sparse. */
export function sanitizeByType(
  input: unknown,
): Partial<Record<ToastTypeKey, ToastTypeOverride>> {
  const out: Partial<Record<ToastTypeKey, ToastTypeOverride>> = {};
  if (!isPlainObject(input)) return out;
  for (const key of TOAST_TYPE_KEYS) {
    const raw = input[key];
    if (!isPlainObject(raw)) continue;
    const override: ToastTypeOverride = {};
    const theme = sanitizeTheme(raw.theme);
    if (Object.keys(theme).length > 0) override.theme = theme;
    const behavior = sanitizeTypeBehavior(raw.behavior);
    if (behavior) override.behavior = behavior;
    if (override.theme || override.behavior) out[key] = override;
  }
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

  const frequency: FrequencySettings = {
    ...DEFAULT_FREQUENCY,
    ...(isPlainObject(input.global?.frequency) ? input.global!.frequency : {}),
  };

  const global: GlobalSettings = {
    ...DEFAULT_GLOBAL,
    ...(isPlainObject(input.global) ? input.global : {}),
    grouping,
    frequency,
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
    byType: sanitizeByType(input.byType),
    cartEvents: sanitizeCartEvents(input.cartEvents),
    messages: mergeMessages(input.messages),
    locales: sanitizeLocaleSettings(input.locales),
    milestones: sanitizeMilestones(input.milestones),
    targeting: sanitizeTargeting(input.targeting),
    notifications: sanitizeNotifications(input.notifications),
    exclusions: sanitizeExclusions(input.exclusions),
  };
}

const PAGE_TYPES = new Set<PageType>([
  "product",
  "collection",
  "cart",
  "home",
  "search",
  "other",
]);
const DEVICE_TARGETS: readonly DeviceTarget[] = ["both", "mobile", "desktop"];
const CUSTOMER_TARGETS: readonly CustomerTarget[] = [
  "both",
  "guest",
  "logged-in",
];

/** Validate targeting; unknown values fall back to defaults. */
export function sanitizeTargeting(input: unknown): ToastTargeting {
  if (!isPlainObject(input)) return DEFAULT_TARGETING;
  const pages = Array.isArray(input.pages)
    ? (input.pages.filter((p) => PAGE_TYPES.has(p as PageType)) as PageType[])
    : [];
  return {
    pages,
    device: oneOf(input.device, DEVICE_TARGETS) ?? "both",
    customerState: oneOf(input.customerState, CUSTOMER_TARGETS) ?? "both",
  };
}

/**
 * Deep-merge stored message overrides over the English defaults. Locale keys are
 * open (any BCP-47 tag the merchant added); each is normalised and length-capped.
 * The default `en` template is always kept as the fallback.
 */
export function mergeMessages(input: unknown): ToastMessages {
  const out: ToastMessages = {};
  for (const type of SEMANTIC_TYPES) {
    const base = DEFAULT_MESSAGES[type];
    const override =
      isPlainObject(input) && isPlainObject((input as Record<string, unknown>)[type])
        ? ((input as Record<string, Record<string, unknown>>)[type] ?? {})
        : {};
    const merged: Record<string, string> = {};
    for (const [k, v] of Object.entries(base ?? {})) {
      if (typeof v === "string") merged[k] = v;
    }
    for (const [rawLocale, value] of Object.entries(override)) {
      const locale = normalizeLocale(rawLocale);
      if (locale && typeof value === "string" && value.trim()) {
        merged[locale] = value.slice(0, 200);
      }
    }
    if (Object.keys(merged).length > 0) out[type] = merged;
  }
  return out;
}

export const MILESTONE_KINDS = new Set(["free_shipping", "gift", "qty_discount"]);

/** Validate a milestones array; drop malformed entries. */
export function sanitizeMilestones(input: unknown): MilestoneRuleConfig[] {
  if (!Array.isArray(input)) return [];
  const out: MilestoneRuleConfig[] = [];
  for (const raw of input) {
    if (!isPlainObject(raw)) continue;
    if (!MILESTONE_KINDS.has(String(raw.kind))) continue;
    const threshold = clampInt(raw.thresholdCents, 0, 100_000_000);
    const thresholds = sanitizeCurrencyThresholds(raw.thresholds);
    out.push({
      id: typeof raw.id === "string" && raw.id ? raw.id.slice(0, 60) : String(raw.kind),
      kind: raw.kind as MilestoneRuleConfig["kind"],
      enabled: raw.enabled === true,
      thresholdCents: threshold ?? 0,
      ...(thresholds ? { thresholds } : {}),
      label: typeof raw.label === "string" ? raw.label.slice(0, 80) : String(raw.kind),
    });
    if (out.length >= 20) break;
  }
  return out;
}
