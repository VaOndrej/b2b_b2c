// Onboarding steps 1–3 (docs/won-discounts/rozhodnuti.md, "Onboarding"; goal: the
// first working discount in under 3 minutes):
//   1. "Co chceš řešit?" — goals only ORDER the modules; all stay visible.
//   2. Shopify discounts found → ONE "Přesunout" button (only when there are any).
//   3. App embed: a button opens the theme editor with the embed switched on; the
//      app detects it by itself when the merchant comes back (focus → revalidate).
// Each step is a WonSection whose state line tells the truth when collapsed (§17d);
// the current step is open. Step 4 (first rule from a recipe) is the editor.

import { useEffect, useRef } from "react";
import { Form, useNavigate } from "react-router";

import { ONBOARDING_GOALS, type OnboardingGoal, type WonDiscountsConfig } from "@won/core/discounts/config";

import { useT } from "../../i18n/context";
import type { MessageKey } from "../../i18n";
import { NativeDiscountsPanel, nativeSummary } from "../NativeDiscounts";
import { recipeHref } from "../RecipeGrid";
import type { RecipeKey } from "../model/rule-form";
import { embedText } from "../model/signals";
import type { EmbedView, NativeView, UiResult } from "../model/types";
import { boolAttr } from "../shell/attrs";
import { Notice } from "../shell/Notice";
import { WonSection } from "../shell/WonSection";

export interface OnboardingScreenProps {
  /** Current step 1–3 (config.onboarding.step, clamped). */
  step: number;
  goals: OnboardingGoal[];
  native: NativeView;
  embed: EmbedView;
  readOnly: boolean;
  result?: UiResult | null;
}

export function buildOnboardingProps(
  config: WonDiscountsConfig,
  opts: { native: NativeView; embed: EmbedView; readOnly: boolean; result?: UiResult | null },
): OnboardingScreenProps {
  return {
    step: Math.min(3, Math.max(1, config.onboarding.step)),
    goals: [...config.onboarding.goals],
    native: opts.native,
    embed: opts.embed,
    readOnly: opts.readOnly,
    result: opts.result ?? null,
  };
}

const GOAL_KEYS: Record<OnboardingGoal, MessageKey> = {
  rewards: "goal.rewards",
  tiers: "goal.tiers",
  outlet: "goal.outlet",
  margin: "goal.margin",
  migrate: "goal.migrate",
};

/** Step 4: the first discount, from the recipe that fits the first goal. */
export function firstRecipe(goals: readonly OnboardingGoal[]): RecipeKey {
  return goals.includes("rewards") ? "freeShipping" : "percentAll";
}

const RECHECK_MIN_MS = 3000;

export function OnboardingScreen({ step, goals, native, embed, readOnly, result }: OnboardingScreenProps) {
  const tr = useT();
  const { t } = tr;
  const embedOn = embed.state === "on";

  // "Appka sama pozná, že je zapnutý": when the merchant comes back from the
  // theme editor tab, re-read the embed state bypassing the short theme cache
  // (`?recheck=`). `focus` and `visibilitychange` both fire on a tab switch, so
  // one re-check per few seconds at most (API-3).
  const navigate = useNavigate();
  const lastCheck = useRef(0);
  useEffect(() => {
    if (embedOn || typeof window === "undefined") return;
    const again = () => {
      if (document.visibilityState !== "visible") return;
      const now = Date.now();
      if (now - lastCheck.current < RECHECK_MIN_MS) return;
      lastCheck.current = now;
      navigate(`?recheck=${now}`, { replace: true, preventScrollReset: true });
    };
    window.addEventListener("focus", again);
    document.addEventListener("visibilitychange", again);
    return () => {
      window.removeEventListener("focus", again);
      document.removeEventListener("visibilitychange", again);
    };
  }, [embedOn, navigate]);

  const goalsSummary =
    goals.length === 0 ? t("onboarding.goals.none") : t("onboarding.goals.picked", { goals: tr.list(goals.map((g) => t(GOAL_KEYS[g]))) });

  return (
    <s-page heading={t("onboarding.title")}>
      <s-link slot="breadcrumb-actions" href="/app">
        {t("nav.overview")}
      </s-link>
      <s-stack direction="block" gap="base">
        <s-paragraph color="subdued">{t("onboarding.subtitle")}</s-paragraph>
        {readOnly ? (
          <s-banner tone="warning" heading={t("common.readOnly.heading")}>
            {t("common.readOnly.body")}
          </s-banner>
        ) : null}
        <Notice result={result} />

        <WonSection
          key={`goals-${step}`}
          title={t("onboarding.goals.title")}
          glyph="target"
          summary={goalsSummary}
          collapsible
          defaultOpen={step === 1}
        >
          <Form method="post">
            <input type="hidden" name="intent" value="goals" />
            <s-stack direction="block" gap="base">
              <s-text color="subdued">{t("onboarding.goals.body")}</s-text>
              {/* One checklist = one control (§7c calm test), multiple answers allowed. */}
              <s-choice-list name="goals" label={t("onboarding.goals.title")} labelAccessibilityVisibility="exclusive" multiple>
                {ONBOARDING_GOALS.map((goal) => (
                  <s-choice key={goal} value={goal} selected={boolAttr(goals.includes(goal))}>
                    {t(GOAL_KEYS[goal])}
                  </s-choice>
                ))}
              </s-choice-list>
              <div>
                <s-button type="submit" variant="primary" disabled={boolAttr(readOnly)}>
                  {t("common.continue")}
                </s-button>
              </div>
            </s-stack>
          </Form>
        </WonSection>

        <WonSection
          key={`native-${step}`}
          title={t("onboarding.native.title")}
          glyph="move"
          summary={nativeSummary(native, tr)}
          collapsible
          defaultOpen={step === 2}
        >
          <s-stack direction="block" gap="base">
            <s-text color="subdued">{t("onboarding.native.body")}</s-text>
            <NativeDiscountsPanel native={native} mode="all" />
            <Form method="post">
              <input type="hidden" name="intent" value="step" />
              <input type="hidden" name="step" value="3" />
              <s-button type="submit" variant={native.state === "ok" && native.discounts.some((d) => d.movable) ? "tertiary" : "primary"} disabled={boolAttr(readOnly)}>
                {t("common.continue")}
              </s-button>
            </Form>
          </s-stack>
        </WonSection>

        <WonSection
          key={`embed-${step}`}
          title={t("onboarding.embed.title")}
          glyph="store"
          summary={embedOn ? t("onboarding.embed.done") : embedText(embed.state, tr)}
          on={embedOn}
          collapsible
          defaultOpen={step === 3}
        >
          <s-stack direction="block" gap="base">
            <s-text color="subdued">{t("onboarding.embed.body")}</s-text>
            {embedOn ? (
              <div>
                <s-button variant="primary" href={recipeHref(firstRecipe(goals))}>
                  {t("onboarding.finish")}
                </s-button>
              </div>
            ) : (
              <s-stack direction="block" gap="small-200">
                <div>
                  {embed.activateUrl ? (
                    <s-button variant="primary" href={embed.activateUrl} target="_blank">
                      {t("onboarding.embed.open")}
                    </s-button>
                  ) : null}
                </div>
                <s-text color="subdued">{t("onboarding.embed.detect")}</s-text>
                <div>
                  <s-link href={recipeHref(firstRecipe(goals))}>{t("onboarding.finish")}</s-link>
                </div>
              </s-stack>
            )}
          </s-stack>
        </WonSection>
      </s-stack>
    </s-page>
  );
}
