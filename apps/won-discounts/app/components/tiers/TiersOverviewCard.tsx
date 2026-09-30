// Přehled card "Množstevní slevy" (MVP 3, A3 status first): the whole-store set
// in one line (core describeTierSet, §17a), how many Pro sets the PLAN runs
// (§17c — on Free none, whatever is stored), and the table on the product page;
// when it is not there, "Přidat tabulku na stránku produktu" sits right on the
// row (§13a). `tiers` absent = not known: the card is not rendered (§12).

import { useT } from "../../i18n/context";
import { blockText, tierSummary } from "../model/tiers";
import type { TiersOverviewView } from "../model/types";
import { RowNote, WonRow, WonSection } from "../shell/WonSection";

export function TiersOverviewCard({ tiers }: { tiers: TiersOverviewView }) {
  const tr = useT();
  const { t } = tr;
  const has = tiers.global !== null || tiers.sets > 0;
  const addUrl = tiers.block.state === "off" || tiers.block.state === "unknown" ? tiers.block.addUrl : null;
  if (!has) {
    return (
      <WonSection title={t("module.tiers")} glyph="layers" summary={t("overview.tiers.none")} on={false} anchor="tiers">
        <div>
          <s-button href="/app/tiers" variant="secondary">
            {t("overview.tiers.setup")}
          </s-button>
        </div>
      </WonSection>
    );
  }
  return (
    <WonSection
      title={t("module.tiers")}
      glyph="layers"
      summary={tiers.global ? tierSummary(tiers.global, tr) : t("overview.tiers.sets", { sets: tr.tp("count.tierSet", tiers.sets) })}
      anchor="tiers"
    >
      <div>
        {tiers.sets > 0 && tiers.global ? (
          <WonRow>
            <RowNote>{t("overview.tiers.sets", { sets: tr.tp("count.tierSet", tiers.sets) })}</RowNote>
          </WonRow>
        ) : null}
        <WonRow
          tone={tiers.block.state === "off" ? "attention" : undefined}
          action={
            addUrl ? (
              <s-button href={addUrl} target="_blank" variant="secondary">
                {t("tiers.block.add")}
              </s-button>
            ) : undefined
          }
        >
          <s-text type="strong">{t("tiers.block.title")}</s-text>
          <RowNote tone={tiers.block.state === "off" ? "attention" : undefined}>{blockText(tiers.block, tr)}</RowNote>
        </WonRow>
        <WonRow
          action={
            <s-button href="/app/tiers" variant="secondary">
              {t("overview.tiers.edit")}
            </s-button>
          }
        >
          {null}
        </WonRow>
      </div>
    </WonSection>
  );
}
