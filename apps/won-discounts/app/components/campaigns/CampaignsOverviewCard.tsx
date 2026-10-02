// Přehled card "Kampaně" (MVP 6, contract K7, A3 status first): the running campaign and when it ends, else the
// next one and when it starts; on Free a campaign finishing after the downgrade says so (A6). The whole module is
// Pro: the amber marker always (§16). `campaigns` absent = not known: the card is not rendered (§12).

import { useT } from "../../i18n/context";
import type { CampaignsOverviewView } from "../model/types";
import { RowNote, WonRow, WonSection } from "../shell/WonSection";

export function CampaignsOverviewCard({ campaigns }: { campaigns: CampaignsOverviewView }) {
  const { t } = useT();
  const { running, next, finishing } = campaigns;
  const summary = running
    ? t("overview.campaigns.running", { name: running.name, end: running.endText })
    : next
      ? t("overview.campaigns.next", { name: next.name, start: next.startText })
      : t("overview.campaigns.none");
  return (
    <WonSection title={t("module.campaigns")} glyph="calendar" on={running !== null} pro summary={summary} anchor="campaigns">
      <div>
        {running && next ? (
          <WonRow>
            <RowNote>{t("overview.campaigns.next", { name: next.name, start: next.startText })}</RowNote>
          </WonRow>
        ) : null}
        {finishing ? (
          <WonRow>
            <RowNote tone="attention">{t("overview.campaigns.finishing")}</RowNote>
          </WonRow>
        ) : null}
        <WonRow
          action={
            <s-button href="/app/campaigns" variant="secondary">
              {t(running || next ? "overview.campaigns.open" : "overview.campaigns.setup")}
            </s-button>
          }
        >
          {null}
        </WonRow>
      </div>
    </WonSection>
  );
}
