// Kampaně (MVP 6, Pro) — the admin module's server side (contract K7).
//   loadCampaignsScreen(ctx, {edit})  the page: every campaign by status (running, scheduled, ended, killed) with its
//                                     window worded in the shop's time, its overrides worded, the rules and (MVP
//                                     6.1) the quantity tier sets the form can change, the campaign being edited;
//   campaignsAction(ctx, form)        intent save (Pro only: BILL-1; core validateCampaignDraft — window, A8
//                                     overlap, rules, values) | kill (any plan: the kill switch is never a Pro
//                                     feature) | delete (a campaign that is not running); every change is a config
//                                     save (saveConfigSection on `campaigns`, F12 token), so it syncs at once;
//   loadCampaignsOverview(ctx)        the Přehled card: the running and the next campaign.
// The session shop only (SEC-2). Times are shop-local wall times (the window the function checks, C4).

import { CAMPAIGN_BLOCK_HANDLE, placementLinks } from "../../components/model/embed";
import { campaignTierSets } from "@won/core/discounts/campaign-tiers";
import { CAMPAIGN_LIMITS, addLocalMinutes, campaignStatusAt, validateCampaignDraft, type CampaignDraft, type CampaignDraftError } from "@won/core/discounts/campaigns";
import { CONFIG_LIMITS, type Campaign, type DiscountRule, type ReadonlyDeep, type TierBreak, type TierSet, type WonDiscountsConfig } from "@won/core/discounts/config";
import { formatAmounts, formatPercent } from "@won/core/discounts/describe";
import { isMilestoneRule } from "@won/core/discounts/milestones";
import { currencyExponent, fromMinorUnits } from "@won/core/discounts/money";
import { reachableTierSets } from "@won/core/discounts/tiers";

import { t, type Locale } from "../../i18n";
import { CAMPAIGN_ERROR_FIELD, CAMPAIGN_FIELD, CAMPAIGN_INTENT, campaignFieldNames, readCampaignForm } from "../../components/model/campaigns";
import { submittedOf, withValues } from "../../components/model/submitted";
import type { FormDataLike } from "../../components/model/rule-form";
import type {
  CampaignRuleChoice,
  CampaignsActionResult,
  CampaignsOverviewView,
  CampaignsScreenData,
  CampaignTierChoice,
  CampaignTierRow,
  CampaignView,
  FieldError,
  UiResult,
} from "../../components/model/types";
import { loadConfig } from "../config.server";
import { formatShopTime } from "../native/copy";
import { loadShopSyncFacts } from "../sync/sync-state.server";
import { shopLocalDateTime } from "../sync/sync.server";
import { lookView } from "./looks.server";
import { graphqlOf, nowOf, type ShopCtx } from "./context.server";
import { readSaveOptions, saveConfigSection } from "./settings.server";
import { campaignsStatus } from "../../components/model/module-status";
import { ctxPlan, loadSyncView } from "./sync-status.server";
import { readAmountSuggest, readMarketNames, readShopContext, readThemeLook } from "./themes.server";
import { currenciesWithoutAmount, currencyViews, enabledCurrencies } from "../../components/model/markets";

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

// --- Quantity tier sets in a campaign (MVP 6.1, L8) --------------------------------------------------------

type SetLike = ReadonlyDeep<TierSet>;
type BreakLike = ReadonlyDeep<TierBreak>;

/** A set has no name: "Celý obchod", or how many products and collections it selects. */
function tierSetLabel(set: SetLike, locale: Locale): string {
  if (set.scope === "global") return t(locale, "tiers.scope.global");
  return t(locale, "campaign.tiers.scoped", { n: (set.scope.productIds?.length ?? 0) + (set.scope.collectionIds?.length ?? 0) });
}

/** Minor units as the form shows them: "10", "0.40", JPY "300". */
function majorOf(minor: number, currency: string): string {
  const text = fromMinorUnits(minor, currency);
  return text.replace(/\.0+$/, "");
}

const tierKind = (breaks: readonly BreakLike[]): "percent" | "amount" => (breaks.length > 0 && typeof breaks[0]!.percent !== "number" ? "amount" : "percent");
const tierCurrencies = (breaks: readonly BreakLike[]): string[] => [...new Set(breaks.flatMap((b) => Object.keys(b.amountOff ?? {})))].sort();

/**
 * The currencies a campaign asks for: the ones the discount has an amount in AND whose market is enabled — the same
 * fields as the discount's own editor (audit 6 Oct 2026, N14: a switched-off market is not asked about). A shop
 * without any market configured keeps every stored currency.
 */
function shownCurrencies(config: ReadonlyDeep<WonDiscountsConfig>, stored: readonly string[]): string[] {
  const enabled = enabledCurrencies(config.markets);
  return enabled.length > 0 ? stored.filter((code) => enabled.includes(code)) : [...stored];
}

function tierRows(breaks: readonly BreakLike[]): CampaignTierRow[] {
  return [...breaks]
    .sort((a, b) => a.minQty - b.minQty)
    .map((b) =>
      typeof b.percent === "number"
        ? { qty: String(b.minQty), percent: String(b.percent) }
        : { qty: String(b.minQty), amount: Object.fromEntries(Object.entries(b.amountOff ?? {}).map(([cur, minor]) => [cur, majorOf(minor, cur)])) },
    );
}

/** "od 2 ks −10 %, od 5 ks −15 %" / "od 3 ks −10 Kč / 0,40 € za kus". */
function tierBreaksText(breaks: readonly BreakLike[], locale: Locale): string {
  return [...breaks]
    .sort((a, b) => a.minQty - b.minQty)
    .map((b) =>
      typeof b.percent === "number"
        ? t(locale, "campaign.tiers.break", { qty: b.minQty, value: formatPercent(b.percent, locale) })
        : t(locale, "campaign.tiers.breakAmount", { qty: b.minQty, value: formatAmounts(b.amountOff ?? {}, Object.keys(b.amountOff ?? {}).sort(), locale) }),
    )
    .join(", ");
}

/** The tier sets the form can change: the ones a product can reach, in the stored order. */
export function campaignTierChoices(config: ReadonlyDeep<WonDiscountsConfig>, locale: Locale): CampaignTierChoice[] {
  return reachableTierSets(config.modules.tiers.sets).map((set) => ({
    id: set.id,
    label: tierSetLabel(set, locale),
    kind: tierKind(set.breaks),
    currencies: shownCurrencies(config, tierCurrencies(set.breaks)),
    baseText: set.breaks.length > 0 ? tierBreaksText(set.breaks, locale) : t(locale, "campaign.tiers.noBreaks"),
    rows: tierRows(set.breaks),
  }));
}

export interface CampaignViewOptions {
  locale: Locale;
  now: string;
  rules: ReadonlyMap<string, ReadonlyDeep<DiscountRule>>;
  /** MVP 6.1: the stored tier sets (the campaign's tier overrides are worded against them); absent = none. */
  tiers?: ReadonlyDeep<WonDiscountsConfig>["modules"]["tiers"];
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
  // MVP 6.1: the tier set overrides that apply (at least as generous as the base, a set a product can reach).
  const run = opts.tiers ? campaignTierSets(opts.tiers, c) : null;
  const tiers = (run?.applied ?? []).map((setId) => {
    const set = run!.sets.find((x) => x.id === setId)!;
    const base = opts.tiers!.sets.find((x) => x.id === setId)!;
    return { setId, label: tierSetLabel(base, opts.locale), text: tierBreaksText(set.breaks, opts.locale), rows: tierRows(set.breaks) };
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
    tiers,
    unused: c.overrides.length - overrides.length - tiers.length,
    // P4: named, not only counted. A tier set by its label; "" = what the change was for no longer exists.
    unusedNames: c.overrides
      .filter((o) => !opts.rules.has(o.ruleId) && !(run?.applied ?? []).includes(o.ruleId))
      .map((o) => {
        const set = opts.tiers?.sets.find((x) => x.id === o.ruleId);
        return set ? tierSetLabel(set, opts.locale) : "";
      }),
    finishing: opts.plan === "free" && status === "running" && opts.finishing.has(c.id),
    tryCartUrl: `/app/try-cart?date=${at.slice(0, 10)}&time=${at.slice(11, 16)}`,
  };
}

/** The rules the form can change (every Slevy a kódy rule, in the stored order). */
export function campaignRuleChoices(config: ReadonlyDeep<WonDiscountsConfig>, locale: Locale): CampaignRuleChoice[] {
  // (a step of Milníky is not a discount a campaign changes: it is set up on that page)
  return config.modules.codes.rules.filter((r) => !isMilestoneRule(r)).map((r) => ({
    id: r.id,
    name: r.name || r.id,
    kind: r.value.kind,
    enabled: r.enabled,
    method: r.method,
    valueText: ruleValueText(r.value, locale),
    currencies: r.value.kind === "fixed" ? shownCurrencies(config, Object.keys(r.value.amount).sort()) : [],
    // N14: an enabled market the discount has no amount for does not get it in a campaign either — the form says so.
    ...(r.value.kind === "fixed" ? { missing: currenciesWithoutAmount([r.value.amount], enabledCurrencies(config.markets)) } : {}),
  }));
}

async function shopNow(ctx: ShopCtx): Promise<{ now: string; timezone: string | null; currencyCode: string | null }> {
  const { timezone, currencyCode } = await readShopContext(graphqlOf(ctx));
  const now = shopLocalDateTime(nowOf(ctx), timezone ?? "UTC");
  return { now, timezone, currencyCode: currencyCode ?? null };
}

export async function finishingOf(ctx: Pick<ShopCtx, "db" | "shop">): Promise<Set<string>> {
  try {
    return new Set((await loadShopSyncFacts(ctx.db, ctx.shop)).campaignsFinishing ?? []);
  } catch {
    return new Set();
  }
}

export async function loadCampaignsScreen(ctx: ShopCtx, opts: { edit?: string | null } = {}): Promise<CampaignsScreenData> {
  const [loaded, plan, { now, timezone, currencyCode }, finishing] = await Promise.all([loadConfig(ctx.db, ctx.shop), ctxPlan(ctx), shopNow(ctx), finishingOf(ctx)]);
  const config = loaded.config;
  const rules = new Map(config.modules.codes.rules.map((r) => [r.id, r]));
  const viewOpts: CampaignViewOptions = { locale: ctx.locale, now, rules, tiers: config.modules.tiers, finishing, plan };
  const campaigns = config.campaigns
    .map((c) => campaignView(c, viewOpts))
    .sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || (a.start.date + a.start.time).localeCompare(b.start.date + b.start.time));
  const editing = opts.edit ? (campaigns.find((c) => c.id === opts.edit && (c.status === "running" || c.status === "scheduled")) ?? null) : null;
  const [sync, look, marketNames, suggest] = await Promise.all([
    loadSyncView(ctx, loaded, timezone),
    readThemeLook(ctx, { scopes: ctx.scopes }),
    readMarketNames(graphqlOf(ctx), ctx.shop, ctx.scopes),
    readAmountSuggest(graphqlOf(ctx), ctx.shop, ctx.scopes, currencyCode),
  ]);
  return {
    plan,
    // The same function, on the same view, as the home tile (model/module-status.ts).
    status: campaignsStatus(campaignsOverviewOf(config.campaigns, { now, locale: ctx.locale, plan, finishing }), plan, sync),
    configVersion: loaded.version ?? null,
    look: lookView(loaded.config, "campaign"),
    today: now.slice(0, 10),
    nowTime: now.slice(11, 16),
    timezone,
    campaigns,
    rules: campaignRuleChoices(config, ctx.locale),
    tierSets: campaignTierChoices(config, ctx.locale),
    currencies: currencyViews(config.markets as WonDiscountsConfig["markets"], { marketNames }),
    ...(suggest ? { suggest } : {}),
    editing,
    limits: { campaigns: CONFIG_LIMITS.campaigns, maxDays: CAMPAIGN_LIMITS.maxDays, minLeadMinutes: CAMPAIGN_LIMITS.minLeadMinutes },
    placements: placementLinks(ctx.shop, ctx.apiKey, CAMPAIGN_BLOCK_HANDLE),
    placed: look.placements,
  };
}

/**
 * Core's draft errors on the form's fields. A tier set is named by its label (it has no name), a currency as " (EUR)".
 * An error about one discount or one tier set carries its id (`at`): the screen shows it at that row. A window that
 * cannot be read lands on the control that is wrong: the date, or the time.
 */
function fieldErrors(
  errors: readonly CampaignDraftError[],
  config: ReadonlyDeep<WonDiscountsConfig>,
  locale: Locale,
  posted: { draft: CampaignDraft; startDate: string; endDate: string },
): FieldError[] {
  const dateOk = (day: string) => /^\d{4}-\d{2}-\d{2}$/.test(day.trim());
  return errors.map((e): FieldError => {
    if (e.key === "campaign.error.when") {
      const start = e.field === "start";
      if (dateOk(start ? posted.startDate : posted.endDate)) return { field: start ? CAMPAIGN_FIELD.startTime : CAMPAIGN_FIELD.endTime, key: "campaign.error.time" };
      return { field: CAMPAIGN_ERROR_FIELD[e.field], key: "campaign.error.date" };
    }
    if (!e.params) return { field: CAMPAIGN_ERROR_FIELD[e.field], key: e.key };
    const params = { ...e.params };
    let at: string | undefined;
    if (e.field === "tiers" && typeof params.set === "string") {
      const set = config.modules.tiers.sets.find((x) => x.id === params.set);
      if (set) {
        at = set.id;
        params.set = tierSetLabel(set, locale);
      }
      if (typeof params.currency === "string") params.currency = params.currency ? ` (${params.currency})` : "";
    }
    if (e.field === "overrides" && typeof params.rule === "string") {
      // Core names the discount, not its id: the first ticked one of that name the error can be about.
      const named = posted.draft.overrides.filter((o) => {
        const rule = config.modules.codes.rules.find((r) => r.id === o.ruleId);
        return rule !== undefined && (rule.name || rule.id) === params.rule;
      });
      const about = e.key === "campaign.error.override" ? named.find((o) => o.enabled === undefined && o.value === undefined) : named.find((o) => o.value !== undefined);
      at = (about ?? named[0])?.ruleId;
    }
    return { field: CAMPAIGN_ERROR_FIELD[e.field], key: e.key, params, ...(at ? { at } : {}) };
  });
}

function saved(result: UiResult, kind: "saved" | "killed" | "deleted"): CampaignsActionResult | UiResult {
  if (!result.ok) return result;
  return { ok: true, kind, ...(result.sync ? { sync: result.sync } : {}), ...(result.fixes?.length ? { fixes: result.fixes } : {}) };
}

/** The Kampaně action (see the header). */
export async function campaignsAction(ctx: ShopCtx, form: FormDataLike): Promise<CampaignsActionResult | UiResult> {
  const loaded = await loadConfig(ctx.db, ctx.shop);
  const kinds = new Map(
    loaded.config.modules.codes.rules.map((r) => [r.id, { kind: r.value.kind, currencies: r.value.kind === "fixed" ? shownCurrencies(loaded.config, Object.keys(r.value.amount)) : [] }]),
  );
  const sets = new Map(
    loaded.config.modules.tiers.sets.map((set) => [set.id, { kind: tierKind(set.breaks), currencies: shownCurrencies(loaded.config, tierCurrencies(set.breaks)), exponent: currencyExponent }]),
  );
  const { intent, id, draft } = readCampaignForm(form, kinds, sets);
  // B14: a refused save gets back what the form posted, so the screen shows it again.
  const posted = () =>
    submittedOf(
      form,
      campaignFieldNames(
        [...kinds].map(([ruleId, k]) => ({ id: ruleId, kind: k.kind, currencies: k.currencies })),
        [...sets].map(([setId, k]) => ({ id: setId, kind: k.kind, currencies: k.currencies })),
      ),
    );
  const pick = (config: WonDiscountsConfig) => config.campaigns;
  const options = readSaveOptions(form);
  switch (intent) {
    case CAMPAIGN_INTENT.save: {
      // BILL-1 / A6: on Free nothing is created, edited or revived (a finishing campaign runs as it was).
      if ((await ctxPlan(ctx)) !== "pro") return { ok: false, reason: "invalid", errors: [{ field: CAMPAIGN_FIELD.name, key: "campaign.error.pro" }], values: posted() };
      const { now } = await shopNow(ctx);
      const r = validateCampaignDraft(draft, loaded.config, { now, maxCampaigns: CONFIG_LIMITS.campaigns });
      if (!r.ok) {
        const dates = { startDate: String(form.get(CAMPAIGN_FIELD.startDate) ?? ""), endDate: String(form.get(CAMPAIGN_FIELD.endDate) ?? "") };
        return { ok: false, reason: "invalid", errors: fieldErrors(r.errors, loaded.config, ctx.locale, { draft, ...dates }), values: posted() };
      }
      const campaign = r.campaign;
      const result = await saveConfigSection(ctx, {
        ...options,
        path: "campaigns",
        pick,
        apply: (config) => {
          const existing = config.campaigns.find((c) => c.id === campaign.id);
          // The form owns the overrides of rules and (MVP 6.1) of tier sets; stored gift tier overrides (never
          // applied: dárky kampaň nemění) are kept as they were.
          const owned = new Set([...config.modules.codes.rules.map((rule) => rule.id), ...config.modules.tiers.sets.map((set) => set.id)]);
          const kept = existing ? existing.overrides.filter((o) => !owned.has(o.ruleId)) : [];
          const next = { ...campaign, overrides: [...campaign.overrides, ...kept] };
          return { ...config, campaigns: existing ? config.campaigns.map((c) => (c.id === campaign.id ? next : c)) : [...config.campaigns, next] };
        },
      });
      // Any other refusal (changed meanwhile, busy, …) keeps the typed values too.
      return saved(withValues(result, posted), "saved");
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
