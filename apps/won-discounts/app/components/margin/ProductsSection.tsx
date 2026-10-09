// Pro "Nastavení podle produktů" (feedback 9 Oct 2026, 3rd round, bod 7): a product's OWN minimum margin and
// ceiling — the most specific setting, before the product's collections and the whole store. An empty field keeps
// what the product would have without it (its collections, else the whole store). The same rules as the
// collections section (CollectionsSection.tsx): visible and amber on Free, the rows stay removable there and their
// values travel as hidden inputs; products come from the App Bridge resource picker; a field's `error` attribute is
// never set (B14).

import { CONFIG_LIMITS } from "@won/core/discounts/config";

import { useT } from "../../i18n/context";
import { MARGIN_FIELD, percentInput } from "../model/margin";
import type { GateNoteView, MarginProductView } from "../model/types";
import { FieldMessage } from "../rule-editor/parts";
import { boolAttr } from "../shell/attrs";
import { GateNotes } from "../shell/GateNotes";
import { ProFrame } from "../shell/ProFrame";
import { ProSell } from "../shell/ProSell";
import { WON_FONT, WON_INK, WON_LINE, WON_WASH } from "../shell/tokens";
import { RowNote, WonRow, WonSection } from "../shell/WonSection";
import { PercentFields } from "./CollectionsSection";

const NAMES = { min: MARGIN_FIELD.productMin, max: MARGIN_FIELD.productMax };

export function ProductsSection({
  pro,
  products,
  gateNotes,
  onPick,
  onRemove,
  pickUnavailable,
  errorFor,
  decimalErrorFor,
  error,
  posted = null,
}: {
  pro: boolean;
  products: readonly MarginProductView[];
  /** Product settings stored but not in force on this plan (core explainGate, BILL-1). */
  gateNotes: readonly GateNoteView[];
  onPick: () => void;
  onRemove: (productId: string) => void;
  pickUnavailable: boolean;
  /** The server's error for one field (`productMin[1]`: readMarginForm indexes the rows as posted). */
  errorFor: (field: string) => string | undefined;
  decimalErrorFor: (field: string) => string | undefined;
  /** A product error that is not about one row. */
  error?: string;
  /** B14: the rows a refused save posted, as typed. */
  posted?: { ids: readonly string[]; min: readonly string[]; max: readonly string[] } | null;
}) {
  const { t } = useT();
  const full = products.length >= CONFIG_LIMITS.marginProductOverrides;
  const typed = (p: MarginProductView, which: "min" | "max"): string => {
    const at = posted ? posted.ids.indexOf(p.productId) : -1;
    const raw = at >= 0 ? posted![which][at] : undefined;
    return raw ?? percentInput(which === "min" ? p.minMarginPercent : p.maxDiscountPercent);
  };
  return (
    <WonSection title={t("margin.products.title")} glyph="tag" pro locked={!pro} summary={t("margin.view.products.about")} anchor="products">
      <s-stack direction="block" gap="base">
        {gateNotes.length > 0 ? <GateNotes notes={gateNotes} compact /> : null}
        {!pro ? <ProSell benefit={t("margin.products.benefit")} /> : null}
        <ProFrame locked={!pro}>
          <s-stack direction="block" gap="base">
            <div data-won-margin-products-how="" style={{ padding: "10px 12px", borderRadius: 11, background: WON_WASH, border: `1px solid ${WON_LINE}`, fontFamily: WON_FONT }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: WON_INK }}>{t("margin.products.how.title")}</div>
              <ol style={{ margin: "6px 0 0", paddingLeft: 20, fontSize: 13, lineHeight: 1.5, color: WON_INK }}>
                <li>{t("margin.products.how.1")}</li>
                <li>{t("margin.products.how.2")}</li>
                <li>{t("margin.products.how.3")}</li>
              </ol>
            </div>
            {products.length === 0 ? <RowNote>{t("margin.products.empty")}</RowNote> : null}
            {products.length > 0 ? (
              <div>
                {products.map((p, i) => (
                  <WonRow
                    key={p.productId}
                    action={
                      <s-button variant="tertiary" onClick={() => onRemove(p.productId)}>
                        {t("margin.collections.remove")}
                      </s-button>
                    }
                  >
                    <input type="hidden" name={MARGIN_FIELD.productId} value={p.productId} />
                    {!pro ? (
                      <>
                        <input type="hidden" name={MARGIN_FIELD.productMin} value={percentInput(p.minMarginPercent)} />
                        <input type="hidden" name={MARGIN_FIELD.productMax} value={percentInput(p.maxDiscountPercent)} />
                      </>
                    ) : null}
                    <div style={{ marginBottom: 8 }} data-won-margin-product={p.productId}>
                      <s-text type="strong">{p.title.trim() || t("margin.impact.untitledProduct")}</s-text>
                      <FieldMessage text={errorFor(`productId[${i}]`)} />
                    </div>
                    <PercentFields min={typed(p, "min")} max={typed(p, "max")} named={pro} disabled={!pro} names={NAMES} texts="products" />
                    <FieldMessage
                      text={
                        (
                          [
                            [`productMin[${i}]`, t("margin.collections.min")],
                            [`productMax[${i}]`, t("margin.collections.max")],
                          ] as const
                        )
                          .map(([field, label]) => {
                            const message = decimalErrorFor(field) ?? errorFor(field);
                            return message ? `${label}: ${message}` : null;
                          })
                          .filter((m): m is string => m !== null)
                          .join(" ") || undefined
                      }
                    />
                  </WonRow>
                ))}
              </div>
            ) : null}
            <FieldMessage text={error} />
            <s-stack direction="block" gap="small-200">
              <s-stack direction="inline" gap="base" alignItems="center">
                <s-button onClick={onPick} disabled={boolAttr(!pro || full)}>
                  {t("editor.pick.products")}
                </s-button>
              </s-stack>
              {full ? <RowNote>{t("margin.products.limit", { max: CONFIG_LIMITS.marginProductOverrides })}</RowNote> : null}
              {pickUnavailable ? <s-text color="subdued">{t("editor.pick.unavailable")}</s-text> : null}
            </s-stack>
          </s-stack>
        </ProFrame>
      </s-stack>
    </WonSection>
  );
}
