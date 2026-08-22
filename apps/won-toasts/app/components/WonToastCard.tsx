import type { CSSProperties } from "react";

import { resolveIcon } from "@won/core/toasts/branding";
import type { ToastSemanticType, ToastTheme } from "@won/core/toasts/config.types";

// The ONE toast card renderer (Wave-0 decision: "shared layer so the preview is
// identical everywhere"). Every preview surface — the static panel preview, the
// animated loop, and the to-scale storefront frame — renders this, so a toast
// looks byte-for-byte the same wherever the merchant sees it. It reads the same
// --won-* CSS variables the storefront host sets, so tokens stay the single
// source of truth.
//
// `size` is the only visual fork: "md" for the roomy config-panel previews,
// "sm" for the scaled-down storefront frame where many cards share a narrow
// column. Behavioural props (leaving/animName) let the animated surface drive
// enter/leave without duplicating the card body.

export interface WonToastCardProps {
  theme: ToastTheme;
  type: ToastSemanticType;
  title: string;
  detail: string;
  delta?: string;
  accent: string;
  /** Real product image (panel previews); falls back to a neutral square. */
  image?: string | null;
  closeable?: boolean;
  /** Show an Undo affordance (removed cart events). */
  undo?: boolean;
  size?: "sm" | "md";
  /** Toast TYPE (cart / countdown / announcement …) — emitted as data-won-type so
   * the merchant's `[data-won-type="cart"]` custom CSS affects the preview exactly
   * as it does the storefront (which sets the same attribute). Defaults to "cart"
   * because every current preview surface shows cart toasts. */
  wonType?: string;
  /**
   * Whether this surface draws the event icon at all. Defaults to following the
   * theme (`resolveIcon`), which is right for CART toasts. Pass `false` for
   * surfaces the storefront renders WITHOUT an icon — milestone and notification
   * cards go through `renderMilestoneToast` / `notifCard` in
   * storefront-src/won-toasts.js, and neither calls `iconFor()`. Showing one in
   * the preview would be a difference between preview and storefront, i.e. a bug
   * by A1.
   */
  icon?: boolean;
  /** Enter animation keyframe name; omit for no enter animation. */
  animName?: string;
  /** Collapsing/leaving state for the animated surface. */
  leaving?: boolean;
}

export function WonToastCard({
  theme,
  type,
  title,
  detail,
  delta,
  accent,
  image,
  closeable,
  undo,
  size = "md",
  wonType = "cart",
  icon = true,
  animName,
  leaving,
}: WonToastCardProps) {
  const sm = size === "sm";
  const imgPx = sm ? 26 : 40;

  const style: CSSProperties = {
    boxSizing: "border-box",
    display: "flex",
    gap: sm ? 8 : 10,
    alignItems: "center",
    width: sm ? "100%" : "var(--won-width)",
    maxWidth: "100%",
    padding: sm ? "8px 9px" : "var(--won-pad)",
    background: "var(--won-bg)",
    color: "var(--won-text)",
    borderRadius: "var(--won-radius)",
    boxShadow: "var(--won-shadow)",
    // Per-side longhand (not `border` shorthand) so the accent borderLeft never
    // conflicts with the frame — mixing the two triggers a React styling warning.
    borderTop: "var(--won-border)",
    borderRight: "var(--won-border)",
    borderBottom: "var(--won-border)",
    borderLeft: `${sm ? 3 : 4}px solid ${accent}`,
    fontSize: sm ? 12 : 14,
    lineHeight: sm ? 1.3 : 1.35,
    fontFamily: "var(--won-font)",
  };

  // Enter/leave animation (animated surface only). Kept here so the animation is
  // identical wherever a card animates.
  if (animName) {
    style.animation = `${animName} .42s cubic-bezier(.16,1,.3,1)`;
    style.opacity = leaving ? 0 : 1;
    style.transform = leaving ? "translateX(14px) scale(.97)" : "none";
    style.maxHeight = leaving ? 0 : 80;
    style.paddingTop = leaving ? 0 : undefined;
    style.paddingBottom = leaving ? 0 : undefined;
    style.overflow = "hidden";
    style.transition =
      "opacity .3s ease, transform .3s cubic-bezier(.16,1,.3,1), max-height .32s ease, padding .32s ease";
  }

  const ic = resolveIcon(theme, type);

  return (
    <div data-won-toast="" data-type={type} data-won-type={wonType} style={style}>
      {theme.showImage ? (
        image ? (
          <img
            src={image}
            alt=""
            style={{ width: imgPx, height: imgPx, borderRadius: sm ? 6 : 8, objectFit: "cover", flex: "0 0 auto" }}
          />
        ) : (
          <div style={{ width: imgPx, height: imgPx, borderRadius: sm ? 6 : 8, background: "rgba(127,127,127,.18)", flex: "0 0 auto" }} />
        )
      ) : null}

      {/* Icons only render at md size — the storefront-scale card is too small to
          carry both an image and an icon legibly, matching the old behaviour. */}
      {icon && !sm && ic.kind !== "none" ? (
        ic.kind === "emoji" ? (
          <span aria-hidden="true" data-won-toast-icon="" data-emoji="" style={{ fontSize: 16, lineHeight: 1, flex: "0 0 auto" }}>
            {ic.glyph}
          </span>
        ) : (
          <div aria-hidden="true" data-won-toast-icon="" style={{ width: 18, height: 18, borderRadius: 5, background: accent, opacity: 0.9, flex: "0 0 auto" }} />
        )
      ) : null}

      <div style={{ flex: "1 1 auto", minWidth: 0 }}>
        <div style={{ fontWeight: 700, whiteSpace: sm ? "nowrap" : undefined, overflow: sm ? "hidden" : undefined, textOverflow: sm ? "ellipsis" : undefined }}>
          {title}
        </div>
        {/* Notification toasts often carry a single line of copy; rendering an
            empty detail row would add a phantom gap under it. */}
        {detail ? (
          <div style={{ color: "#8892a0", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {detail}
          </div>
        ) : null}
      </div>

      {theme.showDelta && delta ? (
        <div data-won-toast-delta="" style={{ fontWeight: 800, color: accent, flex: "0 0 auto" }}>
          {delta}
        </div>
      ) : null}

      {undo ? (
        <button
          type="button"
          style={{ border: 0, background: "transparent", color: accent, fontWeight: 700, textDecoration: "underline", cursor: "pointer", flex: "0 0 auto" }}
        >
          Undo
        </button>
      ) : null}

      {closeable ? (
        <span aria-hidden="true" data-won-toast-close="" style={{ color: "#9aa4b0", fontSize: sm ? 15 : 18, lineHeight: 1, paddingLeft: sm ? 0 : 4, flex: "0 0 auto" }}>
          ×
        </span>
      ) : null}
    </div>
  );
}

// Shared enter-animation keyframes (used by any animated preview surface). One
// <WonToastKeyframes/> per animated preview; maps the merchant's chosen entry
// style to a keyframe name via animKeyframeName().
export function WonToastKeyframes() {
  return (
    <style>{`
      @keyframes wonSlide{0%{opacity:0;transform:translateY(10px) scale(.96)}60%{opacity:1}100%{opacity:1;transform:none}}
      @keyframes wonFade{0%{opacity:0}100%{opacity:1}}
      @keyframes wonPop{0%{opacity:0;transform:scale(.82)}70%{transform:scale(1.03)}100%{opacity:1;transform:none}}
      @keyframes wonSlideScale{0%{opacity:0;transform:translateX(16px) scale(.94)}100%{opacity:1;transform:none}}
    `}</style>
  );
}

export function animKeyframeName(animationIn: string | undefined): string {
  return (
    ({ slide: "wonSlide", fade: "wonFade", pop: "wonPop", "slide-scale": "wonSlideScale" } as Record<string, string>)[
      animationIn ?? ""
    ] ?? "wonSlide"
  );
}
