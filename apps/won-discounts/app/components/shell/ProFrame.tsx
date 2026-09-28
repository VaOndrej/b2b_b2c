import type { ReactNode } from "react";

import { WON_AMBER, WON_AMBER_TINT, WON_AMBER_TINT_STRONG } from "./tokens";

// Consistent visual marker for a Pro-gated block (doctrine §3g/§16): an amber
// frame + tint, so "this is Pro" reads at a glance. `locked` (merchant on Free)
// deepens the tint. The controls inside stay visible (§16a: locked ≠ hidden);
// the server decides what is actually saved and emitted (BILL-1).
export function ProFrame({ children, locked = false }: { children: ReactNode; locked?: boolean }) {
  return (
    <div
      style={{
        border: `1px solid ${WON_AMBER}`,
        background: locked ? WON_AMBER_TINT_STRONG : WON_AMBER_TINT,
        borderRadius: 12,
        padding: 14,
      }}
    >
      {children}
    </div>
  );
}
