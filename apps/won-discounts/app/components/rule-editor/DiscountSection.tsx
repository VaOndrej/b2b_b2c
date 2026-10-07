// Section 1 "Sleva": the primary controls (§7c) — on/off, name, type, value per
// market currency (MKT-1, empty = not offered there), target and pickers. Its
// state line and pill are live (§17b) and its aside shows the consequence.
// P3: the status sentence under the header links to the field that fixes it,
// and that field carries a marker computed from the live draft. P5: the name
// follows the settings until the merchant types their own.

import { useEffect, useRef } from "react";

import { formatMoney } from "@won/core/discounts/describe";

import { boolAttr } from "../shell/attrs";
import { ResyncButton } from "../shell/Notice";
import { SegmentedChoice } from "../shell/SegmentedChoice";
import { useT } from "../../i18n/context";
import { PlanBadge } from "../shell/PlanBadge";
import { SelectedList, type SelectedItem } from "../shell/SelectedList";
import { RowNote, WonSection } from "../shell/WonSection";
import { WON_ATTENTION, WON_FAINT, WON_FONT } from "../shell/tokens";
import { describeRuleLine, missingAmountCurrencies, type RuleLineNames } from "../model/describe";
import { FIELD, NAME_MAX } from "../model/rule-form";
import { needsAttention, needsResync, statusAnchor, statusText, type RuleStatus } from "../model/rule-status";
import type { MarginRuleImpactView } from "../model/types";
import { CustomerPreview } from "./CustomerPreview";
import { MarginNote } from "./MarginNote";
import { TiersNote } from "./TiersNote";
import { Anchor, AnchorLink, FieldGrid, FieldMark, FieldMessage, PickerRow, Shown, type EditorView } from "./parts";

/** The status sentence under the header: a link to the field that fixes it, or "Synchronizovat znovu" right here. */
function StatusLine({ ed, status, resync }: { ed: EditorView; status: RuleStatus; resync: boolean }) {
  const sentence = statusText(status, ed.tr);
  if (!sentence) return null;
  const anchor = statusAnchor(status, ed.draft, ed.codes);
  const attention = needsAttention(status);
  return (
    <div style={{ fontFamily: WON_FONT, fontSize: 12.5, lineHeight: 1.4, color: attention ? WON_ATTENTION : WON_FAINT, display: "flex", flexDirection: "column", gap: 8 }}>
      <div>{anchor ? <AnchorLink to={anchor} tone={attention ? "attention" : undefined}>{sentence}</AnchorLink> : sentence}</div>
      {resync && needsResync(status) ? (
        <div>
          <ResyncButton />
        </div>
      ) : null}
    </div>
  );
}

export function DiscountSection({
  ed,
  status,
  names,
  nameAuto,
  onRestoreAutoName,
  resync,
  productIds,
  variantIds,
  collectionIds,
  labels,
  onRemove,
  pro,
  onPick,
  pickUnavailable,
  marginImpact,
  tiersActive = false,
}: {
  ed: EditorView;
  status: RuleStatus;
  /** Market and rule names for the one-line state. */
  names: RuleLineNames;
  /** The name is generated from the settings (P5); false once the merchant typed their own. */
  nameAuto: boolean;
  onRestoreAutoName: () => void;
  /** The shop is connected: a rule that did not reach Shopify offers "Synchronizovat znovu" here. */
  resync: boolean;
  productIds: string[];
  variantIds: string[];
  collectionIds: string[];
  /** P4: names and images by id; an id without one is listed as "bez názvu". */
  labels: Record<string, { title: string; image?: string }>;
  onRemove: (kind: "products" | "variants" | "collections", id: string) => void;
  /** Server-derived Pro entitlement: the per-item minimum fields (bod 8). */
  pro: boolean;
  onPick: (kind: "products" | "collections") => void;
  pickUnavailable: boolean;
  /** Margin protection lowers the saved rule (ruleMarginImpact; Free without a number); null/absent = none or off. */
  marginImpact?: MarginRuleImpactView | null;
  /** A tier set runs on this plan: a product rule competes with it (MVP 3, A1). */
  tiersActive?: boolean;
}) {
  const { draft, defaults, codes, errorFor, tr, readOnly } = ed;
  /** "Slovensko" for EUR; "" when no market is known for the currency (the field is then named by the currency). */
  const marketsOf = (code: string) => ed.currencyViews.find((v) => v.code === code)?.markets.map((m) => m.name).join(", ") ?? "";
  const { t } = tr;
  const off = boolAttr(readOnly);
  const valueKind = draft.value.kind;
  const targetKind = draft.target.kind;
  // Stored variant ids count until the merchant ticks "Odebrat tyto varianty" (the draft then has none).
  const variantCount = draft.target.kind === "products" ? draft.target.variantIds.length : variantIds.length;
  const productCount = productIds.length + variantCount;
  const itemsOf = (ids: readonly string[]) => ids.map((id) => ({ id, title: labels[id]?.title ?? "", image: labels[id]?.image }));
  // Bod 8 (Pro): each selected product / collection may have its own minimum quantity; empty = the common one.
  const storedItemMinimums = Object.keys(defaults.itemMinimums).length;
  const itemMinField = (item: SelectedItem) => (
    <div style={{ width: 116 }}>
      <s-number-field
        name={FIELD.itemMin(item.id)}
        label={t("editor.itemMin.label", { name: item.title || t("common.untitled") })}
        labelAccessibilityVisibility="exclusive"
        value={defaults.itemMinimums[item.id] ?? ""}
        placeholder={t("editor.itemMin.placeholder")}
        min={1}
        suffix={t("editor.itemMin.suffix")}
        inputMode="numeric"
        disabled={off}
      />
      <FieldMessage text={errorFor(FIELD.itemMin(item.id))} />
    </div>
  );
  const noAmount = missingAmountCurrencies(draft, codes);

  // P5: while the name is automatic it follows the settings. The field's value
  // is set by code ONLY in that mode and only while the merchant is not in the
  // field (a Polaris field snaps back when its value changes under the cursor).
  const nameRef = useRef<(HTMLElement & { value: string }) | null>(null);
  const autoName = nameAuto ? draft.name : null;
  useEffect(() => {
    const el = nameRef.current;
    if (!el || autoName === null) return;
    if (el.matches(":focus-within") || document.activeElement === el) return;
    if (el.value !== autoName) el.value = autoName;
  }, [autoName]);

  return (
    <WonSection
      title={t("editor.section.discount")}
      glyph="tag"
      summary={describeRuleLine(draft, tr, codes, ed.timezone, names)}
      status={status}
      proof={statusText(status, tr) ? <StatusLine ed={ed} status={status} resync={resync} /> : undefined}
      aside={<CustomerPreview draft={draft} currencyViews={ed.currencyViews} tr={tr} status={status} />}
    >
      <s-stack direction="block" gap="base">
        <s-switch name={FIELD.enabled} value="on" label={t("editor.enabled")} checked={boolAttr(defaults.enabled)} disabled={off} />
        <div>
          <s-text-field
            ref={(el) => {
              nameRef.current = el;
            }}
            name={FIELD.name}
            label={t("editor.name.label")}
            value={defaults.name}
            maxLength={NAME_MAX}
            details={t("editor.name.details")}
            error={errorFor(FIELD.name)}
            disabled={off}
          />
          <input type="hidden" name={FIELD.nameAuto} value={nameAuto ? "1" : "0"} />
          {nameAuto ? (
            <RowNote>{t("editor.name.auto")}</RowNote>
          ) : readOnly ? null : (
            <div style={{ marginTop: 2 }}>
              <s-button variant="tertiary" onClick={onRestoreAutoName}>
                {t("editor.name.restoreAuto")}
              </s-button>
            </div>
          )}
        </div>
        <SegmentedChoice
          name={FIELD.valueKind}
          label={t("editor.value.label")}
          defaultValue={defaults.valueKind}
          disabled={readOnly}
          options={[
            { value: "percentage", label: t("editor.value.percentage") },
            { value: "fixed", label: t("editor.value.fixed") },
            { value: "freeShipping", label: t("editor.value.freeShipping") },
          ]}
        />
        <Anchor id="value">
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
              disabled={off}
            />
          </Shown>
          <Shown when={valueKind === "fixed"}>
            <s-stack direction="block" gap="small-200">
              {/* One currency: just the amount. Several: one amount each, said once (a shop with one currency never reads about markets). */}
              {codes.length === 0 ? <s-text color="subdued">{t("editor.amount.noCurrencies")}</s-text> : codes.length > 1 ? <s-text color="subdued">{t("editor.amount.intro", { currencies: tr.list(codes.map((c) => (marketsOf(c) ? `${marketsOf(c)} (${c})` : c))) })}</s-text> : null}
              <FieldGrid>
                {codes.map((c) => (
                  <s-number-field
                    key={c}
                    name={FIELD.amount(c)}
                    label={codes.length > 1 ? (marketsOf(c) ? t("editor.amount.labelMarket", { currency: c, markets: marketsOf(c) }) : t("editor.amount.label", { currency: c })) : t("editor.amount.labelSingle")}
                    value={defaults.amounts[c] ?? ""}
                    min={0}
                    suffix={c}
                    inputMode="decimal"
                    details={codes.length > 1 ? (marketsOf(c) ? t("editor.amount.detailsMarket", { markets: marketsOf(c) }) : t("editor.amount.details", { currency: c })) : undefined}
                    error={errorFor(FIELD.amount(c))}
                    disabled={off}
                  />
                ))}
              </FieldGrid>
              {valueKind === "fixed" && noAmount.length > 0 ? (
                // P3: the empty amount field is what keeps the rule from running (in every currency, or in these).
                <FieldMark
                  text={noAmount.length === codes.length ? t("editor.mark.amountNone") : t("editor.mark.amountMissing", { currencies: tr.list(noAmount) })}
                />
              ) : (
                <FieldMessage text={errorFor("amount")} />
              )}
            </s-stack>
          </Shown>
        </Anchor>
        {marginImpact && draft.id !== "new" ? <MarginNote impact={marginImpact} ruleId={draft.id} /> : null}
        {tiersActive && valueKind !== "freeShipping" && (targetKind === "products" || targetKind === "collections") ? <TiersNote /> : null}
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
                  <s-checkbox name={FIELD.dropCurrency} value={o.currency} label={t("editor.amount.dropDisabled", { currency: o.currency })} disabled={off} />
                </div>
              );
            })}
          </s-stack>
        ) : null}
        <Shown when={valueKind === "freeShipping"}>
          <s-text color="subdued">{t("editor.target.freeShippingNote")}</s-text>
        </Shown>
        <Anchor id="target" hidden={valueKind === "freeShipping"}>
          <s-stack direction="block" gap="small-200">
            <SegmentedChoice
              name={FIELD.target}
              label={t("editor.target.label")}
              defaultValue={defaults.valueKind === "freeShipping" ? "order" : defaults.target}
              disabled={readOnly}
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
                attention={t("editor.mark.noProducts")}
                disabled={readOnly}
              />
              <SelectedList items={itemsOf(productIds)} fallback={t("common.untitledProduct")} onRemove={(id) => onRemove("products", id)} disabled={readOnly} extra={pro ? itemMinField : undefined} />
              {productIds.length > 0 ? <ItemMinimumNote pro={pro} stored={storedItemMinimums} kind="products" off={off} /> : null}
              {variantIds.length > 0 ? (
                // B4: the picker chooses whole products. Variant ids stored earlier still apply;
                // they are listed by name and removed one by one, never dropped silently.
                <div>
                  <RowNote>{t("editor.target.variantsStored", { n: variantIds.length })}</RowNote>
                  <SelectedList items={itemsOf(variantIds)} fallback={t("common.untitledProduct")} onRemove={(id) => onRemove("variants", id)} disabled={readOnly} />
                </div>
              ) : null}
            </Shown>
            <Shown when={targetKind === "collections"}>
              <PickerRow
                label={t("editor.pick.collections")}
                countText={collectionIds.length > 0 ? tr.tp("count.collection", collectionIds.length) : null}
                onPick={() => onPick("collections")}
                unavailable={pickUnavailable}
                attention={t("editor.mark.noCollections")}
                disabled={readOnly}
              />
              <SelectedList items={itemsOf(collectionIds)} fallback={t("common.untitledCollection")} onRemove={(id) => onRemove("collections", id)} disabled={readOnly} extra={pro ? itemMinField : undefined} />
              {collectionIds.length > 0 ? <ItemMinimumNote pro={pro} stored={storedItemMinimums} kind="collections" off={off} /> : null}
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
            <FieldMessage text={noTargetShown(targetKind, productCount, collectionIds.length) ? undefined : errorFor(FIELD.target)} />
          </s-stack>
        </Anchor>
      </s-stack>
    </WonSection>
  );
}

/** The picker row already carries the "nothing selected" marker: the save error would say it twice. */
function noTargetShown(targetKind: string, productCount: number, collectionCount: number): boolean {
  return (targetKind === "products" && productCount === 0) || (targetKind === "collections" && collectionCount === 0);
}

/**
 * Under the selected list (bod 8): what the "Od ks" fields do — or, on Free, that a minimum for each
 * product is a Pro feature; minimums stored earlier keep the rule off on Free and can be removed here.
 */
function ItemMinimumNote({ pro, stored, kind, off }: { pro: boolean; stored: number; kind: "products" | "collections"; off: true | undefined }) {
  const { t } = useT();
  if (pro) return <RowNote>{t(kind === "products" ? "editor.itemMin.hintProducts" : "editor.itemMin.hintCollections")}</RowNote>;
  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
        <PlanBadge tier="pro" locked href="/app/plan" />
        <RowNote>{t(kind === "products" ? "editor.itemMin.proProducts" : "editor.itemMin.proCollections")}</RowNote>
      </div>
      {stored > 0 ? (
        <>
          <FieldMark text={t("editor.itemMin.storedFree", { n: stored })} />
          <s-checkbox name={FIELD.dropItemMinimums} value="on" label={t("editor.itemMin.drop")} disabled={off} />
        </>
      ) : null}
    </div>
  );
}
