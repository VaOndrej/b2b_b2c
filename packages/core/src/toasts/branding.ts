// No-code branding layer — the tier between the on/off toggles and raw Custom
// CSS. Pure helpers shared by the admin previews and mirrored by the storefront
// runtime so a merchant sees exactly what ships. Every option does something
// real (doctrine: no dead toggles).

import type { ToastSemanticType, ToastTheme } from "./config.types.ts";

/** Emoji glyph per semantic event, used when `iconSet` is "emoji". */
export const ICON_EMOJI: Record<ToastSemanticType, string> = {
  added: "🛒",
  removed: "🗑️",
  increased: "➕",
  decreased: "➖",
  gift: "🎁",
  shipping: "🚚",
  discount: "🏷️",
  info: "🔔",
};

const SYSTEM_FONT_STACK =
  'system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';

/**
 * Resolve the CSS `font-family` for a theme, or `null` to inherit the storefront
 * theme's font (no override). "system" = a clean system stack; "inherit-theme" =
 * whatever the shop's theme uses; "custom" = the merchant's own family (falls
 * back to the system stack if they left it blank).
 */
export function resolveFontStack(theme: Pick<ToastTheme, "fontMode" | "fontFamily">): string | null {
  if (theme.fontMode === "inherit-theme") return null;
  if (theme.fontMode === "custom") {
    const fam = (theme.fontFamily ?? "").trim();
    return fam ? fam : SYSTEM_FONT_STACK;
  }
  return SYSTEM_FONT_STACK;
}

/**
 * Resolve the card background: a linear gradient (colorBg → gradientColor) when
 * `gradient` is on, otherwise the flat `colorBg`.
 */
export function resolveBackground(
  theme: Pick<ToastTheme, "gradient" | "colorBg" | "gradientColor">,
): string {
  return theme.gradient
    ? `linear-gradient(135deg, ${theme.colorBg}, ${theme.gradientColor})`
    : theme.colorBg;
}

/**
 * The icon to render for a semantic event given the theme's `showIcon`/`iconSet`.
 * Returns `{ kind: "none" }` (draw nothing), `{ kind: "chip" }` (accent square),
 * or `{ kind: "emoji", glyph }`.
 */
export function resolveIcon(
  theme: Pick<ToastTheme, "showIcon" | "iconSet">,
  semantic: ToastSemanticType,
): { kind: "none" } | { kind: "chip" } | { kind: "emoji"; glyph: string } {
  if (!theme.showIcon || theme.iconSet === "none") return { kind: "none" };
  if (theme.iconSet === "emoji") {
    return { kind: "emoji", glyph: ICON_EMOJI[semantic] ?? ICON_EMOJI.info };
  }
  return { kind: "chip" };
}
