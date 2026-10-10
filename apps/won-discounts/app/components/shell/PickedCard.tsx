// What the merchant PICKED, as a list that reads as one (feedback 10 Oct 2026, 7th round: "mám vybrané kolekce, ale
// nikde se mi nezobrazují" — a picked collection was one grey line of text over two fields). PickedList says what
// the list holds and how many; each picked thing is a PickedCard: a header strip with its place in the list, what
// kind of thing it is ("Kolekce", "Produkt"), its name, what is set for it in a few words, and the button that
// removes it — under the strip its own fields. The same surface as the exceptions of the quantity discounts
// (tiers/ProTierSets.tsx). With nothing picked the list is a dashed place that says what goes there (§15).
// Presentational: the caller owns the hidden inputs and the fields.

import type { ReactNode } from "react";

import { hoverMark } from "./hover";
import { WON_ATTENTION, WON_CARD_SHADOW, WON_FONT, WON_INK, WON_LINE, WON_MUTED, WON_SELECT, WON_SURFACE, WON_WASH } from "./tokens";

export function PickedList({ title, empty, emptyHint, count, children }: { /** "Vybrané kolekce: 2". */ title: string; /** Nothing picked: what the list is for… */ empty: string; /** …and how the first one gets there. */ emptyHint: string; count: number; children: ReactNode }) {
  if (count === 0) {
    return (
      <div data-won-picked-empty="" style={{ padding: "14px 16px", borderRadius: 12, border: "1px dashed #b9c2cc", background: WON_WASH, fontFamily: WON_FONT }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: WON_INK }}>{empty}</div>
        <div style={{ marginTop: 2, fontSize: 13, lineHeight: 1.45, color: WON_MUTED }}>{emptyHint}</div>
      </div>
    );
  }
  return (
    <div data-won-picked="" style={{ display: "grid", gap: 12, fontFamily: WON_FONT }}>
      <div style={{ fontSize: 14, fontWeight: 700, color: WON_INK }}>{title}</div>
      {children}
    </div>
  );
}

export function PickedCard({
  n,
  kind,
  title,
  set,
  action,
  tone,
  marker,
  children,
}: {
  /** Its place in the list (1-based). */
  n: number;
  /** What kind of thing it is, in one word. */
  kind: string;
  title: string;
  /** What is set for it, in a few words; absent = nothing to say. */
  set?: string;
  /** On the right of the strip: the button that removes it. */
  action?: ReactNode;
  tone?: "attention";
  /** `data-*` attributes for tests and deep links. */
  marker?: Record<string, string>;
  children: ReactNode;
}) {
  return (
    <div {...marker} data-won-picked-card="" style={{ border: `1px solid ${WON_LINE}`, borderLeft: tone === "attention" ? `3px solid ${WON_ATTENTION}` : `1px solid ${WON_LINE}`, borderRadius: 12, background: WON_SURFACE, boxShadow: WON_CARD_SHADOW, overflow: "hidden", minWidth: 0 }}>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: "8px 12px", padding: "9px 12px", background: WON_WASH, borderBottom: `1px solid ${WON_LINE}` }}>
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "6px 10px", flex: "1 1 220px", minWidth: 0 }}>
          <span aria-hidden="true" style={{ flex: "0 0 auto", width: 24, height: 24, borderRadius: 999, display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 12.5, fontWeight: 700, color: "#fff", background: "#48525f" }}>
            {n}
          </span>
          <span style={{ flex: "0 0 auto", fontSize: 11, fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase", color: WON_MUTED }}>{kind}</span>
          <span data-won-picked-title="" style={{ fontSize: 14.5, fontWeight: 700, color: WON_INK, overflowWrap: "anywhere", minWidth: 0 }}>{title}</span>
          {set ? (
            <span data-won-picked-set="" style={{ padding: "1px 9px", borderRadius: 999, fontSize: 11.5, fontWeight: 700, lineHeight: 1.5, color: WON_INK, background: WON_SURFACE, border: "1px solid #b9c2cc" }}>
              {set}
            </span>
          ) : null}
        </div>
        {action ? <div style={{ flex: "0 0 auto" }}>{action}</div> : null}
      </div>
      <div style={{ padding: 12 }}>{children}</div>
    </div>
  );
}

/**
 * The way to the NEXT picked thing, at the end of the list (7th round: a small grey button under the cards did not
 * read as "this is how the list grows"): a dashed card the size of the others with a plus, what it adds, and the
 * steps in order — pick, fill in, save — so the workflow is read before the first click. The whole card is the
 * button. `disabled`: said in `note` (the limit is reached, the plan does not run it).
 */
export function PickedAdd({ label, steps, onAdd, disabled = false, note, primary = false }: { label: string; /** What happens, in order ("Vyberete kolekci", "Vyplníte hranice", "Uložíte"). */ steps: readonly string[]; onAdd: () => void; disabled?: boolean; note?: string; /** Nothing is picked yet: the card is the page's main action. */ primary?: boolean }) {
  return (
    <button
      type="button"
      data-won-picked-add=""
      onClick={onAdd}
      disabled={disabled}
      {...(disabled ? {} : hoverMark("card"))}
      style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "10px 14px", width: "100%", padding: "14px 16px", borderRadius: 12, textAlign: "left", font: "inherit", fontFamily: WON_FONT, cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.6 : 1, border: `1.5px dashed ${primary ? WON_SELECT : "#8fa3b8"}`, background: primary ? "#f2f7ff" : WON_SURFACE, boxShadow: "none" }}
    >
      <span aria-hidden="true" style={{ flex: "0 0 auto", width: 36, height: 36, borderRadius: 999, display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 22, lineHeight: 1, fontWeight: 500, color: "#fff", background: WON_SELECT }}>
        +
      </span>
      <span style={{ display: "grid", gap: 4, flex: "1 1 240px", minWidth: 0 }}>
        <span style={{ fontSize: 15, fontWeight: 700, color: WON_INK }}>{label}</span>
        <span style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "4px 8px", fontSize: 12.5, lineHeight: 1.4, color: WON_MUTED }}>
          {steps.map((step, i) => (
            <span key={step} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              {i > 0 ? <span aria-hidden="true">→</span> : null}
              <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 17, height: 17, borderRadius: 999, fontSize: 10.5, fontWeight: 700, color: WON_INK, background: "#e3e7ec" }}>{i + 1}</span>
              {step}
            </span>
          ))}
        </span>
        {note ? <span style={{ fontSize: 12.5, color: WON_MUTED }}>{note}</span> : null}
      </span>
    </button>
  );
}
