// Framework-free config contract for Won Toasts. This is the single source of
// truth shared by the admin (writes config), the app-proxy route (serves
// resolved config), the storefront renderer, and the admin live preview.
//
// Golden rule for the whole app: NO behavioural constant is hardcoded in the
// storefront or the engine. Every value below has a default here and is
// overridable from the Shopify admin.

export type ToastPosition =
  | "top-left"
  | "top-center"
  | "top-right"
  | "middle-left"
  | "middle-center"
  | "middle-right"
  | "bottom-left"
  | "bottom-center"
  | "bottom-right";

export type OverflowStrategy = "queue" | "collapse";
export type StackDirection = "newest-top" | "newest-bottom";
export type GroupingMode = "off" | "by-product" | "by-variant" | "by-type";
export type ClickAction = "none" | "open-cart" | "go-to-product";

export interface GroupingSettings {
  mode: GroupingMode;
  /** Burst window in ms — rapid events within this window merge into one. */
  burstWindowMs: number;
  /** Merge repeated quantity changes into a single "+N" delta. */
  mergeDeltas: boolean;
  /** Drop duplicate events sharing a group key within this window. */
  dedupeWindowMs: number;
  /** Hard ceiling on how many toasts may be shown per minute. */
  rateLimitPerMin: number;
}

/** MVP8 — frequency governance. Caps how often toasts (esp. page-view types)
 * may appear, and a global mute. The storefront enforces these via
 * @won/core/toasts/governance before rendering. */
export interface FrequencySettings {
  /** Max toasts per session across all rules (0 = unlimited). */
  maxPerSession: number;
  /** Minimum ms between emits of the same rule. */
  cooldownMs: number;
  /** After a dismiss, hide the same group for this long (ms). */
  suppressAfterDismissMs: number;
  /** Global mute — when true, nothing is shown. */
  quietMode: boolean;
}

export interface GlobalSettings {
  position: ToastPosition;
  offsetTop: number;
  offsetInline: number;
  durationMs: number;
  autoDismiss: boolean;
  pauseOnHover: boolean;
  closeable: boolean;
  clickAction: ClickAction;
  maxVisible: number;
  overflowStrategy: OverflowStrategy;
  stackDirection: StackDirection;
  grouping: GroupingSettings;
  frequency: FrequencySettings;
  /** When 2+ reward milestones fire together, merge into one summary toast. */
  summarizeConcurrent: boolean;
}

export type ThemeMode = "system" | "light" | "dark" | "custom";
export type ShadowLevel = "none" | "sm" | "md" | "lg";
export type Density = "compact" | "comfortable";
export type AnimationKind = "slide" | "fade" | "pop" | "slide-scale";
export type IconSet = "emoji" | "line" | "none";
export type FontMode = "system" | "inherit-theme" | "custom";

/** Semantic event kinds — accent colours and icons key off these. */
export type ToastSemanticType =
  | "added"
  | "removed"
  | "increased"
  | "decreased"
  | "gift"
  | "shipping"
  | "discount"
  | "info";

export interface ToastTheme {
  mode: ThemeMode;
  colorBg: string;
  colorText: string;
  accent: Record<ToastSemanticType, string>;
  cornerRadius: number;
  shadow: ShadowLevel;
  border: boolean;
  borderColor: string;
  backdropBlur: boolean;
  width: number;
  minWidth: number;
  maxWidth: number;
  gap: number;
  density: Density;
  animationIn: AnimationKind;
  animationOut: AnimationKind;
  animationMs: number;
  showImage: boolean;
  showPrice: boolean;
  showDelta: boolean;
  showIcon: boolean;
  iconSet: IconSet;
  fontMode: FontMode;
  /** Pro-only raw CSS injected into the shadow root. Empty by default. */
  customCss: string;
}

import type { ToastTargeting } from "./targeting.ts";

export type ToastPlan = "free" | "pro";

export type ToastLocale = "cs" | "sk" | "en";

/** Editable message templates: event type → locale → template string. */
export type ToastMessages = Partial<
  Record<ToastSemanticType, Partial<Record<ToastLocale, string>>>
>;

export type MilestoneKind = "free_shipping" | "gift" | "qty_discount";

export interface MilestoneRuleConfig {
  id: string;
  kind: MilestoneKind;
  enabled: boolean;
  /** Threshold in minor units (cents/haléře); must match the real shipping rate. */
  thresholdCents: number;
  label: string;
}

export interface ToastAppConfig {
  /** Schema version — bump on breaking config shape changes; enables migration. */
  version: number;
  enabled: boolean;
  plan: ToastPlan;
  global: GlobalSettings;
  theme: ToastTheme;
  messages: ToastMessages;
  milestones: MilestoneRuleConfig[];
  targeting: ToastTargeting;
}

/** Partial persisted config as stored/sent over the wire (any depth may be absent). */
export interface StoredToastConfig {
  version?: number;
  enabled?: boolean;
  plan?: ToastPlan;
  global?: Omit<Partial<GlobalSettings>, "grouping" | "frequency"> & {
    grouping?: Partial<GroupingSettings>;
    frequency?: Partial<FrequencySettings>;
  };
  theme?: Omit<Partial<ToastTheme>, "accent"> & {
    accent?: Partial<Record<ToastSemanticType, string>>;
  };
  messages?: ToastMessages;
  milestones?: MilestoneRuleConfig[];
  targeting?: Partial<ToastTargeting>;
}
