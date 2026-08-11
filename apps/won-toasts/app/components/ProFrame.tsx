import type { ReactNode } from "react";

import { WON_AMBER, WON_AMBER_TINT, WON_AMBER_TINT_STRONG } from "../lib/tokens";

// Consistent visual marker for Pro-gated blocks (doctrine §3g): a subtle Won
// amber frame + tint, so "this is Pro" reads at a glance across every page and
// app — not just a text badge. `locked` (merchant is on Free) deepens the tint.
// Shares the single brand amber token with PlanBadge so they always match.
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
        border: `1px solid ${WON_AMBER}`,
        background: locked ? WON_AMBER_TINT_STRONG : WON_AMBER_TINT,
        borderRadius: 12,
        padding: 16,
      }}
    >
      {children}
    </div>
  );
}
