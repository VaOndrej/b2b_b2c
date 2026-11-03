// The one status badge of the admin (audit 2026-11-03 D1): a dot and a word in the tone of what it says. What it says
// comes from model/status-badge.ts. `plain`: the card's variant (a sale, a campaign beside its name) — no dot, a
// lighter frame, the same tones. A shell exception of the custom look (README of the audit: colours live in shell/).

import type { CSSProperties } from "react";

import { useT } from "../../i18n/context";
import type { ModuleState } from "../model/module-status";
import type { RuleStatus } from "../model/rule-status";
import { moduleBadge, placementBadge, ruleBadge, switchBadge, type Badge, type BadgeTone, type PlacementState } from "../model/status-badge";
import { WON_ATTENTION, WON_LINE, WON_LIVE, WON_MUTED, WON_SCHEDULED, WON_SCHEDULED_BG, WON_SCHEDULED_EDGE, WON_SURFACE, WON_WASH } from "./tokens";

export const BADGE_COLOR: Readonly<Record<BadgeTone, { text: string; dot: string; background: string; border: string }>> = {
  live: { text: WON_LIVE, dot: WON_LIVE, background: "rgba(26,143,75,.10)", border: "rgba(26,143,75,.28)" },
  attention: { text: WON_ATTENTION, dot: WON_ATTENTION, background: "rgba(180,35,24,.07)", border: "rgba(180,35,24,.3)" },
  // Orange (not the Pro amber): it is there and works, but not where it should be.
  warning: { text: "#B4530A", dot: "#E0700E", background: "rgba(224,112,14,.10)", border: "rgba(224,112,14,.35)" },
  // Light orange, not the Pro amber: it will run on its date.
  scheduled: { text: WON_SCHEDULED, dot: "#F08A3C", background: WON_SCHEDULED_BG, border: WON_SCHEDULED_EDGE },
  neutral: { text: "#5f6b78", dot: "#c3cad2", background: WON_WASH, border: WON_LINE },
};

/** The card variant's colours (only live and neutral are used beside a card's name). */
const PLAIN_COLOR: Readonly<Record<"live" | "neutral", { text: string; background: string; border: string }>> = {
  live: { text: "#1a8f4b", background: "#e6f6ed", border: "#bfe3cd" },
  neutral: { text: WON_MUTED, background: WON_SURFACE, border: WON_LINE },
};

const SHAPE: CSSProperties = { display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11, fontWeight: 700, letterSpacing: ".01em", padding: "2px 9px 2px 7px", borderRadius: 999, whiteSpace: "nowrap" };

export type StatusBadgeProps =
  | { state: ModuleState; status?: never; on?: never; placement?: never; badge?: never }
  | { status: RuleStatus; state?: never; on?: never; placement?: never; badge?: never }
  | { on: boolean; state?: never; status?: never; placement?: never; badge?: never }
  | { placement: PlacementState; move?: boolean; state?: never; status?: never; on?: never; badge?: never }
  | { badge: Badge; plain?: boolean; state?: never; status?: never; on?: never; placement?: never };

/** A module's `state`, a discount's `status`, a switch's `on`, a theme `placement`, or a `badge` already worded. */
export function StatusBadge(props: StatusBadgeProps & { marker?: Record<string, string> }) {
  const tr = useT();
  let badge: Badge | null;
  let marker = props.marker;
  if (props.state !== undefined) {
    badge = moduleBadge(props.state, tr);
    marker = { "data-won-state": props.state, ...marker };
  } else if (props.status !== undefined) badge = ruleBadge(props.status, tr);
  else if (props.on !== undefined) badge = switchBadge(props.on, tr);
  else if (props.placement !== undefined) {
    const placed = placementBadge(props.placement, props.move === true, tr);
    badge = placed;
    marker = { "data-won-placement": placed.marker, ...marker };
  } else badge = props.badge;
  if (!badge) return null;
  if ("plain" in props && props.plain) {
    const color = PLAIN_COLOR[badge.tone === "live" ? "live" : "neutral"];
    return (
      <span {...marker} style={{ fontSize: 11.5, fontWeight: 700, padding: "2px 9px", borderRadius: 999, border: `1px solid ${color.border}`, background: color.background, color: color.text }}>
        {badge.label}
      </span>
    );
  }
  const color = BADGE_COLOR[badge.tone];
  return (
    <span {...marker} style={{ ...SHAPE, color: color.text, background: color.background, border: `1px solid ${color.border}` }}>
      <span aria-hidden="true" style={{ width: 6, height: 6, borderRadius: 999, background: color.dot, flex: "0 0 auto" }} />
      {badge.label}
    </span>
  );
}
