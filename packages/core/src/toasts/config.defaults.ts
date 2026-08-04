// Canonical defaults + safe resolver for Won Toasts config. Both the admin and
// the storefront import these — so an empty or partial/older stored config
// always resolves to a complete, valid, render-safe config. This is what makes
// "config is the single source of truth" hold even for a fresh install.

import type {
  GlobalSettings,
  GroupingSettings,
  MilestoneRuleConfig,
  StoredToastConfig,
  ToastAppConfig,
  ToastLocale,
  ToastMessages,
  ToastSemanticType,
  ToastTheme,
} from "./config.types.ts";
import {
  DEFAULT_TARGETING,
  type CustomerTarget,
  type DeviceTarget,
  type PageType,
  type ToastTargeting,
} from "./targeting.ts";

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

export const DEFAULT_MESSAGES: ToastMessages = {
  added: { en: "Added to cart", cs: "Přidáno do košíku", sk: "Pridané do košíka" },
  removed: { en: "Removed", cs: "Odebráno", sk: "Odobrané" },
  increased: { en: "Updated", cs: "Aktualizováno", sk: "Aktualizované" },
  decreased: { en: "Updated", cs: "Aktualizováno", sk: "Aktualizované" },
  gift: { en: "Gift unlocked 🎁", cs: "Dárek odemčen 🎁", sk: "Darček odomknutý 🎁" },
  shipping: {
    en: "You’ve got free shipping! 🎉",
    cs: "Máš dopravu zdarma! 🎉",
    sk: "Máš dopravu zadarmo! 🎉",
  },
};

export const DEFAULT_MILESTONES: MilestoneRuleConfig[] = [];

// Canonical allow-lists. These are the single source of truth used both by the
// sanitizers below and by the support-docs reference generator
// (apps/*/scripts/gen-docs.ts) — exported so docs can never drift from code.
export const LOCALES: readonly ToastLocale[] = ["cs", "sk", "en"];

export const DEFAULT_TOAST_CONFIG: ToastAppConfig = {
  version: TOAST_CONFIG_VERSION,
  enabled: false,
  plan: "free",
  global: DEFAULT_GLOBAL,
  theme: DEFAULT_THEME,
  messages: DEFAULT_MESSAGES,
  milestones: DEFAULT_MILESTONES,
  targeting: DEFAULT_TARGETING,
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

/** Sanitized partial global; `grouping` may itself be partial. */
export type SanitizedGlobal = Omit<Partial<GlobalSettings>, "grouping"> & {
  grouping?: Partial<GroupingSettings>;
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
function hex(value: unknown): string | undefined {
  return typeof value === "string" && HEX.test(value.trim())
    ? value.trim()
    : undefined;
}

/**
 * Validate/clamp a partial ToastTheme from the design studio. Invalid values
 * are dropped (not defaulted) so the result can merge onto the shop's current
 * theme. Guardrail: colours must be valid hex; sizes are clamped to sane ranges.
 */
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
  const fontMode = oneOf(input.fontMode, FONT_MODES);
  if (fontMode) out.fontMode = fontMode;

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
    out.customCss = input.customCss.slice(0, 4000);
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
    messages: mergeMessages(input.messages),
    milestones: sanitizeMilestones(input.milestones),
    targeting: sanitizeTargeting(input.targeting),
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

/** Deep-merge stored message overrides over the default templates. */
export function mergeMessages(input: unknown): ToastMessages {
  const out: ToastMessages = {};
  for (const type of SEMANTIC_TYPES) {
    const base = DEFAULT_MESSAGES[type];
    const override =
      isPlainObject(input) && isPlainObject((input as Record<string, unknown>)[type])
        ? ((input as Record<string, Record<string, unknown>>)[type] ?? {})
        : {};
    const merged: Partial<Record<ToastLocale, string>> = { ...(base ?? {}) };
    for (const locale of LOCALES) {
      const value = override[locale];
      if (typeof value === "string" && value.trim()) merged[locale] = value.slice(0, 200);
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
    out.push({
      id: typeof raw.id === "string" && raw.id ? raw.id.slice(0, 60) : String(raw.kind),
      kind: raw.kind as MilestoneRuleConfig["kind"],
      enabled: raw.enabled === true,
      thresholdCents: threshold ?? 0,
      label: typeof raw.label === "string" ? raw.label.slice(0, 80) : String(raw.kind),
    });
    if (out.length >= 20) break;
  }
  return out;
}
