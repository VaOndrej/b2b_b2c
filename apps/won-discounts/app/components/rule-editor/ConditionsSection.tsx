// Section 2 "Podmínky": the minimum order per market currency, the minimum
// quantity and — for a product / collection rule that has a minimum — where the
// minimum is measured (the whole cart or only the rule's products; kept on
// edit, cart for new rules; the parser ignores the choice anywhere else, B8).
// P3: a minimum set for some currencies only takes the rule out of the others;
// the marker says in which.

import { amountKeyCurrency } from "@won/core/discounts/money";
import { AmountSuggestions } from "../shell/AmountSuggestions";
import { describeItemMinimums, describeMinimum, missingMinimumCurrencies } from "../model/describe";
import { FIELD } from "../model/rule-form";
import { boolAttr } from "../shell/attrs";
import { SegmentedChoice } from "../shell/SegmentedChoice";
import { WonSection } from "../shell/WonSection";
import { FieldGrid, FieldMark, Shown, type EditorView } from "./parts";

export function ConditionsSection({ ed }: { ed: EditorView }) {
  const { draft, defaults, codes, errorFor, tr, readOnly } = ed;
  /** "Slovensko" for EUR; "" when no market is known for the currency (the field is then named by the currency). */
  const marketsOf = (code: string) => ed.currencyViews.find((v) => v.code === code)?.markets.map((m) => m.name).join(", ") ?? "";
  const { t } = tr;
  const off = boolAttr(readOnly);
  const targetsProducts = draft.target.kind === "products" || draft.target.kind === "collections";
  const hasMinimum = draft.minimum !== undefined;
  const noMinimum = missingMinimumCurrencies(draft, codes);
  return (
    <WonSection title={t("editor.section.conditions")} glyph="cart" summary={[describeMinimum(draft, tr, codes), describeItemMinimums(draft, tr)].filter(Boolean).join(" · ") || t("describe.minimum.none")} anchor="conditions">
      <s-stack direction="block" gap="small-200">
        {codes.length > 1 ? <s-text color="subdued">{t("editor.minimum.details")}</s-text> : null}
        <FieldGrid>
          {codes.map((c) => (
            <s-number-field
              key={c}
              name={FIELD.minimum(c)}
              label={codes.length > 1 ? (marketsOf(c) ? t("editor.minimum.labelMarket", { currency: c, markets: marketsOf(c) }) : t("editor.minimum.label", { currency: c })) : t("editor.minimum.labelSingle")}
              value={defaults.minimums[c] ?? ""}
              min={0}
              suffix={amountKeyCurrency(c)}
              inputMode="decimal"
              error={errorFor(FIELD.minimum(c))}
              disabled={off}
            />
          ))}
          <s-number-field
            name={FIELD.minQty}
            label={t("editor.minQty.label")}
            value={defaults.minQty}
            min={0}
            inputMode="numeric"
            error={errorFor(FIELD.minQty)}
            disabled={off}
          />
        </FieldGrid>
        {off ? null : <AmountSuggestions suggest={ed.suggest} currencies={ed.currencyViews} field={FIELD.minimum} initial={defaults.minimums} />}
        {noMinimum.length > 0 ? <FieldMark text={t("editor.mark.minimumMissing", { currencies: tr.list(noMinimum) })} /> : null}
        <Shown when={targetsProducts && hasMinimum}>
          <SegmentedChoice
            name={FIELD.minScope}
            label={t("editor.minimum.scope")}
            defaultValue={defaults.minScope}
            disabled={readOnly}
            options={[
              { value: "cart", label: t("editor.minimum.scope.cart") },
              { value: "entitled", label: t("editor.minimum.scope.entitled") },
            ]}
          />
        </Shown>
      </s-stack>
    </WonSection>
  );
}
