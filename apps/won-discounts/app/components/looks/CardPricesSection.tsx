// Prices by quantity on product cards (MVP 7 BETA, contract M8): one switch, saved on its own (/app/looks,
// intent `cards`), with the table's look on Množstevní slevy. The card line itself is the extension's
// (snippets/won-card-tier.liquid): it never says more than checkout gives.

import { useFetcher } from "react-router";

import { useT } from "../../i18n/context";
import { LOOK_FIELD, LOOK_INTENT } from "../model/looks";
import { useFormActions } from "../shell/form-actions";
import type { UiResult } from "../model/types";
import { boolAttr } from "../shell/attrs";
import { Notice } from "../shell/Notice";
import { RowNote, WonRow, WonSection } from "../shell/WonSection";

export function CardPricesSection({ cardPrices, cardBlockUrl, configVersion }: { cardPrices: boolean; cardBlockUrl: string | null; configVersion: string | null }) {
  const { t } = useT();
  const fetcher = useFetcher<UiResult>();
  const actions = useFormActions();
  return (
    <WonSection
      title={`${t("appearance.cards.title")} · ${t("appearance.beta")}`}
      glyph="tag"
      on={cardPrices}
      summary={t(cardPrices ? "appearance.cards.summary.on" : "appearance.cards.summary.off")}
      anchor="cards"
      collapsible
      defaultOpen={cardPrices}
    >
      <fetcher.Form method="post" action={actions.looks} data-won-cards-form="">
        <input type="hidden" name={LOOK_FIELD.intent} value={LOOK_INTENT.cards} />
        {configVersion ? <input type="hidden" name={LOOK_FIELD.configVersion} value={configVersion} /> : null}
        <s-stack direction="block" gap="small-300">
          {fetcher.data ? <Notice result={fetcher.data} /> : null}
          <s-checkbox name={LOOK_FIELD.cardPrices} value="on" label={t("appearance.cards.toggle")} checked={boolAttr(cardPrices)} />
          <RowNote>{t("appearance.cards.what")}</RowNote>
          <RowNote>{t("appearance.cards.auto")}</RowNote>
          <WonRow
            action={
              cardBlockUrl ? (
                <s-button href={cardBlockUrl} target="_blank" variant="secondary">
                  {t("appearance.cards.addBlock")}
                </s-button>
              ) : undefined
            }
          >
            <RowNote>{t("appearance.cards.block")}</RowNote>
          </WonRow>
          <div>
            <s-button type="submit" variant="primary" disabled={boolAttr(fetcher.state !== "idle")}>
              {t("common.save")}
            </s-button>
          </div>
        </s-stack>
      </fetcher.Form>
    </WonSection>
  );
}
