// Does a module run? ONE answer for the home tile, the module page and the
// sections inside it (feedback 3, body 1 a 8; doctrine §19a), so the three can
// never disagree. "Aktivní" = saved, written to Shopify and run by the shop's
// plan — computed from what is STORED, never from a switch that is not saved
// yet. Everything here is pure: the loaders (and the dev harness) call the same
// functions on the views the server already builds for Přehled.
//
//   active    — it runs (green)
//   inactive  — nothing set up, switched off, or saved and still on its way to Shopify
//   attention — it should run and does not (a failed write, a failed step)
//   locked    — a Pro module on a plan that does not run it (amber, said by the Pro marker)
//
// `issues` counts what the merchant can resolve on the module's page; it never
// takes the green label away while the module runs.

import type { MessageKey, Translator } from "../../i18n";
import { needsAttention, runsNow, type RuleStatus } from "./rule-status";
import type { AdminSignals, CampaignsOverviewView, MarginOverviewView, OutletOverviewView, RewardsOverviewView, SyncView, TiersOverviewView } from "./types";

export const MODULE_KEYS = ["codes", "tiers", "rewards", "outlet", "campaigns", "margin"] as const;
export type ModuleKey = (typeof MODULE_KEYS)[number];

export type ModuleState = "active" | "inactive" | "attention" | "locked";

export interface ModuleStatus {
  state: ModuleState;
  /** Things to resolve on the module's page. */
  issues: number;
}

/** Is the stored configuration the one Shopify runs? */
export type Written = "yes" | "waiting" | "failed";

export function writtenOf(sync: SyncView): Written {
  if (sync.state === "ok") return (sync.attention ?? []).length > 0 ? "failed" : "yes";
  if (sync.state === "error" || sync.state === "blocked") return "failed";
  return "waiting";
}

export interface ModuleFacts {
  /** Saved and switched on: there is something to run. */
  on: boolean;
  /** The shop's plan runs the module (default: yes). */
  planRuns?: boolean;
  /** Default "yes": modules that do not travel through the config sync (Výprodej writes prices itself). */
  written?: Written;
  /** The module's own step failed (not the write of the config). */
  broken?: boolean;
  issues?: number;
}

export function moduleState(facts: ModuleFacts): ModuleStatus {
  if (facts.planRuns === false) return { state: "locked", issues: 0 };
  const issues = facts.issues ?? 0;
  if (!facts.on) return { state: "inactive", issues };
  if (facts.broken || facts.written === "failed") return { state: "attention", issues: Math.max(issues, 1) };
  if (facts.written === "waiting") return { state: "inactive", issues };
  return { state: "active", issues };
}

const LABEL: Readonly<Record<Exclude<ModuleState, "locked">, MessageKey>> = {
  active: "common.live",
  inactive: "common.inactive",
  attention: "common.needsAttention",
};

/** The label of a state ("locked" is said by the Pro marker: "Pro · odemknout"). */
export function moduleStateLabel(state: ModuleState, tr: Translator): string {
  return tr.t(state === "locked" ? "common.proLocked" : LABEL[state]);
}

// --- The six modules --------------------------------------------------------------------------------------------

/**
 * Slevy a kódy, from the rules' own statuses (model/rule-status.ts already knows the per-rule sync facts).
 * `warned[i]` = how many warnings rule `i` has on the home page's "Vyžaduje pozornost" (a discount that runs but is
 * not offered in one currency is a warning without being a stopped rule): the tile and that list count the same
 * things (audit 6 Oct 2026, N4).
 */
export function codesStatus(rules: readonly RuleStatus[], warned: readonly number[] = []): ModuleStatus {
  const issues = rules.reduce((sum, rule, i) => sum + Math.max(warned[i] ?? 0, needsAttention(rule) ? 1 : 0), 0);
  if (rules.some(runsNow)) return { state: "active", issues };
  return { state: issues > 0 ? "attention" : "inactive", issues };
}

/** The section "Množstevní sleva pro celý obchod". */
export function tiersGlobalStatus(tiers: TiersOverviewView, sync: SyncView): ModuleStatus {
  // A level without an amount in a market's currency is not offered there (MKT-1): something to resolve (N2).
  return moduleState({ on: tiers.global !== null && tiers.global.breaks.length > 0, written: writtenOf(sync), issues: (tiers.missing?.global ?? []).length > 0 ? 1 : 0 });
}

/** The section "Výjimky pro produkty a kolekce" (Pro; `tiers.sets` is what the plan runs). */
export function tiersSetsStatus(tiers: TiersOverviewView, sync: SyncView, plan: "free" | "pro"): ModuleStatus {
  return moduleState({ on: tiers.sets > 0, planRuns: plan === "pro", written: writtenOf(sync), issues: (tiers.missing?.sets ?? []).length });
}

export function tiersStatus(tiers: TiersOverviewView, sync: SyncView): ModuleStatus {
  const on = (tiers.global !== null && tiers.global.breaks.length > 0) || tiers.sets > 0;
  // The discount applies at checkout without the table; a missing table is something to resolve.
  const missing = ((tiers.missing?.global ?? []).length > 0 ? 1 : 0) + (tiers.missing?.sets ?? []).length;
  return moduleState({ on, written: writtenOf(sync), issues: (on && tiers.block.state === "off" ? 1 : 0) + missing });
}

export function rewardsShippingStatus(rewards: RewardsOverviewView, sync: SyncView): ModuleStatus {
  // Free shipping without an amount in a market's currency is not offered there (MKT-1): something to resolve (N2).
  return moduleState({ on: rewards.shipping !== null, written: writtenOf(sync), issues: (rewards.missing?.shipping ?? []).length > 0 ? 1 : 0 });
}

export function rewardsGiftStatus(rewards: RewardsOverviewView, sync: SyncView): ModuleStatus {
  // A gift without an amount in the currency of some enabled market is not offered there (MKT-1; N2: every market, not only the shop's).
  const missing = rewards.gifts.filter((g, i) => g === null || (rewards.missing?.gifts[i] ?? []).length > 0).length;
  return moduleState({ on: rewards.gifts.some((g) => g !== null), written: writtenOf(sync), issues: missing });
}

export function rewardsStatus(rewards: RewardsOverviewView, sync: SyncView): ModuleStatus {
  const shipping = rewardsShippingStatus(rewards, sync);
  const gift = rewardsGiftStatus(rewards, sync);
  const issues = shipping.issues + gift.issues;
  for (const state of ["attention", "active"] as const) if (shipping.state === state || gift.state === state) return { state, issues };
  return { state: "inactive", issues };
}

/** Výprodej (Pro). A sale that still runs after a downgrade is said as it is. */
export function outletStatus(outlet: OutletOverviewView, plan: "free" | "pro"): ModuleStatus {
  const waiting = outlet.pendingReturns.length;
  return moduleState({
    on: outlet.running > 0 || outlet.problems > 0,
    planRuns: plan === "pro" || outlet.running > 0 || waiting > 0 || outlet.problems > 0,
    broken: outlet.problems > 0,
    issues: waiting + outlet.oversold + outlet.problems,
  });
}

/** Kampaně (Pro). A campaign finishing after a downgrade still runs. */
export function campaignsStatus(campaigns: CampaignsOverviewView, plan: "free" | "pro", sync?: SyncView): ModuleStatus {
  return moduleState({
    on: campaigns.running !== null,
    // A campaign changes discounts through the same write as everything else.
    ...(sync ? { written: writtenOf(sync) } : {}),
    planRuns: plan === "pro" || campaigns.running !== null || campaigns.finishing,
    issues: campaigns.finishing ? 1 : 0,
  });
}

/**
 * Ochrana marže. Switched on and written = active: the percent ceiling applies from the first moment, also
 * before the purchase costs are read (the page says which products have only the ceiling). A failed read of
 * the costs needs attention.
 */
export function marginStatus(margin: MarginOverviewView, sync: SyncView): ModuleStatus {
  return moduleState({
    on: margin.enabled,
    written: writtenOf(sync),
    broken: margin.enabled && margin.mirror.state === "failed",
    issues: margin.enabled ? (margin.tooLarge ?? []).length : 0,
  });
}

/** Every module the signals know (absent view = not known: no status, never a guess — §12). */
export function moduleStatuses(
  signals: AdminSignals,
  opts: { plan: "free" | "pro"; rules: readonly RuleStatus[]; warned?: readonly number[] },
): Partial<Record<ModuleKey, ModuleStatus>> {
  const { sync } = signals;
  return {
    codes: codesStatus(opts.rules, opts.warned),
    ...(signals.tiers ? { tiers: tiersStatus(signals.tiers, sync) } : {}),
    ...(signals.rewards ? { rewards: rewardsStatus(signals.rewards, sync) } : {}),
    ...(signals.outlet ? { outlet: outletStatus(signals.outlet, opts.plan) } : {}),
    ...(signals.campaigns ? { campaigns: campaignsStatus(signals.campaigns, opts.plan, sync) } : {}),
    ...(signals.margin ? { margin: marginStatus(signals.margin, sync) } : {}),
  };
}
