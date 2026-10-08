// "Tabulka na stránce produktu" (MVP 3, §13): is the quantity-tier block on the
// live theme's product page — and when it is not (or it cannot be checked), ONE
// button, "Přidat tabulku na stránku produktu": the theme-editor deep link with
// `addAppBlockId` (model/embed.ts tiersBlockAddUrl); the merchant sees the block
// there and saves it. The storefront's settings get a row only when something
// is wrong (P2): the last change is not on the site yet, or writing it failed —
// then with "Synchronizovat znovu" right there (P3). "Zobrazit na mém webu"
// opens a real product the set applies to. Shared by Množstevní slevy and Vzhled.
// Feedback 3, bod 5: the header carries the placement label (green "V tématu",
// red "Chybí v tématu", grey "Neověřeno") and the one button that fixes it —
// the same pattern as every other placement on the storefront (§19c).

import { useT } from "../../i18n/context";
import { blockPlacement } from "../model/embed";
import { blockAlternatesText, blockText, storefrontSyncText } from "../model/tiers";
import { uiText } from "../model/result-copy";
import type { PreviewProductView, StorefrontSyncView, TiersBlockView } from "../model/types";
import { ResyncButton } from "../shell/Notice";
import { RowNote, WonRow, WonSection } from "../shell/WonSection";

export function TiersBlockSection({
  block,
  storefront,
  product,
  about,
}: {
  block: TiersBlockView;
  /** Absent: the page does not know it. */
  storefront?: StorefrontSyncView;
  product: PreviewProductView | null;
  /** Under a view tile that already says where the table stands (§19e): what the section is for, shown instead of that sentence. */
  about?: string;
}) {
  const tr = useT();
  const { t } = tr;
  const addUrl = block.state === "off" || block.state === "unknown" ? block.addUrl : null;
  const needsAction = block.state === "off" || block.state === "unknown";
  const alternates = blockAlternatesText(block, tr);
  // Only a problem gets a row: "everything is current" is not news.
  const sync = storefront && (storefront.state === "pending" || storefront.state === "failed") ? storefront : null;
  // Bod 5: the label says where the table stands; a missing one has "Přidat do tématu" in the header, one that
  // could not be checked has "Zkontrolovat znovu".
  const placement = blockPlacement(block.state);
  const action =
    placement === "missing" && addUrl ? (
      <s-button href={addUrl} target="_blank" variant="primary">
        {t("placement.add")}
      </s-button>
    ) : placement === "unknown" ? (
      <s-button variant="secondary" onClick={() => window.location.reload()}>
        {t("placement.recheck")}
      </s-button>
    ) : undefined;
  return (
    <WonSection title={t("tiers.block.title")} glyph="store" summary={about ?? blockText(block, tr)} anchor="block" placement={placement} action={action}>
      <div>
        {needsAction ? (
          // The state and the button are in the header; the row says what the button does (§13a).
          <WonRow
            tone={block.state === "off" ? "attention" : undefined}
            action={
              block.state === "unknown" && addUrl ? (
                <s-button href={addUrl} target="_blank" variant="secondary">
                  {t("placement.add")}
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
