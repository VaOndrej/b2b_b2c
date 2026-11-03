// The surfaces a screen composes instead of styling its own boxes (audit 2026-11-03 D1, D2, first step of the
// expand–contract): a card, a choice that can be picked, two columns with a preview. Colours come from tokens.ts only.
//
// The exceptions of the custom look live HERE and in the other shell pieces, nowhere else (README of the audit,
// decided by Ondřej 2026-11-03; Polaris backgrounds are only transparent / subdued / base / strong):
//   - amber Pro surface (Card tone="pro", ProSell, PlanBadge),
//   - the red frame of a card that needs attention (Card tone="attention"),
//   - the blue frame and tint of a chosen thing (Card selected, selectableStyle),
//   - the light orange of "Naplánováno" (Card tone="scheduled", StatusBadge),
//   - clickable tiles (ModuleTile, ViewTile) and the segmented choice (SegmentedChoice): raw buttons, because Polaris
//     has no tile and no segmented control.
// Everything else on a screen is an `s-*` component.

import type { CSSProperties, ReactNode } from "react";

import {
  WON_AMBER,
  WON_AMBER_TINT,
  WON_ATTENTION_EDGE,
  WON_CARD_SHADOW,
  WON_CONTROL_EDGE,
  WON_DASH,
  WON_FONT,
  WON_LINE,
  WON_SCHEDULED_BG,
  WON_SCHEDULED_EDGE,
  WON_SELECT,
  WON_SELECT_RING,
  WON_SELECT_TINT,
  WON_SURFACE,
  WON_WASH,
} from "./tokens";

export type CardTone = "plain" | "quiet" | "attention" | "pro" | "scheduled" | "dashed";

const TONE: Readonly<Record<CardTone, CSSProperties>> = {
  plain: { background: WON_SURFACE, border: `1px solid ${WON_LINE}` },
  quiet: { background: WON_WASH, border: `1px solid ${WON_LINE}` },
  attention: { background: WON_SURFACE, border: `1px solid ${WON_ATTENTION_EDGE}` },
  pro: { background: WON_AMBER_TINT, border: `1px solid ${WON_AMBER}` },
  scheduled: { background: WON_SCHEDULED_BG, border: `1px solid ${WON_SCHEDULED_EDGE}` },
  dashed: { background: WON_SURFACE, border: `1px dashed ${WON_DASH}` },
};

/** The look of a thing that can be chosen: blue ring and tint when it is (§11b), a quiet edge when it is not. */
export function selectableStyle(on: boolean): CSSProperties {
  return {
    border: `${on ? 2 : 1}px solid ${on ? WON_SELECT : WON_CONTROL_EDGE}`,
    background: on ? WON_SELECT_TINT : WON_SURFACE,
    boxShadow: on ? `0 0 0 3px ${WON_SELECT_RING}` : WON_CARD_SHADOW,
  };
}

/**
 * A box of content: a list's row group, a sample, a note. `tone` says what it is (see the exceptions above);
 * `selected` draws the chosen look over any tone. Layout (gap, padding) is the caller's; colour never is.
 */
export function Card({
  tone = "plain",
  selected = false,
  padding = 14,
  radius = 12,
  marker,
  style,
  children,
}: {
  tone?: CardTone;
  selected?: boolean;
  padding?: CSSProperties["padding"];
  radius?: number;
  marker?: Record<string, string>;
  /** Layout only (display, gap, grid…); a colour here is the lint's business. */
  style?: CSSProperties;
  children?: ReactNode;
}) {
  return (
    <div {...marker} style={{ ...TONE[tone], ...(selected ? selectableStyle(true) : null), borderRadius: radius, padding, fontFamily: WON_FONT, minWidth: 0, ...style }}>
      {children}
    </div>
  );
}

/**
 * Two columns: the settings and, beside them, what the customer sees (a preview). One column on a narrow screen,
 * the preview first or last as `asideFirst` says.
 */
export function TwoColumns({ main, aside, asideFirst = false, min = 320, gap = 16 }: { main: ReactNode; aside: ReactNode; asideFirst?: boolean; min?: number; gap?: number }) {
  return (
    <div data-won-two-columns="" style={{ display: "grid", gridTemplateColumns: `repeat(auto-fit, minmax(min(100%, ${min}px), 1fr))`, gap, alignItems: "start" }}>
      {asideFirst ? aside : main}
      {asideFirst ? main : aside}
    </div>
  );
}
