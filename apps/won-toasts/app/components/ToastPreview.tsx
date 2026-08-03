import { useState, type CSSProperties } from "react";

import {
  resolveToastPresentation,
  styleTokensFor,
} from "@won/core/toasts/presentation";
import type { ToastCartEvent } from "@won/core/toasts/cart-events";
import type { ToastTheme } from "@won/core/toasts/config.types";

// Live preview panel. It computes the SAME style tokens + presentation model as
// the storefront (from @won/core/toasts/presentation), so what the merchant sees
// here is what shoppers get. DOM is plain React here vs a Shadow-DOM host on the
// storefront, but the tokens and content are identical.

function line(title: string): ToastCartEvent["line"] {
  return { key: title, variantId: 1, quantity: 1, title };
}
function event(
  type: ToastCartEvent["type"],
  delta: number,
  title: string,
): ToastCartEvent {
  return { type, key: title, variantId: 1, delta, quantity: Math.max(0, delta), line: line(title) };
}

const SCENARIOS: Record<string, ToastCartEvent[]> = {
  "Add 1×": [event("added", 2, "Widget Pro")],
  Remove: [event("removed", -1, "Gadget Mini")],
  "Update qty": [event("increased", 1, "Gizmo Plus")],
  Mixed: [
    event("added", 2, "Widget Pro"),
    event("increased", 1, "Gizmo Plus"),
    event("removed", -1, "Gadget Mini"),
  ],
};

export function ToastPreview({ theme }: { theme: ToastTheme }) {
  const [scenario, setScenario] = useState<keyof typeof SCENARIOS>("Mixed");
  const tokens = styleTokensFor(theme) as CSSProperties;
  const events = SCENARIOS[scenario];

  return (
    <div style={{ position: "sticky", top: 12 }}>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
        {Object.keys(SCENARIOS).map((name) => (
          <button
            key={name}
            type="button"
            onClick={() => setScenario(name)}
            style={{
              border: "1px solid #c9ced4",
              borderRadius: 999,
              padding: "4px 10px",
              background: name === scenario ? "#111" : "#fff",
              color: name === scenario ? "#fff" : "#333",
              cursor: "pointer",
              font: "inherit",
              fontSize: 12,
            }}
          >
            {name}
          </button>
        ))}
      </div>

      <div
        style={{
          ...tokens,
          background:
            theme.mode === "dark" ? "#0f1317" : "#eef1f4",
          borderRadius: 14,
          padding: 18,
          display: "flex",
          flexDirection: "column",
          gap: `var(--won-gap)`,
          minHeight: 180,
        }}
      >
        {events.map((ev, i) => {
          const p = resolveToastPresentation(ev, { theme });
          return (
            <div
              key={i}
              data-won-toast=""
              data-type={ev.type}
              style={{
                boxSizing: "border-box",
                display: "flex",
                gap: 10,
                alignItems: "center",
                width: "var(--won-width)",
                maxWidth: "100%",
                padding: "var(--won-pad)",
                background: "var(--won-bg)",
                color: "var(--won-text)",
                borderRadius: "var(--won-radius)",
                boxShadow: "var(--won-shadow)",
                border: "var(--won-border)",
                borderLeft: `4px solid ${p.accent}`,
                font: "14px/1.35 system-ui, sans-serif",
              }}
            >
              {p.showImage && p.image ? (
                <img
                  src={p.image}
                  alt=""
                  style={{ width: 40, height: 40, borderRadius: 8, objectFit: "cover" }}
                />
              ) : p.showImage ? (
                <div
                  style={{
                    width: 40,
                    height: 40,
                    borderRadius: 8,
                    background: "rgba(127,127,127,.18)",
                    flex: "0 0 auto",
                  }}
                />
              ) : null}
              <div style={{ flex: "1 1 auto", minWidth: 0 }}>
                <div style={{ fontWeight: 700 }}>{p.title}</div>
                <div
                  style={{
                    color: "#8892a0",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {p.detail}
                </div>
              </div>
              {p.delta ? (
                <div data-won-toast-delta="" style={{ fontWeight: 800, color: p.accent }}>
                  {p.delta}
                </div>
              ) : null}
              {ev.type === "removed" ? (
                <button
                  type="button"
                  style={{
                    border: 0,
                    background: "transparent",
                    color: p.accent,
                    fontWeight: 700,
                    textDecoration: "underline",
                    cursor: "pointer",
                  }}
                >
                  Undo
                </button>
              ) : null}
            </div>
          );
        })}
      </div>
      <p style={{ color: "#8892a0", fontSize: 12, marginTop: 8 }}>
        Live preview · same render tokens as the storefront
      </p>
    </div>
  );
}
