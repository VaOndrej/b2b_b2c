// Quantity tiers in a campaign (MVP 6.1, docs/plans/2026-10-04-won-discounts-mvp6-1.md, contracts L2, L6, L7).
//
// A campaign override naming a tier set may replace the set's `breaks` — and only with breaks AT LEAST AS GENEROUS
// as the base ones for every quantity and currency (E2). Then, while the campaign is live, the function reads the
// campaign's sets INSTEAD of the base ones (function-payload.ts `campaigns[0].tiers`, plan.ts), and the table on the
// product page may show them: from a minute after the start until 3 minutes before the end (E3), so the page never
// promises more than checkout gives — outside that time checkout gives the same or more than the base table says.
//
//   tierOverrideIssue(base, breaks)       null, or why the override is refused (the first quantity it fails at);
//   campaignTierSets(tiers, campaign)     the sets as the campaign runs them; an override that is refused, names a
//                                         set no product reaches, or patches only `countAcross` (E1) is `unused`:
//                                         the base applies, fail closed;
//   campaignTiersPayload(tiers, campaign) their shop-config form, null when no override applies;
//   campaignTiersShownAt(config, now)     the campaign whose sets the product page shows at `now`, else null;
//   campaignTierSwitches(config, now)     the shop-local times the page switches next (the scheduler's boundaries).
// Build everything from the GATED config (plan-gate.ts removes the overrides of the sets it narrowed on Free).

import type { Campaign, ReadonlyDeep, TierBreak, TierSet, TiersModule, WonDiscountsConfig } from "./config.ts";
import { selectCampaign } from "./function-config.ts";
import { moneyFor } from "./money.ts";
import { buildTiersPayload, reachableTierSets, type FunctionTiersPayload } from "./tiers.ts";

export const CAMPAIGN_TIERS = {
  /** The product page shows the campaign's sets this long after the campaign started (checkout has them by then). */
  showDelaySeconds: 60,
  /** … and goes back to the base sets this long before it ends (one scheduler retry, the sync, a cached page). */
  hideLeadSeconds: 180,
} as const;

export interface TierOverrideIssue {
  /** `less`: worth less than the base there; `kind`: a percent against an amount; `empty`: no usable break. */
  kind: "less" | "kind" | "empty";
  /** The first quantity it fails at (0 for `empty`). */
  minQty: number;
  /** The currency it fails in; null = whatever the currency (percent breaks). */
  currency: string | null;
}

type Breaks = readonly ReadonlyDeep<TierBreak>[];
type Reached = { percent: number } | { amount: number } | null;

/** The break a count of `qty` reaches in `currency` (plan-tiers.ts step 4: the highest OFFERED minQty ≤ qty). */
function reached(breaks: Breaks, qty: number, currency: string | null): Reached {
  let out: Reached = null;
  let top = 0;
  for (const b of breaks) {
    if (b.minQty > qty || b.minQty < top) continue;
    let value: Reached = null;
    if (typeof b.percent === "number") value = { percent: b.percent };
    else if (currency !== null) {
      const amount = moneyFor(b.amountOff, currency);
      if (amount !== null) value = { amount };
    }
    if (value === null) continue;
    out = value;
    top = b.minQty;
  }
  return out;
}

/** E2: null when `breaks` give the same or more than `base.breaks` at every quantity, in every currency. */
export function tierOverrideIssue(base: ReadonlyDeep<Pick<TierSet, "breaks">>, breaks: Breaks): TierOverrideIssue | null {
  if (breaks.length === 0) return base.breaks.length === 0 ? null : { kind: "empty", minQty: 0, currency: null };
  const currencies = new Set<string | null>([null]);
  for (const b of [...base.breaks, ...breaks]) for (const c of Object.keys(b.amountOff ?? {})) currencies.add(c);
  const quantities = [...new Set([...base.breaks, ...breaks].map((b) => b.minQty))].sort((a, b) => a - b);
  for (const minQty of quantities) {
    // Sorted so the currency named is the same on every run.
    for (const currency of [...currencies].sort((a, b) => (a === null ? -1 : b === null ? 1 : a < b ? -1 : 1))) {
      const was = reached(base.breaks, minQty, currency);
      if (was === null) continue;
      const now = reached(breaks, minQty, currency);
      if (now === null) {
        // Nothing of the base's kind in the override at all → another kind, not merely "less".
        const sameKind = breaks.some((b) => ("percent" in was ? typeof b.percent === "number" : typeof b.percent !== "number"));
        return { kind: sameKind ? "less" : "kind", minQty, currency };
      }
      if ("percent" in was !== "percent" in now) return { kind: "kind", minQty, currency };
      const less = "percent" in was ? (now as { percent: number }).percent < was.percent : (now as { amount: number }).amount < was.amount;
      if (less) return { kind: "less", minQty, currency };
    }
  }
  return null;
}

type TiersLike = ReadonlyDeep<TiersModule>;
type CampaignLike = ReadonlyDeep<Pick<Campaign, "overrides">>;

export interface CampaignTierSets {
  /** Every set of the module, config order; the applied overrides' breaks in place. */
  sets: TierSet[];
  /** Ids of the sets whose override applies. */
  applied: string[];
  /** Ids of the sets whose override does not apply (refused, unreachable, `countAcross` only). */
  unused: string[];
}

export function campaignTierSets(tiers: TiersLike, campaign: CampaignLike): CampaignTierSets {
  const reachable = new Set(reachableTierSets(tiers.sets).map((set) => set.id));
  const byId = new Map(tiers.sets.map((set) => [set.id, set]));
  // The later override of a set wins, like a rule's patches (plan.ts activeCampaign).
  const patches = new Map<string, Breaks | null>();
  for (const override of campaign.overrides) {
    if (!byId.has(override.ruleId)) continue;
    const breaks = (override.patch as { breaks?: unknown }).breaks;
    if (Array.isArray(breaks)) patches.set(override.ruleId, breaks as Breaks);
    else if (!patches.has(override.ruleId)) patches.set(override.ruleId, null);
  }
  const applied: string[] = [];
  const unused: string[] = [];
  const sets = tiers.sets.map((set): TierSet => {
    const copy = JSON.parse(JSON.stringify(set)) as TierSet;
    if (!patches.has(set.id)) return copy;
    const breaks = patches.get(set.id) ?? null;
    if (breaks === null || !reachable.has(set.id) || tierOverrideIssue(set, breaks) !== null) {
      unused.push(set.id);
      return copy;
    }
    applied.push(set.id);
    return { ...copy, breaks: JSON.parse(JSON.stringify(breaks)) as TierBreak[] };
  });
  return { sets, applied, unused };
}

export function campaignTiersPayload(tiers: TiersLike, campaign: CampaignLike): FunctionTiersPayload | null {
  const { sets, applied } = campaignTierSets(tiers, campaign);
  return applied.length === 0 ? null : buildTiersPayload({ ...tiers, sets });
}

/** Shop-local datetime + seconds (wall-clock arithmetic, like campaigns.ts addLocalMinutes). */
export function addLocalSeconds(local: string, seconds: number): string {
  const d = new Date(`${local}Z`);
  d.setUTCSeconds(d.getUTCSeconds() + seconds);
  return d.toISOString().slice(0, 19);
}

type ConfigLike = ReadonlyDeep<Pick<WonDiscountsConfig, "campaigns" | "modules">>;

/** The selected campaign and when the page shows its sets (`from` inclusive, `to` exclusive); null = never. */
function shownWindow(config: ConfigLike, now: string): { id: string; from: string; to: string } | null {
  const selected = selectCampaign(config.campaigns, { now });
  if (!selected || campaignTierSets(config.modules.tiers, selected).applied.length === 0) return null;
  const from = addLocalSeconds(selected.window.start, CAMPAIGN_TIERS.showDelaySeconds);
  const to = addLocalSeconds(selected.window.end, -CAMPAIGN_TIERS.hideLeadSeconds);
  return from < to ? { id: selected.id, from, to } : null;
}

export function campaignTiersShownAt(config: ConfigLike, now: string): string | null {
  const shown = shownWindow(config, now);
  return shown && now >= shown.from && now < shown.to ? shown.id : null;
}

/** The times after `now` the product page switches its tier table for the selected campaign, ascending. */
export function campaignTierSwitches(config: ConfigLike, now: string): string[] {
  const shown = shownWindow(config, now);
  return shown ? [shown.from, shown.to].filter((at) => at > now) : [];
}
