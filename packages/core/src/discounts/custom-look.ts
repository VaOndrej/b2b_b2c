// The Pro custom look of a storefront element (MVP 7, contract M7, decision P5; SEC-3): a few colors and the
// corner radius as CSS variables + the merchant's own CSS. Stored as the merchant typed it (so the admin shows it
// back unchanged); what reaches a page is ALWAYS `customLookCss(look, root)`: the variables as one rule on the
// element's root and the CSS scoped under it (scope-css.ts) — or nothing, when the stored CSS is not acceptable.
// Every element has its own look and its own root (LOOK_ROOT; looks.ts): one element's CSS never styles another.
//
//   sanitizeCustomLook(raw, issues)  the stored form: only known variables with valid values; the CSS as text
//                                    (a string, at most CUSTOM_CSS_MAX_LENGTH; anything else is dropped). The CSS
//                                    is NOT rewritten here — customLookIssue says whether it is acceptable;
//   customLookIssue(look, root)      why the CSS cannot be used (the admin refuses to save it), or null;
//   customLookCss(look, root)        the stylesheet text for the storefront config; "" = nothing to add.
// Free never ships a custom look (plan-gate.ts removes it).

import { pushIssue } from "./config/sanitize-helpers.ts";
import type { ConfigIssue } from "./config/types.ts";
import { CUSTOM_CSS_MAX_LENGTH, scopeCss, type ScopeCssReason } from "./scope-css.ts";

/**
 * The storefront elements with a look of their own: the quantity table, the Milníky ladder, the sale badge, the
 * campaign banner, and the cart panel with the top strip (the frames the ladder and the gifts sit in).
 */
export const LOOK_ELEMENTS = ["tiers", "milestones", "outlet", "campaign", "cart"] as const;
export type LookElement = (typeof LOOK_ELEMENTS)[number];

/** The root each element's look is confined to (the theme app extension's markup). */
export const LOOK_ROOT: Readonly<Record<LookElement, string>> = {
  tiers: ".won-tiers",
  milestones: ".won-ms",
  outlet: ".won-outlet",
  campaign: ".won-campaign",
  cart: ":is(.won-cart,.won-cart-slot,.won-topbar)",
};

/** Variable name in the config → the CSS custom property the elements read (the extension's stylesheets). */
export const CUSTOM_LOOK_VARS = {
  accent: "--won-tiers-accent",
  line: "--won-tiers-line",
  tint: "--won-tiers-tint",
  radius: "--won-tiers-radius",
} as const;

export type CustomLookVar = keyof typeof CUSTOM_LOOK_VARS;

export interface CustomLook {
  /** Colors `#rgb` / `#rrggbb` (accent, line, tint); `radius` in whole px, 0–32. */
  vars: { accent?: string; line?: string; tint?: string; radius?: number };
  /** The merchant's CSS as typed. */
  css: string;
}

/**
 * The ready-made highlight colours of every plan (config/enums.ts ACCENT_PRESETS). Dark enough to read as text on
 * white (the highlighted tier's label is drawn in the accent); the tint behind it is mixed from it in the block's CSS.
 */
export const ACCENT_COLORS: Readonly<Record<string, string>> = {
  green: "#1a7f45",
  blue: "#1a5fd0",
  orange: "#b45309",
  red: "#b42318",
  violet: "#6d28d9",
};

/** The stylesheet text of a ready-made highlight colour: one variable on the element's root; "" = the theme's colour. */
export function accentCss(accent: string | undefined | null, root: string): string {
  const color = typeof accent === "string" ? ACCENT_COLORS[accent] : undefined;
  return color ? `${root}{${CUSTOM_LOOK_VARS.accent}:${color}}` : "";
}

export const CUSTOM_LOOK_RADIUS_MAX = 32;
const COLOR = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

const isRec = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** The stored custom look, or undefined when there is nothing to keep. */
export function sanitizeCustomLook(raw: unknown, issues: ConfigIssue[], path = "storefront.custom"): CustomLook | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (!isRec(raw)) {
    pushIssue(issues, path, "invalid_custom_look", "The custom look was not readable; it was dropped.");
    return undefined;
  }
  const vars: CustomLook["vars"] = {};
  const rawVars = isRec(raw.vars) ? raw.vars : {};
  for (const key of ["accent", "line", "tint"] as const) {
    const value = rawVars[key];
    if (value === undefined || value === null || value === "") continue;
    if (typeof value === "string" && COLOR.test(value.trim())) vars[key] = value.trim().toLowerCase();
    else pushIssue(issues, `${path}.vars.${key}`, "invalid_custom_color", `A custom look color must be #rgb or #rrggbb; ${key} was dropped.`, { field: key });
  }
  if (rawVars.radius !== undefined && rawVars.radius !== null && rawVars.radius !== "") {
    const r = rawVars.radius;
    if (typeof r === "number" && Number.isFinite(r)) vars.radius = Math.min(CUSTOM_LOOK_RADIUS_MAX, Math.max(0, Math.round(r)));
    else pushIssue(issues, `${path}.vars.radius`, "invalid_custom_radius", `The corner radius must be a number of pixels from 0 to ${CUSTOM_LOOK_RADIUS_MAX}; it was dropped.`, { min: 0, max: CUSTOM_LOOK_RADIUS_MAX });
  }
  let css = "";
  if (typeof raw.css === "string") {
    css = raw.css;
    if (css.length > CUSTOM_CSS_MAX_LENGTH) {
      pushIssue(issues, `${path}.css`, "custom_css_too_long", `Custom CSS can have at most ${CUSTOM_CSS_MAX_LENGTH} characters; it was dropped.`, { max: CUSTOM_CSS_MAX_LENGTH, count: css.length });
      css = "";
    }
  } else if (raw.css !== undefined && raw.css !== null) {
    pushIssue(issues, `${path}.css`, "invalid_custom_css", "Custom CSS must be text; it was dropped.");
  }
  if (Object.keys(vars).length === 0 && css.trim() === "") return undefined;
  return { vars, css };
}

/** Why the look's CSS cannot reach a page (scope-css.ts), or null. */
export function customLookIssue(look: Pick<CustomLook, "css"> | undefined | null, root: string): { reason: ScopeCssReason; detail?: string } | null {
  if (!look || look.css.trim() === "") return null;
  const scoped = scopeCss(look.css, root);
  return scoped.ok ? null : { reason: scoped.reason, ...(scoped.detail ? { detail: scoped.detail } : {}) };
}

/**
 * The stylesheet a page gets: the variables on the element's root, then the scoped CSS. A CSS that is not acceptable
 * contributes nothing (the variables still apply). Never contains `<`, `url(`, `@import` (scope-css.ts refuses them;
 * the variables are validated colors and a number).
 */
export function customLookCss(look: CustomLook | undefined | null, root: string): string {
  if (!look) return "";
  const declarations: string[] = [];
  for (const key of ["accent", "line", "tint"] as const) {
    const value = look.vars[key];
    if (typeof value === "string" && COLOR.test(value)) declarations.push(`${CUSTOM_LOOK_VARS[key]}:${value}`);
  }
  if (typeof look.vars.radius === "number" && Number.isFinite(look.vars.radius)) {
    declarations.push(`${CUSTOM_LOOK_VARS.radius}:${Math.min(CUSTOM_LOOK_RADIUS_MAX, Math.max(0, Math.round(look.vars.radius)))}px`);
  }
  const vars = declarations.length > 0 ? `${root}{${declarations.join(";")}}` : "";
  const scoped = look.css.trim() === "" ? null : scopeCss(look.css, root);
  return vars + (scoped?.ok ? scoped.css : "");
}
