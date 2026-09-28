// The wired admin pages: every loader / action body of the embedded routes
// (app/routes/app*.tsx), taking the request context instead of the request's
// auth. A route is then three lines — authenticate, build the ShopCtx from the
// SESSION shop, call the page — and tests/integration run these exact bodies
// with a fake AdminClient and a throwaway database.

import type { LoadedConfig } from "../config.server";
import { loadConfig } from "../config.server";
import { loadSyncStatus } from "../sync/save-and-sync.server";
import { resolveLocale } from "../../i18n";
import { isRecipeKey, shopToday } from "../../components/model/rule-form";
import type { UiResult } from "../../components/model/types";
import { buildDiscountsProps } from "../../components/screens/DiscountsScreen";
import { buildOnboardingProps } from "../../components/screens/OnboardingScreen";
import { buildOverviewProps } from "../../components/screens/OverviewScreen";
import { buildRuleEditorProps } from "../../components/screens/RuleEditorScreen";
import { buildTryCartProps } from "../../components/screens/TryCartScreen";
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
import { loadRuleSync, loadSyncView } from "./sync-status.server";
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
 * After a redirect (a new rule, a delete) the action's result is gone; the
 * latest sync run is what that save wrote, so the landing page reports it.
 */
async function landingResult(ctx: ShopCtx, loaded: LoadedConfig, message: "saved" | "deleted"): Promise<UiResult> {
  const status = await loadSyncStatus(ctx.db, ctx.shop);
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
  const signals = await loadStoreSignals(ctx, loaded, {
    scopes: opts.scopes,
    graphql: graphql(ctx),
    timezone: reads.shopContext.timezone,
    sync: true,
    syncDeadlineMs: opts.syncDeadlineMs,
    nativeDeadlineMs: opts.nativeDeadlineMs,
  });
  // After the (possible) resync: the per-rule facts include what it just wrote.
  const ruleSync = await loadRuleSync(ctx, loaded.config);
  return {
    config: loaded.config,
    options: {
      readOnly: loaded.readOnly,
      signals,
      ruleSync,
      shopCurrency: reads.shopContext.currencyCode,
      timezone: reads.shopContext.timezone,
      marketNames: reads.marketNames,
      now: nowOf(ctx),
    },
  };
}

export async function overviewPage(ctx: ShopCtx, opts: PageOptions) {
  const { config, options } = await overviewData(ctx, opts);
  return buildOverviewProps(config, options);
}

/** Přehled actions: "Přesunout" / "Přesunout vše" / "Vrátit zpět" / "Synchronizovat znovu". */
export async function overviewAction(ctx: ShopCtx, form: FormData): Promise<UiResult> {
  const intent = form.get("intent");
  const scoped = { ...ctx, locale: formLocale(form, ctx.locale) };
  if (intent === "move") return moveNative(scoped, readNativeIds(form));
  if (intent === "undo") return undoMove(scoped, readBackupId(form));
  if (intent === "resync") return resyncNow(scoped);
  return { ok: false, reason: "bad_request" };
}

// --- Slevy a kódy -----------------------------------------------------------------------------

export async function discountsPage(ctx: ShopCtx, opts: PageOptions & { deleted: boolean }) {
  const [loaded, reads] = await Promise.all([
    loadConfig(ctx.db, ctx.shop),
    readAdminContext({ shop: ctx.shop, scopes: opts.scopes, apiKey: ctx.apiKey, graphql: graphql(ctx) }),
  ]);
  const [sync, ruleSync, result] = await Promise.all([
    loadSyncView(ctx, loaded, reads.shopContext.timezone),
    loadRuleSync(ctx, loaded.config),
    opts.deleted ? landingResult(ctx, loaded, "deleted") : Promise.resolve(null),
  ]);
  return buildDiscountsProps(loaded.config, {
    readOnly: loaded.readOnly,
    sync,
    ruleSync,
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
  const [loaded, reads, plan] = await Promise.all([
    loadConfig(ctx.db, ctx.shop),
    readAdminContext({ shop: ctx.shop, scopes: opts.scopes, apiKey: ctx.apiKey, graphql: graphql(ctx) }),
    resolvePlan(),
  ]);
  const [sync, ruleSync] = await Promise.all([loadSyncView(ctx, loaded, reads.shopContext.timezone), loadRuleSync(ctx, loaded.config)]);
  const props = buildRuleEditorProps(loaded.config, {
    ruleId: opts.ruleId,
    recipe: isRecipeKey(opts.recipe) ? opts.recipe : null,
    readOnly: loaded.readOnly,
    pro: plan.pro,
    timezone: reads.shopContext.timezone,
    sync,
    ruleSync,
    codeRules: codeRuleLimit(loaded.config),
    shopCurrency: reads.shopContext.currencyCode,
    marketNames: reads.marketNames,
    now: nowOf(ctx),
  });
  if (!props) return null;
  const result = opts.saved ? await landingResult(ctx, loaded, "saved") : null;
  return { ...props, result };
}

export type RuleEditorOutcome = { redirect: string } | { result: UiResult };

/** Save (`intent=save`, optionally `replaceUnreadable=1`) or delete (`intent=delete`) the rule of the URL. */
export async function ruleEditorAction(ctx: ShopCtx, form: FormData, ruleId: string): Promise<RuleEditorOutcome> {
  const intent = form.get("intent");
  if (intent === "delete") {
    const result = await deleteRule(ctx, ruleId);
    // A deleted rule has no editor page to come back to; the list reports the sync.
    if (result.ok) return { redirect: "/app/discounts?deleted=1" };
    return { result };
  }
  if (intent !== "save") return { result: { ok: false, reason: "bad_request" } };
  const [shopContext, plan] = await Promise.all([readShopContext(graphql(ctx)), resolvePlan()]);
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

export async function tryCartPage(ctx: ShopCtx, opts: PageOptions) {
  const [{ config }, reads] = await Promise.all([
    loadConfig(ctx.db, ctx.shop),
    readAdminContext({ shop: ctx.shop, scopes: opts.scopes, apiKey: ctx.apiKey, graphql: graphql(ctx) }),
  ]);
  return buildTryCartProps(config, {
    timezone: reads.shopContext.timezone,
    shopCurrency: reads.shopContext.currencyCode,
    marketNames: reads.marketNames,
    now: nowOf(ctx),
  });
}

/** `intent=run`: validate the cart (SEC-1), price it in Shopify, plan it with the engine. */
export async function tryCartAction(ctx: ShopCtx, form: FormData, opts: PageOptions): Promise<TryCartRun> {
  if (form.get("intent") !== "run") return { result: { ok: false, reason: "bad_request" }, plan: null };
  const [{ config }, reads] = await Promise.all([
    loadConfig(ctx.db, ctx.shop),
    readAdminContext({ shop: ctx.shop, scopes: opts.scopes, apiKey: ctx.apiKey, graphql: graphql(ctx) }),
  ]);
  const { input, errors } = readTryCart(form, config, {
    shopCurrency: reads.shopContext.currencyCode,
    today: shopToday(reads.shopContext.timezone, nowOf(ctx)),
  });
  if (errors.length > 0) return { result: { ok: false, reason: "invalid", errors }, plan: null };
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
  const signals = await loadStoreSignals(ctx, loaded, {
    scopes: opts.scopes,
    graphql: graphql(ctx),
    timezone: shopContext.timezone,
    sync: false,
    fresh: opts.fresh,
    nativeDeadlineMs: opts.nativeDeadlineMs,
  });
  return buildOnboardingProps(loaded.config, { native: signals.native, embed: signals.embed, readOnly: loaded.readOnly });
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
