// One step of a form that is filled in order (a new sale, a campaign): a numbered rail on the left and the step's
// own card on the right, so the steps read as separate things and not as one long form (feedback 10 Oct 2026,
// bod 4). The rail's line joins a step to the next one; the last step has none.
// 6th round ("stále působí flat"): the card has depth — a header strip in the neutral wash with "Krok 1 ze 4"
// above the title, a white body under it and a soft shadow; the number on the rail is the selection blue.

import type { ReactNode } from "react";

import { useT } from "../../i18n/context";
import { WON_CARD_SHADOW, WON_FONT, WON_INK, WON_LINE, WON_MUTED, WON_SELECT, WON_SURFACE, WON_WASH } from "./tokens";

export function StepCard({
  n,
  of,
  title,
  hint,
  last = false,
  children,
}: {
  n: number;
  /** How many steps the form has ("Krok 2 ze 4" above the title); absent = not said. */
  of?: number;
  title: string;
  hint?: string;
  /** No line under the number: nothing follows. */
  last?: boolean;
  children: ReactNode;
}) {
  const { t } = useT();
  return (
    <div data-won-step={n} style={{ display: "grid", gridTemplateColumns: "36px minmax(0, 1fr)", columnGap: 14, fontFamily: WON_FONT }}>
      <div aria-hidden="true" style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
        <span style={{ width: 36, height: 36, marginTop: 8, borderRadius: 999, display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 15, fontWeight: 700, color: "#fff", background: WON_SELECT, boxShadow: "0 0 0 4px rgba(26,115,232,.14)", flex: "0 0 auto" }}>{n}</span>
        {last ? null : <span style={{ flex: "1 1 auto", width: 2, marginTop: 8, background: "#cfd6de", borderRadius: 2 }} />}
      </div>
      <div style={{ border: `1px solid ${WON_LINE}`, borderRadius: 14, background: WON_SURFACE, boxShadow: WON_CARD_SHADOW, overflow: "hidden", marginBottom: last ? 0 : 18, minWidth: 0 }}>
        <div style={{ padding: "11px 16px", background: WON_WASH, borderBottom: `1px solid ${WON_LINE}` }}>
          {of ? <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase", color: WON_SELECT }}>{t("step.of", { n, of })}</div> : null}
          <div style={{ fontSize: 16, fontWeight: 700, color: WON_INK, letterSpacing: "-0.01em" }}>{title}</div>
          {hint ? <div style={{ marginTop: 2, fontSize: 13, lineHeight: 1.45, color: WON_MUTED }}>{hint}</div> : null}
        </div>
        <div style={{ padding: 16 }}>
          <s-stack direction="block" gap="base">
            {children}
          </s-stack>
        </div>
      </div>
    </div>
  );
}
