import { useT } from "../../i18n/context";
import { WON_AMBER, WON_AMBER_TEXT, WON_AMBER_TINT } from "./tokens";

// The single plan marker (doctrine §16b, one component, not three look-alikes).
// Pro = brand amber outline; Free = quiet neutral. Polaris s-badge can't be
// amber, so this small styled pill is the ONLY place a plan is rendered.
// `locked` (merchant on Free, feature is Pro) turns the label into a nudge
// without changing the amber identity. `href` (optional) makes the pill a link
// — "Pro · odemknout" then really leads to the plan (§13b: a lock is never a dead end).
export function PlanBadge({ tier, locked = false, href }: { tier: "pro" | "free"; locked?: boolean; href?: string }) {
  const { t } = useT();
  const isPro = tier === "pro";
  const text = isPro ? (locked ? t("common.proLocked") : t("common.pro")) : t("common.free");
  const pill = (
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
  return href ? <s-link href={href}>{pill}</s-link> : pill;
}
