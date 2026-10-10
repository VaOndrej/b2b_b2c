// A card INSIDE a section: one thing with its own header strip (a name, a label, a button) and its own body, so a
// section that holds several things does not read as one flat list (feedback 10 Oct 2026, 6th round: "celé flat,
// nepřehledné a zmixované dohromady"). The strip is the neutral wash, the body white with a soft shadow.
//   - `tone="attention"`: something to resolve inside (a red left edge, never a red surface);
//   - `footer`: a second strip under the body for what is edited in place (a form opened by a button).
// ChoiceCard is the same surface for a choice to click (a radio or a checkbox with a title and one sentence).

import type { CSSProperties, ReactNode } from "react";

import { WON_ATTENTION, WON_CARD_SHADOW, WON_FONT, WON_INK, WON_LINE, WON_MUTED, WON_SELECT, WON_SURFACE, WON_WASH } from "./tokens";

export function SubCard({
  title,
  label,
  action,
  tone,
  footer,
  marker,
  children,
}: {
  title: ReactNode;
  /** Beside the title: a state pill or a count. */
  label?: ReactNode;
  /** On the right of the strip: the card's button(s). */
  action?: ReactNode;
  tone?: "attention";
  footer?: ReactNode;
  /** `data-*` attributes for tests and deep links. */
  marker?: Record<string, string>;
  children?: ReactNode;
}) {
  return (
    <div
      {...marker}
      data-won-subcard=""
      style={{ border: `1px solid ${WON_LINE}`, borderLeft: tone === "attention" ? `3px solid ${WON_ATTENTION}` : `1px solid ${WON_LINE}`, borderRadius: 12, background: WON_SURFACE, boxShadow: WON_CARD_SHADOW, overflow: "hidden", fontFamily: WON_FONT, minWidth: 0 }}
    >
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: "6px 12px", padding: "9px 14px", background: WON_WASH, borderBottom: children ? `1px solid ${WON_LINE}` : "none" }}>
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "4px 10px", minWidth: 0 }}>
          <span style={{ fontSize: 13.5, fontWeight: 700, color: WON_INK, letterSpacing: "-0.005em", overflowWrap: "anywhere" }}>{title}</span>
          {label}
        </div>
        {action ? <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>{action}</div> : null}
      </div>
      {children ? <div style={{ padding: 14, display: "grid", gap: 12 }}>{children}</div> : null}
      {footer ? <div style={{ padding: 14, background: WON_WASH, borderTop: `1px solid ${WON_LINE}` }}>{footer}</div> : null}
    </div>
  );
}

/** The surface of a choice to click: blue ring and tint when chosen (§11b selectionRing's look, with room for content). */
export function choiceCardStyle(on: boolean, disabled = false): CSSProperties {
  return {
    display: "grid",
    gridTemplateColumns: "auto minmax(0, 1fr)",
    gap: "2px 10px",
    alignItems: "start",
    padding: on ? 13 : 14,
    borderRadius: 12,
    cursor: disabled ? "default" : "pointer",
    border: `${on ? 2 : 1}px solid ${on ? WON_SELECT : "#d6dbe1"}`,
    background: on ? "#f2f7ff" : WON_SURFACE,
    boxShadow: on ? "0 0 0 3px rgba(26,115,232,.12)" : WON_CARD_SHADOW,
    fontFamily: WON_FONT,
    opacity: disabled ? 0.7 : 1,
  };
}

/** A yes / no mark with a name: what applies and what does not, read at a glance (never colour alone: ✓ / ✕). */
export function YesNo({ yes, children }: { yes: boolean; children: ReactNode }) {
  return (
    <span data-won-yesno={yes ? "yes" : "no"} style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "3px 10px 3px 6px", borderRadius: 999, fontFamily: WON_FONT, fontSize: 12.5, fontWeight: 600, lineHeight: 1.4, color: yes ? WON_INK : WON_MUTED, background: yes ? "#e6f6ed" : WON_WASH, border: `1px solid ${yes ? "#bfe3cd" : WON_LINE}` }}>
      <span aria-hidden="true" style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 16, height: 16, borderRadius: 999, fontSize: 10.5, fontWeight: 700, color: "#fff", background: yes ? "#1a8f4b" : "#8892a0" }}>
        {yes ? "✓" : "✕"}
      </span>
      <span style={yes ? undefined : { textDecoration: "line-through" }}>{children}</span>
    </span>
  );
}
