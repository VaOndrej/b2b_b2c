// The five modules + campaigns + appearance (docs/won-discounts/rozhodnuti.md,
// Admin IA). MVP 1 ships Slevy a kódy, MVP 2 Ochrana marže, MVP 3 Množstevní
// slevy and Vzhled, MVP 4 Odměny, MVP 5 Výprodej, MVP 6 Kampaně; a module not built yet would be visible — each has a real
// page that says so and links onward (§13b: never a dead end). Every module
// stays in the nav, built or not.

import type { OnboardingGoal } from "@won/core/discounts/config";

import { t, type Locale, type MessageKey } from "../../i18n";

/** Every module in the nav, in the default order. */
export const ADMIN_MODULES = ["tiers", "rewards", "outlet", "margin", "campaigns", "appearance"] as const;
export type AdminModule = (typeof ADMIN_MODULES)[number];

/** Modules with their own screen (a static route, e.g. app.margin.tsx, wins over app.$module.tsx). */
export const BUILT_MODULES = ["margin", "tiers", "rewards", "outlet", "campaigns", "appearance"] as const satisfies readonly AdminModule[];

/** Modules that are visible but not built yet (app.$module.tsx → ComingSoonScreen). */
// MVP 6: Kampaně shipped — nothing is "coming soon" any more (the machinery stays for a later module).
export const UPCOMING_MODULES: readonly AdminModule[] = [];
/** A module listed in UPCOMING_MODULES (none today; isUpcomingModule decides at runtime). */
export type UpcomingModule = AdminModule;

export interface ModuleMeta {
  key: AdminModule;
  title: MessageKey;
  nav: MessageKey;
  body: MessageKey;
  pro: boolean;
}

export const MODULE_META: Readonly<Record<AdminModule, ModuleMeta>> = {
  tiers: { key: "tiers", title: "module.tiers", nav: "nav.tiers", body: "soon.tiers", pro: false },
  rewards: { key: "rewards", title: "module.rewards", nav: "nav.rewards", body: "soon.rewards", pro: false },
  outlet: { key: "outlet", title: "module.outlet", nav: "nav.outlet", body: "soon.outlet", pro: true },
  margin: { key: "margin", title: "module.margin", nav: "nav.margin", body: "soon.margin", pro: false },
  campaigns: { key: "campaigns", title: "module.campaigns", nav: "nav.campaigns", body: "soon.campaigns", pro: true },
  appearance: { key: "appearance", title: "module.appearance", nav: "nav.appearance", body: "soon.appearance", pro: false },
};

/** The not-yet-built modules' meta (ComingSoonScreen, Přehled "Další moduly"). */
export const UPCOMING_MODULE_META: Readonly<Record<UpcomingModule, ModuleMeta>> = MODULE_META;

export function isUpcomingModule(v: unknown): v is UpcomingModule {
  return typeof v === "string" && (UPCOMING_MODULES as readonly string[]).includes(v);
}

/** Onboarding goals that name a module ("migrate" is about Shopify discounts, not a module). */
const GOAL_MODULE: Partial<Record<OnboardingGoal, AdminModule>> = {
  rewards: "rewards",
  tiers: "tiers",
  outlet: "outlet",
  margin: "margin",
};

/**
 * Modules in the order the merchant asked for in onboarding step 1 ("Co chceš
 * řešit?"): picked modules first, in the order picked, then the rest in the
 * default order. Goals only ORDER — every module stays visible (Admin IA).
 */
export function orderedModules(goals: readonly OnboardingGoal[]): AdminModule[] {
  const first: AdminModule[] = [];
  for (const goal of goals) {
    const module = GOAL_MODULE[goal];
    if (module && !first.includes(module)) first.push(module);
  }
  return [...first, ...ADMIN_MODULES.filter((m) => !first.includes(m))];
}

/** The not-yet-built modules in goal order (Přehled "Další moduly"). */
export function orderedUpcomingModules(goals: readonly OnboardingGoal[]): UpcomingModule[] {
  return orderedModules(goals).filter(isUpcomingModule);
}

/** The admin nav after the home link: Slevy a kódy, Vyzkoušet košík, modules (goal order), Nastavení, Tarif last. */
export function navItems(locale: Locale, goals: readonly OnboardingGoal[]): { to: string; label: string }[] {
  return [
    { to: "/app/discounts", label: t(locale, "nav.discounts") },
    { to: "/app/try-cart", label: t(locale, "nav.tryCart") },
    ...orderedModules(goals).map((key) => ({ to: `/app/${key}`, label: t(locale, MODULE_META[key].nav) })),
    { to: "/app/settings", label: t(locale, "nav.settings") },
    { to: "/app/plan", label: t(locale, "nav.plan") },
  ];
}
