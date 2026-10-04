// Tarif (MVP 7, contracts M1–M3) — the plan screen's server side.
//   loadPlanScreen(ctx)        reconciles the plan with Shopify first (so the screen never shows a stale plan: the
//                              return from the confirmation page lands here), then: the plan in force, the trial's
//                              end, what a cancel would leave running (A6), what "Připravit na odinstalaci" would
//                              do (A7), the real limits;
//   planAction(ctx, form, o)   intent subscribe → Shopify's confirmation page URL (the screen opens it in the top
//                              frame) | cancel → appSubscriptionCancel, reconcile, resync (the gate takes Pro data
//                              out of checkout; running campaigns and sales finish) | uninstall_prep → ends the
//                              sales and restores the moved Shopify discounts.
// A plan change resyncs the shop: checkout must run what the plan allows at once, not at the next save.
// The dev override (WON_DEV_PLAN, development only) wins over everything and the screen says so.
// The session shop only (SEC-2); the form is parsed here (SEC-1).

import { campaignStatusAt } from "@won/core/discounts/campaigns";
import { CONFIG_LIMITS } from "@won/core/discounts/config";

import type { FormDataLike } from "../../components/model/rule-form";
import type { PlanActionResult, PlanScreenData } from "../../components/model/plan";
import { cancelProSubscription, entitlementView, isTestCharge, PRO_PLAN, reconcilePlan, requestProSubscription } from "../billing.server";
import { loadConfig } from "../config.server";
import { formatShopTime } from "../native/copy";
import { devPlanOverride } from "../plan.server";
import { resyncShop } from "../sync/save-and-sync.server";
import { shopLocalDateTime } from "../sync/sync.server";
import { codeRuleLimit } from "../ui-actions.server";
import { graphqlOf, nowOf, type ShopCtx } from "./context.server";
import { ctxPlan } from "./sync-status.server";
import { readShopContext } from "./themes.server";
import { planUninstallPrep, runUninstallPrep } from "./uninstall-prep.server";

export const PLAN_INTENT = { subscribe: "subscribe", cancel: "cancel", uninstallPrep: "uninstall_prep" } as const;

/** Resync after a plan change; never fatal for the screen (the Přehled retries a failed sync). */
async function resyncForPlan(ctx: ShopCtx): Promise<boolean> {
  try {
    const result = await resyncShop({ client: ctx.client, db: ctx.db, shop: ctx.shop, ...(ctx.createSync ? { createSync: ctx.createSync } : {}), ...(ctx.now ? { now: ctx.now } : {}) });
    return result.ok;
  } catch (error) {
    if (error instanceof Response) throw error;
    return false;
  }
}

export async function loadPlanScreen(ctx: ShopCtx, opts: { env?: Readonly<Record<string, string | undefined>> } = {}): Promise<PlanScreenData> {
  const now = nowOf(ctx);
  const devOverride = devPlanOverride(opts.env) === "pro";
  const reconciled = await reconcilePlan(ctx.db, ctx.client, ctx.shop, now);
  if (reconciled.changed && !devOverride) await resyncForPlan(ctx);
  const [view, plan, loaded, prep, shopContext, outlets] = await Promise.all([
    entitlementView(ctx.db, ctx.shop, now),
    ctxPlan(ctx),
    loadConfig(ctx.db, ctx.shop),
    planUninstallPrep(ctx),
    readShopContext(graphqlOf(ctx)),
    ctx.db.outletRun.count({ where: { shop: ctx.shop, status: { in: ["starting", "active", "ending"] } } }),
  ]);
  const zone = shopContext.timezone ?? "UTC";
  const nowLocal = shopLocalDateTime(now, zone);
  return {
    plan,
    subscribed: view.plan === "pro",
    devOverride,
    billingKnown: reconciled.known,
    trialEndsText: view.trialEndsAt ? formatShopTime(view.trialEndsAt.toISOString(), zone, ctx.locale) : null,
    test: view.test || isTestCharge(opts.env),
    price: { amount: PRO_PLAN.amount.replace(/\.00$/, ""), currency: PRO_PLAN.currency, trialDays: PRO_PLAN.trialDays },
    codeRules: codeRuleLimit(loaded.config),
    maxRules: CONFIG_LIMITS.rules,
    finishing: {
      campaigns: loaded.config.campaigns.filter((c) => campaignStatusAt(c, nowLocal) === "running").map((c) => c.name || c.id),
      outlets,
    },
    uninstall: { outlets: prep.outlets.length, natives: prep.natives.map((n) => n.title) },
  };
}

/**
 * Where Shopify sends the merchant after the confirmation page: Tarif INSIDE the admin. The app's own URL would
 * open outside the admin with no session (the login page) — live finding 2026-10-04.
 */
function billingReturnUrl(shop: string, apiKey: string): string | null {
  const store = /^([a-z0-9][a-z0-9-]*)\.myshopify\.com$/.exec(shop)?.[1];
  return store && apiKey ? `https://admin.shopify.com/store/${store}/apps/${encodeURIComponent(apiKey)}/app/plan?billing=return` : null;
}

export async function planAction(ctx: ShopCtx, form: FormDataLike, opts: { env?: Readonly<Record<string, string | undefined>> } = {}): Promise<PlanActionResult> {
  const intent = String(form.get("intent") ?? "");
  switch (intent) {
    case PLAN_INTENT.subscribe: {
      const returnUrl = billingReturnUrl(ctx.shop, ctx.apiKey);
      if (!returnUrl) return { ok: false, kind: "subscribe", detail: "the app's client id is not configured" };
      const result = await requestProSubscription(ctx.client, returnUrl, { test: isTestCharge(opts.env) });
      return result.ok ? { ok: true, kind: "subscribe", confirmationUrl: result.confirmationUrl } : { ok: false, kind: "subscribe", detail: result.detail };
    }
    case PLAN_INTENT.cancel: {
      const cancelled = await cancelProSubscription(ctx.client);
      if (!cancelled.ok) return { ok: false, kind: "cancel", detail: cancelled.detail };
      const reconciled = await reconcilePlan(ctx.db, ctx.client, ctx.shop, nowOf(ctx));
      const synced = reconciled.changed ? await resyncForPlan(ctx) : true;
      return { ok: true, kind: "cancel", synced };
    }
    case PLAN_INTENT.uninstallPrep: {
      const result = await runUninstallPrep(ctx);
      return { ok: result.failed.length === 0, kind: "uninstall_prep", ended: result.ended, restored: result.restored, failed: result.failed.map((f) => ({ what: f.what, detail: f.detail })) };
    }
    default:
      return { ok: false, kind: "unknown", detail: "bad request" };
  }
}
