// BILL-1 in the admin (audit P1-1): Pro settings the stored config holds but
// the shop's plan does not run. The sentences come from core explainGate (the
// same gate the sync applies before anything reaches checkout), so the admin
// never shows a Pro setting as working when checkout ignores it (§12, §17c).

import { useT } from "../../i18n/context";
import type { GateNoteView } from "../model/types";

/**
 * `pending` (F2 re-review I-2): the shop config live in Shopify was still built
 * with these Pro settings (before the sync gated for plans, or before a
 * downgrade). Checkout runs them until the resync under way — the banner says
 * that, never "not active".
 */
export function GateNotes({ notes, compact = false, pending = false }: { notes: readonly GateNoteView[]; compact?: boolean; pending?: boolean }) {
  const { t } = useT();
  if (notes.length === 0) return null;
  return (
    <s-banner tone="warning" heading={t(pending ? "gate.pendingHeading" : "gate.heading")}>
      <s-stack direction="block" gap="small-200">
        {pending ? <s-paragraph>{t("gate.pendingBody")}</s-paragraph> : compact ? null : <s-paragraph>{t("gate.body")}</s-paragraph>}
        <s-unordered-list>
          {notes.map((note, i) => (
            <s-list-item key={`${i}-${note.ruleId ?? ""}`}>{note.text}</s-list-item>
          ))}
        </s-unordered-list>
      </s-stack>
      <s-button slot="secondary-actions" href="/app/plan">
        {t("common.upgradeCta")}
      </s-button>
    </s-banner>
  );
}
