// Přehled card "Přehledy" (MVP 7, contract M4): the basic numbers of the last 30 days (any plan), or the honest
// nothing: without access to orders or without an order there is neither content nor an action, so the card is
// not rendered (P2). `analytics` absent = not known: not rendered either (§12).

import { useT } from "../../i18n/context";
import type { AnalyticsOverviewView } from "../model/analytics";
import { RowNote, WonRow, WonSection } from "../shell/WonSection";

export function AnalyticsOverviewCard({ analytics }: { analytics: AnalyticsOverviewView }) {
  const { t } = useT();
  if (!analytics.available || analytics.empty) return null;
  const numbers = analytics.tiles.map((tile) => `${t(`analytics.tile.${tile.id}` as "analytics.tile.cost")}: ${tile.value}`).join(" · ");
  return (
    <WonSection title={t("overview.analytics.title")} glyph="check" summary={numbers} anchor="analytics">
      <div>
        <WonRow>
          <RowNote>{t("analytics.basic.title", { days: analytics.days })}</RowNote>
        </WonRow>
        <WonRow
          action={
            <s-button href="/app/analytics" variant="secondary">
              {t("overview.analytics.open")}
            </s-button>
          }
        >
          {null}
        </WonRow>
      </div>
    </WonSection>
  );
}
