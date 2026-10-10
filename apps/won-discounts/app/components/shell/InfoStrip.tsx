// "Jen přehled": the strip at the top of a panel that only SHOWS something (which discounts the protection
// lowers, which products have no cost price). It says in one line that nothing is switched on or saved here and
// what the numbers are for, so the merchant does not look for a switch (feedback 10 Oct 2026, 6th round).
// Neutral on purpose: not a state (green), not a problem (red), not a plan (amber).

import type { ReactNode } from "react";

import { WON_FONT, WON_INK, WON_MUTED } from "./tokens";

export function InfoStrip({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div data-won-info-strip="" style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "6px 10px", padding: "9px 12px", borderRadius: 10, background: "#eef1f4", border: "1px solid #d6dbe1", fontFamily: WON_FONT, fontSize: 13, lineHeight: 1.45, color: WON_MUTED }}>
      <span style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "1px 9px", borderRadius: 999, background: "#ffffff", border: "1px solid #d6dbe1", fontSize: 11.5, fontWeight: 700, color: WON_INK, whiteSpace: "nowrap" }}>
        <span aria-hidden="true" style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 13, height: 13, borderRadius: 999, background: WON_INK, color: "#fff", fontSize: 9.5, fontWeight: 700 }}>
          i
        </span>
        {label}
      </span>
      <span style={{ minWidth: 0 }}>{children}</span>
    </div>
  );
}
