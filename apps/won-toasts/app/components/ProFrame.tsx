import type { ReactNode } from "react";

// Consistent visual marker for Pro-gated blocks (doctrine §3g): a subtle Won
// amber frame + tint, so "this is Pro" reads at a glance across every page and
// app — not just a text badge. `locked` (merchant is on Free) deepens the tint.
const AMBER = "#C8912A";

export function ProFrame({
  children,
  locked = false,
}: {
  children: ReactNode;
  locked?: boolean;
}) {
  return (
    <div
      style={{
        border: `1px solid ${AMBER}`,
        background: locked ? "rgba(200,145,42,0.10)" : "rgba(200,145,42,0.05)",
        borderRadius: 12,
        padding: 16,
      }}
    >
      {children}
    </div>
  );
}
