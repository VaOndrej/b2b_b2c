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
export const WON_SURFACE = "#ffffff";
/** Neutral wash behind glyphs, summaries and nested blocks. */
export const WON_WASH = "#f5f7f9";
/** Status green — "this is live" (§11d). The ONLY green in the admin. */
export const WON_LIVE = "#1a8f4b";
/** "Needs attention" — see the header comment; the fourth deliberate code. */
export const WON_ATTENTION = "#b42318";
export const WON_CARD_SHADOW = "0 1px 2px rgba(20,28,45,.05), 0 6px 18px rgba(20,28,45,.05)";
