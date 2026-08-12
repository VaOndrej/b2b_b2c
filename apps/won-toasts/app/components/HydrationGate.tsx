import { useEffect, useState, type ReactNode } from "react";

// Boolean-heavy forms (Markets, Targeting, Design) briefly flash their App Bridge
// s-checkbox / s-switch web components in their DEFAULT (checked) state before the
// saved values apply — the merchant sees "everything on" for a frame. Gate the
// content's visibility until a couple of frames after mount so that flash isn't
// visible. `visibility` (not `display`) keeps the layout stable — no reflow, no CLS.
export function HydrationGate({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    // Two frames: one for the custom elements to upgrade, one for their values
    // to apply, before we reveal.
    let inner = 0;
    const outer = requestAnimationFrame(() => {
      inner = requestAnimationFrame(() => setReady(true));
    });
    return () => {
      cancelAnimationFrame(outer);
      cancelAnimationFrame(inner);
    };
  }, []);
  return <div style={{ visibility: ready ? "visible" : "hidden" }}>{children}</div>;
}
