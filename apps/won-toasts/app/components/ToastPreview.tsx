import type { CSSProperties } from "react";

import {
  accentFor,
  resolveToastPresentation,
  styleTokensFor,
} from "@won/core/toasts/presentation";
import type { ToastCartEvent } from "@won/core/toasts/cart-events";
import type {
  ToastSemanticType,
  ToastTheme,
} from "@won/core/toasts/config.types";
import { WonToastCard } from "./WonToastCard";

// Live preview panel. It computes the SAME style tokens + presentation model as
// the storefront (from @won/core/toasts/presentation), so what the merchant sees
// here is what shoppers get. DOM is plain React here vs a Shadow-DOM host on the
// storefront, but the tokens and content are identical.
//
// Doctrine §3: the preview shows ONE representative scene (no scenario switcher)
// and must exercise EVERY editable dimension — here that means every accent the
// merchant can edit (added/removed/increased/decreased/gift/shipping) is visible,
// so nothing they tune is invisible in the preview.

interface PreviewCard {
  type: ToastSemanticType;
  title: string;
  detail: string;
  delta: string;
  accent: string;
  showImage: boolean;
  image?: string | null;
  undo?: boolean;
}

function line(title: string): ToastCartEvent["line"] {
  return { key: title, variantId: 1, quantity: 1, title };
}
function cartEvent(
  type: ToastCartEvent["type"],
  delta: number,
  title: string,
): ToastCartEvent {
  return {
    type,
    key: title,
    variantId: 1,
    delta,
    quantity: Math.max(0, delta),
    line: line(title),
  };
}

// A cart event mapped through the shared presentation logic.
function fromCart(theme: ToastTheme, ev: ToastCartEvent): PreviewCard {
  const p = resolveToastPresentation(ev, { theme });
  return {
    type: p.type,
    title: p.title,
    detail: p.detail,
    delta: p.delta,
    accent: p.accent,
    showImage: p.showImage,
    image: p.image,
    undo: ev.type === "removed",
  };
}

// A milestone card (gift / free shipping) — not a cart delta, so we build it
// directly but still colour it from the SAME accent tokens the merchant edits.
function milestone(
  theme: ToastTheme,
  type: ToastSemanticType,
  title: string,
  detail: string,
): PreviewCard {
  return {
    type,
    title,
    detail,
    delta: "",
    accent: accentFor(theme, type),
    showImage: theme.showImage,
    image: null,
  };
}

export function ToastPreview({
  theme,
  customCss,
  closeable,
}: {
  theme: ToastTheme;
  customCss?: string;
  /** Show the close (×) affordance, mirroring global.closeable. */
  closeable?: boolean;
}) {
  const tokens = styleTokensFor(theme) as CSSProperties;

  // One rich scene covering all six editable accents.
  const cards: PreviewCard[] = [
    fromCart(theme, cartEvent("added", 2, "Widget Pro")),
    fromCart(theme, cartEvent("increased", 1, "Gizmo Plus")),
    fromCart(theme, cartEvent("decreased", -1, "Bolt Set")),
    fromCart(theme, cartEvent("removed", -1, "Gadget Mini")),
    milestone(theme, "shipping", "Free shipping unlocked", "You’ve hit the threshold"),
    milestone(theme, "gift", "Gift unlocked", "Added to your order"),
  ];

  return (
    // No positioning here — the page that wants a sticky preview column wraps this
    // (Design/Toasts do). On a vertical stack (Overview) sticky would pin and
    // overlap the buttons below it.
    <div>
      <div
        style={{
          ...tokens,
          background: theme.mode === "dark" ? "#0f1317" : "#eef1f4",
          borderRadius: 14,
          padding: 18,
          display: "flex",
          flexDirection: "column",
          gap: `var(--won-gap)`,
          minHeight: 180,
        }}
      >
        {/* Live custom CSS injected into the preview scope so the merchant isn't
            editing blind (doctrine §3k). Hooks: [data-won-toast], [data-type]. */}
        {customCss ? <style>{customCss}</style> : null}
        {cards.map((c, i) => (
          <WonToastCard
            key={i}
            theme={theme}
            type={c.type}
            title={c.title}
            detail={c.detail}
            delta={c.delta}
            accent={c.accent}
            image={c.image}
            undo={c.undo}
            closeable={closeable}
          />
        ))}
      </div>
      <p style={{ color: "#8892a0", fontSize: 12, marginTop: 8 }}>
        Live preview · same render tokens as the storefront
      </p>
    </div>
  );
}
