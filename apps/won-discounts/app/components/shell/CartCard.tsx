// One cart, drawn the same way everywhere (13 Oct 2026): the cart the merchant builds by hand on Vyzkoušet košík
// and every cart the app planned itself ("Časté kombinace"). A header that says WHICH cart it is (an eyebrow such
// as "Nejlevnější produkt", a title, a state), the lines with their prices, then the totals on a wash — the three
// parts are separated by lines, the sum is the heaviest thing in the card.

import type { ReactNode } from "react";

import { WON_ATTENTION, WON_CARD_SHADOW, WON_FONT, WON_INK, WON_LINE, WON_MUTED, WON_SELECT, WON_SURFACE, WON_WASH } from "./tokens";

export interface CartCardLine {
  key: string;
  /** "Mikina Won × 2" (with chips beside it where the caller has some). */
  name: ReactNode;
  /** The line's price, as the caller formats it (a struck price beside the new one). */
  price: ReactNode;
  /** Under the line: why it got what it got. */
  extra?: ReactNode;
}

export interface CartCardTotal {
  label: string;
  value: string;
  strong?: boolean;
}

export function CartCard({
  eyebrow,
  title,
  pill,
  tone = "plain",
  note,
  lines,
  after,
  totals,
  footer,
  marker,
  faded = false,
}: {
  /** Which cart this is, in capitals above the title ("Nejlevnější produkt", "Váš košík"). */
  eyebrow: string;
  title?: string;
  /** Its state, at the right of the header. */
  pill?: { label: string; tone: "ok" | "warning" };
  /** "warning": the frame is red-tinted (a cart with something to resolve). */
  tone?: "plain" | "warning";
  /** A sentence above the lines (the market the prices are from). */
  note?: ReactNode;
  lines: readonly CartCardLine[];
  /** Between the lines and the totals: what applies to the order as a whole, what went otherwise. */
  after?: ReactNode;
  totals: readonly CartCardTotal[];
  footer?: ReactNode;
  marker?: Readonly<Record<string, string>>;
  /** The card is the previous cart's (a new result is on its way). */
  faded?: boolean;
}) {
  const warning = tone === "warning";
  return (
    <div
      data-won-cart-card=""
      {...marker}
      style={{ display: "flex", flexDirection: "column", border: `1px solid ${warning ? "#eab5b5" : "#cfd6de"}`, borderRadius: 14, background: WON_SURFACE, boxShadow: WON_CARD_SHADOW, overflow: "hidden", fontFamily: WON_FONT, minWidth: 0, opacity: faded ? 0.6 : 1 }}
    >
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: "6px 10px", padding: "10px 14px", background: warning ? "#fdf1f1" : WON_WASH, borderBottom: `1px solid ${warning ? "#eab5b5" : WON_LINE}` }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase", color: WON_SELECT }}>{eyebrow}</div>
          {title ? <div style={{ fontSize: 14.5, fontWeight: 700, color: WON_INK, overflowWrap: "anywhere" }}>{title}</div> : null}
        </div>
        {pill ? (
          <span style={{ display: "inline-flex", alignItems: "center", padding: "2px 10px", borderRadius: 999, fontSize: 12, fontWeight: 700, flex: "0 0 auto", color: pill.tone === "ok" ? "#0f6b3f" : WON_ATTENTION, background: pill.tone === "ok" ? "#e6f6ed" : "#fbdede" }}>{pill.label}</span>
        ) : null}
      </div>
      <div style={{ padding: "4px 14px 0", flex: "1 1 auto" }}>
        {note ? <div style={{ padding: "8px 0 4px", fontSize: 12.5, color: WON_MUTED }}>{note}</div> : null}
        {lines.map((line, i) => (
          <div key={line.key} data-won-cart-line="" style={{ padding: "9px 0", borderTop: i === 0 && !note ? "none" : `1px solid ${WON_LINE}` }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
              <span style={{ fontSize: 13.5, fontWeight: 600, color: WON_INK, minWidth: 0, overflowWrap: "anywhere" }}>{line.name}</span>
              <span style={{ fontSize: 13.5, color: WON_INK, whiteSpace: "nowrap", marginLeft: "auto" }}>{line.price}</span>
            </div>
            {line.extra}
          </div>
        ))}
        {after ? <div style={{ padding: "9px 0", borderTop: `1px solid ${WON_LINE}` }}>{after}</div> : null}
      </div>
      <div data-won-cart-totals="" style={{ padding: "10px 14px", background: WON_WASH, borderTop: `1px solid ${WON_LINE}`, display: "grid", gap: 3 }}>
        {totals.map((row) => (
          <div key={row.label} style={{ display: "flex", justifyContent: "space-between", gap: 10, fontSize: row.strong ? 15.5 : 13, fontWeight: row.strong ? 700 : 400, color: row.strong ? WON_INK : WON_MUTED, paddingTop: row.strong ? 5 : 0, marginTop: row.strong ? 3 : 0, borderTop: row.strong ? `1px solid ${WON_LINE}` : "none" }}>
            <span>{row.label}</span>
            <span style={{ whiteSpace: "nowrap" }}>{row.value}</span>
          </div>
        ))}
      </div>
      {footer ? <div style={{ padding: "9px 14px", borderTop: `1px solid ${WON_LINE}` }}>{footer}</div> : null}
    </div>
  );
}
