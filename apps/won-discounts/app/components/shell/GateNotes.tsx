// BILL-1 in the admin (audit P1-1): Pro settings the stored config holds but
// the shop's plan does not run. The sentences come from core explainGate (the
// same gate the sync applies before anything reaches checkout), so the admin
// never shows a Pro setting as working when checkout ignores it (§12, §17c).

import { useT } from "../../i18n/context";
import type { GateNoteView } from "../model/types";

export function GateNotes({ notes, compact = false }: { notes: readonly GateNoteView[]; compact?: boolean }) {
  const { t } = useT();
  if (notes.length === 0) return null;
  return (
    <s-banner tone="warning" heading={t("gate.heading")}>
      <s-stack direction="block" gap="small-200">
        {compact ? null : <s-paragraph>{t("gate.body")}</s-paragraph>}
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
