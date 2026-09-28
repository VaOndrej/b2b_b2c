// "Přesunout do Won" confirmation (docs/won-discounts/rozhodnuti.md, "Přesun
// nativních slev"): before the one click, say exactly what happens and what is
// lost (§14c), and how to undo it (§14b). The body is a separate component so the
// harness and tests can render it without opening a modal.

import type { NativeDiscountView, NativeLoss } from "./model/types";
import { useT } from "../i18n/context";

const LOSS_KEYS: Record<NativeLoss, "move.lose.usageHistory" | "move.lose.oncePerCustomer"> = {
  usage_history: "move.lose.usageHistory",
  once_per_customer: "move.lose.oncePerCustomer",
};

export function MoveDialogBody({ discounts }: { discounts: readonly NativeDiscountView[] }) {
  const { t } = useT();
  const losses = [...new Set(discounts.flatMap((d) => d.losses))];
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
      <s-stack direction="block" gap="small-200">
        <s-text type="strong">{t("move.lose.title")}</s-text>
        {losses.length === 0 ? (
          <s-paragraph>{t("move.lose.none")}</s-paragraph>
        ) : (
          <s-unordered-list>
            {losses.map((loss) => (
              <s-list-item key={loss}>{t(LOSS_KEYS[loss])}</s-list-item>
            ))}
          </s-unordered-list>
        )}
      </s-stack>
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
