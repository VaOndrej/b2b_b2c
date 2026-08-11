import { WON_AMBER, WON_AMBER_TEXT, WON_AMBER_TINT } from "../lib/tokens";

// The single plan marker used everywhere (doctrine: one component, not three
// look-alikes). Pro = brand amber outline; Free = quiet neutral. Polaris s-badge
// can't be amber (fixed tones), so this is a small styled pill instead — the ONLY
// place Pro/Free is rendered, so it stays consistent across every page.
//
// `tier` is what the marker denotes; `locked` (merchant on Free, feature is Pro)
// switches the label to an upgrade nudge without changing the amber identity.
export function PlanBadge({
  tier,
  locked = false,
  label,
}: {
  tier: "pro" | "free";
  locked?: boolean;
  label?: string;
}) {
  const isPro = tier === "pro";
  const text = label ?? (isPro ? (locked ? "Pro — upgrade" : "Pro") : "Free");
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        fontSize: 11,
        fontWeight: 600,
        lineHeight: 1.4,
        padding: "1px 8px",
        borderRadius: 999,
        whiteSpace: "nowrap",
        border: `1px solid ${isPro ? WON_AMBER : "#C9CDD3"}`,
        color: isPro ? WON_AMBER_TEXT : "#616A75",
        background: isPro ? WON_AMBER_TINT : "transparent",
      }}
    >
      {text}
    </span>
  );
}
