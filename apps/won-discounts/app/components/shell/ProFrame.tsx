import { useContext, type ReactNode } from "react";

import { ProMarked } from "./pro-marked";
import { WON_AMBER, WON_AMBER_TINT, WON_AMBER_TINT_STRONG, WON_LINE, WON_WASH } from "./tokens";

// Consistent visual marker for a Pro-gated block (doctrine §3g/§16): an amber
// frame + tint, so "this is Pro" reads at a glance. `locked` (merchant on Free)
// deepens the tint. The controls inside stay visible (§16a: locked ≠ hidden);
// the server decides what is actually saved and emitted (BILL-1).
// Inside a section that already says Pro (§19b: Pro is marked once) the frame
// carries no amber: an unlocked one is not drawn at all, a locked one is a quiet
// grey frame around the form the plan does not run.
export function ProFrame({ children, locked = false }: { children: ReactNode; locked?: boolean }) {
  const marked = useContext(ProMarked);
  if (marked && !locked) return <>{children}</>;
  return (
    <div
      data-won-pro-frame={marked ? "neutral" : "amber"}
      style={{
        border: `1px solid ${marked ? WON_LINE : WON_AMBER}`,
        background: marked ? WON_WASH : locked ? WON_AMBER_TINT_STRONG : WON_AMBER_TINT,
        borderRadius: 12,
        padding: 14,
      }}
    >
      {children}
    </div>
  );
}
