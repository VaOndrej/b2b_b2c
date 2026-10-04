// Přehled card "Přehledy" (MVP 7, contract M4): the basic numbers of the last 30 days (any plan), or the honest
// reason there are none. `analytics` absent = not known: the card is not rendered (§12).

import { useT } from "../../i18n/context";
import type { AnalyticsOverviewView } from "../model/analytics";
import { RowNote, WonRow, WonSection } from "../shell/WonSection";

export function AnalyticsOverviewCard({ analytics }: { analytics: AnalyticsOverviewView }) {
  const { t } = useT();
  const numbers = analytics.tiles.map((tile) => `${t(`analytics.tile.${tile.id}` as "analytics.tile.cost")}: ${tile.value}`).join(" · ");
  const summary = !analytics.available ? t("overview.analytics.unavailable") : analytics.empty ? t("overview.analytics.empty", { days: analytics.days }) : numbers;
  return (
    <WonSection title={t("overview.analytics.title")} glyph="check" summary={summary} anchor="analytics">
      <div>
        {analytics.available && !analytics.empty ? (
          <WonRow>
            <RowNote>{t("analytics.basic.title", { days: analytics.days })}</RowNote>
          </WonRow>
        ) : null}
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
