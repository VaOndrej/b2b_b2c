// A short heading on the page's own ground and a list to pick from: an icon, a name, what it is, an arrow. The same
// shape as "Vyberte typ slevy" in Shopify (Ondřej, 31 Oct 2026), used for "Nová sleva" and "Nový stupeň".

import type { ReactNode } from "react";

import { hoverMark } from "./hover";
import { WON_EDGE, WON_FAINT, WON_FONT, WON_INK, WON_LINE, WON_MUTED, WON_SURFACE, WON_WASH } from "./tokens";

const ICONS = {
  percent: (
    <>
      <path d="M13.5 4.5l-9 9" />
      <circle cx="5.5" cy="5.5" r="2" />
      <circle cx="12.5" cy="12.5" r="2" />
    </>
  ),
  coin: (
    <>
      <circle cx="9" cy="9" r="6.5" />
      <path d="M11.3 6.5c-.5-.7-1.3-1-2.3-1-1.4 0-2.5.8-2.5 2s1 1.6 2.5 1.8 2.5.7 2.5 1.9-1.1 2-2.5 2c-1 0-1.8-.3-2.3-1" />
    </>
  ),
  truck: (
    <>
      <path d="M2 5h9v8H2zM11 8h3l2 2.500V13h-5z" />
      <circle cx="5.5" cy="13.5" r="1.3" />
      <circle cx="13" cy="13.5" r="1.3" />
    </>
  ),
  ticket: (
    <>
      <path d="M2.5 5.500h13v2.200a1.5 1.5 0 000 2.600v2.200h-13v-2.200a1.5 1.5 0 000-2.600z" />
      <path d="M11 5.500v7" />
    </>
  ),
  pen: <path d="M3 15l.8-3.2 8-8 2.4 2.4-8 8zM10.5 5l2.4 2.4" />,
  gift: (
    <>
      <path d="M3 7.500h12V10H3zM4 10v5.500h10V10M9 7.500v8" />
      <path d="M9 7.500c-2.5 0-4-1-4-2.300S6.8 3 9 7.500c2.2-4.5 4-3.6 4-2.300s-1.5 2.3-4 2.300z" />
    </>
  ),
} as const;

export type PickIcon = keyof typeof ICONS;

export interface PickItem {
  key: string;
  icon: PickIcon;
  title: string;
  body: string;
  /** Leads somewhere; without it the row is a button (`onPick`). */
  href?: string;
  onPick?: () => void;
  disabled?: boolean;
  marker?: Record<string, string>;
}

export function PlainHead({ title, sub, id, children }: { title: string; sub?: string; id?: string; children?: ReactNode }) {
  return (
    <div id={id} style={{ display: "flex", flexWrap: "wrap", alignItems: "baseline", gap: "2px 10px", marginBottom: 12, fontFamily: WON_FONT, scrollMarginTop: 16 }}>
      <h2 style={{ margin: 0, fontSize: 17, fontWeight: 700, letterSpacing: "-.01em", color: WON_INK }}>{title}</h2>
      {sub ? <span style={{ fontSize: 13, color: WON_MUTED }}>{sub}</span> : null}
      {children}
    </div>
  );
}

function Row({ item, first }: { item: PickItem; first: boolean }) {
  return (
    <div {...hoverMark("line", item.disabled === true)} {...item.marker} style={{ display: "flex", alignItems: "center", gap: 12, padding: "11px 16px", borderTop: first ? "none" : `1px solid ${WON_LINE}`, opacity: item.disabled ? 0.55 : 1, textAlign: "left" }}>
      <span aria-hidden="true" style={{ display: "grid", placeItems: "center", width: 34, height: 34, flex: "0 0 auto", borderRadius: 9, background: WON_WASH, color: "#3d4552" }}>
        <svg viewBox="0 0 18 18" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          {ICONS[item.icon]}
        </svg>
      </span>
      <span style={{ flex: "1 1 auto", minWidth: 0, display: "grid", gap: 1 }}>
        <span style={{ fontSize: 14.5, fontWeight: 600, letterSpacing: "-.01em", color: WON_INK }}>{item.title}</span>
        <span style={{ fontSize: 13, color: WON_MUTED }}>{item.body}</span>
      </span>
      <svg aria-hidden="true" viewBox="0 0 14 14" width="14" height="14" fill="none" stroke={WON_FAINT} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{ flex: "0 0 auto" }}>
        <path d="M5 2.500L9.5 7 5 11.5" />
      </svg>
    </div>
  );
}

export function PickList({ items }: { items: readonly PickItem[] }) {
  return (
    <div data-won-pick-list="" style={{ border: `1px solid ${WON_EDGE}`, borderRadius: 12, overflow: "hidden", background: WON_SURFACE, fontFamily: WON_FONT }}>
      {items.map((item, i) =>
        item.href ? (
          <s-clickable key={item.key} href={item.href}>
            <Row item={item} first={i === 0} />
          </s-clickable>
        ) : (
          <button key={item.key} type="button" disabled={item.disabled} onClick={item.onPick} style={{ all: "unset", display: "block", width: "100%", boxSizing: "border-box", cursor: item.disabled ? "default" : "pointer" }}>
            <Row item={item} first={i === 0} />
          </button>
        ),
      )}
    </div>
  );
}
