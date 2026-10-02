// Campaigns over time (MVP 6, plan docs/plans/2026-10-02-won-discounts-mvp6.md; spec §4.6, C4, A6, A8). Pure, every
// time a shop-local `YYYY-MM-DDTHH:MM:SS` (same-shape strings compare chronologically):
//
//   campaignStatusAt(c, now)            scheduled | running (start inclusive, end exclusive) | ended | killed;
//   campaignBoundary(config, now)       when the selected campaign (the current one, else the next — function-config
//                                       selectCampaign) changes: its end. The scheduler resyncs then (K4); null = no
//                                       campaign is selected, nothing to wait for;
//   campaignInputFromShopConfig(p, now) the cart plan's campaign from the LIVE shop config (K6): what a node whose
//                                       vars carry the selected campaign gets (function-payload campaignInputFromVars);
//   validateCampaignDraft(d, config)    the admin form → a Campaign, or field errors (D2 value + enabled only, D3
//                                       window, A8 overlap naming the other campaign).
// The start and the end themselves are the function's (C4): nothing here is on the critical path.

import type { CartCampaignInput } from "./cart.ts";
import { isShopLocalDateTime, type Campaign, type DiscountRule, type ReadonlyDeep, type WonDiscountsConfig } from "./config.ts";
import { fnv1a } from "./config/sanitize-helpers.ts";
import { liveCampaigns, selectCampaign } from "./function-config.ts";

export const CAMPAIGN_LIMITS = {
  /** A campaign ends at least this many minutes after it is saved (D3). */
  minLeadMinutes: 5,
  /** At most this many days long (D3: longer = a regular rule with a schedule). */
  maxDays: 92,
  nameMaxLength: 80,
} as const;

export type CampaignStatus = "scheduled" | "running" | "ended" | "killed";

type CampaignView = Pick<ReadonlyDeep<Campaign>, "killed" | "window">;

export function campaignStatusAt(c: CampaignView, now: string): CampaignStatus {
  if (c.killed) return "killed";
  if (now < c.window.start) return "scheduled";
  return now < c.window.end ? "running" : "ended";
}

export function campaignBoundary(config: ReadonlyDeep<Pick<WonDiscountsConfig, "campaigns">>, now: string): string | null {
  return selectCampaign(config.campaigns, { now })?.window.end ?? null;
}

const NO_CAMPAIGN: CartCampaignInput = { id: null, active: false, varsVersion: null };
const isRec = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

export function campaignInputFromShopConfig(payload: unknown, now: string): CartCampaignInput {
  if (!isRec(payload)) return NO_CAMPAIGN;
  const id = payload.campaignId;
  const version = payload.campaignVarsVersion;
  if (typeof id !== "string" || id === "" || typeof version !== "string" || version === "") return NO_CAMPAIGN;
  const campaign = (Array.isArray(payload.campaigns) ? payload.campaigns : []).find((c) => isRec(c) && c.id === id);
  const window = isRec(campaign) && isRec(campaign.window) ? campaign.window : null;
  if (!window || !isShopLocalDateTime(window.start) || !isShopLocalDateTime(window.end)) return NO_CAMPAIGN;
  return { id, active: now >= window.start && now < window.end, varsVersion: version };
}

/** Offset (ms) of `zone` at UTC instant `ms`: local wall clock as UTC minus the instant. */
function zoneOffsetMs(ms: number, zone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(ms));
  const n = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return Date.UTC(n("year"), n("month") - 1, n("day"), n("hour"), n("minute"), n("second")) - ms;
}

/**
 * The UTC instant of a shop-local wall time (`YYYY-MM-DDTHH:MM:SS`) in `zone` (the scheduler's boundary, K4). A wall
 * time the clocks skip maps to the instant the same distance after the gap starts. Throws on an unknown zone.
 */
export function shopLocalToUtc(local: string, zone: string): Date {
  const wall = Date.parse(`${local}Z`);
  if (Number.isNaN(wall)) throw new TypeError(`shopLocalToUtc: not a local datetime: ${local}`);
  let guess = wall - zoneOffsetMs(wall, zone);
  guess = wall - zoneOffsetMs(guess, zone);
  return new Date(guess);
}

// --- The admin draft --------------------------------------------------------------------------------

export interface CampaignDraftOverride {
  ruleId: string;
  /** Switch the rule on (or off) during the campaign. */
  enabled?: boolean;
  /** The rule's value during the campaign; the kind must be the rule's own. */
  value?: { kind: "percentage"; percent: number } | { kind: "fixed"; amount: Record<string, number> };
}

export interface CampaignDraft {
  /** null = a new campaign. */
  id: string | null;
  name: string;
  start: string;
  end: string;
  overrides: CampaignDraftOverride[];
}

export type CampaignDraftField = "name" | "start" | "end" | "overrides";

export interface CampaignDraftError {
  field: CampaignDraftField;
  key:
    | "campaign.error.name"
    | "campaign.error.when"
    | "campaign.error.order"
    | "campaign.error.past"
    | "campaign.error.tooSoon"
    | "campaign.error.tooLong"
    | "campaign.error.overlap"
    | "campaign.error.empty"
    | "campaign.error.rule"
    | "campaign.error.value"
    | "campaign.error.override"
    | "campaign.error.notEditable"
    | "campaign.error.tooMany";
  params?: Record<string, string | number>;
}

export type CampaignDraftResult = { ok: true; campaign: Campaign } | { ok: false; errors: CampaignDraftError[] };

/** Shop-local datetime + minutes (calendar arithmetic on the wall clock, as the window is wall-clock time). */
export function addLocalMinutes(local: string, minutes: number): string {
  const d = new Date(`${local}Z`);
  d.setUTCMinutes(d.getUTCMinutes() + minutes);
  return d.toISOString().slice(0, 19);
}

function valueError(rule: ReadonlyDeep<DiscountRule>, value: CampaignDraftOverride["value"]): boolean {
  if (!value) return false;
  if (rule.value.kind !== value.kind) return true;
  if (value.kind === "percentage") return !Number.isInteger(value.percent) || value.percent < 1 || value.percent > 100;
  const entries = Object.entries(value.amount ?? {});
  return entries.length === 0 || entries.some(([currency, minor]) => !/^[A-Z]{3}$/.test(currency) || !Number.isInteger(minor) || minor <= 0);
}

export function validateCampaignDraft(
  draft: CampaignDraft,
  config: ReadonlyDeep<WonDiscountsConfig>,
  opts: { now: string; maxCampaigns?: number },
): CampaignDraftResult {
  const errors: CampaignDraftError[] = [];
  const { now } = opts;
  const existing = draft.id ? config.campaigns.find((c) => c.id === draft.id) : undefined;
  if (draft.id && (!existing || campaignStatusAt(existing, now) === "ended" || existing.killed)) {
    return { ok: false, errors: [{ field: "name", key: "campaign.error.notEditable" }] };
  }
  if (!draft.id && config.campaigns.length >= (opts.maxCampaigns ?? Number.POSITIVE_INFINITY)) {
    return { ok: false, errors: [{ field: "name", key: "campaign.error.tooMany", params: { max: opts.maxCampaigns ?? 0 } }] };
  }
  const name = draft.name.trim();
  if (!name || name.length > CAMPAIGN_LIMITS.nameMaxLength) errors.push({ field: "name", key: "campaign.error.name", params: { max: CAMPAIGN_LIMITS.nameMaxLength } });

  const { start, end } = draft;
  if (!isShopLocalDateTime(start) || !isShopLocalDateTime(end)) {
    errors.push({ field: isShopLocalDateTime(start) ? "end" : "start", key: "campaign.error.when" });
  } else if (start >= end) {
    errors.push({ field: "end", key: "campaign.error.order" });
  } else {
    // A running campaign keeps its (past) start; a new or scheduled one starts now at the earliest.
    const running = existing && campaignStatusAt(existing, now) === "running";
    if (start < now && !(running && start === existing.window.start)) errors.push({ field: "start", key: "campaign.error.past" });
    else if (end < addLocalMinutes(now, CAMPAIGN_LIMITS.minLeadMinutes)) errors.push({ field: "end", key: "campaign.error.tooSoon", params: { n: CAMPAIGN_LIMITS.minLeadMinutes } });
    else if (end > addLocalMinutes(start, CAMPAIGN_LIMITS.maxDays * 24 * 60)) errors.push({ field: "end", key: "campaign.error.tooLong", params: { n: CAMPAIGN_LIMITS.maxDays } });
    else {
      const clash = liveCampaigns(config.campaigns).find((c) => c.id !== draft.id && campaignStatusAt(c, now) !== "ended" && start < c.window.end && c.window.start < end);
      if (clash) errors.push({ field: "start", key: "campaign.error.overlap", params: { other: clash.name || clash.id } });
    }
  }

  const rules = new Map(config.modules.codes.rules.map((r) => [r.id, r]));
  if (draft.overrides.length === 0) errors.push({ field: "overrides", key: "campaign.error.empty" });
  for (const o of draft.overrides) {
    const rule = rules.get(o.ruleId);
    if (!rule) {
      errors.push({ field: "overrides", key: "campaign.error.rule" });
      break;
    }
    if (o.enabled === undefined && o.value === undefined) {
      errors.push({ field: "overrides", key: "campaign.error.override", params: { rule: rule.name || rule.id } });
      break;
    }
    if (valueError(rule, o.value)) {
      errors.push({ field: "overrides", key: "campaign.error.value", params: { rule: rule.name || rule.id } });
      break;
    }
  }
  if (errors.length) return { ok: false, errors };

  let id = draft.id;
  if (!id) {
    const taken = new Set(config.campaigns.map((c) => c.id));
    const base = `c_${fnv1a(`${name}|${start}|${end}|${now}`)}`;
    id = base;
    for (let n = 2; taken.has(id); n += 1) id = `${base}-${n}`;
  }
  return {
    ok: true,
    campaign: {
      id,
      name,
      window: { start, end },
      overrides: draft.overrides.map((o) => ({
        ruleId: o.ruleId,
        patch: {
          ...(o.enabled !== undefined ? { enabled: o.enabled } : {}),
          ...(o.value !== undefined ? { value: o.value } : {}),
        },
      })),
      killed: false,
    },
  };
}
