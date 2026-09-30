// "Tabulka na stránce produktu" (MVP 3, §13): is the quantity-tier block on the
// live theme's product page — and when it is not (or it cannot be checked), ONE
// button, "Přidat tabulku na stránku produktu": the theme-editor deep link with
// `addAppBlockId` (model/embed.ts tiersBlockAddUrl); the merchant sees the block
// there and saves it. Then whether the storefront has the current settings
// (the storefront config metafield, K5) and "Zobrazit na mém webu" to a real
// product the set applies to. Shared by Množstevní slevy and Vzhled.

import { useT } from "../../i18n/context";
import { blockText, storefrontSyncText } from "../model/tiers";
import { uiText } from "../model/result-copy";
import type { PreviewProductView, StorefrontSyncView, TiersBlockView } from "../model/types";
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
  return (
    <WonSection title={t("tiers.block.title")} glyph="store" summary={blockText(block, tr)} anchor="block">
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
        {storefront ? (
          <WonRow tone={storefront.state === "failed" ? "attention" : undefined}>
            <s-text type="strong">{t("tiers.storefront.label")}</s-text>
            <RowNote tone={storefront.state === "failed" ? "attention" : undefined}>{storefrontSyncText(storefront, tr)}</RowNote>
            {storefront.state === "failed"
              ? storefront.problems.slice(0, 2).map((problem, i) => <RowNote key={i}>{uiText(problem, tr)}</RowNote>)
              : null}
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
