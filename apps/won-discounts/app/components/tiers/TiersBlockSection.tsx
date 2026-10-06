// "Tabulka na stránce produktu" (MVP 3, §13): is the quantity-tier block on the
// live theme's product page — and when it is not (or it cannot be checked), ONE
// button, "Přidat tabulku na stránku produktu": the theme-editor deep link with
// `addAppBlockId` (model/embed.ts tiersBlockAddUrl); the merchant sees the block
// there and saves it. The storefront's settings get a row only when something
// is wrong (P2): the last change is not on the site yet, or writing it failed —
// then with "Synchronizovat znovu" right there (P3). "Zobrazit na mém webu"
// opens a real product the set applies to. Without access to the theme the
// check has nothing to say and nothing to offer, so it says nothing; a section
// left without any row is not drawn. Shared by Množstevní slevy and Vzhled.

import { useT } from "../../i18n/context";
import { blockAlternatesText, blockText, storefrontSyncText } from "../model/tiers";
import { uiText } from "../model/result-copy";
import type { PreviewProductView, StorefrontSyncView, TiersBlockView } from "../model/types";
import { ResyncButton } from "../shell/Notice";
import { RowNote, WonRow, WonSection } from "../shell/WonSection";

export function TiersBlockSection({
  block,
  storefront,
  product,
}: {
  block: TiersBlockView;
  /** Absent: the page does not know it (Vzhled). */
  storefront?: StorefrontSyncView;
  product: PreviewProductView | null;
}) {
  const tr = useT();
  const { t } = tr;
  const addUrl = block.state === "off" || block.state === "unknown" ? block.addUrl : null;
  const needsAction = block.state === "off" || block.state === "unknown";
  const alternates = blockAlternatesText(block, tr);
  // Only a problem gets a row: "everything is current" is not news.
  const sync = storefront && (storefront.state === "pending" || storefront.state === "failed") ? storefront : null;
  // No access to the theme: the check cannot say anything and there is no fix to offer here.
  const blockKnown = block.state !== "no_scope";
  if (!blockKnown && !sync && !product?.url) return null;
  return (
    <WonSection title={t("tiers.block.title")} glyph="store" summary={blockKnown ? blockText(block, tr) : undefined} anchor="block">
      <div>
        {needsAction ? (
          // The state is in the header; the row carries the one fix (§13a).
          <WonRow
            tone={block.state === "off" ? "attention" : undefined}
            action={
              addUrl ? (
                <s-button href={addUrl} target="_blank" variant={block.state === "off" ? "primary" : "secondary"}>
                  {t("tiers.block.add")}
                </s-button>
              ) : undefined
            }
          >
            <RowNote tone={block.state === "off" ? "attention" : undefined}>{addUrl ? t("tiers.block.addHint") : t("tiers.block.noLink")}</RowNote>
          </WonRow>
        ) : null}
        {alternates ? (
          <WonRow>
            <RowNote>{alternates}</RowNote>
          </WonRow>
        ) : null}
        {sync ? (
          <WonRow tone={sync.state === "failed" ? "attention" : undefined} action={sync.state === "failed" ? <ResyncButton variant="primary" /> : undefined}>
            <s-text type="strong">{t("tiers.storefront.label")}</s-text>
            <RowNote tone={sync.state === "failed" ? "attention" : undefined}>{storefrontSyncText(sync, tr)}</RowNote>
            {sync.state === "failed" ? sync.problems.slice(0, 2).map((problem, i) => <RowNote key={i}>{uiText(problem, tr)}</RowNote>) : null}
          </WonRow>
        ) : null}
        {product?.url ? (
          <WonRow
            action={
              <s-button href={product.url} target="_blank" variant="secondary">
                {t("tiers.view")}
              </s-button>
            }
          >
            <RowNote>{t("tiers.view.product", { product: product.title.trim() || t("common.untitledProduct") })}</RowNote>
          </WonRow>
        ) : null}
      </div>
    </WonSection>
  );
}
