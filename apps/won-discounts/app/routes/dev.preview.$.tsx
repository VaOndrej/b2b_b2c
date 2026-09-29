import type { ReactNode } from "react";
import type { LoaderFunctionArgs } from "react-router";
import { useActionData, useLoaderData, useLocation } from "react-router";

import { resolveLocale } from "../i18n";
import { LocaleProvider, useT } from "../i18n/context";
import { MoveDialog, MoveDialogBody, moveDialogHeading } from "../components/MoveDialog";
import { isUpcomingModule, type UpcomingModule } from "../components/model/modules";
import { currencyViews } from "../components/model/markets";
import { isRecipeKey } from "../components/model/rule-form";
import type { NativeDiscountView } from "../components/model/types";
import { WonSection } from "../components/shell/WonSection";
import { ComingSoonScreen } from "../components/screens/ComingSoonScreen";
import { buildDiscountsProps, DiscountsScreen, type DiscountsScreenProps } from "../components/screens/DiscountsScreen";
import { buildOnboardingProps, OnboardingScreen, type OnboardingScreenProps } from "../components/screens/OnboardingScreen";
import { buildOverviewProps, OverviewScreen, type OverviewScreenProps } from "../components/screens/OverviewScreen";
import { PlanScreen, type PlanScreenProps } from "../components/screens/PlanScreen";
import { buildRuleEditorProps, RuleEditorScreen, type RuleEditorScreenProps } from "../components/screens/RuleEditorScreen";
import { SettingsScreen, type SettingsScreenProps } from "../components/screens/SettingsScreen";
import { MarginScreen, type MarginScreenProps } from "../components/screens/MarginScreen";
import { buildTryCartProps, TryCartScreen, type TryCartScreenProps } from "../components/screens/TryCartScreen";
import { CONFIG_LIMITS } from "@won/core/discounts/config";

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
  DEV_RULE_SYNC_FAILED,
  DEV_RULE_SYNC_OK,
  DEV_SIGNALS,
  DEV_SIGNALS_SYNC_FAILED,
  DEV_TIMEZONE,
  DEV_TRY_CART_LINES,
  devEditorResult,
  devMovedResult,
  devNative,
  devNativeMoved,
  devTryCartPlan,
  devMarginOverview,
  devMarginResult,
  devMarginScreen,
  devRuleMarginImpact,
  devTryCartPlanMargin,
  DEV_TRY_CART_MARGIN_LINES,
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
//                                 ?readOnly=1
//   /dev/preview/discounts       ?state=empty, ?state=f2, ?state=f2-pending, ?sync=ok | ?sync=failed (per-rule facts)
//   /dev/preview/rule-editor     ?rule=<fixture id> | ?rule=new&recipe=<recipe>, ?plan=pro,
//                                 ?result=unreadable|too-many|collision|sync-failed|saved|base-changed|busy|syncing,
//                                 ?rule=dev-f2-collection | dev-f2-market (F2 fixture, Free gate),
//                                 &margin=1 (the margin note: protection lowers the rule)
//   /dev/preview/try-cart        a REAL engine plan on fixture prices; ?state=empty | ?state=not-wired | ?state=warnings
//                                 | ?state=margin (EUR cart, costs by an estimated rate, capped lines)
//   /dev/preview/margin          Ochrana marže: Free by default, ?plan=pro; ?state=running | zero | off |
//                                 stale | failed | gate (Free with collection settings stored);
//                                 ?rule=<id> (Přehled zásahů of one rule); ?result=refreshed | saved | invalid | unreadable
//   /dev/preview/onboarding      ?step=1|2|3, ?embed=on
//   /dev/preview/move-dialog
//   /dev/preview/coming-soon     ?module=tiers|rewards|outlet|campaigns|appearance
//   /dev/preview/plan, /dev/preview/settings
//   Any screen: ?locale=en for the English admin.
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
  "coming-soon",
  "plan",
  "settings",
  "margin",
] as const;
export type HarnessScreen = (typeof HARNESS_SCREENS)[number];

/** `/dev/preview/<screen>` → the screen; `/dev/preview` alone is Přehled; anything else is null. */
export function harnessScreen(pathname: string): HarnessScreen | null {
  const rest = pathname.replace(/^\/dev\/preview\/?/, "").replace(/\/+$/, "");
  if (rest === "") return "overview";
  return (HARNESS_SCREENS as readonly string[]).includes(rest) ? (rest as HarnessScreen) : null;
}

const notFound = () => new Response("Not Found", { status: 404 });

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
      const wired = { readOnly, timezone: DEV_TIMEZONE, marketNames: names, now: DEV_NOW };
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
      if (state === "margin" || state === "margin-off") {
        return buildOverviewProps(DEV_OVERVIEW_FIXTURE, {
          ...wired,
          signals: { ...DEV_SIGNALS, native: devNative(locale), margin: devMarginOverview(state === "margin" ? "stale" : "off") },
          ruleSync: DEV_RULE_SYNC_OK,
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
      const props = buildRuleEditorProps(f2 ? DEV_F2_FIXTURE : DEV_OVERVIEW_FIXTURE, {
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
      return {
        ...props,
        result: devEditorResult(q.get("result")),
        ...(q.get("margin") === "1" ? { marginImpact: devRuleMarginImpact(ruleParam) } : {}),
      };
    }
    case "try-cart": {
      const base = buildTryCartProps(DEV_OVERVIEW_FIXTURE, { timezone: DEV_TIMEZONE, marketNames: names, now: DEV_NOW });
      if (state === "empty") return base;
      if (state === "warnings") return { ...base, lines: DEV_TRY_CART_LINES, codes: "VIP10", currency: "CZK:cz", plan: devTryCartPlanWarnings(locale) };
      if (state === "margin") return { ...base, lines: DEV_TRY_CART_MARGIN_LINES, currency: "EUR:sk", plan: devTryCartPlanMargin(locale) };
      if (state === "not-wired") {
        return { ...base, lines: DEV_TRY_CART_LINES, codes: "VIP10", result: { ok: false as const, reason: "not_wired" as const, what: "tryCart" as const } };
      }
      return { ...base, lines: DEV_TRY_CART_LINES, codes: "VIP10", currency: "CZK:cz", plan: devTryCartPlan(locale) };
    }
    case "onboarding": {
      const step = Number(q.get("step") ?? "1");
      const config = step === 1 ? DEV_EMPTY_FIXTURE : DEV_ONBOARDING_FIXTURE;
      const props = buildOnboardingProps(config, {
        native: devNative(locale),
        embed: q.get("embed") === "on" ? DEV_EMBED_ON : DEV_EMBED_OFF,
        readOnly,
      });
      return { ...props, step: Math.min(3, Math.max(1, Number.isFinite(step) ? step : 1)) };
    }
    case "move-dialog": {
      const discounts = devNative(locale).discounts.filter((d) => d.movable);
      return { discounts: q.get("all") === "1" ? discounts : discounts.slice(0, 1) };
    }
    case "coming-soon": {
      const module = q.get("module") ?? "tiers";
      if (!isUpcomingModule(module)) throw notFound();
      return { module };
    }
    case "plan":
      return { pro: q.get("plan") === "pro", codeRules: codeRuleLimit(DEV_OVERVIEW_FIXTURE), maxRules: CONFIG_LIMITS.rules };
    case "settings":
      return { currencies: currencyViews(DEV_OVERVIEW_FIXTURE.markets, { marketNames: names }) };
    case "margin":
      return {
        ...devMarginScreen({ plan: q.get("plan") === "pro" ? "pro" : "free", state, locale }),
        result: devMarginResult(q.get("result")),
        focusRuleId: q.get("rule"),
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
    case "coming-soon":
      content = <ComingSoonScreen {...(data as { module: UpcomingModule })} />;
      break;
    case "plan":
      content = <PlanScreen {...(data as PlanScreenProps)} />;
      break;
    case "settings":
      content = <SettingsScreen {...(data as SettingsScreenProps)} />;
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
