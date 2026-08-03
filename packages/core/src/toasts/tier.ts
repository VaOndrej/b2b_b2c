// Tier gating — Free vs Pro. Principle (locked): Pro gates SCOPE, never quality.
// Free keeps all cart events, accessibility, localization, preview and the
// default look; Pro unlocks the design studio, advanced grouping, targeting,
// custom CSS, unlimited milestones, analytics and brand removal.

import { DEFAULT_THEME } from "./config.defaults.ts";
import type { ToastAppConfig, ToastPlan } from "./config.types.ts";
import { DEFAULT_TARGETING } from "./targeting.ts";

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
    milestones: config.milestones.slice(0, FREE_MILESTONE_LIMIT),
    targeting: DEFAULT_TARGETING, // targeting is a Pro feature
    // Free keeps global behaviour (position, duration, basic grouping) and
    // messages/localization — those are usability, not scope.
  };
}

/** Whether the "Powered by Won" badge should show (Free only). */
export function showsBranding(plan: ToastPlan): boolean {
  return plan !== "pro";
}
