import type { ReactNode } from "react";
import type { LoaderFunctionArgs } from "react-router";
import { useActionData, useLoaderData, useLocation } from "react-router";

import { resolveLocale } from "../i18n";
import { LocaleProvider, useT } from "../i18n/context";
import { MoveDialog, MoveDialogBody, moveDialogHeading } from "../components/MoveDialog";
import { isRecipeKey, shopToday } from "../components/model/rule-form";
import { ruleStatus } from "../components/model/rule-status";
import type { NativeDiscountView } from "../components/model/types";
import { WonSection } from "../components/shell/WonSection";
import { buildDiscountsProps, DiscountsScreen, type DiscountsScreenProps } from "../components/screens/DiscountsScreen";
import { buildOnboardingProps, onboardingHasNative, OnboardingScreen, type OnboardingScreenProps, onboardingStep } from "../components/screens/OnboardingScreen";
import { buildOverviewProps, OverviewScreen, type OverviewScreenProps } from "../components/screens/OverviewScreen";
import { PlanScreen, type PlanScreenProps } from "../components/screens/PlanScreen";
import { buildRuleEditorProps, RuleEditorScreen, type RuleEditorScreenProps } from "../components/screens/RuleEditorScreen";
import { SettingsScreen, type SettingsScreenProps } from "../components/screens/SettingsScreen";
import { AppearanceScreen, type AppearanceScreenProps } from "../components/screens/AppearanceScreen";
import { TiersScreen, type TiersScreenProps } from "../components/screens/TiersScreen";
import { RewardsScreen, type RewardsScreenProps } from "../components/screens/RewardsScreen";
import { OutletScreen, type OutletScreenProps } from "../components/screens/OutletScreen";
import { AnalyticsScreen, type AnalyticsScreenProps } from "../components/screens/AnalyticsScreen";
import { CampaignsScreen, type CampaignsScreenProps } from "../components/screens/CampaignsScreen";
import { MarginScreen, type MarginScreenProps } from "../components/screens/MarginScreen";
import { buildTryCartProps, TryCartScreen, type TryCartScreenProps } from "../components/screens/TryCartScreen";

import { codeRuleLimit } from "../lib/ui-actions.server";
import {
  DEV_EMBED_OFF,
  DEV_EMBED_ON,
  DEV_EMPTY_FIXTURE,
  DEV_F2_FIXTURE,
  DEV_RULE_SYNC_F2,
  DEV_SIGNALS_F2,
  devGate,
  devTryCartPlanWarnings,
  DEV_MARKET_NAMES,
  DEV_NOW,
  DEV_ONBOARDING_FIXTURE,
  DEV_OVERVIEW_FIXTURE,
  DEV_REWARDS_FIXTURE,
  DEV_RULE_SYNC_FAILED,
  DEV_RULE_SYNC_OK,
  DEV_SIGNALS,
  DEV_SIGNALS_SYNC_FAILED,
  DEV_TIMEZONE,
  DEV_TRY_CART_LINES,
  devEditorResult,
  devRewardsResult,
  devRewardsScreen,
  devOutletOverview,
  devOutletResult,
  devOutletScreen,
  devCampaignsOverview,
  devCampaignsResult,
  devAnalyticsScreen,
  devCampaignsScreen,
  devMovedResult,
  devNative,
  devNativeMoved,
  devTryCartPlan,
  devMarginOverview,
  devModuleSignals,
  devMarginResult,
  devMarginScreen,
  devRuleMarginImpact,
  devTryCartPlanMargin,
  DEV_TRY_CART_MARGIN_LINES,
  DEV_TIERS_FIXTURE,
  devAppearanceScreen,
  devPlanScreen,
  devSettingsScreen,
  devTiersOverview,
  devTiersResult,
  devTiersScreen,
  devTryCartPlanTiers,
  devTryCartPlanRewards,
  devTryCartRewardLines,
  DEV_TRY_CART_TIER_LINES,
  isDevHarnessEnabled,
} from "../lib/dev-harness.server";

// Dev-only admin harness (Task 5 brief): renders the REAL admin screens (the
// same components the embedded app/routes/app.* routes render) against fixture
// configs and fixture store signals, with no Shopify auth and no database — so
// every screen can be screenshot at 390/1440px without logging into Shopify.
//
//   /dev/preview/overview        Přehled without store signals (the v0 contract);
//                                 ?state=live (wired: synced, native discounts),
//                                 ?state=f2 (Free plan gate, targeting being refreshed,
//                                 automatic node switched off in Shopify),
//                                 ?state=sync-failed (last sync failed + Synchronizovat
//                                 znovu), ?state=moved (a discount just moved, with
//                                 its undo + an unfinished move), ?state=empty,
//                                 ?state=margin (Ochrana marže card, costs read
//                                 2 days ago + Obnovit nákupní ceny), ?state=margin-off,
//                                 ?state=margin-running (first read: the ceiling-only line,
//                                 no green) | margin-reauth | margin-too-large,
//                                 ?readOnly=1
//   /dev/preview/discounts       ?state=empty, ?state=f2, ?state=f2-pending, ?sync=ok | ?sync=failed (per-rule facts)
//   /dev/preview/rule-editor     ?rule=<fixture id> | ?rule=new&recipe=<recipe>, ?plan=pro,
//                                 ?result=unreadable|too-many|collision|sync-failed|saved|base-changed|busy|syncing,
//                                 ?rule=dev-f2-collection | dev-f2-market (F2 fixture, Free gate),
//                                 &margin=1 (the margin note: protection lowers the rule; with
//                                 ?plan=pro the count of variants, else no number) | &margin=computing
//   /dev/preview/try-cart        a REAL engine plan on fixture prices; ?state=empty | ?state=not-wired | ?state=warnings
//                                 | ?state=margin (EUR cart, costs by an estimated rate, capped lines)
//                                 | ?state=tiers (MVP 3: the whole-store tier on the caps; &plan=pro: the hoodie's Pro set)
//   /dev/preview/margin          Ochrana marže: Free by default, ?plan=pro; ?state=running | failed-first |
//                                 reauth | zero | off | stale | failed | too-large | many | impact-updating |
//                                 impact-computing | gate (Free with collection settings stored);
//                                 ?rule=<id> (Přehled zásahů of one rule, narrowed like the server does);
//                                 ?result=refreshed | saved | invalid | unreadable | fixes (sanitizer notes of a save)
//   /dev/preview/tiers           Množstevní slevy (MVP 3): Free by default, ?plan=pro; ?state=exceptions (two
//                                 exceptions; &result=invalid-exception opens the one refused) | empty | dawn |
//                                 failed | pending | block-unknown | no-scope | custom (a stored Pro custom
//                                 look + a changed text in the preview); ?theme=dawn; ?accent=green (a stored
//                                 colour); ?embed=off | noscope (Won on the storefront off / not readable);
//                                 ?result=saved | invalid | unreadable | too-large (does not fit at checkout)
//   /dev/preview/appearance      Vzhled: the four looks on the theme; ?state=empty (an example set) | custom |
//                                 issue, ?theme=dawn
//   /dev/preview/rewards         Odměny: Free by default, ?plan=pro; ?state=empty | embed-draft | embed-unknown |
//                                 embed-no-scope; ?result=saved | invalid | too-many
//   /dev/preview/settings        Nastavení: combination switches + markets + tools + the plan sections;
//                                 ?state=changed, ?plan=pro, ?planState=dev | unknown | clean | production
//   /dev/preview/overview        …also ?state=tiers (the Množstevní slevy card, the table not on the page yet),
//                                 ?state=tiers-empty
//   /dev/preview/rule-editor     …also &tiers=1 (a product rule competing with a tier set: the tier note)
//   /dev/preview/onboarding      ?step=1–5, ?embed=on | none | noscope, ?native=none (step 2 skipped), ?rules=1 (has discounts), ?live=<n>
//   /dev/preview/overview        …also ?state=clean (nothing outside Won, all good) | native-error | conflict | pro-cards; ?plan=pro
//   /dev/preview/try-cart        …the bare page is Free (locked); ?plan=pro the tool; ?date=&time= as from a campaign
//   /dev/preview/move-dialog
//   /dev/preview/outlet          Výprodej (MVP 5): Free by default, ?plan=pro; ?state=empty; ?result=started | ended |
//                                 invalid | failed (both with the posted values, B14) | settings-pro (B15).
//                                 Přehled: ?state=outlet (the card with a question)
//   /dev/preview/campaigns       Kampaně (MVP 6): Free by default, ?plan=pro; ?state=empty | finishing | suggest
//                                 (&edit=bf: the discount only in the shop currency; &result=invalid-tier: the levels too; &rates=none: no rate set); ?edit=<id>;
//                                 ?result=saved | killed | invalid | invalid-rule (an error at one discount and at
//                                 the time control) | sync-pending. Přehled: ?state=campaigns (+ &finishing=1)
//   /dev/preview/plan            Tarif as its own page; ?plan=pro, ?state=dev | unknown | clean | production
//                                 (production: no sentences for developers), ?result=<kind>
//   Any screen: ?locale=en for the English admin.
//   tiers, rewards, settings: ?markets=shared (Germany sells in euros next to Slovakia: a field per market).
//
// Double guard against ever reaching a non-development environment:
//   1. BUILD-TIME: app/routes.ts excludes this file from the route manifest
//      unless NODE_ENV is exactly "development" or "test".
//   2. RUNTIME (defence in depth, e.g. a misconfigured build): the loader and
//      the action 404 whenever isDevHarnessEnabled() is false (same allowlist).
//
// The route component only reads useLoaderData()/useLocation() and renders
// shared components — it never imports dev-harness.server.ts values itself
// (React Router strips loader/action from the client bundle, but NOT a
// component's own imports).

export const HARNESS_SCREENS = [
  "overview",
  "discounts",
  "rule-editor",
  "try-cart",
  "onboarding",
  "move-dialog",
  "plan",
  "analytics",
  "settings",
  "margin",
  "tiers",
  "rewards",
  "outlet",
  "campaigns",
  "appearance",
] as const;
export type HarnessScreen = (typeof HARNESS_SCREENS)[number];

/** `/dev/preview/<screen>` → the screen; `/dev/preview` alone is Přehled; anything else is null. */
export function harnessScreen(pathname: string): HarnessScreen | null {
  const rest = pathname.replace(/^\/dev\/preview\/?/, "").replace(/\/+$/, "");
  if (rest === "") return "overview";
  return (HARNESS_SCREENS as readonly string[]).includes(rest) ? (rest as HarnessScreen) : null;
}

const notFound = () => new Response("Not Found", { status: 404 });

/** Návrh 2 in the harness: Slovakia has a manual rate (1 Kč = 0,04 €); ?rates=none = no market has one. */
function devSuggest(q: URLSearchParams) {
  // ?rates=market: Germany's own manual rate (0,05) next to the euro's 0,04 — its suggestion differs from Slovakia's.
  return { base: "CZK", rates: q.get("rates") === "none" ? {} : { EUR: 0.04 }, ...(q.get("rates") === "market" ? { marketRates: { de: 0.05 } } : {}) };
}

export const loader = ({ request }: LoaderFunctionArgs) => {
  if (!isDevHarnessEnabled()) {
    throw notFound();
  }
  const url = new URL(request.url);
  const q = url.searchParams;
  const screen = harnessScreen(url.pathname);
  const readOnly = q.get("readOnly") === "1";
  const state = q.get("state");
  const locale = resolveLocale(q.get("locale"));

  const names = DEV_MARKET_NAMES;
  const sync = { state: "not_wired" as const };
  switch (screen) {
    case "overview": {
      // ?plan=pro: the Pro cards (Kampaně, Výprodej) as a Pro shop sees them; Free says they are Pro.
      const wired = { readOnly, timezone: DEV_TIMEZONE, marketNames: names, now: DEV_NOW, plan: q.get("plan") === "pro" ? ("pro" as const) : ("free" as const) };
      // Nothing outside Won, the website on, everything synced: "Slevy mimo Won" is not rendered and the store status is all good.
      if (state === "clean") {
        return buildOverviewProps(DEV_OVERVIEW_FIXTURE, {
          ...wired,
          signals: { ...DEV_SIGNALS, embed: DEV_EMBED_ON, native: { state: "ok", discounts: [], moved: [], conflicts: [] }, analytics: { available: true, empty: true, days: 30, tiles: [] } },
          ruleSync: DEV_RULE_SYNC_OK,
        });
      }
      // The detection failed (a retry), a discount fights a Won one (a link to its codes), the theme cannot be read, the sync is blocked.
      if (state === "native-error") {
        return buildOverviewProps(DEV_OVERVIEW_FIXTURE, { ...wired, signals: { ...DEV_SIGNALS, native: { state: "error" } }, ruleSync: DEV_RULE_SYNC_OK });
      }
      if (state === "conflict") {
        return buildOverviewProps(DEV_OVERVIEW_FIXTURE, {
          ...wired,
          signals: {
            ...DEV_SIGNALS,
            embed: { state: "no_scope", activateUrl: null },
            sync: { state: "blocked", reason: "unreadable_config" },
            native: {
              ...devNative(locale),
              conflicts: [{ nativeTitle: "VIP10", ruleName: "VIP kód", ruleId: "dev-fixture-2", message: locale === "cs" ? "Kód VIP10 používá i sleva v Shopify. Platit může jen jedna." : "The code VIP10 is also used by a Shopify discount. Only one can apply." }],
            },
          },
          ruleSync: DEV_RULE_SYNC_OK,
        });
      }
      // Free with nothing running: the Pro cards say so (ProSell) instead of offering their setup.
      if (state === "pro-cards") {
        return buildOverviewProps(DEV_OVERVIEW_FIXTURE, {
          ...wired,
          signals: {
            ...DEV_SIGNALS,
            native: devNative(locale),
            campaigns: { running: null, next: null, finishing: false },
            outlet: { running: 0, pendingReturns: [], oversold: 0, problems: 0, ordersCounted: true },
          },
          ruleSync: DEV_RULE_SYNC_OK,
        });
      }
      if (state === "live") {
        return buildOverviewProps(DEV_OVERVIEW_FIXTURE, { ...wired, signals: { ...DEV_SIGNALS, native: devNative(locale) }, ruleSync: DEV_RULE_SYNC_OK });
      }
      if (state === "sync-failed") {
        return buildOverviewProps(DEV_OVERVIEW_FIXTURE, {
          ...wired,
          signals: { ...DEV_SIGNALS_SYNC_FAILED, native: devNative(locale) },
          ruleSync: DEV_RULE_SYNC_FAILED,
        });
      }
      if (state === "moved") {
        return {
          ...buildOverviewProps(DEV_OVERVIEW_FIXTURE, { ...wired, signals: { ...DEV_SIGNALS, native: devNativeMoved(locale) }, ruleSync: DEV_RULE_SYNC_OK }),
          // The Notice the Move fetcher shows in the section right after the move.
          nativeResult: devMovedResult(locale),
        };
      }
      if (state === "f2") {
        return buildOverviewProps(DEV_F2_FIXTURE, {
          ...wired,
          signals: { ...DEV_SIGNALS_F2, native: devNative(locale) },
          ruleSync: DEV_RULE_SYNC_F2,
          ...devGate(locale),
        });
      }
      if (state === "margin" || state === "margin-off" || state === "margin-running" || state === "margin-reauth" || state === "margin-too-large") {
        const card = state === "margin" ? "stale" : state === "margin-off" ? "off" : state === "margin-running" ? "running" : state === "margin-reauth" ? "reauth" : "too-large";
        return buildOverviewProps(DEV_OVERVIEW_FIXTURE, {
          ...wired,
          signals: { ...DEV_SIGNALS, native: devNative(locale), margin: devMarginOverview(card) },
          ruleSync: DEV_RULE_SYNC_OK,
        });
      }
      if (state === "campaigns") {
        return buildOverviewProps(DEV_OVERVIEW_FIXTURE, {
          ...wired,
          signals: { ...DEV_SIGNALS, native: devNative(locale), campaigns: devCampaignsOverview({ locale, finishing: q.get("finishing") === "1" }) },
          ruleSync: DEV_RULE_SYNC_OK,
        });
      }
      if (state === "outlet") {
        return buildOverviewProps(DEV_OVERVIEW_FIXTURE, {
          ...wired,
          signals: { ...DEV_SIGNALS, native: devNative(locale), outlet: devOutletOverview(q.get("orders") === "on") },
          ruleSync: DEV_RULE_SYNC_OK,
        });
      }
      if (state === "tiers" || state === "tiers-empty") {
        return buildOverviewProps(DEV_OVERVIEW_FIXTURE, {
          ...wired,
          signals: { ...DEV_SIGNALS, native: devNative(locale), tiers: devTiersOverview(state === "tiers" ? "off" : "empty") },
          ruleSync: DEV_RULE_SYNC_OK,
        });
      }
      // Every module from the fixtures the module pages render: a tile and its page say the same state.
      if (state === "modules" || state === "modules-off" || state === "modules-failed") {
        const mode = state === "modules" ? "on" : state === "modules-off" ? "off" : "failed";
        return buildOverviewProps(mode === "off" ? DEV_EMPTY_FIXTURE : DEV_OVERVIEW_FIXTURE, {
          ...wired,
          signals: devModuleSignals({ mode, plan: wired.plan, locale }),
          ruleSync: mode === "failed" ? DEV_RULE_SYNC_FAILED : DEV_RULE_SYNC_OK,
        });
      }
      if (state === "empty") return buildOverviewProps(DEV_EMPTY_FIXTURE, { readOnly, timezone: DEV_TIMEZONE, now: DEV_NOW });
      return buildOverviewProps(DEV_OVERVIEW_FIXTURE, { readOnly });
    }
    case "discounts": {
      if (state === "f2" || state === "f2-pending") {
        const gate = devGate(locale);
        return buildDiscountsProps(DEV_F2_FIXTURE, {
          readOnly,
          sync: DEV_SIGNALS_F2.sync,
          ruleSync: DEV_RULE_SYNC_F2,
          codeRules: codeRuleLimit(DEV_F2_FIXTURE),
          timezone: DEV_TIMEZONE,
          marketNames: names,
          now: DEV_NOW,
          ...gate,
          // I-2: checkout still runs a config built with these Pro settings (a resync is under way).
          ...(state === "f2-pending" ? { gateOff: [], gatePending: true } : {}),
        });
      }
      const config = state === "empty" ? DEV_EMPTY_FIXTURE : DEV_OVERVIEW_FIXTURE;
      const syncState = q.get("sync");
      return buildDiscountsProps(config, {
        readOnly,
        sync: syncState === "ok" ? DEV_SIGNALS.sync : syncState === "failed" ? DEV_SIGNALS_SYNC_FAILED.sync : sync,
        ...(syncState === "ok" ? { ruleSync: DEV_RULE_SYNC_OK } : syncState === "failed" ? { ruleSync: DEV_RULE_SYNC_FAILED } : {}),
        codeRules: codeRuleLimit(config),
        timezone: DEV_TIMEZONE,
        marketNames: names,
        now: DEV_NOW,
      });
    }
    case "rule-editor": {
      const recipe = q.get("recipe");
      const ruleParam = q.get("rule") ?? "dev-fixture-4";
      const f2 = ruleParam.startsWith("dev-f2-");
      const withTiers = q.get("tiers") === "1";
      const props = buildRuleEditorProps(withTiers ? DEV_TIERS_FIXTURE : f2 ? DEV_F2_FIXTURE : DEV_OVERVIEW_FIXTURE, {
        ...(f2 && q.get("plan") !== "pro" ? devGate(locale) : {}),
        ...(f2 ? { ruleSync: DEV_RULE_SYNC_F2, marketsScope: false } : {}),
        ruleId: ruleParam,
        recipe: isRecipeKey(recipe) ? recipe : null,
        readOnly,
        pro: q.get("plan") === "pro",
        timezone: DEV_TIMEZONE,
        sync,
        codeRules: codeRuleLimit(DEV_OVERVIEW_FIXTURE),
        shopCurrency: "CZK",
        marketNames: names,
        now: DEV_NOW,
      });
      if (!props) throw notFound();
      // P4: ?products=N targets N named products (the selected list, its filter and "show all"); the last has no name.
      const productCount = Math.min(Number(q.get("products")) || 0, 40);
      const picked = Array.from({ length: productCount }, (_, i) => `gid://shopify/Product/${900 + i}`);
      const pickedLabels = Object.fromEntries(picked.slice(0, -1).map((id, i) => [id, { title: `${["Mikina Won", "Tričko Won", "Čepice Won", "Ponožky Won"][i % 4]} ${i + 1}` }]));
      return {
        ...props,
        suggest: devSuggest(q),
        ...(productCount > 0 && props.rule
          ? { rule: { ...props.rule, target: { kind: "products" as const, productIds: picked, variantIds: [], ...(q.get("mins") === "1" ? { itemMinimums: [{ id: picked[0]!, quantity: 3 }, { id: picked[1] ?? picked[0]!, quantity: 4 }] } : {}) } }, labels: pickedLabels }
          : { labels: { "gid://shopify/Collection/7": { title: "Doplňky" } } }),
        // Bod 6: ?batch=N lists a generated batch of N codes (and a Pro-pattern one).
        ...(Number(q.get("batch")) > 0
          ? {
              batches: [
                { id: "b1", pattern: "KXTR-XXXXXXXXXX", pro: false, codes: Array.from({ length: Math.min(Number(q.get("batch")), 200) }, (_, i) => `KXTR-${String(7352941 * (i + 3)).padStart(10, "A").slice(0, 10)}`) },
                { id: "b2", pattern: "BF-XXXXXX-VIP", pro: true, codes: ["BF-4821KQ-VIP", "BF-9034TR-VIP", "BF-1177MZ-VIP"] },
              ],
            }
          : {}),
        result: devEditorResult(q.get("result")),
        ...(q.get("margin") === "1" || q.get("margin") === "computing"
          ? { marginImpact: devRuleMarginImpact(ruleParam, { pro: q.get("plan") === "pro", computing: q.get("margin") === "computing" }) }
          : {}),
      };
    }
    case "try-cart": {
      // Vyzkoušet košík is Pro: the bare page is what Free sees (the locked frame), ?plan=pro the tool itself.
      // A `state` fixture shows a result of the engine, so it is always the unlocked tool (its ?plan= picks the fixture's plan).
      // ?date=&time= as from a campaign link (the "začátek kampaně" time choice).
      const base = buildTryCartProps(DEV_OVERVIEW_FIXTURE, {
        timezone: DEV_TIMEZONE,
        marketNames: names,
        now: DEV_NOW,
        pro: q.get("plan") === "pro" || state !== null,
        date: q.get("date"),
        time: q.get("time"),
      });
      if (!base.pro) return base;
      if (state === "empty") return base;
      if (state === "warnings") return { ...base, lines: DEV_TRY_CART_LINES, ruleIds: ["dev-fixture-2"], currency: "CZK:cz", plan: devTryCartPlanWarnings(locale) };
      if (state === "margin") return { ...base, lines: DEV_TRY_CART_MARGIN_LINES, currency: "EUR:sk", plan: devTryCartPlanMargin(locale) };
      if (state === "tiers") {
        return { ...base, lines: DEV_TRY_CART_TIER_LINES, currency: "CZK:cz", plan: devTryCartPlanTiers(locale, q.get("plan") === "pro" ? "pro" : "free") };
      }
      if (state === "rewards") {
        const plan = q.get("plan") === "pro" ? "pro" : "free";
        return { ...base, lines: devTryCartRewardLines(plan), currency: "CZK:cz", plan: devTryCartPlanRewards(locale, plan) };
      }
      if (state === "not-wired") {
        return { ...base, lines: DEV_TRY_CART_LINES, ruleIds: ["dev-fixture-2"], result: { ok: false as const, reason: "not_wired" as const, what: "tryCart" as const } };
      }
      return { ...base, lines: DEV_TRY_CART_LINES, ruleIds: ["dev-fixture-2"], currency: "CZK:cz", plan: devTryCartPlan(locale) };
    }
    case "onboarding": {
      const step = Number(q.get("step") ?? "1");
      // ?rules=1: a shop that already has discounts (steps 4 and 5 done or not, by ?live=).
      const config = step === 1 ? DEV_EMPTY_FIXTURE : q.get("rules") === "1" ? { ...DEV_OVERVIEW_FIXTURE, onboarding: DEV_ONBOARDING_FIXTURE.onboarding } : DEV_ONBOARDING_FIXTURE;
      // ?native=none: nothing outside Won, so step 2 is skipped (four steps). ?embed=on | none (no link to the editor)
      // | noscope. ?live=<n>: how many of the discounts really run (default: all of them).
      const native = q.get("native") === "none" ? { state: "ok" as const, discounts: [], moved: [], conflicts: [] } : devNative(locale);
      const embedParam = q.get("embed");
      const embed =
        embedParam === "on" ? DEV_EMBED_ON : embedParam === "none" ? { state: "unknown" as const, activateUrl: null } : embedParam === "noscope" ? { state: "no_scope" as const, activateUrl: null } : DEV_EMBED_OFF;
      const live = q.get("live");
      // ?goal=rewards: the goal "Doprava zdarma nebo dárek" is picked (step 4 leads to Odměny, N1); ?rewards=set | live.
      const goalConfig = q.get("goal") === "rewards" ? { ...config, onboarding: { ...config.onboarding, goals: ["rewards" as const] } } : config;
      const rewardsParam = q.get("rewards");
      const withRewards = rewardsParam === "set" || rewardsParam === "live" ? { ...goalConfig, modules: { ...goalConfig.modules, rewards: DEV_REWARDS_FIXTURE.modules.rewards } } : goalConfig;
      // The default count is what really runs in the fixture (N12: never "all of them" next to a tile that says three).
      const liveDefault = withRewards.modules.codes.rules.filter((rule) => ruleStatus(rule, { today: shopToday(DEV_TIMEZONE, DEV_NOW), timezone: DEV_TIMEZONE, sync: DEV_SIGNALS.sync, currencies: ["CZK", "EUR"] }).kind === "live").length;
      const props = buildOnboardingProps(withRewards, {
        native,
        embed,
        readOnly,
        liveRules: live !== null && /^\d+$/.test(live) ? Number(live) : liveDefault,
        rewardsLive: rewardsParam === "live",
        plan: q.get("plan") === "pro" ? "pro" : "free",
        storeUrl: "https://won-dev.myshopify.com",
      });
      // The shown step follows the state as on the real page (past step 3 → 4, a first discount → 5; step 2 only with something outside Won).
      return { ...props, step: onboardingStep(Number.isFinite(step) ? step : 1, { embedOn: embedParam === "on", rules: props.rules, hasNative: onboardingHasNative(native) }) };
    }
    case "move-dialog": {
      const discounts = devNative(locale).discounts.filter((d) => d.movable);
      return { discounts: q.get("all") === "1" ? discounts : discounts.slice(0, 1) };
    }
    case "plan":
      // Tarif (MVP 7): Free by default; ?plan=pro (subscribed, on trial), ?state=dev (the dev override alone),
      // ?state=unknown (Shopify did not answer), ?state=clean (nothing to put back), ?result=<kind>.
      // ?state=production: the app in production (the dev override and test charge sentences are not shown).
      return { ...devPlanScreen({ plan: q.get("plan") === "pro" ? "pro" : "free", state, result: q.get("result") }), production: state === "production" };
    case "settings": {
      // Nastavení ends with the plan sections (Tarif lives here since the menu change); ?planState= as on /plan.
      const plan = q.get("plan") === "pro" ? "pro" : "free";
      const planState = q.get("planState");
      return {
        ...devSettingsScreen({ plan, state, shared: q.get("markets") === "shared", fallback: q.get("fallback") === "1", highest: q.get("highest") === "1" }),
        planScreen: { ...devPlanScreen({ plan, state: planState, result: null }), production: planState === "production" },
      };
    }
    case "tiers":
      return {
        ...devTiersScreen({ plan: q.get("plan") === "pro" ? "pro" : "free", state, locale, theme: q.get("theme"), accent: q.get("accent"), embed: q.get("embed"), shared: q.get("markets") === "shared" }),
        result: devTiersResult(q.get("result")),
        suggest: devSuggest(q),
      };
    case "rewards":
      // ?start=shipping: opened from the setup guide (free shipping switched on, amounts prefilled — N1).
      return { ...devRewardsScreen({ plan: q.get("plan") === "pro" ? "pro" : "free", state, locale, shared: q.get("markets") === "shared" }), result: devRewardsResult(q.get("result")), start: q.get("start") === "shipping" ? ("shipping" as const) : null, suggest: devSuggest(q) };
    case "campaigns":
      return {
        ...devCampaignsScreen({ plan: q.get("plan") === "pro" ? "pro" : "free", state, locale, edit: q.get("edit") }),
        result: devCampaignsResult(q.get("result")),
        suggest: devSuggest(q),
      };
    case "analytics":
      // Přehledy (MVP 7): Free by default (?plan=pro), ?state=empty (no order yet), ?state=unavailable (no access to orders).
      return devAnalyticsScreen({ plan: q.get("plan") === "pro" ? "pro" : "free", state, locale });
    case "outlet":
      return { ...devOutletScreen({ plan: q.get("plan") === "pro" ? "pro" : "free", state, locale, orders: q.get("orders") === "on" }), result: devOutletResult(q.get("result")) };
    case "appearance":
      return devAppearanceScreen({ plan: q.get("plan") === "pro" ? "pro" : "free", state, theme: q.get("theme") });
    case "margin":
      return {
        ...devMarginScreen({ plan: q.get("plan") === "pro" ? "pro" : "free", state, locale, focusRuleId: q.get("rule") }),
        result: devMarginResult(q.get("result"), locale),
      };
    default:
      throw notFound();
  }
};

// Forms in the harness post here: nothing is saved, and the screen says so.
export const action = () => {
  if (!isDevHarnessEnabled()) {
    throw notFound();
  }
  return { ok: false as const, reason: "preview_only" as const };
};

/** The dialog's body inline (a screenshot can't catch an open modal), plus the real modal. */
function MoveDialogPreview({ discounts }: { discounts: NativeDiscountView[] }) {
  const tr = useT();
  return (
    <s-page heading="Won Discounts">
      <WonSection title={moveDialogHeading(discounts, tr)} glyph="move">
        <MoveDialogBody discounts={discounts} />
        <div style={{ marginTop: 12 }}>
          <s-button variant="primary" commandFor="won-move-dialog" command="--show">
            {tr.t("move.confirm")}
          </s-button>
        </div>
      </WonSection>
      <MoveDialog id="won-move-dialog" discounts={discounts} onConfirm={() => undefined} />
    </s-page>
  );
}

export default function DevPreview() {
  const data = useLoaderData<typeof loader>();
  // A harness form submit answers `preview_only`; the screen shows it like any result.
  const submitted = useActionData<typeof action>() ?? null;
  const location = useLocation();
  const screen = harnessScreen(location.pathname) ?? "overview";
  const locale = resolveLocale(new URLSearchParams(location.search).get("locale"));

  let content: ReactNode;
  switch (screen) {
    case "overview": {
      const props = data as OverviewScreenProps;
      content = <OverviewScreen {...props} />;
      break;
    }
    case "discounts":
      content = <DiscountsScreen {...(data as DiscountsScreenProps)} />;
      break;
    case "rule-editor":
      content = <RuleEditorScreen {...(data as RuleEditorScreenProps)} result={submitted ?? (data as RuleEditorScreenProps).result} />;
      break;
    case "try-cart":
      content = <TryCartScreen {...(data as TryCartScreenProps)} result={submitted ?? (data as TryCartScreenProps).result} />;
      break;
    case "onboarding":
      content = <OnboardingScreen {...(data as OnboardingScreenProps)} result={submitted ?? (data as OnboardingScreenProps).result} />;
      break;
    case "move-dialog":
      content = <MoveDialogPreview {...(data as { discounts: NativeDiscountView[] })} />;
      break;
    case "plan":
      content = <PlanScreen {...(data as PlanScreenProps)} />;
      break;
    case "settings":
      // The plan sections post to the harness itself (nothing is saved), not to /app/plan.
      content = <SettingsScreen {...(data as SettingsScreenProps)} result={submitted} planAction="" />;
      break;
    case "tiers":
      content = <TiersScreen {...(data as TiersScreenProps)} result={submitted ?? (data as TiersScreenProps).result} />;
      break;
    case "rewards":
      content = <RewardsScreen {...(data as RewardsScreenProps)} result={submitted ?? (data as RewardsScreenProps).result} />;
      break;
    case "campaigns":
      content = <CampaignsScreen {...(data as CampaignsScreenProps)} result={(data as CampaignsScreenProps).result} />;
      break;
    case "analytics":
      content = <AnalyticsScreen {...(data as AnalyticsScreenProps)} />;
      break;
    case "outlet":
      content = <OutletScreen {...(data as OutletScreenProps)} result={(data as OutletScreenProps).result} />;
      break;
    case "appearance":
      content = <AppearanceScreen {...(data as AppearanceScreenProps)} result={submitted} />;
      break;
    case "margin":
      content = <MarginScreen {...(data as MarginScreenProps)} result={submitted ?? (data as MarginScreenProps).result} />;
      break;
  }

  return (
    <>
      {/* Polaris web components (s-page, s-section, …), loaded the same way
          @shopify/shopify-app-react-router's <AppProvider> loads it for real
          admin pages, so a screenshot of this route looks like the real app. */}
      <script src="https://cdn.shopify.com/shopifycloud/polaris.js" />
      <LocaleProvider locale={locale}>{content}</LocaleProvider>
    </>
  );
}
