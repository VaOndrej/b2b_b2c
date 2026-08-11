// Pure presentation logic — the "what to show" for a toast, independent of any
// framework or the DOM. The storefront renderer, and the admin live preview,
// both derive their content + colours from here, so preview === storefront.
// (DOM construction differs by host — theme asset vs React — but the presented
// content and style tokens are computed once, here, and covered by shared tests.)

import { resolveFontStack } from "./branding.ts";
import type { ToastCartEvent } from "./cart-events.ts";
import type { ToastAppConfig, ToastSemanticType, ToastTheme } from "./config.types.ts";

export interface ToastPresentation {
  type: ToastSemanticType;
  /** Default label — MVP4 makes these merchant-editable templates. */
  title: string;
  detail: string;
  /** Signed delta text, or "" when not shown. */
  delta: string;
  accent: string;
  showImage: boolean;
  image?: string | null;
}

const CART_TO_SEMANTIC: Record<string, ToastSemanticType> = {
  added: "added",
  removed: "removed",
  increased: "increased",
  decreased: "decreased",
};

const DEFAULT_TITLES: Record<string, string> = {
  added: "Added to cart",
  removed: "Removed",
  increased: "Updated",
  decreased: "Updated",
};

function lineName(line: ToastCartEvent["line"]): string {
  return (
    line.title ||
    (line as { product_title?: string }).product_title ||
    "Item"
  );
}

export function accentFor(theme: ToastTheme, type: ToastSemanticType): string {
  return theme.accent[type] || theme.accent.info || "#4a5568";
}

export function resolveToastPresentation(
  event: ToastCartEvent,
  config: Pick<ToastAppConfig, "theme">,
): ToastPresentation {
  const theme = config.theme;
  const type = CART_TO_SEMANTIC[event.type] ?? "info";
  const showDelta = theme.showDelta && event.type !== "removed";
  const delta = showDelta ? (event.delta > 0 ? "+" : "") + event.delta : "";
  return {
    type,
    title: DEFAULT_TITLES[event.type] ?? "Cart updated",
    detail: lineName(event.line),
    delta,
    accent: accentFor(theme, type),
    showImage: theme.showImage,
    image: event.line.image ?? null,
  };
}

const SHADOWS: Record<ToastTheme["shadow"], string> = {
  none: "none",
  sm: "0 2px 8px rgba(0,0,0,.12)",
  md: "0 6px 24px rgba(0,0,0,.16)",
  lg: "0 12px 40px rgba(0,0,0,.22)",
};

/**
 * Compute the CSS custom properties that style the toast card, from the theme
 * tokens. Returned as a flat map so both the storefront (sets them on the
 * shadow host) and the preview (same) render identically. `system` mode uses
 * light values here; the host adds a prefers-color-scheme override separately.
 */
export function styleTokensFor(theme: ToastTheme): Record<string, string> {
  const isDark = theme.mode === "dark";
  const baseBg =
    theme.mode === "custom" ? theme.colorBg : isDark ? "#1a1f24" : "#ffffff";
  const bg = theme.gradient
    ? `linear-gradient(135deg, ${baseBg}, ${theme.gradientColor})`
    : baseBg;
  const text =
    theme.mode === "custom" ? theme.colorText : isDark ? "#eef1f4" : "#1a1f24";
  const font = resolveFontStack(theme) ?? "inherit";
  return {
    "--won-bg": bg,
    "--won-text": text,
    "--won-font": font,
    "--won-radius": `${theme.cornerRadius}px`,
    "--won-width": `${theme.width}px`,
    "--won-min-width": `${theme.minWidth}px`,
    "--won-max-width": `${theme.maxWidth}px`,
    "--won-gap": `${theme.gap}px`,
    "--won-shadow": SHADOWS[theme.shadow] ?? SHADOWS.md,
    "--won-pad": theme.density === "compact" ? "8px 12px" : "12px 14px",
    "--won-border": theme.border ? `1px solid ${theme.borderColor}` : "0",
    "--won-blur": theme.backdropBlur ? "blur(8px)" : "none",
    "--won-anim-ms": `${theme.animationMs}ms`,
  };
}
