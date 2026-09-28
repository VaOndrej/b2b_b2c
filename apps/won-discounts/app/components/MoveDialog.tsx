// "Přesunout do Won" confirmation (docs/won-discounts/rozhodnuti.md, "Přesun
// nativních slev"): before the one click, say exactly what happens and what is
// lost (§14c) — the planMove sentences for THIS discount (app/lib/native) —
// and how to undo it (§14b). The body is a separate component so the harness
// and tests can render it without opening a modal.

import type { NativeDiscountView } from "./model/types";
import { useT } from "../i18n/context";

function List({ items }: { items: readonly string[] }) {
  return (
    <s-unordered-list>
      {items.map((item, i) => (
        <s-list-item key={`${i}-${item}`}>{item}</s-list-item>
      ))}
    </s-unordered-list>
  );
}

/** One discount: its losses and notes. Several: the same, per discount (each says its own). */
function LossBlock({ discount, titled }: { discount: NativeDiscountView; titled: boolean }) {
  const { t } = useT();
  const warnings = discount.warnings ?? [];
  return (
    <s-stack direction="block" gap="small-200">
      {titled ? <s-text type="strong">{discount.title}</s-text> : null}
      <s-text type={titled ? undefined : "strong"}>{t("move.lose.title")}</s-text>
      {discount.losses.length === 0 ? <s-paragraph>{t("move.lose.none")}</s-paragraph> : <List items={discount.losses} />}
      {warnings.length > 0 ? (
        <>
          <s-text type={titled ? undefined : "strong"}>{t("move.warnings.title")}</s-text>
          <List items={warnings} />
        </>
      ) : null}
    </s-stack>
  );
}

export function MoveDialogBody({ discounts }: { discounts: readonly NativeDiscountView[] }) {
  const { t } = useT();
  return (
    <s-stack direction="block" gap="base">
      <s-stack direction="block" gap="small-200">
        <s-text type="strong">{t("move.what")}</s-text>
        <s-ordered-list>
          <s-list-item>{t("move.step.backup")}</s-list-item>
          <s-list-item>{t("move.step.create")}</s-list-item>
          <s-list-item>{t("move.step.delete")}</s-list-item>
        </s-ordered-list>
      </s-stack>
      {discounts.map((discount) => (
        <LossBlock key={discount.id} discount={discount} titled={discounts.length > 1} />
      ))}
      <s-paragraph color="subdued">{t("move.undo")}</s-paragraph>
    </s-stack>
  );
}

export function moveDialogHeading(discounts: readonly NativeDiscountView[], tr: ReturnType<typeof useT>): string {
  return discounts.length === 1
    ? tr.t("move.headingOne", { title: discounts[0].title })
    : tr.t("move.headingMany", { discounts: tr.tp("count.discount", discounts.length) });
}

/**
 * The modal itself. Opened by any `<s-button commandFor={id} command="--show">`;
 * the caller owns the submission (a fetcher) and passes `onConfirm`.
 */
export function MoveDialog({
  id,
  discounts,
  onConfirm,
}: {
  id: string;
  discounts: readonly NativeDiscountView[];
  onConfirm: () => void;
}) {
  const tr = useT();
  return (
    <s-modal id={id} heading={discounts.length > 0 ? moveDialogHeading(discounts, tr) : tr.t("move.confirm")}>
      <MoveDialogBody discounts={discounts} />
      <s-button slot="primary-action" variant="primary" commandFor={id} command="--hide" onClick={onConfirm}>
        {tr.t("move.confirm")}
      </s-button>
      <s-button slot="secondary-actions" commandFor={id} command="--hide">
        {tr.t("common.cancel")}
      </s-button>
    </s-modal>
  );
}
