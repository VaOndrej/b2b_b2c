// Pro "Nastavení podle kolekcí" (A2/§16: visible, amber, never blocks Free;
// BILL-1: the server decides what is stored and what checkout runs). Each row
// is one collection with its own minimum margin and ceiling; an empty field
// inherits the global value. Collections come from the App Bridge resource
// picker (model/app-bridge.ts); outside Shopify admin (the dev harness) the
// picker is unavailable and the section says so.
//
// A Pro collection the last sync could not read says so at its row, its values
// then apply to the whole store (P1-1): over 10 000 products on its own (Shopify
// counts exactly only up to 10 000), or — with an exact count — the 10 000 per
// sync were used up by the margin collections read before it.
//
// On Free the rows stay visible and removable (§14a: off ≠ erased — removing a
// Pro setting the plan folds into a stricter global value is always allowed),
// their values travel as hidden inputs so a save never drops them, and the
// fields are disabled. With nothing stored, Free sees the benefit sentence with
// the plan link and the locked frame: no invented sample row (§12).
// B14: a field's `error` attribute is never set (it resets a Polaris field that
// holds typed text): the server's and the live messages sit under the row.

import { CONFIG_LIMITS } from "@won/core/discounts/config";
import { formatPercent } from "@won/core/discounts/describe";

import { useT } from "../../i18n/context";
import { COLLECTION_READ_LIMIT, MARGIN_FIELD, MARGIN_PERCENT_STEP, percentInput } from "../model/margin";
import type { GateNoteView, MarginCollectionView, MarginTooLargeView } from "../model/types";
import { FieldGrid, FieldMessage } from "../rule-editor/parts";
import { boolAttr } from "../shell/attrs";
import { WON_FONT, WON_INK, WON_LINE, WON_WASH } from "../shell/tokens";
import { GateNotes } from "../shell/GateNotes";
import { ProFrame } from "../shell/ProFrame";
import { ProSell } from "../shell/ProSell";
import { RowNote, WonRow, WonSection } from "../shell/WonSection";

export function PercentFields({
  min,
  max,
  named,
  disabled,
  names = { min: MARGIN_FIELD.collectionMin, max: MARGIN_FIELD.collectionMax },
  texts = "collections",
}: {
  /** The two fields' form names (the collections' by default; the products section passes its own). */
  names?: { min: string; max: string };
  /** Whose help and placeholder the fields carry. */
  texts?: "collections" | "products";
  /** The field's value as text: the stored percent, or exactly what a refused save posted. */
  min: string;
  max: string;
  /** Submit these fields (Pro); on Free the values go as hidden inputs instead. */
  named: boolean;
  disabled: boolean;
}) {
  const { t } = useT();
  return (
    <FieldGrid>
      <s-number-field
        name={named ? names.min : undefined}
        label={t("margin.collections.min")}
        value={min}
        placeholder={t(`margin.${texts}.inherit`)}
        details={t(`margin.${texts}.min.details`)}
        min={0}
        max={95}
        step={MARGIN_PERCENT_STEP}
        suffix="%"
        inputMode="decimal"
        disabled={boolAttr(disabled)}
      />
      <s-number-field
        name={named ? names.max : undefined}
        label={t("margin.collections.max")}
        value={max}
        placeholder={t(`margin.${texts}.inherit`)}
        details={t(`margin.${texts}.max.details`)}
        min={0}
        max={100}
        step={MARGIN_PERCENT_STEP}
        suffix="%"
        inputMode="decimal"
        disabled={boolAttr(disabled)}
      />
    </FieldGrid>
  );
}

export function CollectionsSection({
  pro,
  collections,
  gateNotes,
  onPick,
  onRemove,
  pickUnavailable,
  errorFor,
  decimalErrorFor,
  error,
  tooLarge = [],
  posted = null,
  store,
}: {
  /** The whole-store values in force (what an empty field falls back to), said in words above the rows. */
  store?: { minMarginPercent: number | null; maxDiscountPercent: number };
  pro: boolean;
  collections: readonly MarginCollectionView[];
  /** Pro settings stored but not in force on this plan (core explainGate, BILL-1). */
  gateNotes: readonly GateNoteView[];
  onPick: () => void;
  onRemove: (collectionId: string) => void;
  pickUnavailable: boolean;
  /** The server's error for one field (`collectionMin[1]`: readMarginForm indexes the rows as posted). */
  errorFor: (field: string) => string | undefined;
  /** The live one-decimal check (said under the row, never on the field: see MarginScreen). */
  decimalErrorFor: (field: string) => string | undefined;
  /** A collection error that is not about one row. */
  error?: string;
  /** Collections the last sync could not read (over the 10 000-product limit): said at their row (P1-1). */
  tooLarge?: readonly MarginTooLargeView[];
  /** B14: the rows a refused save posted, as typed (a value the server refused is shown again, not dropped). */
  posted?: { ids: readonly string[]; min: readonly string[]; max: readonly string[] } | null;
}) {
  const tr = useT();
  const { t } = tr;
  const full = collections.length >= CONFIG_LIMITS.marginOverrides;
  const tooLargeOf = new Map(tooLarge.map((c) => [c.collectionId, c]));
  const typed = (c: MarginCollectionView, which: "min" | "max"): string => {
    const at = posted ? posted.ids.indexOf(c.collectionId) : -1;
    const raw = at >= 0 ? posted![which][at] : undefined;
    return raw ?? percentInput(which === "min" ? c.minMarginPercent : c.maxDiscountPercent);
  };
  return (
    <WonSection
      title={t("margin.collections.title")}
      glyph="layers"
      pro
      locked={!pro}
      summary={t("margin.view.collections.about")}
      anchor="collections"
    >
      <s-stack direction="block" gap="base">
        {gateNotes.length > 0 ? <GateNotes notes={gateNotes} compact /> : null}
        {!pro ? <ProSell benefit={t("margin.collections.benefit")} /> : null}
        <ProFrame locked={!pro}>
          <s-stack direction="block" gap="base">
            {/* Feedback 9 Oct 2026 (2nd round): what the section is for, how to fill it in, an example in numbers. */}
            <div data-won-margin-collections-how="" style={{ padding: "10px 12px", borderRadius: 11, background: WON_WASH, border: `1px solid ${WON_LINE}`, fontFamily: WON_FONT }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: WON_INK }}>{t("margin.collections.how.title")}</div>
              <ol style={{ margin: "6px 0 0", paddingLeft: 20, fontSize: 13, lineHeight: 1.5, color: WON_INK }}>
                <li>{t("margin.collections.how.1")}</li>
                <li>{t("margin.collections.how.2")}</li>
                <li>{t("margin.collections.how.3")}</li>
              </ol>
            </div>
            {store ? (
              <s-text>
                {t("margin.collections.store", {
                  min: store.minMarginPercent === null ? t("margin.collections.store.minNone") : t("margin.collections.store.min", { percent: formatPercent(store.minMarginPercent, tr.locale) }),
                  max: t("margin.collections.store.max", { percent: formatPercent(store.maxDiscountPercent, tr.locale) }),
                })}
              </s-text>
            ) : null}
            <s-text color="subdued">{t("margin.collections.body")}</s-text>
            {collections.length === 0 ? <RowNote>{t("margin.collections.empty")}</RowNote> : null}
            {collections.length > 0 ? (
              <div>
                {collections.map((c, i) => (
                  <WonRow
                    key={c.collectionId}
                    action={
                      <s-button variant="tertiary" onClick={() => onRemove(c.collectionId)}>
                        {t("margin.collections.remove")}
                      </s-button>
                    }
                  >
                    <input type="hidden" name={MARGIN_FIELD.collectionId} value={c.collectionId} />
                    {!pro ? (
                      <>
                        <input type="hidden" name={MARGIN_FIELD.collectionMin} value={percentInput(c.minMarginPercent)} />
                        <input type="hidden" name={MARGIN_FIELD.collectionMax} value={percentInput(c.maxDiscountPercent)} />
                      </>
                    ) : null}
                    <div style={{ marginBottom: 8 }}>
                      <s-text type="strong">{c.title.trim() || t("common.untitledCollection")}</s-text>
                      <FieldMessage text={errorFor(`collectionId[${i}]`)} />
                      {pro && tooLargeOf.has(c.collectionId) ? (
                        <RowNote tone="attention">
                          {tooLargeOf.get(c.collectionId)!.count === null
                            ? t("margin.collections.tooLargeUncounted", { limit: COLLECTION_READ_LIMIT })
                            : t("margin.collections.tooLarge", { count: tooLargeOf.get(c.collectionId)!.count!, limit: COLLECTION_READ_LIMIT })}{" "}
                          {t("margin.collections.tooLargeFix")}
                        </RowNote>
                      ) : null}
                    </div>
                    <PercentFields
                      min={typed(c, "min")}
                      max={typed(c, "max")}
                      named={pro}
                      disabled={!pro}
                    />
                    <FieldMessage
                      text={
                        (
                          [
                            [`collectionMin[${i}]`, t("margin.collections.min")],
                            [`collectionMax[${i}]`, t("margin.collections.max")],
                          ] as const
                        )
                          .map(([field, label]) => {
                            // The live check first (it is about what is in the field now), else the server's refusal.
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
                  {t("editor.pick.collections")}
                </s-button>
              </s-stack>
              {full ? <RowNote>{t("margin.collections.limit", { max: CONFIG_LIMITS.marginOverrides })}</RowNote> : null}
              {pickUnavailable ? <s-text color="subdued">{t("editor.pick.unavailable")}</s-text> : null}
            </s-stack>
          </s-stack>
        </ProFrame>
      </s-stack>
    </WonSection>
  );
}
