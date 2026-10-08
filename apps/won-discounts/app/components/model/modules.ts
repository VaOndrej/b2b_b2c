// The modules of the admin (docs/won-discounts/rozhodnuti.md, Admin IA; plan
// docs/won-discounts/plan-zmen-2026-10-06.md, Dávka 1). The Shopify sidebar has
// five items after the home link (P1): Slevy · Ochrana marže · Vzhled · Přehledy ·
// Nastavení. The discount pages (Slevy a kódy, Množstevní slevy, Odměny, Výprodej,
// Kampaně) share one sidebar item and a sub-navigation on the page
// (app/components/shell/SubNav.tsx). Tarif and Vyzkoušet košík live in Nastavení.
// Every URL stays as it was.

import type { OnboardingGoal } from "@won/core/discounts/config";

import { t, type Locale, type MessageKey } from "../../i18n";
import type { ModuleKey, ModuleState, ModuleStatus } from "./module-status";

/** Every module with its own page, in the default order. */
export const ADMIN_MODULES = ["tiers", "rewards", "outlet", "margin", "campaigns", "appearance"] as const;
export type AdminModule = (typeof ADMIN_MODULES)[number];

export interface ModuleMeta {
  key: AdminModule;
  title: MessageKey;
  nav: MessageKey;
  /** The module in one sentence (the `soon.*` keys are older than the modules; the names stay, other screens read them). */
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

/** Onboarding goals that name a module ("migrate" is about Shopify discounts, not a module). */
const GOAL_MODULE: Partial<Record<OnboardingGoal, AdminModule>> = {
  rewards: "rewards",
  tiers: "tiers",
  outlet: "outlet",
  margin: "margin",
};

/**
 * Modules in the order the merchant asked for in onboarding step 1: picked
 * modules first, in the order picked, then the rest in the default order.
 * Goals only ORDER, every module stays.
 */
export function orderedModules(goals: readonly OnboardingGoal[]): AdminModule[] {
  const first: AdminModule[] = [];
  for (const goal of goals) {
    const module = GOAL_MODULE[goal];
    if (module && !first.includes(module)) first.push(module);
  }
  return [...first, ...ADMIN_MODULES.filter((m) => !first.includes(m))];
}

/** The Shopify sidebar after the home link: exactly five items (P1), no plan suffixes. */
export function navItems(locale: Locale): { to: string; label: string }[] {
  return [
    { to: "/app/discounts", label: t(locale, "nav.discountsGroup") },
    { to: "/app/margin", label: t(locale, "nav.margin") },
    { to: "/app/appearance", label: t(locale, "nav.appearance") },
    { to: "/app/analytics", label: t(locale, "nav.analytics") },
    { to: "/app/settings", label: t(locale, "nav.settings") },
  ];
}

// --- The sub-navigation of "Slevy" ---------------------------------------------------------------

/** The pages under the sidebar item "Slevy". */
export const DISCOUNT_PAGES = ["discounts", "tiers", "rewards", "outlet", "campaigns"] as const;
export type DiscountPage = (typeof DISCOUNT_PAGES)[number];

export interface SubNavItem<K extends string = string> {
  key: K;
  to: string;
  label: string;
  pro: boolean;
  /** Does the page's module run (model/module-status.ts)? Absent = not known, or locked (the Pro badge says that). */
  state?: Exclude<ModuleState, "locked">;
}

/** The state of each page under "Slevy", as its module's home tile says it. Absent = not known. */
export type DiscountPageStates = Partial<Record<DiscountPage, ModuleState>>;

/** What the strip under "Slevy" needs besides the language: from the layout loader, in the dev harness from fixtures. */
export interface DiscountNavData {
  goals: OnboardingGoal[];
  states: DiscountPageStates;
}

export const NO_DISCOUNT_NAV: DiscountNavData = { goals: [], states: {} };

/**
 * Does the embedded layout read its data again (the strip's order and dots)? After a form submission (a save
 * changes a state, onboarding goals reorder the strip), on a new `?locale=` and when the page changes — a write
 * to Shopify that finished meanwhile then shows on the next page's dots as it does on its tiles. A navigation
 * inside one page (a query string, a hash) keeps what it has.
 */
export function layoutReloads(change: { submitted: boolean; localeInUrl: boolean; fromPath: string; toPath: string }): boolean {
  return change.submitted || change.localeInUrl || change.fromPath !== change.toPath;
}

/** The strip's states out of the modules' statuses (the page "Slevy a kódy" is the module `codes`). */
export function discountPageStates(statuses: Partial<Record<ModuleKey, ModuleStatus>>): DiscountPageStates {
  const states: DiscountPageStates = {};
  for (const page of DISCOUNT_PAGES) {
    const status = statuses[page === "discounts" ? "codes" : page];
    if (status) states[page] = status.state;
  }
  return states;
}

function isDiscountModule(module: AdminModule): module is Exclude<DiscountPage, "discounts"> {
  return (DISCOUNT_PAGES as readonly string[]).includes(module);
}

/** Slevy a kódy first, then the four discount modules in the order of the onboarding goals. */
export function discountPages(goals: readonly OnboardingGoal[]): DiscountPage[] {
  return ["discounts", ...orderedModules(goals).filter(isDiscountModule)];
}

/**
 * The sub-navigation's items: the label without a plan suffix, Pro said by a badge (`pro`), the module's state
 * for the dot. A locked module has no dot: the badge says why it does not run.
 */
export function discountSubNavItems(locale: Locale, goals: readonly OnboardingGoal[], states: DiscountPageStates = {}): SubNavItem<DiscountPage>[] {
  return discountPages(goals).map((key) => {
    const state = states[key];
    const item = key === "discounts" ? { key, to: "/app/discounts", label: t(locale, "nav.discounts"), pro: false } : { key, to: `/app/${key}`, label: t(locale, MODULE_META[key].nav), pro: MODULE_META[key].pro };
    return state && state !== "locked" ? { ...item, state } : item;
  });
}
