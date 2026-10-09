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

export function CardPricesSection({
  cardPrices,
  cardBlockUrl,
  viewUrl = null,
  editorUrl = null,
  themeName = null,
  configVersion,
}: {
  cardPrices: boolean;
  cardBlockUrl: string | null;
  /** A storefront page with product cards (the live theme): shown only while the line is on, else there is nothing to see. */
  viewUrl?: string | null;
  /** The live theme's editor on the collection template. */
  editorUrl?: string | null;
  /** The live theme's name, when the page knows it. */
  themeName?: string | null;
  configVersion: string | null;
}) {
  const { t } = useT();
  const fetcher = useFetcher<UiResult>();
  const actions = useFormActions();
  return (
    <WonSection
      title={`${t("looks.cards.title")} · ${t("looks.beta")}`}
      glyph="tag"
      on={cardPrices}
      summary={t(cardPrices ? "looks.cards.summary.on" : "looks.cards.summary.off")}
      anchor="cards"
      collapsible
      defaultOpen={cardPrices}
    >
      <fetcher.Form method="post" action={actions.looks} data-won-cards-form="">
        <input type="hidden" name={LOOK_FIELD.intent} value={LOOK_INTENT.cards} />
        {configVersion ? <input type="hidden" name={LOOK_FIELD.configVersion} value={configVersion} /> : null}
        <s-stack direction="block" gap="small-300">
          {fetcher.data ? <Notice result={fetcher.data} /> : null}
          <s-checkbox name={LOOK_FIELD.cardPrices} value="on" label={t("looks.cards.toggle")} checked={boolAttr(cardPrices)} />
          <RowNote>{t("looks.cards.what")}</RowNote>
          <RowNote>{t("looks.cards.auto")}</RowNote>
          {/* Bod 6: how it looks in the live theme, one click away — only while it is on (nothing to see otherwise). */}
          {cardPrices && (viewUrl || editorUrl) ? (
            <div data-won-cards-view="">
              <WonRow
                action={
                  <span style={{ display: "inline-flex", flexWrap: "wrap", gap: 8 }}>
                    {viewUrl ? (
                      <s-button href={viewUrl} target="_blank" variant="primary">
                        {t("looks.cards.view")}
                      </s-button>
                    ) : null}
                    {editorUrl ? (
                      <s-button href={editorUrl} target="_blank" variant="secondary">
                        {t("looks.cards.editor")}
                      </s-button>
                    ) : null}
                  </span>
                }
              >
                <RowNote>{themeName ? t("looks.cards.viewNote.theme", { theme: themeName }) : t("looks.cards.viewNote")}</RowNote>
              </WonRow>
            </div>
          ) : null}
          <WonRow
            action={
              cardBlockUrl ? (
                <s-button href={cardBlockUrl} target="_blank" variant="secondary">
                  {t("looks.cards.addBlock")}
                </s-button>
              ) : undefined
            }
          >
            <RowNote>{t("looks.cards.block")}</RowNote>
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
