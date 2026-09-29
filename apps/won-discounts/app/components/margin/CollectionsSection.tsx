// Pro "Nastavení podle kolekcí" (A2/§16: visible, amber, never blocks Free;
// BILL-1: the server decides what is stored and what checkout runs). Each row
// is one collection with its own minimum margin and ceiling; an empty field
// inherits the global value. Collections come from the App Bridge resource
// picker (model/app-bridge.ts); outside Shopify admin (the dev harness) the
// picker is unavailable and the section says so.
//
// On Free the rows stay visible and removable (§14a: off ≠ erased — removing a
// Pro setting the plan folds into a stricter global value is always allowed),
// their values travel as hidden inputs so a save never drops them, and the
// fields are disabled. With nothing stored, Free sees one sample row labelled
// "Ukázka" (§16c: show the upside, never as the shop's data — §12).

import { CONFIG_LIMITS } from "@won/core/discounts/config";

import { useT } from "../../i18n/context";
import { MARGIN_FIELD, MARGIN_PERCENT_STEP, percentInput } from "../model/margin";
import type { GateNoteView, MarginCollectionView } from "../model/types";
import { FieldGrid, FieldMessage } from "../rule-editor/parts";
import { boolAttr } from "../shell/attrs";
import { GateNotes } from "../shell/GateNotes";
import { ProFrame } from "../shell/ProFrame";
import { ProSell } from "../shell/ProSell";
import { RowNote, WonRow, WonSection } from "../shell/WonSection";
import { WON_AMBER_TEXT } from "../shell/tokens";

function PercentFields({
  min,
  max,
  named,
  disabled,
  minError,
  maxError,
}: {
  min: number | null;
  max: number | null;
  /** Submit these fields (Pro); on Free the values go as hidden inputs instead. */
  named: boolean;
  disabled: boolean;
  minError?: string;
  maxError?: string;
}) {
  const { t } = useT();
  return (
    <FieldGrid>
      <s-number-field
        name={named ? MARGIN_FIELD.collectionMin : undefined}
        label={t("margin.collections.min")}
        value={percentInput(min)}
        placeholder={t("margin.collections.inherit")}
        min={0}
        max={95}
        step={MARGIN_PERCENT_STEP}
        suffix="%"
        inputMode="decimal"
        disabled={boolAttr(disabled)}
        error={minError}
      />
      <s-number-field
        name={named ? MARGIN_FIELD.collectionMax : undefined}
        label={t("margin.collections.max")}
        value={percentInput(max)}
        placeholder={t("margin.collections.inherit")}
        min={0}
        max={100}
        step={MARGIN_PERCENT_STEP}
        suffix="%"
        inputMode="decimal"
        disabled={boolAttr(disabled)}
        error={maxError}
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
}: {
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
}) {
  const tr = useT();
  const { t } = tr;
  const full = collections.length >= CONFIG_LIMITS.marginOverrides;
  // §17c: on Free one setting applies to the whole shop, whatever is stored.
  const summary =
    pro && collections.length > 0
      ? t("margin.collections.some", { collections: tr.tp("count.collection", collections.length) })
      : t("margin.collections.none");
  return (
    <WonSection
      title={t("margin.collections.title")}
      glyph="layers"
      pro
      locked={!pro}
      summary={summary}
      collapsible
      defaultOpen={collections.length > 0 || gateNotes.length > 0 || !!error}
      anchor="collections"
    >
      <s-stack direction="block" gap="base">
        {gateNotes.length > 0 ? <GateNotes notes={gateNotes} compact /> : null}
        {!pro ? <ProSell benefit={t("margin.collections.benefit")} /> : null}
        <ProFrame locked={!pro}>
          <s-stack direction="block" gap="base">
            <s-text color="subdued">{t("margin.collections.body")}</s-text>
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
                      <s-text type="strong">{c.title}</s-text>
                      <FieldMessage text={errorFor(`collectionId[${i}]`)} />
                    </div>
                    <PercentFields
                      min={c.minMarginPercent}
                      max={c.maxDiscountPercent}
                      named={pro}
                      disabled={!pro}
                      minError={errorFor(`collectionMin[${i}]`)}
                      maxError={errorFor(`collectionMax[${i}]`)}
                    />
                    <FieldMessage text={decimalErrorFor(`collectionMin[${i}]`) ?? decimalErrorFor(`collectionMax[${i}]`)} />
                  </WonRow>
                ))}
              </div>
            ) : !pro ? (
              <WonRow>
                <div style={{ marginBottom: 8 }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: WON_AMBER_TEXT }}>{t("margin.collections.sample")} · </span>
                  <s-text type="strong">{t("margin.collections.sampleName")}</s-text>
                </div>
                <PercentFields min={30} max={20} named={false} disabled />
              </WonRow>
            ) : null}
            <FieldMessage text={error} />
            <s-stack direction="block" gap="small-200">
              <s-stack direction="inline" gap="base" alignItems="center">
                <s-button onClick={onPick} disabled={boolAttr(!pro || full)}>
                  {t("editor.pick.collections")}
                </s-button>
                {collections.length > 0 ? <s-text color="subdued">{tr.tp("count.collection", collections.length)}</s-text> : null}
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
