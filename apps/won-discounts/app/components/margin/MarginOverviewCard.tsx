// Přehled card "Ochrana marže" (MVP 2, A3 status first): on/off with the
// settings in one line (core describeMarginSettings, §17a), how many products
// lack a cost price and what applies to them (A2), and the cost mirror — when it
// is behind or failed, "Obnovit nákupní ceny" sits right on the row (§13a).
// Honest about the windows (audit P2-1): until the first complete read of the
// costs, unread products have only the percent ceiling — the card says so and
// never shows the green "Běží" before that read finished; a failed read says
// why (e.g. "open the app" when the background has no session, OQ4); a Pro
// collection too large to read says its values apply to the whole store (P1-1).
// `margin` absent = not known: the card is not rendered (§12).

import { describeMarginSettings } from "@won/core/discounts/describe";

import { useT } from "../../i18n/context";
import { ceilingOnlyText, mirrorNeedsRefresh, mirrorText, percentText } from "../model/margin";
import { uiText } from "../model/result-copy";
import { syncSettled } from "../model/signals";
import type { MarginOverviewView, SyncView } from "../model/types";
import { RefreshCostsButton } from "../shell/Notice";
import { RowNote, WonRow, WonSection } from "../shell/WonSection";

export function MarginOverviewCard({ margin, sync }: { margin: MarginOverviewView; sync: SyncView }) {
  const tr = useT();
  const { t } = tr;
  const summary = describeMarginSettings(
    {
      enabled: margin.enabled,
      global: {
        maxDiscountPercent: margin.maxDiscountPercent,
        ...(margin.minMarginPercent !== null ? { minMarginPercent: margin.minMarginPercent } : {}),
      },
      perCollection: [],
    },
    tr.locale,
  );
  const missing = margin.productsWithoutCost;
  const costsKnown = missing !== null;
  // Green only when it really runs: on, the config is in Shopify (§11d) AND the costs were read once
  // (before that, unread products have only the ceiling — audit P2-1); otherwise the lines below say why.
  const on = margin.enabled ? (syncSettled(sync) && costsKnown ? true : undefined) : false;

  if (!margin.enabled) {
    return (
      <WonSection title={t("module.margin")} glyph="shield" summary={summary} on={on} hint={t("soon.margin")} anchor="margin">
        <div>
          <s-button href="/app/margin" variant="secondary">
            {t("overview.margin.setup")}
          </s-button>
        </div>
      </WonSection>
    );
  }

  const refresh = mirrorNeedsRefresh(margin.mirror);
  const ceilingOnly = ceilingOnlyText({ enabled: true, mirror: margin.mirror, costsKnown, maxDiscountPercent: margin.maxDiscountPercent }, tr);
  const failed = margin.mirror.state === "failed" ? margin.mirror.problems : [];
  return (
    // Honest scope (§12): the hint says protection does not see the discounts outside Won (the section below).
    <WonSection title={t("module.margin")} glyph="shield" summary={summary} on={on} hint={t("overview.margin.scope")} anchor="margin">
      <div>
        <WonRow
          action={
            missing !== null && missing > 0 ? (
              <s-button href="/app/margin#costs" variant="secondary">
                {t("overview.margin.costs.show")}
              </s-button>
            ) : undefined
          }
        >
          <s-text type="strong">{t("overview.margin.costs.label")}</s-text>
          <RowNote>
            {missing === null
              ? t("overview.margin.costs.unknown")
              : missing === 0
                ? t("margin.costs.all")
                : `${tr.tp("margin.costs.missing", missing)}. ${t("overview.margin.costs.cap", { percent: percentText(margin.maxDiscountPercent, tr) })}`}
          </RowNote>
          {ceilingOnly ? <RowNote tone="attention">{ceilingOnly}</RowNote> : null}
        </WonRow>
        <WonRow tone={margin.mirror.state === "failed" ? "attention" : undefined} action={refresh ? <RefreshCostsButton /> : undefined}>
          <s-text type="strong">{t("margin.mirror.label")}</s-text>
          <RowNote tone={margin.mirror.state === "failed" ? "attention" : undefined}>{mirrorText(margin.mirror, tr)}</RowNote>
          {failed.slice(0, 1).map((problem, i) => (
            <RowNote key={i}>{uiText(problem, tr)}</RowNote>
          ))}
        </WonRow>
        {(margin.tooLarge ?? []).length > 0 ? (
          <WonRow tone="attention">
            <s-text type="strong">{t("margin.collections.title")}</s-text>
            {(margin.tooLarge ?? []).slice(0, 3).map((c) => (
              <RowNote key={c.collectionId}>
                {c.count === null
                  ? t("sync.problem.marginTooLargeUncounted", { collection: c.title })
                  : t("sync.problem.marginTooLarge", { collection: c.title, count: new Intl.NumberFormat(tr.locale === "cs" ? "cs-CZ" : "en-US").format(c.count) })}
              </RowNote>
            ))}
          </WonRow>
        ) : null}
        <WonRow
          action={
            <s-button href="/app/margin" variant="secondary">
              {t("overview.margin.edit")}
            </s-button>
          }
        >
          {null}
        </WonRow>
      </div>
    </WonSection>
  );
}
