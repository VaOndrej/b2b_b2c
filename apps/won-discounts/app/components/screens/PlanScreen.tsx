// Tarif (MVP 7, contracts M1–M3; spec §7, A6, A7, A9). The plan actually in force (BILL-1: Pro only from a verified
// Shopify subscription), the real limits (never "neomezeně"), Pro in amber with its price and trial, and the two
// ways out that do no harm:
//   - "Zrušit Pro": says what stops and what runs to its end (A6) and asks before it does it;
//   - "Připravit na odinstalaci" (any plan): puts sale prices back and restores the moved Shopify discounts (A7);
//     asks first, and is not shown at all when there is nothing to put back (P2).
// Subscribing opens Shopify's own confirmation page in the top frame (the app never takes a payment itself).
//
// Since the menu change of 6 Oct 2026 the plan is part of Nastavení: PlanSections are the sections, SettingsScreen
// renders them at its end. The route /app/plan stays (Shopify's billing return and the "Zobrazit tarif Pro" links
// land there) and renders the same sections as a page of its own (PlanScreen). The three actions post to that route
// through a fetcher, so the answer shows where the merchant clicked — in Nastavení too.
// Presentational: the routes render it from loadPlanScreen (app/lib/integration/plan-admin.server.ts), the dev
// harness from a fixture.

import { useEffect } from "react";
import { useFetcher } from "react-router";

import { useT } from "../../i18n/context";
import { planFailure, PRO_FEATURES, uninstallFailureDetail, type PlanActionResult, type PlanScreenData } from "../model/plan";
import { ProFrame } from "../shell/ProFrame";
import { RowNote, WonSection } from "../shell/WonSection";
import { WON_FONT, WON_INK } from "../shell/tokens";

export interface PlanSectionsProps extends PlanScreenData {
  result?: PlanActionResult | null;
  /** Where the three actions post. Unset = the page's own route (the plan route itself, the dev harness). */
  action?: string;
  /** A heading above the sections (Nastavení: the plan is one part of the page), with the `#plan` anchor. */
  heading?: boolean;
}

export type PlanScreenProps = Omit<PlanSectionsProps, "heading">;

/** The form's intents (the server's PLAN_INTENT, app/lib/integration/plan-admin.server.ts). */
const INTENT = { subscribe: "subscribe", cancel: "cancel", uninstallPrep: "uninstall_prep" } as const;

const CANCEL_DIALOG = "won-plan-cancel-dialog";
const UNINSTALL_DIALOG = "won-plan-uninstall-dialog";

function isPlanResult(value: unknown): value is PlanActionResult {
  return typeof value === "object" && value !== null && typeof (value as { kind?: unknown }).kind === "string";
}

function FailureBanner({ heading, detail }: { heading: string; detail: string }) {
  const { t } = useT();
  const failure = planFailure(detail);
  return (
    <s-banner tone="critical" heading={heading}>
      <s-paragraph>{failure.key === "plan.fail.other" ? t(failure.key, { detail: failure.detail }) : t(failure.key)}</s-paragraph>
    </s-banner>
  );
}

function ResultBanner({ result }: { result: PlanActionResult }) {
  const { t } = useT();
  if (result.kind === "subscribe") {
    return result.ok ? <s-banner tone="info" heading={t("plan.subscribe.redirect")} /> : <FailureBanner heading={t("plan.subscribe.failed")} detail={result.detail} />;
  }
  if (result.kind === "cancel") {
    if (!result.ok) return <FailureBanner heading={t("plan.cancel.failed")} detail={result.detail} />;
    return <s-banner tone={result.synced ? "success" : "warning"} heading={t(result.synced ? "plan.cancel.done" : "plan.cancel.pending")} />;
  }
  if (result.kind === "uninstall_prep") {
    if (result.ok) return <s-banner tone="success" heading={t("plan.uninstall.done", { ended: result.ended, restored: result.restored })} />;
    const failed = result.failed
      .map((f) => {
        const detail = uninstallFailureDetail(f.detail);
        if (f.what === "outlet") return detail ? t("plan.uninstall.failed.outlet", { detail }) : t("plan.uninstall.failed.outlet.plain");
        return detail ? t("plan.uninstall.failed.native", { detail }) : t("plan.uninstall.failed.native.plain");
      })
      .join(", ");
    return <s-banner tone="critical" heading={t("plan.uninstall.partial", { ended: result.ended, restored: result.restored, failed })} />;
  }
  // An intent the server does not know (a stale page).
  return <s-banner tone="critical" heading={t("plan.fail.badRequest")} />;
}

/** The plan as sections: Free, Pro (subscribe / cancel), Připravit na odinstalaci. No page of its own. */
export function PlanSections(props: PlanSectionsProps) {
  const { t } = useT();
  const { plan, subscribed, devOverride, billingKnown, trialEndsText, test, production = false, price, codeRules, maxRules, finishing, uninstall, action, heading = false } = props;
  const pro = plan === "pro";

  const fetcher = useFetcher();
  const busy = fetcher.state !== "idle";
  const result = isPlanResult(fetcher.data) ? fetcher.data : (props.result ?? null);
  const post = (intent: string) => fetcher.submit({ intent }, action ? { method: "post", action } : { method: "post" });

  // Shopify's confirmation page must replace the whole admin frame, not load inside the app's iframe.
  const confirmationUrl = result && result.ok && result.kind === "subscribe" ? result.confirmationUrl : null;
  useEffect(() => {
    if (confirmationUrl && typeof window !== "undefined") window.open(confirmationUrl, "_top");
  }, [confirmationUrl]);

  // The sentences for developers (dev override, test charge) are never shown in production.
  const showDev = !production;
  const state = showDev && devOverride && !subscribed
    ? t("plan.state.dev")
    : pro
      ? trialEndsText
        ? t("plan.state.trial", { date: trialEndsText, amount: price.amount, currency: price.currency })
        : t("plan.state.pro")
      : t("plan.state.free");
  const finishingItems = [...finishing.campaigns, ...(finishing.outlets > 0 ? [t("plan.cancel.finishing.outlets", { n: finishing.outlets })] : [])];
  const somethingToRestore = uninstall.outlets > 0 || uninstall.natives.length > 0;
  const uninstallRows = (
    <>
      {uninstall.outlets > 0 ? <RowNote>{t("plan.uninstall.outlets", { n: uninstall.outlets })}</RowNote> : null}
      {uninstall.natives.length > 0 ? <RowNote>{t("plan.uninstall.natives", { titles: uninstall.natives.join(", ") })}</RowNote> : null}
    </>
  );

  return (
    <>
      <s-stack direction="block" gap="base">
        {heading ? (
          <h2 id="plan" style={{ margin: "8px 4px 0", fontFamily: WON_FONT, fontSize: 15, fontWeight: 650, color: WON_INK }}>
            {t("nav.plan")}
          </h2>
        ) : null}
        {result ? <ResultBanner result={result} /> : null}
        {!billingKnown ? <s-banner tone="warning" heading={t("plan.state.unknown")} /> : null}

        <WonSection
          title={t("plan.free.title")}
          glyph="check"
          summary={t("plan.free.summary", { rules: maxRules, codes: codeRules.limit })}
          hint={[pro ? "" : t("plan.current"), t("plan.codeLimit", { codes: codeRules.limit, shopify: codeRules.shopifyLimit })].filter(Boolean).join(" · ")}
        />

        <WonSection title={t("plan.pro.price", { amount: price.amount, currency: price.currency })} glyph="plan" pro on={pro} summary={state} anchor="pro">
          <ProFrame>
            <s-stack direction="block" gap="small-300">
              <s-text>{t(pro ? "plan.pro.has" : "plan.pro.adds")}</s-text>
              <s-unordered-list>
                {PRO_FEATURES.map((feature) => (
                  <s-list-item key={feature.label}>
                    <s-link href={feature.href}>{t(feature.label)}</s-link>
                  </s-list-item>
                ))}
              </s-unordered-list>
              {showDev && test ? <RowNote>{t("plan.state.test")}</RowNote> : null}
              {subscribed ? (
                <s-stack direction="block" gap="small-300">
                  <RowNote>{t("plan.cancel.what")}</RowNote>
                  {finishingItems.length > 0 ? <RowNote>{t("plan.cancel.finishing", { items: finishingItems.join(", ") })}</RowNote> : null}
                  <div data-won-plan-cancel>
                    <s-button variant="secondary" tone="critical" commandFor={CANCEL_DIALOG} command="--show" disabled={busy ? true : undefined}>
                      {t("plan.cancel")}
                    </s-button>
                  </div>
                </s-stack>
              ) : (
                <s-stack direction="block" gap="small-300">
                  <RowNote>{t("plan.pro.offer", { days: price.trialDays, amount: price.amount, currency: price.currency })}</RowNote>
                  <div data-won-plan-subscribe>
                    <s-button variant="primary" disabled={busy ? true : undefined} onClick={() => post(INTENT.subscribe)}>
                      {t("plan.subscribe", { days: price.trialDays })}
                    </s-button>
                  </div>
                </s-stack>
              )}
            </s-stack>
          </ProFrame>
        </WonSection>

        {somethingToRestore ? (
          <WonSection title={t("plan.uninstall.title")} glyph="tag" summary={t("plan.uninstall.summary")} anchor="uninstall">
            <s-stack direction="block" gap="small-300">
              <RowNote>{t("plan.uninstall.why")}</RowNote>
              {uninstallRows}
              <RowNote>{t("plan.uninstall.keeps")}</RowNote>
              <div data-won-plan-uninstall>
                <s-button variant="secondary" commandFor={UNINSTALL_DIALOG} command="--show" disabled={busy ? true : undefined}>
                  {t("plan.uninstall.run")}
                </s-button>
              </div>
            </s-stack>
          </WonSection>
        ) : null}
      </s-stack>

      {subscribed ? (
        <s-modal id={CANCEL_DIALOG} heading={t("plan.cancel.confirm.heading")}>
          <s-paragraph>{t("plan.cancel.what")}</s-paragraph>
          {finishingItems.length > 0 ? <s-paragraph>{t("plan.cancel.finishing", { items: finishingItems.join(", ") })}</s-paragraph> : null}
          <s-button slot="primary-action" variant="primary" tone="critical" commandFor={CANCEL_DIALOG} command="--hide" onClick={() => post(INTENT.cancel)}>
            {t("plan.cancel")}
          </s-button>
          <s-button slot="secondary-actions" commandFor={CANCEL_DIALOG} command="--hide">
            {t("plan.cancel.keep")}
          </s-button>
        </s-modal>
      ) : null}
      {somethingToRestore ? (
        <s-modal id={UNINSTALL_DIALOG} heading={t("plan.uninstall.confirm.heading")}>
          {uninstallRows}
          <s-paragraph>{t("plan.uninstall.keeps")}</s-paragraph>
          <s-button slot="primary-action" variant="primary" commandFor={UNINSTALL_DIALOG} command="--hide" onClick={() => post(INTENT.uninstallPrep)}>
            {t("plan.uninstall.run")}
          </s-button>
          <s-button slot="secondary-actions" commandFor={UNINSTALL_DIALOG} command="--hide">
            {t("common.cancel")}
          </s-button>
        </s-modal>
      ) : null}
    </>
  );
}

/** The plan as its own page (/app/plan): where Shopify's billing return and the "Zobrazit tarif Pro" links land. */
export function PlanScreen(props: PlanScreenProps) {
  const { t } = useT();
  return (
    <s-page heading={t("nav.plan")}>
      <s-link slot="breadcrumb-actions" href="/app/settings">
        {t("nav.settings")}
      </s-link>
      <PlanSections {...props} />
    </s-page>
  );
}
