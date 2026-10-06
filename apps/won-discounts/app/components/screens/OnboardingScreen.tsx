// Onboarding (docs/won-discounts/rozhodnuti.md, "Onboarding"; goal: the first working
// discount in under 3 minutes). Steps, by id:
//   1. "Co chcete řešit?" — goals only ORDER the modules; all stay visible.
//   2. Shopify discounts found → ONE "Přesunout" button. Shown only when there is
//      something outside Won (or a move to return); otherwise the step is skipped
//      and the guide has four steps (B16, P2).
//   3. App embed: a button opens the theme editor with the embed switched on; the
//      app detects it by itself when the merchant comes back (focus → revalidate).
//      The discount works at checkout without it, so the step can be skipped.
//   4. The first discount from a recipe with its values pre-filled (MVP 7): open as
//      soon as step 3 is done OR skipped.
//   5. "Hotovo": a checklist of what is REALLY done (signals and rule statuses, never
//      a stored tick or a count) with one button for each thing that is not.
// The numbers the merchant sees are positions among the steps shown ("1."–"4." or
// "1."–"5."), and Přehled's card counts the same way (onboardingProgress).
// Each step is a WonSection whose state line tells the truth when collapsed (§17d);
// the current step is open.

import { useEffect, useRef } from "react";
import { Form, useNavigate } from "react-router";

import { ONBOARDING_GOALS, type OnboardingGoal, type WonDiscountsConfig } from "@won/core/discounts/config";

import { useT } from "../../i18n/context";
import type { MessageKey } from "../../i18n";
import { NativeDiscountsPanel, nativeSummary } from "../NativeDiscounts";
import { RecipeGrid, recipeHref } from "../RecipeGrid";
import type { RecipeKey } from "../model/rule-form";
import { embedText, nativeNeedsSection } from "../model/signals";
import type { EmbedView, NativeView, UiResult } from "../model/types";
import { boolAttr } from "../shell/attrs";
import { Notice } from "../shell/Notice";
import { PlanBadge } from "../shell/PlanBadge";
import { RowNote, WonRow, WonSection } from "../shell/WonSection";

export interface OnboardingScreenProps {
  /** Current step 1–5: the stored step (1–3), moved on by the shop's state (onboardingStep). */
  step: number;
  /** Discounts the shop has (step 4 is done with the first one). */
  rules: number;
  /** How many of them really run (model/rule-status "live"): "Všechno je aktivní" and the green marks come from this. */
  liveRules: number;
  goals: OnboardingGoal[];
  native: NativeView;
  embed: EmbedView;
  readOnly: boolean;
  result?: UiResult | null;
}

export function buildOnboardingProps(
  config: WonDiscountsConfig,
  opts: { native: NativeView; embed: EmbedView; readOnly: boolean; result?: UiResult | null; liveRules?: number },
): OnboardingScreenProps {
  const rules = config.modules.codes.rules.length;
  return {
    step: onboardingStep(config.onboarding.step, { embedOn: opts.embed.state === "on", rules, hasNative: onboardingHasNative(opts.native) }),
    rules,
    liveRules: Math.min(rules, opts.liveRules ?? 0),
    goals: [...config.onboarding.goals],
    native: opts.native,
    embed: opts.embed,
    readOnly: opts.readOnly,
    result: opts.result ?? null,
  };
}

/** Step 2 has something to show: discounts outside Won, a move to return, a failed read — or the read is still running. */
export function onboardingHasNative(native: NativeView | undefined): boolean {
  return nativeNeedsSection(native) || native?.state === "loading";
}

/**
 * The step to show (its id, 1–5): the stored one (what the merchant clicked through), then by what is really
 * there. Step 2 is skipped when nothing is outside Won. Past step 3 — the embed is on, or the merchant skipped
 * it (stored 4+) — it is 4 (the first discount), with a discount 5 (done). The merchant can always open any
 * earlier step; nothing is locked.
 */
export function onboardingStep(stored: number, state: { embedOn: boolean; rules: number; hasNative?: boolean }): number {
  let step = Math.min(5, Math.max(1, Math.floor(stored) || 1));
  if (step === 2 && state.hasNative === false) step = 3;
  if (step < 3) return step;
  if (step === 3 && !state.embedOn) return 3;
  return state.rules > 0 ? 5 : 4;
}

/** The ids of the steps shown, in order (step 2 only with something outside Won). */
export function onboardingSteps(hasNative: boolean): number[] {
  return hasNative ? [1, 2, 3, 4, 5] : [1, 3, 4, 5];
}

/** "Krok 2 ze 4": the current step's position among the steps shown — one count for the guide and for Přehled (B16). */
export function onboardingProgress(stored: number, state: { embedOn: boolean; rules: number; hasNative: boolean }): { step: number; position: number; total: number } {
  const step = onboardingStep(stored, state);
  const steps = onboardingSteps(state.hasNative);
  return { step, position: Math.max(1, steps.indexOf(step) + 1), total: steps.length };
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

export function OnboardingScreen({ step, rules, liveRules = 0, goals, native, embed, readOnly, result }: OnboardingScreenProps) {
  const tr = useT();
  const { t } = tr;
  const embedOn = embed.state === "on";
  const hasNative = onboardingHasNative(native);
  const steps = onboardingSteps(hasNative);
  /** "3. Zapnout na webu": the position among the steps shown. */
  const numbered = (id: number, key: MessageKey) => `${steps.indexOf(id) + 1}. ${t(key)}`;
  const running = liveRules > 0;
  const allDone = embedOn && running;

  // "Aplikace sama pozná, že je zapnuto": when the merchant comes back from the
  // theme editor tab, re-read the embed state bypassing the short theme cache
  // (`?recheck=`). `focus` and `visibilitychange` both fire on a tab switch, so
  // one re-check per few seconds at most (API-3).
  const navigate = useNavigate();
  const lastCheck = useRef(0);
  const recheck = () => {
    const now = Date.now();
    lastCheck.current = now;
    navigate(`?recheck=${now}`, { replace: true, preventScrollReset: true });
  };
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
  const firstSummary = rules === 0 ? t("onboarding.first.none") : running ? tr.tp("onboarding.first.done", rules) : `${tr.tp("onboarding.first.done", rules)}. ${t("onboarding.first.notLive")}`;

  /** "Pokračovat" / "Přeskočit": stores the step the guide goes on with. */
  const stepForm = (next: number, label: string, variant: "primary" | "secondary" | "tertiary") => (
    <Form method="post">
      <input type="hidden" name="intent" value="step" />
      <input type="hidden" name="step" value={String(next)} />
      <s-button type="submit" variant={variant} disabled={boolAttr(readOnly)}>
        {label}
      </s-button>
    </Form>
  );

  return (
    <s-page heading={t("onboarding.title")}>
      <s-link slot="breadcrumb-actions" href="/app">
        {t("nav.overview")}
      </s-link>
      <s-stack direction="block" gap="base">
        <s-paragraph color="subdued">{t("onboarding.subtitle", { steps: tr.tp("count.step", steps.length) })}</s-paragraph>
        {readOnly ? (
          <s-banner tone="warning" heading={t("common.readOnly.heading")}>
            {t("common.readOnly.body")}
          </s-banner>
        ) : null}
        <Notice result={result} />

        <WonSection
          key={`goals-${step}`}
          title={numbered(1, "onboarding.goals.title")}
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

        {hasNative ? (
          <WonSection
            key={`native-${step}`}
            title={numbered(2, "onboarding.native.title")}
            glyph="move"
            summary={nativeSummary(native, tr)}
            collapsible
            defaultOpen={step === 2}
          >
            <s-stack direction="block" gap="base">
              <s-text color="subdued">{t("onboarding.native.body")}</s-text>
              <NativeDiscountsPanel native={native} mode="all" readOnly={readOnly} />
              {stepForm(3, t("common.continue"), native.state === "ok" && native.discounts.some((d) => d.movable) ? "tertiary" : "primary")}
            </s-stack>
          </WonSection>
        ) : null}

        <WonSection
          key={`embed-${step}`}
          title={numbered(3, "onboarding.embed.title")}
          glyph="store"
          summary={embedOn ? t("onboarding.embed.done") : embedText(embed.state, tr)}
          on={embedOn}
          collapsible
          defaultOpen={step === 3}
        >
          <s-stack direction="block" gap="base">
            {embedOn ? (
              // Done: say so and offer the next step (nothing left to switch on here).
              <>
                <s-text>{t("onboarding.embed.done")}</s-text>
                {stepForm(4, t("common.continue"), "primary")}
              </>
            ) : (
              <>
                <s-text color="subdued">{t("onboarding.embed.body")}</s-text>
                {embed.state !== "no_scope" && embed.activateUrl ? (
                  <s-stack direction="block" gap="small-200">
                    <div>
                      <s-button variant="primary" href={embed.activateUrl} target="_blank">
                        {t("onboarding.embed.open")}
                      </s-button>
                    </div>
                    <s-text color="subdued">{t("onboarding.embed.detect")}</s-text>
                  </s-stack>
                ) : (
                  // No link to the editor, or the app cannot read the theme: why, and what to do instead.
                  <s-stack direction="block" gap="small-200">
                    <RowNote tone="attention">{t(embed.state === "no_scope" ? "onboarding.embed.noScope" : "onboarding.embed.manual")}</RowNote>
                    <div>
                      <s-button variant="secondary" onClick={recheck}>
                        {t("overview.embed.recheck")}
                      </s-button>
                    </div>
                  </s-stack>
                )}
                {/* B16: the first discount does not need the website switched on. */}
                <s-text color="subdued">{t("onboarding.embed.skipNote")}</s-text>
                {stepForm(4, t("onboarding.embed.skip"), "tertiary")}
              </>
            )}
          </s-stack>
        </WonSection>

        <WonSection
          key={`first-${step}`}
          title={numbered(4, "onboarding.first.title")}
          glyph="tag"
          summary={firstSummary}
          // Green only when a discount really runs (rule statuses), not when one merely exists.
          on={rules > 0 ? running : false}
          collapsible
          defaultOpen={step === 4}
          anchor="first"
        >
          <s-stack direction="block" gap="base">
            <s-text color="subdued">{t("onboarding.first.body")}</s-text>
            <RecipeGrid />
          </s-stack>
        </WonSection>

        <WonSection
          key={`done-${step}`}
          title={numbered(5, "onboarding.done.title")}
          glyph="check"
          summary={t(allDone ? "onboarding.done.all" : "onboarding.done.left")}
          on={allDone}
          collapsible
          defaultOpen={step === 5}
        >
          <div data-won-onboarding-checklist>
            <WonRow
              action={
                embedOn ? undefined : embed.state !== "no_scope" && embed.activateUrl ? (
                  <s-button href={embed.activateUrl} target="_blank" variant="secondary">
                    {t("onboarding.embed.open")}
                  </s-button>
                ) : (
                  <s-button variant="secondary" onClick={recheck}>
                    {t("overview.embed.recheck")}
                  </s-button>
                )
              }
            >
              <RowNote tone={embedOn ? undefined : "attention"}>{t(embedOn ? "onboarding.check.embed.on" : "onboarding.check.embed.off")}</RowNote>
            </WonRow>
            <WonRow
              action={
                rules === 0 ? (
                  <s-button href={recipeHref(firstRecipe(goals))} variant="secondary">
                    {t("onboarding.finish")}
                  </s-button>
                ) : running ? undefined : (
                  // A discount exists but none runs: the list says why for each one.
                  <s-button href="/app/discounts" variant="secondary">
                    {t("result.action.showDiscounts")}
                  </s-button>
                )
              }
            >
              <RowNote tone={running ? undefined : "attention"}>
                {rules === 0 ? t("onboarding.check.first.off") : running ? tr.tp("onboarding.check.live", liveRules) : t("onboarding.check.first.notLive")}
              </RowNote>
            </WonRow>
            <WonRow
              action={
                <s-button href="/app/try-cart" variant="secondary">
                  {t("nav.tryCart")}
                </s-button>
              }
            >
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <RowNote>{t("onboarding.check.tryCart")}</RowNote>
                <PlanBadge tier="pro" />
              </div>
            </WonRow>
            <WonRow
              action={
                <s-button href="/app" variant={allDone ? "primary" : "secondary"}>
                  {t("onboarding.done.open")}
                </s-button>
              }
            >
              {null}
            </WonRow>
          </div>
        </WonSection>
      </s-stack>
    </s-page>
  );
}
