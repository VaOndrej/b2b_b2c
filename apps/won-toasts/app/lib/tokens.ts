// Single source of truth for WonCommerce brand accents used across the admin UI.
// Polaris owns the rest of the palette; this is only the amber we layer on top
// for plan-gating (Pro/Free). Keeping it in one place means the exact brand hex
// is a one-line change.
//
// NOTE: WON_AMBER is an approximation of the brand goldenrod from merchant
// review; swap for the exact hex when confirmed — every Pro marker updates.
export const WON_AMBER = "#D9A83A";
/** Faint amber wash for Pro surfaces/badges. */
export const WON_AMBER_TINT = "rgba(217, 168, 58, 0.10)";
/** Deeper amber wash for locked (Free-plan) Pro surfaces. */
export const WON_AMBER_TINT_STRONG = "rgba(217, 168, 58, 0.18)";
/** Readable amber text on light backgrounds (the raw amber is too light). */
export const WON_AMBER_TEXT = "#8A6410";

/**
 * Font stack for our hand-styled elements (cards, custom titles) so they match
 * the Polaris admin instead of falling back to the document default (which can
 * render serif). Polaris s-* components own their own type; this keeps our
 * plain <div>s visually consistent with them.
 */
export const WON_FONT =
  'ShopifySans, Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';

// ── Selection accent (§11 — one meaning, one colour) ───────────────────────────
// "This item is chosen/active" has ONE visual language across every picker, kept
// deliberately distinct from WON_AMBER (Pro/plan) and status green (on/off) so a
// merchant never confuses "selected" with "enabled" or "premium".
export const WON_SELECT = "#1a73e8";

/**
 * The shared "this card is selected" ring. Every picker (preset looks, the Toasts
 * launcher, any future one) spreads this so the highlight can't drift into N
 * near-identical copies. `tint` softly fills the card; pass false when the card
 * holds its own coloured content that a blue wash would fight.
 */
export function selectionRing(active: boolean, tint = true): import("react").CSSProperties {
  return {
    border: active ? `2px solid ${WON_SELECT}` : "1px solid #d6dbe1",
    background: active && tint ? "#f2f7ff" : "#ffffff",
    boxShadow: active ? "0 2px 8px rgba(26,115,232,.16)" : "0 1px 2px rgba(0,0,0,.04)",
  };
}

// ── Section shell surface (§17 / A7) ──────────────────────────────────────────
// The one card the whole admin is built from. Kept here, not in the component,
// so a future Won app restyles every section by changing these five values.
export const WON_INK = "#111418";
export const WON_MUTED = "#5b6472";
export const WON_FAINT = "#8892a0";
export const WON_LINE = "#e3e7ec";
export const WON_SURFACE = "#ffffff";
/** Neutral wash behind glyphs, summaries and nested blocks. */
export const WON_WASH = "#f5f7f9";
/** Status green — "this is live" (§11d). The ONLY green in the admin. */
export const WON_LIVE = "#1a8f4b";
export const WON_CARD_SHADOW = "0 1px 2px rgba(20,28,45,.05), 0 6px 18px rgba(20,28,45,.05)";
