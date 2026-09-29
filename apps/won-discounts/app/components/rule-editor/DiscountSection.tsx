// Section "Sleva": the primary controls (§7c) — on/off, name, type, value per
// market currency (MKT-1, empty = not offered there), target and pickers. Its
// state line and pill are live (§17b) and its aside shows the consequence.

import { formatMoney } from "@won/core/discounts/describe";

import { boolAttr } from "../shell/attrs";
import { SegmentedChoice } from "../shell/SegmentedChoice";
import { RowNote, WonSection } from "../shell/WonSection";
import { describeRuleLine } from "../model/describe";
import { FIELD, NAME_MAX } from "../model/rule-form";
import { statusText, type RuleStatus } from "../model/rule-status";
import { CustomerPreview } from "./CustomerPreview";
import { MarginNote } from "./MarginNote";
import { FieldGrid, FieldMessage, PickerRow, Shown, type EditorView } from "./parts";

export function DiscountSection({
  ed,
  status,
  productIds,
  variantIds,
  collectionIds,
  onPick,
  pickUnavailable,
  marginImpact,
}: {
  ed: EditorView;
  status: RuleStatus;
  productIds: string[];
  variantIds: string[];
  collectionIds: string[];
  onPick: (kind: "products" | "collections") => void;
  pickUnavailable: boolean;
  /** Products whose discount margin protection lowers (saved rule, protection on); null/absent = none or off. */
  marginImpact?: number | null;
}) {
  const { draft, defaults, codes, errorFor, tr } = ed;
  const { t } = tr;
  const valueKind = draft.value.kind;
  const targetKind = draft.target.kind;
  const productCount = productIds.length + variantIds.length;

  return (
    <WonSection
      title={t("editor.section.discount")}
      glyph="tag"
      summary={describeRuleLine(draft, tr, codes, ed.timezone)}
      status={status}
      hint={statusText(status, tr) ?? undefined}
      anchor="value"
      aside={<CustomerPreview draft={draft} codes={codes} tr={tr} status={status} />}
    >
      <s-stack direction="block" gap="base">
        <s-switch name={FIELD.enabled} value="on" label={t("editor.enabled")} checked={boolAttr(defaults.enabled)} />
        <s-text-field
          name={FIELD.name}
          label={t("editor.name.label")}
          value={defaults.name}
          maxLength={NAME_MAX}
          details={t("editor.name.details")}
          error={errorFor(FIELD.name)}
        />
        <SegmentedChoice
          name={FIELD.valueKind}
          label={t("editor.value.label")}
          defaultValue={defaults.valueKind}
          options={[
            { value: "percentage", label: t("editor.value.percentage") },
            { value: "fixed", label: t("editor.value.fixed") },
            { value: "freeShipping", label: t("editor.value.freeShipping") },
          ]}
        />
        <Shown when={valueKind === "percentage"}>
          <s-number-field
            name={FIELD.percent}
            label={t("editor.percent.label")}
            value={defaults.percent}
            min={1}
            max={100}
            suffix="%"
            inputMode="decimal"
            error={errorFor(FIELD.percent)}
          />
        </Shown>
        <Shown when={valueKind === "fixed"}>
          <s-stack direction="block" gap="small-200">
            <s-text color="subdued">{codes.length > 0 ? t("editor.amount.intro") : t("editor.amount.noCurrencies")}</s-text>
            <FieldGrid>
              {codes.map((c) => (
                <s-number-field
                  key={c}
                  name={FIELD.amount(c)}
                  label={t("editor.amount.label", { currency: c })}
                  value={defaults.amounts[c] ?? ""}
                  min={0}
                  suffix={c}
                  inputMode="decimal"
                  details={t("editor.amount.details")}
                  error={errorFor(FIELD.amount(c))}
                />
              ))}
            </FieldGrid>
            <FieldMessage text={errorFor("amount")} />
          </s-stack>
        </Shown>
        {marginImpact && draft.id !== "new" ? <MarginNote count={marginImpact} ruleId={draft.id} /> : null}
        {defaults.outside.length > 0 ? (
          // §14a: values in currencies whose market is off stay stored; removing one is explicit.
          <s-stack direction="block" gap="small-200">
            {defaults.outside.map((o) => {
              const value = [
                o.amount !== null ? formatMoney(o.amount, o.currency, tr.locale) : "",
                o.minimum !== null ? `${t("editor.minimum.title")}: ${formatMoney(o.minimum, o.currency, tr.locale)}` : "",
              ]
                .filter(Boolean)
                .join(" · ");
              return (
                <div key={o.currency}>
                  <RowNote>{t("editor.amount.disabledMarket", { currency: o.currency, value })}</RowNote>
                  <s-checkbox name={FIELD.dropCurrency} value={o.currency} label={t("editor.amount.dropDisabled", { currency: o.currency })} />
                </div>
              );
            })}
          </s-stack>
        ) : null}
        <Shown when={valueKind === "freeShipping"}>
          <s-text color="subdued">{t("editor.target.freeShippingNote")}</s-text>
        </Shown>
        <div id="target" style={{ display: valueKind === "freeShipping" ? "none" : "block", scrollMarginTop: 16 }}>
          <s-stack direction="block" gap="small-200">
            <SegmentedChoice
              name={FIELD.target}
              label={t("editor.target.label")}
              defaultValue={defaults.valueKind === "freeShipping" ? "order" : defaults.target}
              options={[
                { value: "order", label: t("editor.target.order") },
                { value: "products", label: t("editor.target.products") },
                { value: "collections", label: t("editor.target.collections") },
                { value: "shipping", label: t("editor.target.shipping") },
              ]}
            />
            <Shown when={targetKind === "products"}>
              <PickerRow
                label={t("editor.pick.products")}
                countText={productCount > 0 ? tr.tp("count.product", productCount) : null}
                onPick={() => onPick("products")}
                unavailable={pickUnavailable}
              />
            </Shown>
            <Shown when={targetKind === "collections"}>
              <PickerRow
                label={t("editor.pick.collections")}
                countText={collectionIds.length > 0 ? tr.tp("count.collection", collectionIds.length) : null}
                onPick={() => onPick("collections")}
                unavailable={pickUnavailable}
              />
              <s-text color="subdued">{t("editor.target.collectionsRefresh")}</s-text>
            </Shown>
            {productIds.map((id) => (
              <input key={id} type="hidden" name={FIELD.productIds} value={id} />
            ))}
            {variantIds.map((id) => (
              <input key={id} type="hidden" name={FIELD.variantIds} value={id} />
            ))}
            {collectionIds.map((id) => (
              <input key={id} type="hidden" name={FIELD.collectionIds} value={id} />
            ))}
            <FieldMessage text={errorFor(FIELD.target)} />
          </s-stack>
        </div>
      </s-stack>
    </WonSection>
  );
}
