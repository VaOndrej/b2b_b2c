// Surface and meaning tokens for the Won Discounts admin (copied from the Won
// Toasts shell, doctrine A7: restyling the whole admin is a change to these few
// values, not a sweep through screens).
//
// One meaning, one colour (§11a):
//   blue  = selected / active   (WON_SELECT)
//   amber = Pro / plan          (WON_AMBER*)  — the ONLY plan signal (§16b)
//   green = live / on           (WON_LIVE)    — the ONLY green
//   red   = needs attention     (WON_ATTENTION) — the deliberate fourth code: a
//           discount that silently does not run somewhere (missing currency value,
//           a code rule without a code). Never used for decoration.
//   orange = waits for its date  (WON_SCHEDULED*) — a discount that will run; lighter than and never the Pro amber.
// One exception to blue (Ondřej, 30 Oct 2026): the name badge of a home tile (WON_BADGE*), a label, not a selection.

export const WON_AMBER = "#D9A83A";
/** Faint amber wash for Pro surfaces/badges. */
export const WON_AMBER_TINT = "rgba(217, 168, 58, 0.10)";
/** Deeper amber wash for locked (Free-plan) Pro surfaces. */
export const WON_AMBER_TINT_STRONG = "rgba(217, 168, 58, 0.18)";
/** Readable amber text on light backgrounds (the raw amber is too light). */
export const WON_AMBER_TEXT = "#8A6410";

/** Font stack for hand-styled elements, matching the Polaris admin. */
export const WON_FONT =
  'ShopifySans, Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';

export const WON_SELECT = "#1a73e8";

/** The shared "this option is selected" treatment (§11b: one source, never re-typed). */
export function selectionRing(active: boolean, tint = true): import("react").CSSProperties {
  return {
    // The chosen one is drawn two pixels thick WITHOUT growing: one pixel of border and one of inset shadow. A
    // thicker border made the card narrower inside, so its text wrapped differently once picked (7th round).
    border: `1px solid ${active ? WON_SELECT : "#d6dbe1"}`,
    background: active && tint ? "#f2f7ff" : "#ffffff",
    boxShadow: active ? `inset 0 0 0 1px ${WON_SELECT}, 0 2px 8px rgba(26,115,232,.16)` : "0 1px 2px rgba(0,0,0,.04)",
  };
}

// ── Section shell surface (§17 / A7) ──────────────────────────────────────────
export const WON_INK = "#111418";
export const WON_MUTED = "#5b6472";
export const WON_FAINT = "#8892a0";
export const WON_LINE = "#e3e7ec";
/** The outline of a home tile and the line between its groups: darker than WON_LINE, so a tile reads as one object. */
export const WON_EDGE = "#cfd5dc";
/** The name badge of a home tile. */
export const WON_BADGE = "#e3efff";
export const WON_BADGE_TEXT = "#0f4fa8";
export const WON_SURFACE = "#ffffff";
/** Neutral wash behind glyphs, summaries and nested blocks. */
export const WON_WASH = "#f5f7f9";
/** Status green — "this is live" (§11d). The ONLY green in the admin. */
export const WON_LIVE = "#1a8f4b";
/** "Needs attention" — see the header comment; the fourth deliberate code. */
export const WON_ATTENTION = "#b42318";
/** "Naplánováno": a light orange that must not read as the Pro amber. */
export const WON_SCHEDULED = "#B4530A";
export const WON_SCHEDULED_BG = "#FFF1E6";
export const WON_SCHEDULED_EDGE = "#FBD3B0";
export const WON_CARD_SHADOW = "0 1px 2px rgba(20,28,45,.05), 0 6px 18px rgba(20,28,45,.05)";

// --- Named shades the screens used as raw values (audit 2026-11-03 D1): one name per meaning, so a screen composes
// shell pieces and tokens and never types a colour. The values are the ones the screens had, so nothing looks different.

/** A chosen thing's tint and its ring (selection, §11b). */
export const WON_SELECT_TINT = "#f2f7ff";
export const WON_SELECT_EDGE = "#c7dcfb";
export const WON_SELECT_RING = "rgba(26,115,232,.12)";
export const WON_SELECT_FOCUS = "rgba(26,115,232,.15)";
/** The edge of a control that can be picked but is not (a chip, a card choice). */
export const WON_CONTROL_EDGE = "#d6dbe1";
/** A stronger control edge (a hover, a preview's frame) and the dashed "add here" outline. */
export const WON_CONTROL_EDGE_STRONG = "#c9d0d8";
export const WON_DASH = "#b9c2cc";
/** Text and marks on a dark or coloured fill (a numbered step, a filled chip). */
export const WON_ON_FILL = "#ffffff";
/** A neutral dark fill (an unselected numbered mark, a bar in a chart). */
export const WON_FILL_NEUTRAL = "#48525f";
/** Light neutral fills: a track, a chip, a quiet panel. */
export const WON_TRACK = "#e9edf1";
export const WON_CHIP = "#eef1f4";
export const WON_PANEL = "#f1f1f1";
/** The near-white of an open row and of a dense list's background. */
export const WON_ROW_OPEN = "#fafbfc";
export const WON_LIST_BG = "#fbfcfd";
/** The plain divider of Polaris-like tables (Přehledy, a look's code box). */
export const WON_DIVIDER = "#e3e3e3";
/** The red-tinted edge of a row that needs attention (a sale that waits for a decision). */
export const WON_ATTENTION_EDGE = "#eab5b5";
/** The quiet green of "it is on" inside a sentence (a combination that applies, a sale's yes). */
export const WON_LIVE_TEXT = "#0f6b3f";
export const WON_LIVE_TINT = "#e6f6ed";
export const WON_LIVE_EDGE = "#bfe3cd";
/** A storefront sample's own ink and paper (a preview shows the theme, not the admin). */
export const WON_SAMPLE_INK = "#121212";
export const WON_SAMPLE_PAPER = "#ffffff";
/** A chart's accent (Přehledy). */
export const WON_CHART = "#2f6fed";
/** The sample colour a colour field suggests. */
export const WON_SAMPLE_ACCENT = "#0a7d4f";
