// Kampaně (MVP 6, Pro) — the admin module's server side (contract K7).
//   loadCampaignsScreen(ctx, {edit})  the page: every campaign by status (running, scheduled, ended, killed) with its
//                                     window worded in the shop's time, its overrides worded, the rules the form can
//                                     change, the campaign being edited;
//   campaignsAction(ctx, form)        intent save (Pro only: BILL-1; core validateCampaignDraft — window, A8
//                                     overlap, rules, values) | kill (any plan: the kill switch is never a Pro
//                                     feature) | delete (a campaign that is not running); every change is a config
//                                     save (saveConfigSection on `campaigns`, F12 token), so it syncs at once;
//   loadCampaignsOverview(ctx)        the Přehled card: the running and the next campaign.
// The session shop only (SEC-2). Times are shop-local wall times (the window the function checks, C4).

import { CAMPAIGN_LIMITS, addLocalMinutes, campaignStatusAt, validateCampaignDraft, type CampaignDraftError } from "@won/core/discounts/campaigns";
import { CONFIG_LIMITS, type Campaign, type DiscountRule, type ReadonlyDeep, type WonDiscountsConfig } from "@won/core/discounts/config";
import { formatAmounts, formatPercent } from "@won/core/discounts/describe";

import { t, type Locale } from "../../i18n";
import { CAMPAIGN_ERROR_FIELD, CAMPAIGN_FIELD, CAMPAIGN_INTENT, readCampaignForm } from "../../components/model/campaigns";
import type { FormDataLike } from "../../components/model/rule-form";
import type { CampaignRuleChoice, CampaignsActionResult, CampaignsOverviewView, CampaignsScreenData, CampaignView, FieldError, UiResult } from "../../components/model/types";
import { loadConfig } from "../config.server";
import { formatShopTime } from "../native/copy";
import { loadShopSyncFacts } from "../sync/sync-state.server";
import { shopLocalDateTime } from "../sync/sync.server";
import { graphqlOf, nowOf, type ShopCtx } from "./context.server";
import { readSaveOptions, saveConfigSection } from "./settings.server";
import { ctxPlan } from "./sync-status.server";
import { readShopContext } from "./themes.server";

const STATUS_ORDER = { running: 0, scheduled: 1, ended: 2, killed: 3 } as const;

/** A shop-local wall time worded (no zone conversion: it IS the shop's time). */
export function wallTimeText(local: string, locale: Locale): string {
  return formatShopTime(`${local}Z`, "UTC", locale);
}

function ruleValueText(value: ReadonlyDeep<DiscountRule["value"]> | unknown, locale: Locale): string {
  const v = value as { kind?: string; percent?: number; amount?: Record<string, number> } | null;
  if (v?.kind === "percentage" && typeof v.percent === "number") return formatPercent(v.percent, locale);
  if (v?.kind === "fixed" && v.amount) return formatAmounts(v.amount, Object.keys(v.amount), locale);
  if (v?.kind === "freeShipping") return t(locale, "campaign.value.freeShipping");
  return "";
}

function majorText(minor: number): string {
  return Number.isInteger(minor / 100) ? String(minor / 100) : (minor / 100).toFixed(2);
}

export interface CampaignViewOptions {
  locale: Locale;
  now: string;
  rules: ReadonlyMap<string, ReadonlyDeep<DiscountRule>>;
  finishing: ReadonlySet<string>;
  plan: "free" | "pro";
}

/** A campaign as the screen shows it (pure: the dev harness renders the same). */
export function campaignView(c: ReadonlyDeep<Campaign>, opts: CampaignViewOptions): CampaignView {
  const status = campaignStatusAt(c, opts.now);
  const overrides = c.overrides
    .filter((o) => opts.rules.has(o.ruleId))
    .map((o) => {
      const rule = opts.rules.get(o.ruleId)!;
      const patch = o.patch as { enabled?: unknown; value?: { kind?: string; percent?: number; amount?: Record<string, number> } };
      return {
        ruleId: o.ruleId,
        ruleName: rule.name || o.ruleId,
        ...(typeof patch.enabled === "boolean" ? { enabled: patch.enabled } : {}),
        ...(patch.value ? { valueText: ruleValueText(patch.value, opts.locale) } : {}),
        ...(patch.value?.kind === "percentage" && typeof patch.value.percent === "number" ? { percent: patch.value.percent } : {}),
        ...(patch.value?.kind === "fixed" && patch.value.amount
          ? { amount: Object.fromEntries(Object.entries(patch.value.amount).map(([cur, minor]) => [cur, majorText(minor)])) }
          : {}),
      };
    });
  const split = (local: string) => ({ date: local.slice(0, 10), time: local.slice(11, 16) });
  const at = addLocalMinutes(c.window.start, 1);
  return {
    id: c.id,
    name: c.name,
    status,
    startText: wallTimeText(c.window.start, opts.locale),
    endText: wallTimeText(c.window.end, opts.locale),
    start: split(c.window.start),
    end: split(c.window.end),
    overrides,
    unused: c.overrides.length - overrides.length,
    finishing: opts.plan === "free" && status === "running" && opts.finishing.has(c.id),
    tryCartUrl: `/app/try-cart?date=${at.slice(0, 10)}&time=${at.slice(11, 16)}`,
  };
}

/** The rules the form can change (every Slevy a kódy rule, in the stored order). */
export function campaignRuleChoices(config: ReadonlyDeep<WonDiscountsConfig>, locale: Locale): CampaignRuleChoice[] {
  return config.modules.codes.rules.map((r) => ({
    id: r.id,
    name: r.name || r.id,
    kind: r.value.kind,
    enabled: r.enabled,
    method: r.method,
    valueText: ruleValueText(r.value, locale),
    currencies: r.value.kind === "fixed" ? Object.keys(r.value.amount).sort() : [],
  }));
}

async function shopNow(ctx: ShopCtx): Promise<{ now: string; timezone: string | null }> {
  const { timezone } = await readShopContext(graphqlOf(ctx));
  const now = shopLocalDateTime(nowOf(ctx), timezone ?? "UTC");
  return { now, timezone };
}

async function finishingOf(ctx: ShopCtx): Promise<Set<string>> {
  try {
    return new Set((await loadShopSyncFacts(ctx.db, ctx.shop)).campaignsFinishing ?? []);
  } catch {
    return new Set();
  }
}

export async function loadCampaignsScreen(ctx: ShopCtx, opts: { edit?: string | null } = {}): Promise<CampaignsScreenData> {
  const [loaded, plan, { now, timezone }, finishing] = await Promise.all([loadConfig(ctx.db, ctx.shop), ctxPlan(ctx), shopNow(ctx), finishingOf(ctx)]);
  const config = loaded.config;
  const rules = new Map(config.modules.codes.rules.map((r) => [r.id, r]));
  const viewOpts: CampaignViewOptions = { locale: ctx.locale, now, rules, finishing, plan };
  const campaigns = config.campaigns
    .map((c) => campaignView(c, viewOpts))
    .sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || (a.start.date + a.start.time).localeCompare(b.start.date + b.start.time));
  const editing = opts.edit ? (campaigns.find((c) => c.id === opts.edit && (c.status === "running" || c.status === "scheduled")) ?? null) : null;
  return {
    plan,
    configVersion: loaded.version ?? null,
    today: now.slice(0, 10),
    nowTime: now.slice(11, 16),
    timezone,
    campaigns,
    rules: campaignRuleChoices(config, ctx.locale),
    editing,
    limits: { campaigns: CONFIG_LIMITS.campaigns, maxDays: CAMPAIGN_LIMITS.maxDays, minLeadMinutes: CAMPAIGN_LIMITS.minLeadMinutes },
  };
}

const fieldErrors = (errors: readonly CampaignDraftError[]): FieldError[] =>
  errors.map((e) => ({ field: CAMPAIGN_ERROR_FIELD[e.field], key: e.key, ...(e.params ? { params: e.params } : {}) }));

function saved(result: UiResult, kind: "saved" | "killed" | "deleted"): CampaignsActionResult | UiResult {
  if (!result.ok) return result;
  return { ok: true, kind, ...(result.sync ? { sync: result.sync } : {}), ...(result.fixes?.length ? { fixes: result.fixes } : {}) };
}

/** The Kampaně action (see the header). */
export async function campaignsAction(ctx: ShopCtx, form: FormDataLike): Promise<CampaignsActionResult | UiResult> {
  const loaded = await loadConfig(ctx.db, ctx.shop);
  const kinds = new Map(
    loaded.config.modules.codes.rules.map((r) => [r.id, { kind: r.value.kind, currencies: r.value.kind === "fixed" ? Object.keys(r.value.amount) : [] }]),
  );
  const { intent, id, draft } = readCampaignForm(form, kinds);
  const pick = (config: WonDiscountsConfig) => config.campaigns;
  const options = readSaveOptions(form);
  switch (intent) {
    case CAMPAIGN_INTENT.save: {
      // BILL-1 / A6: on Free nothing is created, edited or revived (a finishing campaign runs as it was).
      if ((await ctxPlan(ctx)) !== "pro") return { ok: false, reason: "invalid", errors: [{ field: CAMPAIGN_FIELD.name, key: "campaign.error.pro" }] };
      const { now } = await shopNow(ctx);
      const r = validateCampaignDraft(draft, loaded.config, { now, maxCampaigns: CONFIG_LIMITS.campaigns });
      if (!r.ok) return { ok: false, reason: "invalid", errors: fieldErrors(r.errors) };
      const campaign = r.campaign;
      const result = await saveConfigSection(ctx, {
        ...options,
        path: "campaigns",
        pick,
        apply: (config) => {
          const existing = config.campaigns.find((c) => c.id === campaign.id);
          // D1: stored overrides of tier sets / gift tiers (not applied in this version) are kept as they were.
          const ruleIds = new Set(config.modules.codes.rules.map((rule) => rule.id));
          const kept = existing ? existing.overrides.filter((o) => !ruleIds.has(o.ruleId)) : [];
          const next = { ...campaign, overrides: [...campaign.overrides, ...kept] };
          return { ...config, campaigns: existing ? config.campaigns.map((c) => (c.id === campaign.id ? next : c)) : [...config.campaigns, next] };
        },
      });
      return saved(result, "saved");
    }
    case CAMPAIGN_INTENT.kill: {
      const target = loaded.config.campaigns.find((c) => c.id === id);
      if (!target || target.killed) return { ok: false, reason: "bad_request" };
      const result = await saveConfigSection(ctx, {
        ...options,
        path: "campaigns",
        pick,
        apply: (config) => ({ ...config, campaigns: config.campaigns.map((c) => (c.id === id ? { ...c, killed: true } : c)) }),
      });
      return saved(result, "killed");
    }
    case CAMPAIGN_INTENT.delete: {
      const target = loaded.config.campaigns.find((c) => c.id === id);
      const { now } = await shopNow(ctx);
      if (!target) return { ok: false, reason: "bad_request" };
      if (campaignStatusAt(target, now) === "running") return { ok: false, reason: "invalid", errors: [{ field: CAMPAIGN_FIELD.name, key: "campaign.error.deleteRunning" }] };
      const result = await saveConfigSection(ctx, {
        ...options,
        path: "campaigns",
        pick,
        apply: (config) => ({ ...config, campaigns: config.campaigns.filter((c) => c.id !== id) }),
      });
      return saved(result, "deleted");
    }
    default:
      return { ok: false, reason: "bad_request" };
  }
}

// --- Přehled ----------------------------------------------------------------------------------------------

/** The Přehled card from the stored campaigns at `now` (pure). */
export function campaignsOverviewOf(
  campaigns: readonly ReadonlyDeep<Campaign>[],
  opts: { now: string; locale: Locale; plan: "free" | "pro"; finishing: ReadonlySet<string> },
): CampaignsOverviewView {
  const running = campaigns.find((c) => campaignStatusAt(c, opts.now) === "running") ?? null;
  const next = [...campaigns].filter((c) => campaignStatusAt(c, opts.now) === "scheduled").sort((a, b) => a.window.start.localeCompare(b.window.start))[0] ?? null;
  return {
    running: running ? { name: running.name, endText: wallTimeText(running.window.end, opts.locale) } : null,
    next: next ? { name: next.name, startText: wallTimeText(next.window.start, opts.locale) } : null,
    finishing: opts.plan === "free" && running !== null && opts.finishing.has(running.id),
  };
}

export async function loadCampaignsOverview(ctx: ShopCtx): Promise<CampaignsOverviewView> {
  const [loaded, plan, { now }, finishing] = await Promise.all([loadConfig(ctx.db, ctx.shop), ctxPlan(ctx), shopNow(ctx), finishingOf(ctx)]);
  return campaignsOverviewOf(loaded.config.campaigns, { now, locale: ctx.locale, plan, finishing });
}
