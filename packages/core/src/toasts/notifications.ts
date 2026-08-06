// MVP9+ — "Notifications" (a.k.a. recipes): merchant-configured, page-view /
// aggregate toast rules that are NOT driven by the visitor's own cart diff.
// Every type here is governed by @won/core/toasts/governance (MVP8) on the
// storefront and gated by plan server-side. This is the extensible model the
// admin Recipes page writes and the storefront renders.
//
// Locked principle: REAL data only. countdown uses a real deadline, stock.low a
// real inventory, cart.activity a real server-side counter. Nothing fabricated.

import type { ToastLocale, ToastPlan } from "./config.types.ts";
import {
  DEFAULT_LOCALE,
  normalizeLocale,
  resolveLocalizedText,
} from "./locales.ts";

export type NotificationType =
  | "countdown"
  | "stock.low"
  | "cart.activity"
  | "announcement"
  | "order.summary"
  | "order.created";

export const NOTIFICATION_TYPES: readonly NotificationType[] = [
  "countdown",
  "stock.low",
  "cart.activity",
  "announcement",
  "order.summary",
  "order.created",
];

/** Types whose body is a REAL aggregate (marker data-won-aggregate on render). */
export const AGGREGATE_TYPES: readonly NotificationType[] = [
  "cart.activity",
  "order.summary",
];

/** Where a notification may render. */
export type NotificationSurface = "toast" | "banner" | "persistent-toast" | "inline";
export const NOTIFICATION_SURFACES: readonly NotificationSurface[] = [
  "toast",
  "banner",
  "persistent-toast",
  "inline",
];

/** Page scopes. "all" (or an empty list) means every page. */
export type NotificationPage =
  | "all"
  | "product"
  | "collection"
  | "cart"
  | "home"
  | "search";
export const NOTIFICATION_PAGES: readonly NotificationPage[] = [
  "all",
  "product",
  "collection",
  "cart",
  "home",
  "search",
];

/** Optional per-rule frequency overrides (fall back to global frequency). */
export interface NotificationFrequency {
  maxPerSession?: number;
  cooldownMs?: number;
  suppressAfterDismissMs?: number;
}

interface NotificationBase {
  id: string;
  enabled: boolean;
  surface: NotificationSurface;
  /** Page scopes; empty = all pages. */
  pages: NotificationPage[];
  /** Localizable body; falls back to `message` when a locale is missing. */
  message: string;
  /** Optional per-rule frequency (MVP8 governance) overrides. */
  frequency?: NotificationFrequency;
}

export interface CountdownNotification extends NotificationBase {
  type: "countdown";
  /** Fixed deadline (ISO 8601). Takes precedence over evergreenMs. */
  endsAt?: string;
  /** Evergreen per-session duration in ms. */
  evergreenMs?: number;
}

export interface StockLowNotification extends NotificationBase {
  type: "stock.low";
  /** Show only when 0 < inventory < threshold. */
  threshold: number;
}

export interface CartActivityNotification extends NotificationBase {
  type: "cart.activity";
  /** Aggregation window in hours for the "X people added" counter. */
  windowHours: number;
}

export interface AnnouncementNotification extends NotificationBase {
  type: "announcement";
  /** Localized bodies; `message` (base) is the fallback for missing locales. */
  messages?: Partial<Record<ToastLocale, string>>;
  /** MVP13 A/B: alternate message variants, split deterministically by token. */
  variants?: string[];
}

export interface OrderSummaryNotification extends NotificationBase {
  type: "order.summary";
  /** Aggregation window in hours for the "X orders in the last …" counter. */
  windowHours: number;
}

export interface SocialProofNotification extends NotificationBase {
  type: "order.created";
  /** Privacy toggles: whether to display the shopper's first name / city. */
  showName: boolean;
  showCity: boolean;
  /** Cold-start honesty: don't run until this many real orders exist. */
  minOrders: number;
}

export type NotificationRule =
  | CountdownNotification
  | StockLowNotification
  | CartActivityNotification
  | AnnouncementNotification
  | OrderSummaryNotification
  | SocialProofNotification;

export const DEFAULT_NOTIFICATIONS: NotificationRule[] = [];

/** Which plan a notification type requires. countdown + announcement are Free. */
export function notificationPlanFor(type: NotificationType): ToastPlan {
  return type === "countdown" || type === "announcement" ? "free" : "pro";
}

/** True when a rule may render on the given storefront page type. */
export function notificationOnPage(
  rule: Pick<NotificationRule, "pages">,
  pageType: string,
): boolean {
  const pages = rule.pages ?? [];
  if (pages.length === 0 || pages.includes("all")) return true;
  return (pages as string[]).includes(pageType);
}

/** Locale-aware message. Announcements carry a per-locale map resolved with the
 * shared fallback chain (exact → language → default locale → any); everything
 * else, and any unresolved locale, falls back to the base `message`. */
export function notificationMessage(
  rule: NotificationRule | Pick<NotificationRule, "message">,
  locale: ToastLocale,
  defaultLocale: ToastLocale = DEFAULT_LOCALE,
): string {
  const messages = (rule as AnnouncementNotification).messages;
  // No "any language" catch-all: the base `message` is the author's fallback, so
  // an unrelated language must never win over it.
  const localized = resolveLocalizedText(messages, locale, defaultLocale, {
    allowAny: false,
  });
  return localized || rule.message || "";
}

// ---- sanitation ----

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function clampInt(value: unknown, min: number, max: number): number | undefined {
  const n = Number(value);
  if (!Number.isFinite(n)) return undefined;
  return Math.min(max, Math.max(min, Math.round(n)));
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[]): T | undefined {
  return typeof value === "string" && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : undefined;
}

/** ISO-8601 timestamp string that Date can parse to a finite time. */
function isoOrUndefined(value: unknown): string | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined;
  const t = Date.parse(value);
  return Number.isFinite(t) ? value : undefined;
}

function sanitizePages(input: unknown): NotificationPage[] {
  if (!Array.isArray(input)) return [];
  const out: NotificationPage[] = [];
  for (const p of input) {
    const page = oneOf(p, NOTIFICATION_PAGES);
    if (page && !out.includes(page)) out.push(page);
  }
  return out;
}

function sanitizeLocaleMap(
  input: unknown,
): Partial<Record<ToastLocale, string>> | undefined {
  if (!isPlainObject(input)) return undefined;
  const out: Partial<Record<ToastLocale, string>> = {};
  // Open locale set (locale-as-data): keep any valid BCP-47 key, normalised.
  for (const [rawLoc, v] of Object.entries(input)) {
    const loc = normalizeLocale(rawLoc);
    if (loc && typeof v === "string" && v.trim()) out[loc] = v.slice(0, 200);
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function sanitizeFrequency(input: unknown): NotificationFrequency | undefined {
  if (!isPlainObject(input)) return undefined;
  const out: NotificationFrequency = {};
  const maxPerSession = clampInt(input.maxPerSession, 0, 100);
  if (maxPerSession !== undefined) out.maxPerSession = maxPerSession;
  const cooldownMs = clampInt(input.cooldownMs, 0, 3_600_000);
  if (cooldownMs !== undefined) out.cooldownMs = cooldownMs;
  const suppressAfterDismissMs = clampInt(input.suppressAfterDismissMs, 0, 86_400_000);
  if (suppressAfterDismissMs !== undefined)
    out.suppressAfterDismissMs = suppressAfterDismissMs;
  return Object.keys(out).length > 0 ? out : undefined;
}

/** Validate a notifications array; drop malformed entries. Hard cap of 20. */
export function sanitizeNotifications(input: unknown): NotificationRule[] {
  if (!Array.isArray(input)) return [];
  const out: NotificationRule[] = [];
  const seenIds = new Set<string>();

  for (const raw of input) {
    if (!isPlainObject(raw)) continue;
    const type = oneOf(raw.type, NOTIFICATION_TYPES);
    if (!type) continue;

    const id =
      typeof raw.id === "string" && raw.id.trim()
        ? raw.id.trim().slice(0, 60)
        : type;
    if (seenIds.has(id)) continue; // ids must be unique within a shop
    const surface = oneOf(raw.surface, NOTIFICATION_SURFACES) ?? "toast";
    const base: NotificationBase = {
      id,
      enabled: raw.enabled === true,
      surface,
      pages: sanitizePages(raw.pages),
      message: typeof raw.message === "string" ? raw.message.slice(0, 200) : "",
    };
    const frequency = sanitizeFrequency(raw.frequency);
    if (frequency) base.frequency = frequency;

    let rule: NotificationRule;
    if (type === "countdown") {
      const endsAt = isoOrUndefined(raw.endsAt);
      const evergreenMs = clampInt(raw.evergreenMs, 1000, 30 * 86_400_000);
      rule = { ...base, type, ...(endsAt ? { endsAt } : {}), ...(evergreenMs !== undefined ? { evergreenMs } : {}) };
    } else if (type === "stock.low") {
      rule = { ...base, type, threshold: clampInt(raw.threshold, 1, 100_000) ?? 1 };
    } else if (type === "cart.activity") {
      rule = { ...base, type, windowHours: clampInt(raw.windowHours, 1, 168) ?? 24 };
    } else if (type === "order.summary") {
      // Orders "in the last N days" → window up to 30 days.
      rule = { ...base, type, windowHours: clampInt(raw.windowHours, 1, 720) ?? 24 };
    } else if (type === "order.created") {
      rule = {
        ...base,
        type,
        showName: raw.showName !== false, // default show name
        showCity: raw.showCity !== false, // default show city
        minOrders: clampInt(raw.minOrders, 0, 100_000) ?? 5,
      };
    } else {
      // announcement: optional per-locale i18n bodies + A/B variants.
      const messages = sanitizeLocaleMap(raw.messages);
      const variants = Array.isArray(raw.variants)
        ? raw.variants
            .filter((v): v is string => typeof v === "string" && v.trim().length > 0)
            .map((v) => v.slice(0, 200))
            .slice(0, 5)
        : undefined;
      rule = {
        ...base,
        type,
        ...(messages ? { messages } : {}),
        ...(variants && variants.length ? { variants } : {}),
      };
    }

    seenIds.add(id);
    out.push(rule);
    if (out.length >= 20) break;
  }
  return out;
}
