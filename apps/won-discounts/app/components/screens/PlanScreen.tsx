// Tarif (MVP 7, contracts M1–M3; spec §7, A6, A7, A9). The plan actually in force (BILL-1: Pro only from a verified
// Shopify subscription), the real limits (never "neomezeně"), Pro in amber with its price and trial, and the two
// ways out that do no harm:
//   - "Zrušit Pro": says what stops and what runs to its end (A6) before the click;
//   - "Připravit na odinstalaci" (any plan): puts sale prices back and restores the moved Shopify discounts (A7).
// Subscribing opens Shopify's own confirmation page in the top frame (the app never takes a payment itself).
// A presentational component: app/routes/app.plan.tsx renders it from loadPlanScreen
// (app/lib/integration/plan-admin.server.ts), the dev harness from a fixture.

import { useEffect } from "react";
import { Form } from "react-router";

import { useT } from "../../i18n/context";
import type { PlanActionResult, PlanScreenData } from "../model/plan";
import { ProFrame } from "../shell/ProFrame";
import { RowNote, WonSection } from "../shell/WonSection";

export interface PlanScreenProps extends PlanScreenData {
  result?: PlanActionResult | null;
}

/** The form's intents (the server's PLAN_INTENT, app/lib/integration/plan-admin.server.ts). */
const INTENT = { subscribe: "subscribe", cancel: "cancel", uninstallPrep: "uninstall_prep" } as const;

function ResultBanner({ result }: { result: PlanActionResult }) {
  const { t } = useT();
  if (result.kind === "subscribe") {
    return result.ok ? <s-banner tone="info" heading={t("plan.subscribe.redirect")} /> : <s-banner tone="critical" heading={t("plan.subscribe.failed", { detail: result.detail })} />;
  }
  if (result.kind === "cancel") {
    if (!result.ok) return <s-banner tone="critical" heading={t("plan.cancel.failed", { detail: result.detail })} />;
    return <s-banner tone={result.synced ? "success" : "warning"} heading={t(result.synced ? "plan.cancel.done" : "plan.cancel.pending")} />;
  }
  if (result.kind === "uninstall_prep") {
    if (result.ok) return <s-banner tone="success" heading={t("plan.uninstall.done", { ended: result.ended, restored: result.restored })} />;
    const failed = result.failed.map((f) => t(f.what === "outlet" ? "plan.uninstall.failed.outlet" : "plan.uninstall.failed.native", { detail: f.detail })).join(", ");
    return <s-banner tone="critical" heading={t("plan.uninstall.partial", { ended: result.ended, restored: result.restored, failed })} />;
  }
  return null;
}

export function PlanScreen(props: PlanScreenProps) {
  const { t } = useT();
  const { plan, subscribed, devOverride, billingKnown, trialEndsText, test, price, codeRules, maxRules, finishing, uninstall, result } = props;
  const pro = plan === "pro";

  // Shopify's confirmation page must replace the whole admin frame, not load inside the app's iframe.
  const confirmationUrl = result && result.ok && result.kind === "subscribe" ? result.confirmationUrl : null;
  useEffect(() => {
    if (confirmationUrl && typeof window !== "undefined") window.open(confirmationUrl, "_top");
  }, [confirmationUrl]);

  const state = devOverride && !subscribed
    ? t("plan.state.dev")
    : pro
      ? trialEndsText
        ? t("plan.state.trial", { date: trialEndsText, amount: price.amount, currency: price.currency })
        : t("plan.state.pro")
      : t("plan.state.free");
  const finishingItems = [...finishing.campaigns, ...(finishing.outlets > 0 ? [t("plan.cancel.finishing.outlets", { n: finishing.outlets })] : [])];
  const nothingToRestore = uninstall.outlets === 0 && uninstall.natives.length === 0;

  return (
    <s-page heading={t("nav.plan")}>
      <s-stack direction="block" gap="base">
        {result ? <ResultBanner result={result} /> : null}
        {!billingKnown ? <s-banner tone="warning" heading={t("plan.state.unknown")} /> : null}

        <WonSection
          title={t("plan.free.title")}
          glyph="check"
          on={!pro}
          summary={t("plan.free.summary", { rules: maxRules, codes: codeRules.limit })}
          hint={[pro ? "" : t("plan.current"), t("plan.codeLimit", { codes: codeRules.limit, shopify: codeRules.shopifyLimit })].filter(Boolean).join(" · ")}
        />

        <WonSection title={t("plan.pro.price", { amount: price.amount, currency: price.currency })} glyph="plan" pro on={pro} summary={state} anchor="pro">
          <ProFrame>
            <s-stack direction="block" gap="small-300">
              <s-text>{t("plan.pro.adds")}</s-text>
              {subscribed && test ? <RowNote>{t("plan.state.test")}</RowNote> : null}
              {subscribed ? (
                <s-stack direction="block" gap="small-300">
                  <RowNote>{t("plan.cancel.what")}</RowNote>
                  {finishingItems.length > 0 ? <RowNote>{t("plan.cancel.finishing", { items: finishingItems.join(", ") })}</RowNote> : null}
                  <Form method="post" data-won-plan-cancel>
                    <input type="hidden" name="intent" value={INTENT.cancel} />
                    <s-button type="submit" variant="secondary" tone="critical">
                      {t("plan.cancel")}
                    </s-button>
                  </Form>
                </s-stack>
              ) : (
                <s-stack direction="block" gap="small-300">
                  <RowNote>{t("plan.pro.offer", { days: price.trialDays, amount: price.amount, currency: price.currency })}</RowNote>
                  {test ? <RowNote>{t("plan.state.test")}</RowNote> : null}
                  <Form method="post" data-won-plan-subscribe>
                    <input type="hidden" name="intent" value={INTENT.subscribe} />
                    <s-button type="submit" variant="primary">
                      {t("plan.subscribe", { days: price.trialDays })}
                    </s-button>
                  </Form>
                </s-stack>
              )}
            </s-stack>
          </ProFrame>
        </WonSection>

        <WonSection title={t("plan.uninstall.title")} glyph="tag" summary={t("plan.uninstall.summary")} anchor="uninstall">
          <s-stack direction="block" gap="small-300">
            <RowNote>{t("plan.uninstall.why")}</RowNote>
            {nothingToRestore ? <RowNote>{t("plan.uninstall.nothing")}</RowNote> : null}
            {uninstall.outlets > 0 ? <RowNote>{t("plan.uninstall.outlets", { n: uninstall.outlets })}</RowNote> : null}
            {uninstall.natives.length > 0 ? <RowNote>{t("plan.uninstall.natives", { titles: uninstall.natives.join(", ") })}</RowNote> : null}
            <RowNote>{t("plan.uninstall.keeps")}</RowNote>
            {nothingToRestore ? null : (
              <Form method="post" data-won-plan-uninstall>
                <input type="hidden" name="intent" value={INTENT.uninstallPrep} />
                <s-button type="submit" variant="secondary">
                  {t("plan.uninstall.run")}
                </s-button>
              </Form>
            )}
            <div>
              <s-button href="/app" variant="tertiary">
                {t("common.backToOverview")}
              </s-button>
            </div>
          </s-stack>
        </WonSection>
      </s-stack>
    </s-page>
  );
}
