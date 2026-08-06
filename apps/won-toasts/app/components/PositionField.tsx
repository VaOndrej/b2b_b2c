import { useRef, useState } from "react";

const ROWS = ["top", "middle", "bottom"] as const;
const COLS = ["left", "center", "right"] as const;

// Human names for the position enum (doctrine §4c — no raw "top-right" in a
// label, aria-label or the readout).
const ROW_LABEL: Record<string, string> = { top: "Top", middle: "Middle", bottom: "Bottom" };
const COL_LABEL: Record<string, string> = { left: "left", center: "centre", right: "right" };
function positionLabel(v: string): string {
  const [row, col] = v.split("-");
  return `${ROW_LABEL[row] ?? row} ${COL_LABEL[col] ?? col}`;
}

// Visual position picker: a dummy storefront screen with 9 clickable zones.
// The selected zone shows a mock toast so the merchant sees *where* it lands
// instead of reading "top-right" from a dropdown. Posts `position` via a hidden
// input; dispatching an input event lets the App Bridge save bar detect the
// change like any other field.
export function PositionField({
  name,
  defaultValue,
}: {
  name: string;
  defaultValue: string;
}) {
  const [value, setValue] = useState(defaultValue);
  const inputRef = useRef<HTMLInputElement>(null);

  function choose(next: string) {
    setValue(next);
    const el = inputRef.current;
    if (el) {
      el.value = next;
      el.dispatchEvent(new Event("input", { bubbles: true }));
    }
  }

  return (
    <div>
      <div style={{ marginBottom: 8, fontSize: 13, fontWeight: 600 }}>
        Position
      </div>
      <input ref={inputRef} type="hidden" name={name} defaultValue={defaultValue} />

      <div
        style={{
          position: "relative",
          width: "100%",
          maxWidth: 340,
          aspectRatio: "16 / 10",
          border: "1px solid #c9ced4",
          borderRadius: 12,
          background: "#f6f7f9",
          overflow: "hidden",
        }}
      >
        {/* Mock storefront chrome — a header bar and a product grid hint. */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            padding: 12,
            display: "flex",
            flexDirection: "column",
            gap: 8,
            pointerEvents: "none",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <div style={{ width: 14, height: 14, borderRadius: 4, background: "#d3d8de" }} />
            <div style={{ height: 6, width: 64, borderRadius: 3, background: "#e2e6ea" }} />
            <div style={{ marginLeft: "auto", height: 6, width: 34, borderRadius: 3, background: "#e2e6ea" }} />
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr 1fr",
              gap: 6,
              flex: 1,
            }}
          >
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} style={{ borderRadius: 6, background: "#eceef1" }} />
            ))}
          </div>
        </div>

        {/* 3×3 clickable zones over the mock screen. */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "grid",
            gridTemplateColumns: "1fr 1fr 1fr",
            gridTemplateRows: "1fr 1fr 1fr",
          }}
        >
          {ROWS.flatMap((row) =>
            COLS.map((col) => {
              const v = `${row}-${col}`;
              const active = v === value;
              return (
                <button
                  key={v}
                  type="button"
                  onClick={() => choose(v)}
                  aria-label={positionLabel(v)}
                  aria-pressed={active}
                  style={{
                    display: "flex",
                    justifyContent:
                      col === "left"
                        ? "flex-start"
                        : col === "right"
                          ? "flex-end"
                          : "center",
                    alignItems:
                      row === "top"
                        ? "flex-start"
                        : row === "bottom"
                          ? "flex-end"
                          : "center",
                    padding: 8,
                    border: 0,
                    background: "transparent",
                    cursor: "pointer",
                  }}
                >
                  {active ? (
                    <span
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 4,
                        width: 52,
                        height: 17,
                        paddingLeft: 5,
                        borderRadius: 5,
                        background: "#1a1a1a",
                        boxShadow: "0 2px 6px rgba(0,0,0,.28)",
                      }}
                    >
                      <span style={{ width: 5, height: 5, borderRadius: 999, background: "#4ade80" }} />
                      <span style={{ height: 4, width: 26, borderRadius: 2, background: "#5b6169" }} />
                    </span>
                  ) : (
                    <span style={{ width: 8, height: 8, borderRadius: 999, background: "#c9ced4" }} />
                  )}
                </button>
              );
            }),
          )}
        </div>
      </div>
      <div style={{ marginTop: 6, fontSize: 12, color: "#6b7280" }}>{positionLabel(value)}</div>
    </div>
  );
}
