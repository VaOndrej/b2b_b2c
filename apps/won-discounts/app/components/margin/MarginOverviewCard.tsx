// Přehled card "Ochrana marže" (MVP 2, A3 status first): on/off with the
// settings in one line (core describeMarginSettings, §17a), how many products
// lack a cost price and what applies to them (A2), and the cost mirror — when it
// is behind or failed, "Obnovit nákupní ceny" sits right on the row (§13a).
// `margin` absent = not known: the card is not rendered (§12).

import { describeMarginSettings } from "@won/core/discounts/describe";

import { useT } from "../../i18n/context";
import { mirrorNeedsRefresh, mirrorText, percentText } from "../model/margin";
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
  // Green only when it really runs: on AND the config is in Shopify (§11d); while
  // the sync is not settled the "Stav v obchodě" line says why, the pill stays out.
  const on = margin.enabled ? (syncSettled(sync) ? true : undefined) : false;

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

  const missing = margin.productsWithoutCost;
  const refresh = mirrorNeedsRefresh(margin.mirror);
  return (
    <WonSection title={t("module.margin")} glyph="shield" summary={summary} on={on} anchor="margin">
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
        </WonRow>
        <WonRow tone={margin.mirror.state === "failed" ? "attention" : undefined} action={refresh ? <RefreshCostsButton /> : undefined}>
          <s-text type="strong">{t("margin.mirror.label")}</s-text>
          <RowNote tone={margin.mirror.state === "failed" ? "attention" : undefined}>{mirrorText(margin.mirror, tr)}</RowNote>
        </WonRow>
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
