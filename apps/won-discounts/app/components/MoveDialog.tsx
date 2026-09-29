// "Přesunout do Won" confirmation (docs/won-discounts/rozhodnuti.md, "Přesun
// nativních slev"): before the one click, say exactly what happens, in the
// order the code does it (automatic: backup → Won rule + sync → delete, both
// may apply for a moment; code: backup → delete → Won rule + sync, a short
// window without the discount, and why), what is lost (§14c) — the planMove sentences
// for THIS discount (app/lib/native) — that uninstalling the app ends moved
// discounts, and how to undo it (§14b). The "Vrátit zpět" confirmation says
// what the undo changes BEFORE the click too (F11). The bodies are separate
// components so the harness and tests can render them without opening a modal.

import type { NativeDiscountExtras } from "../lib/native/types";
import type { MovedDiscountView, NativeDiscountView } from "./model/types";
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

/** A movable discount on Přehled with its stacking notes (NativeDiscountExtras, app/lib/integration). */
export type MovableDiscount = NativeDiscountView & NativeDiscountExtras;

/**
 * One discount: its losses and notes. Several: the same, per discount (each
 * says its own). How it stacks with other Shopify discounts (F4) is said only
 * for those that stay in Shopify, not for those moved in the same batch.
 */
function LossBlock({ discount, titled, batch }: { discount: MovableDiscount; titled: boolean; batch: ReadonlySet<string> }) {
  const { t } = useT();
  const stacking = (discount.stacking ?? []).filter((note) => !batch.has(note.nativeId)).map((note) => note.text);
  const warnings = [...(discount.warnings ?? []), ...new Set(stacking)];
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

/**
 * The steps in the order the move runs them (app/lib/native/move.server.ts):
 * automatic discounts create the Won rule first and delete after; code
 * discounts must delete first (Shopify keeps a code text taken even by an
 * ended discount). A dialog for both kinds shows both, titled.
 */
function Steps({ discounts }: { discounts: readonly NativeDiscountView[] }) {
  const { t } = useT();
  const code = discounts.some((d) => d.method === "code");
  const automatic = discounts.some((d) => d.method === "automatic");
  const titled = code && automatic;
  return (
    <>
      {automatic || !code ? (
        <s-stack direction="block" gap="small-200">
          {titled ? <s-text>{t("move.auto.title")}</s-text> : null}
          <s-ordered-list>
            <s-list-item>{t("move.step.backup")}</s-list-item>
            <s-list-item>{t("move.auto.create")}</s-list-item>
            <s-list-item>{t("move.auto.delete")}</s-list-item>
          </s-ordered-list>
          <s-paragraph>{t("move.auto.window")}</s-paragraph>
        </s-stack>
      ) : null}
      {code ? (
        <s-stack direction="block" gap="small-200">
          {titled ? <s-text>{t("move.code.title")}</s-text> : null}
          <s-ordered-list>
            <s-list-item>{t("move.step.backup")}</s-list-item>
            <s-list-item>{t("move.step.delete")}</s-list-item>
            <s-list-item>{t("move.step.create")}</s-list-item>
          </s-ordered-list>
          <s-paragraph>{t("move.window")}</s-paragraph>
        </s-stack>
      ) : null}
    </>
  );
}

export function MoveDialogBody({ discounts }: { discounts: readonly MovableDiscount[] }) {
  const { t } = useT();
  const batch = new Set(discounts.map((d) => d.id));
  return (
    <s-stack direction="block" gap="base">
      <s-stack direction="block" gap="small-200">
        <s-text type="strong">{t("move.what")}</s-text>
        <Steps discounts={discounts} />
      </s-stack>
      {discounts.map((discount) => (
        <LossBlock key={discount.id} discount={discount} titled={discounts.length > 1} batch={batch} />
      ))}
      <s-paragraph>{t("move.uninstall")}</s-paragraph>
      <s-paragraph color="subdued">{t("move.undo")}</s-paragraph>
    </s-stack>
  );
}

/** A backup on Přehled with what its undo will change (undoCosts / stacking live on MovedDiscountView, F3 concern 2). */
export type UndoableBackup = MovedDiscountView;

/** What "Vrátit zpět" will do and change, before the click (F11, §14c). */
export function UndoDialogBody({ backup }: { backup: UndoableBackup }) {
  const { t } = useT();
  const costs = backup.undoCosts ?? [];
  return (
    <s-stack direction="block" gap="base">
      <s-stack direction="block" gap="small-200">
        <s-text type="strong">{t("undo.what")}</s-text>
        <s-ordered-list>
          <s-list-item>{t("undo.step.remove")}</s-list-item>
          <s-list-item>{t("undo.step.restore")}</s-list-item>
        </s-ordered-list>
      </s-stack>
      <s-stack direction="block" gap="small-200">
        <s-text type="strong">{t("undo.changes.title")}</s-text>
        {costs.length > 0 ? <List items={costs} /> : <s-paragraph>{t("undo.changes.generic")}</s-paragraph>}
      </s-stack>
    </s-stack>
  );
}

/** The "Vrátit zpět" confirmation modal; the caller owns the submission (`onConfirm`). */
export function UndoDialog({ id, backup, onConfirm }: { id: string; backup: UndoableBackup | null; onConfirm: () => void }) {
  const { t } = useT();
  return (
    <s-modal id={id} heading={backup ? t("undo.headingOne", { title: backup.title }) : t("undo.confirm")}>
      {backup ? <UndoDialogBody backup={backup} /> : null}
      <s-button slot="primary-action" variant="primary" commandFor={id} command="--hide" onClick={onConfirm}>
        {t("undo.confirm")}
      </s-button>
      <s-button slot="secondary-actions" commandFor={id} command="--hide">
        {t("common.cancel")}
      </s-button>
    </s-modal>
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
