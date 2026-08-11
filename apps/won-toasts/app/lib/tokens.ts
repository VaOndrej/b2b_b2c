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
