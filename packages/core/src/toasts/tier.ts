// Tier gating — Free vs Pro. Principle (locked): Pro gates SCOPE, never quality.
// Free keeps all cart events, accessibility, localization, preview and the
// default look; Pro unlocks the design studio, advanced grouping, targeting,
// custom CSS, unlimited milestones, analytics and brand removal.

import { DEFAULT_GROUPING, DEFAULT_THEME } from "./config.defaults.ts";
import type { ToastAppConfig, ToastPlan } from "./config.types.ts";
import { DEFAULT_TARGETING } from "./targeting.ts";
import { notificationPlanFor } from "./notifications.ts";
import { capLocaleSettingsForPlan } from "./locales.ts";

export type ProFeature =
  | "design_studio"
  | "advanced_grouping"
  | "custom_css"
  | "targeting"
  | "unlimited_milestones"
  | "remove_branding"
  | "analytics"
  | "experiments";

export const PRO_FEATURES: readonly ProFeature[] = [
  "design_studio",
  "advanced_grouping",
  "custom_css",
  "targeting",
  "unlimited_milestones",
  "remove_branding",
  "analytics",
  "experiments",
];

/** Free can use everything that is NOT a Pro-gated feature. */
export function isFeatureAllowed(plan: ToastPlan, feature: ProFeature): boolean {
  return plan === "pro" || !PRO_FEATURES.includes(feature);
}

/** How many milestone rules a plan may have active. */
export const FREE_MILESTONE_LIMIT = 2;

/**
 * The per-session toast cap Free is held to.
 *
 * Deliberately NOT "Free has no cap" and NOT "capping is Pro". A shopper must
 * never be floodable — that protection is quality, and Pro gates scope, never
 * quality (see the file header). What Pro buys is CONTROL of the number,
 * including raising it or setting 0 for unlimited. So Free gets a sane fixed
 * ceiling it cannot raise, and the admin says so plainly instead of showing an
 * editable field that the server would silently override (BILL-1).
 */
export const FREE_MAX_PER_SESSION = 5;

/**
 * How many per-currency free-shipping thresholds Free may keep.
 *
 * Same shape as the language limit: tiered by COUNT, not by quality. A store
 * selling in one or two currencies is fully served on Free; a store selling in
 * more is the one Pro is for.
 */
export const FREE_CURRENCY_LIMIT = 2;

/**
 * Keep at most `limit` currency thresholds, deterministically (alphabetical by
 * ISO code) so the same two survive on every read — a cap that silently picked a
 * different pair per request would make a shopper's free-shipping bar flicker.
 */
export function capCurrencyThresholds(
  thresholds: Record<string, number> | undefined,
  limit: number,
): Record<string, number> | undefined {
  if (!thresholds) return thresholds;
  const codes = Object.keys(thresholds).sort();
  if (codes.length <= limit) return thresholds;
  const kept: Record<string, number> = {};
  for (const code of codes.slice(0, limit)) kept[code] = thresholds[code];
  return kept;
}

/**
 * The cap actually in force for a plan. The admin MUST render this rather than
 * the stored value, or a Free merchant reads "no session cap" while the server
 * is enforcing 5 — a header stating something the config doesn't guarantee
 * (§17c).
 */
export function effectiveMaxPerSession(
  plan: ToastPlan,
  configured: number,
): number {
  return plan === "pro" ? configured : FREE_MAX_PER_SESSION;
}

/**
 * Return the config the storefront should actually use for this plan. On Free
 * we force the default look (no design studio), clear custom CSS, and cap active
 * milestones — but never touch behaviour that affects usability/accessibility.
 * Applied server-side in the app-proxy route so the storefront just renders it.
 */
export function gateConfigForPlan(config: ToastAppConfig): ToastAppConfig {
  if (config.plan === "pro") return config;
  return {
    ...config,
    theme: DEFAULT_THEME,
    // Per-type look/behaviour overrides are a Pro scope (the design studio); Free
    // renders every type with the default look.
    byType: {},
    milestones: config.milestones
      .slice(0, FREE_MILESTONE_LIMIT)
      .map((m) => ({
        ...m,
        thresholds: capCurrencyThresholds(m.thresholds, FREE_CURRENCY_LIMIT),
      })),
    targeting: DEFAULT_TARGETING, // targeting is a Pro feature
    // Free keeps countdown notifications (real deadline urgency) but not the
    // Pro-only page-view types. Quality is never gated — only scope.
    notifications: config.notifications.filter(
      (n) => notificationPlanFor(n.type) === "free",
    ),
    // Localization is tiered by COUNT (not quality): Free ships up to 2 languages
    // (the default is always kept), Pro ships many. Messages themselves stay
    // fully editable on Free — only the number of languages is a Pro scope.
    locales: capLocaleSettingsForPlan(config.locales, "free"),
    // Free keeps global behaviour (position, duration, basic grouping) — but the
    // per-session cap is pinned, so no Free store can flood a shopper by setting
    // it to 0. Pro owns the number.
    global: {
      ...config.global,
      // `advanced_grouping` is a Pro feature and the admin locks those fields —
      // but the UI lock is only a courtesy (BILL-1). Without this, a store that
      // downgraded from Pro kept being SERVED its tuned merge window, rate limit
      // and dedupe settings forever. Free falls back to the defaults, which still
      // merge sensibly: Pro buys control of the numbers, not merging itself.
      grouping: DEFAULT_GROUPING,
      frequency: {
        ...config.global.frequency,
        maxPerSession: FREE_MAX_PER_SESSION,
      },
    },
  };
}

/** Whether the "Powered by Won" badge should show (Free only). */
export function showsBranding(plan: ToastPlan): boolean {
  return plan !== "pro";
}
