// Shared "studio shell" navigator (doctrine §7b): a segmented control that
// switches the visible panel on a config page. One shape everywhere (Toasts /
// Design / Targeting) so the merchant learns a single layout.
//
// It must read as an OBVIOUS interactive control at a glance — a merchant once
// overlooked a plain pill row as static text. So: a grouped, tinted+bordered
// "track" with a raised white active segment (classic segmented control), which
// also reads clearly different from nearby action buttons (e.g. preset buttons).
//
// Native <button> segments on purpose: s-clickable defaults to display:block /
// width:100% and would stretch full-width.

import { PlanBadge } from "./PlanBadge";

export interface SegmentItem {
  key: string;
  label: string;
  /** Pro-gated segment. */
  pro?: boolean;
  /** Feature is currently live. */
  on?: boolean;
}

export function SegmentedNav({
  items,
  selected,
  onSelect,
  ariaLabel = "Sections",
}: {
  items: SegmentItem[];
  selected: string;
  onSelect: (key: string) => void;
  ariaLabel?: string;
}) {
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      style={{
        display: "inline-flex",
        flexWrap: "wrap",
        gap: 4,
        padding: 5,
        background: "#e4e8ee",
        border: "1px solid #cfd5dc",
        borderRadius: 14,
        marginBottom: 18,
        maxWidth: "100%",
        boxShadow: "inset 0 1px 2px rgba(0,0,0,.06)",
      }}
    >
      {items.map((it) => {
        const active = selected === it.key;
        return (
          <button
            key={it.key}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onSelect(it.key)}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: "8px 16px",
              borderRadius: 10,
              border: active ? "1px solid #c4cad2" : "1px solid transparent",
              background: active ? "#ffffff" : "transparent",
              boxShadow: active ? "0 2px 6px rgba(0,0,0,.16)" : "none",
              cursor: "pointer",
              fontFamily: "inherit",
              fontSize: 13.5,
              fontWeight: active ? 700 : 600,
              color: active ? "#111418" : "#586573",
              transition: "background .15s ease, box-shadow .15s ease, color .15s ease",
            }}
          >
            {/* Active tab gets a small accent dot so the selected section is
                unmistakable, not just a subtle background change. */}
            {active ? (
              <span aria-hidden="true" style={{ width: 6, height: 6, borderRadius: 999, background: "#1a73e8", flex: "0 0 auto" }} />
            ) : null}
            <span>{it.label}</span>
            {it.pro ? <PlanBadge tier="pro" /> : null}
            {it.on ? <s-badge tone="success">On</s-badge> : null}
          </button>
        );
      })}
    </div>
  );
}
