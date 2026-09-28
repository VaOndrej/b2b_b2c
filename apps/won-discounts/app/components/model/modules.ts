// The five modules + campaigns + appearance (docs/won-discounts/rozhodnuti.md,
// Admin IA). MVP 1 ships Slevy a kódy; the rest are visible but not built yet —
// each has a real page that says so and links onward (§13b: never a dead end).

import type { MessageKey } from "../../i18n";

export const UPCOMING_MODULES = ["tiers", "rewards", "outlet", "margin", "campaigns", "appearance"] as const;
export type UpcomingModule = (typeof UPCOMING_MODULES)[number];

export interface UpcomingModuleMeta {
  key: UpcomingModule;
  title: MessageKey;
  nav: MessageKey;
  body: MessageKey;
  pro: boolean;
}

export const UPCOMING_MODULE_META: Readonly<Record<UpcomingModule, UpcomingModuleMeta>> = {
  tiers: { key: "tiers", title: "module.tiers", nav: "nav.tiers", body: "soon.tiers", pro: false },
  rewards: { key: "rewards", title: "module.rewards", nav: "nav.rewards", body: "soon.rewards", pro: false },
  outlet: { key: "outlet", title: "module.outlet", nav: "nav.outlet", body: "soon.outlet", pro: true },
  margin: { key: "margin", title: "module.margin", nav: "nav.margin", body: "soon.margin", pro: false },
  campaigns: { key: "campaigns", title: "module.campaigns", nav: "nav.campaigns", body: "soon.campaigns", pro: true },
  appearance: { key: "appearance", title: "module.appearance", nav: "nav.appearance", body: "soon.appearance", pro: false },
};

export function isUpcomingModule(v: unknown): v is UpcomingModule {
  return typeof v === "string" && (UPCOMING_MODULES as readonly string[]).includes(v);
}
