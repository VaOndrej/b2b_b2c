// The wired admin pages: every loader / action body of the embedded routes
// (app/routes/app*.tsx), taking the request context instead of the request's
// auth. A route is then three lines — authenticate, build the ShopCtx from the
// SESSION shop, call the page — and tests/integration run these exact bodies
// with a fake AdminClient and a throwaway database.

import type { WonDiscountsConfig } from "@won/core/discounts/config";
import { explainGate, gateConfigForPlan } from "@won/core/discounts/plan-gate";

import type { LoadedConfig } from "../config.server";
import { codeBatchPattern, isProCodeBatch, listBatchCodes } from "@won/core/discounts/code-batch";

import type { GeneratedBatchView } from "../../components/model/types";
import { resourceLabels } from "./titles.server";
import { loadConfig } from "../config.server";
import { canReadMarkets, loadSyncStatus } from "../sync/save-and-sync.server";
import { syncProgress } from "../sync/progress";
import { isSyncRunning, shopLocalDateTime } from "../sync/sync.server";
import { resolveLocale } from "../../i18n";
import { currencyCodes, currencyViews } from "../../components/model/markets";
import { isRecipeKey, shopToday } from "../../components/model/rule-form";
import { ruleStatus } from "../../components/model/rule-status";
import { resolveRuleCodes } from "../../components/model/try-cart-form";
import type { GateNoteView, NativeView, UiResult } from "../../components/model/types";
import { buildDiscountsProps } from "../../components/screens/DiscountsScreen";
import { rewardsStatus, storeStatuses } from "../../components/model/module-status";
import { discountPageStates, type DiscountPageStates } from "../../components/model/modules";
import { NOT_WIRED_SIGNALS } from "../../components/model/signals";
import { buildOnboardingProps, rewardsStored } from "../../components/screens/OnboardingScreen";
import { rewardsOverviewOf } from "./rewards.server";
import { cachedRead, readAmountSuggest } from "./themes.server";
import { tiersOverviewOf } from "./tiers.server";
import { textRows } from "./translations.server";
import { outletOverviewOf, outletOverviewRuns } from "./outlet-admin.server";
import { campaignsOverviewOf, finishingOf } from "./campaigns-admin.server";
import { buildOverviewProps } from "../../components/screens/OverviewScreen";
import { buildRuleEditorProps } from "../../components/screens/RuleEditorScreen";
import { buildTryCartProps } from "../../components/screens/TryCartScreen";
import { combinationCheck, scenarioCartOf } from "./combination-check.server";
import {
  codeRuleLimit,
  deleteRule,
  loadStoreSignals,
  moveNative,
  readAdminContext,
  readBackupId,
  readNativeIds,
  readOnboardingForm,
  readShopContext,
  readTryCart,
  refreshTargetingAction,
  resolvePlan,
  resyncNow,
  runTryCart,
  saveOnboarding,
  saveRule,
  undoMove,
  type AdminGraphql,
} from "../ui-actions.server";
import { graphqlOf, nowOf, type ShopCtx } from "./context.server";
import { formLocale } from "./locale.server";
import { ruleNames, syncOutcome } from "./sync-copy";
import { ctxPlan, loadRuleSync, loadSyncView, loadTargetingView, readAutoNodeState, syncWithAutoNode } from "./sync-status.server";
import { appliedPlanOf } from "../sync/runs";
import type { TryCartRun } from "./try-cart.server";

export interface PageOptions {
  /** The session's granted scopes (read_themes decides the embed check). */
  scopes: string;
  /** Test hooks: the REL-1 deadlines. */
  syncDeadlineMs?: number;
  nativeDeadlineMs?: number;
}

function graphql(ctx: ShopCtx): AdminGraphql {
  return graphqlOf(ctx) as AdminGraphql;
}

/**
 * BILL-1 for the admin: the plan in force and what of the STORED config it
 * does not run (core gateConfigForPlan + explainGate, the same gate the sync
 * applies): one sentence per Pro setting, and the rules it switches off.
 * `pending` (F2 re-review I-2): the shop config LIVE in Shopify was still
 * built with those Pro settings (written before the sync gated for plans, or
 * before a downgrade) — checkout runs them until the resync that is under
 * way; the admin says exactly that, and no rule claims "Neběží" meanwhile.
 */
export async function planGateFor(
  ctx: Pick<ShopCtx, "shop" | "locale" | "now" | "db"> & Partial<Pick<ShopCtx, "client" | "createSync">>,
  config: WonDiscountsConfig,
  timezone: string | null,
): Promise<{ pro: boolean; gate: GateNoteView[]; gateOff: string[]; pending: boolean }> {
  const [plan, applied] = await Promise.all([ctxPlan(ctx), appliedPlanOf(ctx.db, ctx.shop)]);
  const now = shopLocalDateTime(nowOf(ctx), timezone ?? "UTC");
  const { stripped } = gateConfigForPlan(config, plan, { now });
  const pending = stripped.length > 0 && applied === "pro" && plan === "free";
  return {
    pro: plan === "pro",
    gate: explainGate(stripped, ctx.locale).map((e) => ({ text: e.text, ...(e.ruleId !== undefined ? { ruleId: e.ruleId } : {}) })),
    gateOff: pending ? [] : stripped.filter((s) => s.reason === "rule_off" && s.ruleId !== undefined).map((s) => s.ruleId as string),
    pending,
  };
}

/**
 * After a redirect (a new rule, a delete) the action's result is gone; the
 * latest sync run is what that save wrote, so the landing page reports it.
 */
async function landingResult(ctx: ShopCtx, loaded: LoadedConfig, message: "saved" | "deleted"): Promise<UiResult> {
  const status = await loadSyncStatus(ctx.db, ctx.shop);
  // The save's sync is still going on in the background (item 7): say so rather than an older run's outcome.
  if (isSyncRunning(ctx.shop) && (!status || status.pending.includes("products_in_progress"))) {
    const progress = syncProgress(ctx.shop);
    return { ok: true, message, ...(status ? { sync: syncOutcome(status, [], ruleNames(loaded.config)) } : {}), syncing: progress?.total ? { products: progress.total } : {} };
  }
  if (!status) return { ok: true, message };
  return { ok: true, message, sync: syncOutcome(status, [], ruleNames(loaded.config)) };
}

// --- Přehled ---------------------------------------------------------------------------------

/** Přehled's data: the stored config + what buildOverviewProps needs (the route builds the props). */
export async function overviewData(ctx: ShopCtx, opts: PageOptions) {
  const [loaded, reads] = await Promise.all([
    loadConfig(ctx.db, ctx.shop),
    readAdminContext({ shop: ctx.shop, scopes: opts.scopes, apiKey: ctx.apiKey, graphql: graphql(ctx) }),
  ]);
  const timezone = reads.shopContext.timezone;
  const signals = await loadStoreSignals(ctx, loaded, {
    scopes: opts.scopes,
    graphql: graphql(ctx),
    timezone,
    shopCurrency: reads.shopContext.currencyCode,
    sync: true,
    syncDeadlineMs: opts.syncDeadlineMs,
    nativeDeadlineMs: opts.nativeDeadlineMs,
  });
  // After the (possible) resync: the automatic node live (P2-3), the targeting line, the gate,
  // and the per-rule facts including what the resync just wrote.
  const [autoNode, targeting, gate] = await Promise.all([
    signals.sync.state === "ok" ? readAutoNodeState(ctx) : Promise.resolve("unknown" as const),
    loadTargetingView(ctx, loaded.config, timezone),
    planGateFor(ctx, loaded.config, timezone),
  ]);
  const sync = syncWithAutoNode(signals.sync, autoNode);
  const ruleSync = await loadRuleSync(ctx, loaded.config, { autoNode });
  return {
    config: loaded.config,
    options: {
      readOnly: loaded.readOnly,
      // The Pro cards (Kampaně, Výprodej) say so on Free instead of offering their setup.
      plan: gate.pro ? ("pro" as const) : ("free" as const),
      signals: { ...signals, sync, targeting, native: withConflictRules(signals.native, loaded.config) },
      ruleSync,
      gate: gate.gate,
      gateOff: gate.gateOff,
      gatePending: gate.pending,
      shopCurrency: reads.shopContext.currencyCode,
      timezone,
      marketNames: reads.marketNames,
      now: nowOf(ctx),
      // Překlady's tile: which languages are complete (the page's rows, counted).
      textCount: textRows(loaded.config, ctx.locale).length,
    },
  };
}

/**
 * The states of the pages under "Slevy" for the strip on each of them (the layout loader): the same facts and
 * the same function as Přehled's tiles (storeStatuses), so a dot and its module's tile cannot disagree.
 *
 * Cheap enough for every page: the stored config and the database only, plus two small Shopify reads kept for
 * 60 s (the shop's time zone and currency; the automatic discount's own state). It never starts a write to
 * Shopify (Přehled's loader does that) and reads neither the theme nor the native discounts: what a tile
 * COUNTS as things to resolve may need those, the state itself does not.
 */
export async function loadDiscountPageStates(ctx: ShopCtx, loaded: LoadedConfig): Promise<DiscountPageStates> {
  const { config } = loaded;
  const [shopContext, plan, runs, finishing] = await Promise.all([
    cachedRead(`shop-context:${ctx.shop}`, () => readShopContext(graphqlOf(ctx))),
    ctxPlan(ctx),
    outletOverviewRuns(ctx),
    finishingOf(ctx),
  ]);
  const { timezone, currencyCode } = shopContext;
  const stored = await loadSyncView(ctx, loaded, timezone);
  const autoNode = stored.state === "ok" ? await cachedRead(`auto-node:${ctx.shop}`, () => readAutoNodeState(ctx)) : ("unknown" as const);
  const [ruleSync, gate] = await Promise.all([loadRuleSync(ctx, config, { autoNode, plan }), planGateFor(ctx, config, timezone)]);
  const now = nowOf(ctx);
  const signals = {
    ...NOT_WIRED_SIGNALS,
    sync: syncWithAutoNode(stored, autoNode),
    // Where the table stands in the theme only adds to the count of things to resolve, never changes the state.
    tiers: tiersOverviewOf(config, plan, { state: "unknown", addUrl: null }),
    rewards: rewardsOverviewOf(config, plan, currencyCode || config.markets.find((m) => m.enabled)?.currency || ""),
    // The names of the variants are for Přehled's sentences only.
    outlet: outletOverviewOf(runs, new Map(), true),
    campaigns: campaignsOverviewOf(config.campaigns, { now: shopLocalDateTime(now, timezone ?? "UTC"), locale: ctx.locale, plan, finishing }),
  };
  const facts = buildOverviewProps(config, { readOnly: loaded.readOnly, plan, signals, ruleSync, gateOff: gate.gateOff, shopCurrency: currencyCode, timezone, now });
  return discountPageStates(storeStatuses({ ...facts, signals }).modules);
}

/**
 * "Střetává se s Won" rows link to the Won discount they fight. The detection names that discount; its id
 * is looked up here by that name (only an unambiguous match), until the native view carries the id itself.
 */
function withConflictRules(native: NativeView, config: WonDiscountsConfig): NativeView {
  if (native.state !== "ok" || !native.conflicts || native.conflicts.length === 0) return native;
  const rules = config.modules.codes.rules;
  return {
    ...native,
    conflicts: native.conflicts.map((conflict) => {
      if (conflict.ruleId) return conflict;
      const named = rules.filter((rule) => rule.name === conflict.ruleName);
      return named.length === 1 ? { ...conflict, ruleId: named[0]!.id } : conflict;
    }),
  };
}

export async function overviewPage(ctx: ShopCtx, opts: PageOptions) {
  const { config, options } = await overviewData(ctx, opts);
  // Kontrola kombinací: the two counts for the tile, read from the stored check (nothing is computed here).
  const combos = await combinationCheck(ctx, { config, plan: options.plan });
  return { ...buildOverviewProps(config, options), ...(combos ? { combos: { ok: combos.view.ok, warnings: combos.view.warnings } } : {}) };
}

/** Přehled actions: "Přesunout" / "Přesunout vše" / "Vrátit zpět" / "Synchronizovat znovu" / "Obnovit cílení". */
export async function overviewAction(ctx: ShopCtx, form: FormData): Promise<UiResult> {
  const intent = form.get("intent");
  const scoped = { ...ctx, locale: formLocale(form, ctx.locale) };
  if (intent === "move") return moveNative(scoped, readNativeIds(form));
  if (intent === "undo") return undoMove(scoped, readBackupId(form));
  if (intent === "resync") return resyncNow(scoped);
  if (intent === "refresh_targeting") return refreshTargetingAction(scoped);
  return { ok: false, reason: "bad_request" };
}

// --- Slevy a kódy -----------------------------------------------------------------------------

export async function discountsPage(ctx: ShopCtx, opts: PageOptions & { deleted: boolean }) {
  const [loaded, reads] = await Promise.all([
    loadConfig(ctx.db, ctx.shop),
    readAdminContext({ shop: ctx.shop, scopes: opts.scopes, apiKey: ctx.apiKey, graphql: graphql(ctx) }),
  ]);
  const [sync, ruleSync, result, gate] = await Promise.all([
    loadSyncView(ctx, loaded, reads.shopContext.timezone),
    loadRuleSync(ctx, loaded.config),
    opts.deleted ? landingResult(ctx, loaded, "deleted") : Promise.resolve(null),
    planGateFor(ctx, loaded.config, reads.shopContext.timezone),
  ]);
  return buildDiscountsProps(loaded.config, {
    readOnly: loaded.readOnly,
    sync,
    ruleSync,
    gate: gate.gate,
    gateOff: gate.gateOff,
    gatePending: gate.pending,
    codeRules: codeRuleLimit(loaded.config),
    shopCurrency: reads.shopContext.currencyCode,
    timezone: reads.shopContext.timezone,
    marketNames: reads.marketNames,
    now: nowOf(ctx),
    result,
  });
}

// --- Editor pravidla -------------------------------------------------------------------------

export async function ruleEditorPage(
  ctx: ShopCtx,
  opts: PageOptions & { ruleId: string; recipe: string | null; saved: boolean },
) {
  const [loaded, reads] = await Promise.all([
    loadConfig(ctx.db, ctx.shop),
    readAdminContext({ shop: ctx.shop, scopes: opts.scopes, apiKey: ctx.apiKey, graphql: graphql(ctx) }),
  ]);
  const [sync, ruleSync, gate] = await Promise.all([
    loadSyncView(ctx, loaded, reads.shopContext.timezone),
    loadRuleSync(ctx, loaded.config),
    planGateFor(ctx, loaded.config, reads.shopContext.timezone),
  ]);
  const props = buildRuleEditorProps(loaded.config, {
    ruleId: opts.ruleId,
    recipe: isRecipeKey(opts.recipe) ? opts.recipe : null,
    readOnly: loaded.readOnly,
    pro: gate.pro,
    gate: gate.gate,
    gateOff: gate.gateOff,
    gatePending: gate.pending,
    marketsScope: canReadMarkets(opts.scopes),
    timezone: reads.shopContext.timezone,
    sync,
    ruleSync,
    codeRules: codeRuleLimit(loaded.config),
    shopCurrency: reads.shopContext.currencyCode,
    marketNames: reads.marketNames,
    now: nowOf(ctx),
  });
  if (!props) return null;
  // Návrh 2: the amounts of the other markets are suggested from the rates set by hand in Shopify.
  const suggest = await readAmountSuggest(graphql(ctx), ctx.shop, opts.scopes, reads.shopContext.currencyCode);
  if (suggest) props.suggest = suggest;
  const target = props.rule?.target;
  const targetIds = target?.kind === "products" ? [...target.productIds, ...target.variantIds] : target?.kind === "collections" ? target.ids : [];
  const [result, labels] = await Promise.all([
    opts.saved ? landingResult(ctx, loaded, "saved") : null,
    // P4: the editor lists what the rule targets by name.
    targetIds.length > 0 ? resourceLabels(ctx, targetIds) : {},
  ]);
  // Bod 6: the generated batches with their codes (rebuilt from the seed here; the seed stays on the server).
  const batches: GeneratedBatchView[] = (props.rule?.codeBatches ?? []).map((batch) => ({
    id: batch.id,
    pattern: codeBatchPattern(batch),
    codes: listBatchCodes(batch),
    pro: isProCodeBatch(batch),
  }));
  return { ...props, labels, batches, result };
}

export type RuleEditorOutcome = { redirect: string } | { result: UiResult };

/** Save (`intent=save`, optionally `replaceUnreadable=1`) or delete (`intent=delete`) the rule of the URL. */
export async function ruleEditorAction(ctx: ShopCtx, form: FormData, ruleId: string): Promise<RuleEditorOutcome> {
  const intent = form.get("intent");
  if (intent === "delete") {
    const version = form.get("ruleVersion");
    const result = await deleteRule(ctx, ruleId, { ruleVersion: typeof version === "string" ? version : null });
    // A deleted rule has no editor page to come back to; the list reports the sync.
    if (result.ok) return { redirect: "/app/discounts?deleted=1" };
    return { result };
  }
  if (intent !== "save") return { result: { ok: false, reason: "bad_request" } };
  const [shopContext, plan] = await Promise.all([readShopContext(graphql(ctx)), resolvePlan(ctx.shop)]);
  const { result, ruleId: savedId } = await saveRule(ctx, form, {
    ruleId,
    timezone: shopContext.timezone,
    shopCurrency: shopContext.currencyCode,
    pro: plan.pro,
  });
  if (result.ok && ruleId === "new" && savedId) return { redirect: `/app/discounts/${encodeURIComponent(savedId)}?saved=1` };
  return { result };
}

// --- Vyzkoušet košík --------------------------------------------------------------------------

export async function tryCartPage(ctx: ShopCtx, opts: PageOptions & { date?: string | null; time?: string | null; scenario?: string | null }) {
  const [{ config }, reads, plan] = await Promise.all([
    loadConfig(ctx.db, ctx.shop),
    readAdminContext({ shop: ctx.shop, scopes: opts.scopes, apiKey: ctx.apiKey, graphql: graphql(ctx) }),
    ctxPlan(ctx),
  ]);
  const props = buildTryCartProps(config, {
    // Vyzkoušet košík is Pro (BILL-1): Free sees the locked frame, and tryCartAction refuses a run.
    pro: plan === "pro",
    timezone: reads.shopContext.timezone,
    shopCurrency: reads.shopContext.currencyCode,
    marketNames: reads.marketNames,
    now: nowOf(ctx),
    date: opts.date ?? null,
    time: opts.time ?? null,
  });
  // Kontrola kombinací: the stored check, read once — the page's Shopify reads above are all there are.
  const combos = await combinationCheck(ctx, { config, plan, marketNames: reads.marketNames });
  if (!combos) return props;
  // ?scenario=<id> (Pro): the manual cart prepared from that combination — its products, codes, market and time.
  const opened = plan === "pro" && opts.scenario ? scenarioCartOf(combos.stored, opts.scenario, ctx.locale) : null;
  return { ...props, combos: combos.view, ...(opened ?? {}) };
}

/**
 * The page's action. Vyzkoušet košík is a Pro tool: the server is the authority (SEC-1, BILL-1), so a Free
 * shop's run is refused here whatever the page showed; nothing is read from Shopify for it.
 */
export async function tryCartAction(ctx: ShopCtx, form: FormData, opts: PageOptions): Promise<TryCartRun> {
  if (form.get("intent") !== "run") return { result: { ok: false, reason: "bad_request" }, plan: null };
  if ((await ctxPlan(ctx)) !== "pro") {
    return { result: { ok: false, reason: "invalid", errors: [{ field: "plan", key: "tryCart.error.pro" }] }, plan: null };
  }
  return tryCartCompute(ctx, form, opts);
}

/**
 * `intent=run`: validate the cart (SEC-1), price it in Shopify, plan it with the engine — on whatever plan
 * the shop has (the engine tests of every module run their carts through this; the page goes through
 * tryCartAction, which adds the plan check). The ticked discounts (`ruleId`) become their first codes here.
 */
export async function tryCartCompute(ctx: ShopCtx, form: FormData, opts: PageOptions): Promise<TryCartRun> {
  if (form.get("intent") !== "run") return { result: { ok: false, reason: "bad_request" }, plan: null };
  const [{ config }, reads] = await Promise.all([
    loadConfig(ctx.db, ctx.shop),
    readAdminContext({ shop: ctx.shop, scopes: opts.scopes, apiKey: ctx.apiKey, graphql: graphql(ctx) }),
  ]);
  const { input: read, errors } = readTryCart(form, config, {
    shopCurrency: reads.shopContext.currencyCode,
    today: shopToday(reads.shopContext.timezone, nowOf(ctx)),
  });
  if (errors.length > 0) return { result: { ok: false, reason: "invalid", errors }, plan: null };
  const input = { ...read, codes: resolveRuleCodes(read.ruleIds, config.modules.codes.rules, read.codes) };
  const locale = resolveLocale(typeof form.get("locale") === "string" ? String(form.get("locale")) : ctx.locale);
  return runTryCart(ctx, { ...input, locale }, {
    config,
    shopCurrency: reads.shopContext.currencyCode,
    timezone: reads.shopContext.timezone,
    marketNames: reads.marketNames,
  });
}

// --- Onboarding -------------------------------------------------------------------------------

export async function onboardingPage(ctx: ShopCtx, opts: PageOptions & { fresh: boolean }) {
  const [loaded, shopContext] = await Promise.all([loadConfig(ctx.db, ctx.shop), readShopContext(graphql(ctx))]);
  const rules = loaded.config.modules.codes.rules;
  const [signals, liveRules] = await Promise.all([
    loadStoreSignals(ctx, loaded, {
      scopes: opts.scopes,
      graphql: graphql(ctx),
      timezone: shopContext.timezone,
      sync: false,
      fresh: opts.fresh,
      nativeDeadlineMs: opts.nativeDeadlineMs,
    }),
    // "Všechno je aktivní" comes from the discounts' real statuses, never from how many there are (B16).
    rules.length > 0 ? liveRuleCount(ctx, loaded, shopContext).catch(() => 0) : Promise.resolve(0),
  ]);
  // N1: a stored reward finishes step 4 too; it is "live" by the same function as its tile (model/module-status.ts).
  const plan = await ctxPlan(ctx);
  const rewardsLive = rewardsStored(loaded.config)
    ? await loadSyncView(ctx, loaded, shopContext.timezone)
        .then((sync) => rewardsStatus(rewardsOverviewOf(loaded.config, plan, shopContext.currencyCode || ""), sync).state === "active")
        .catch(() => false)
    : false;
  return buildOnboardingProps(loaded.config, {
    native: signals.native,
    embed: signals.embed,
    readOnly: loaded.readOnly,
    liveRules,
    rewardsLive,
    plan,
    // N11: the store itself is how a Free shop sees its discounts work.
    storeUrl: `https://${ctx.shop}`,
  });
}

/** How many discounts really run right now: the same judgement as the list and Přehled (model/rule-status "live"). */
async function liveRuleCount(ctx: ShopCtx, loaded: LoadedConfig, shopContext: { timezone: string | null; currencyCode: string | null }): Promise<number> {
  const { config } = loaded;
  const rules = config.modules.codes.rules;
  const [sync, ruleSync, gate] = await Promise.all([
    loadSyncView(ctx, loaded, shopContext.timezone),
    loadRuleSync(ctx, config),
    planGateFor(ctx, config, shopContext.timezone),
  ]);
  const statusCtx = {
    today: shopToday(shopContext.timezone, nowOf(ctx)),
    timezone: shopContext.timezone,
    sync,
    ruleSync,
    gateOff: gate.gateOff,
    currencies: currencyCodes(currencyViews(config.markets, { shopCurrency: shopContext.currencyCode, rules })),
    enabledMarkets: config.markets.filter((m) => m.enabled).map((m) => m.handle),
  };
  return rules.filter((rule) => ruleStatus(rule, statusCtx).kind === "live").length;
}

export async function onboardingAction(ctx: ShopCtx, form: FormData): Promise<UiResult> {
  const intent = form.get("intent");
  const scoped = { ...ctx, locale: formLocale(form, ctx.locale) };
  if (intent === "move") return moveNative(scoped, readNativeIds(form));
  if (intent === "undo") return undoMove(scoped, readBackupId(form));
  const patch = readOnboardingForm(form);
  if (!patch) return { ok: false, reason: "bad_request" };
  return saveOnboarding(ctx, patch);
}
