// A single small toast rendered through the SHARED card (A1), for use in a
// section's `aside` slot or inside an Effect Proof.
//
// It exists so no surface is ever tempted to hand-draw "roughly a toast" again:
// it applies the same `styleTokensFor()` CSS variables the storefront host sets
// and renders WonToastCard, so a mini toast can never drift from a real one.

import type { CSSProperties } from "react";

import { accentFor, styleTokensFor } from "@won/core/toasts/presentation";
import type { ToastSemanticType, ToastTheme } from "@won/core/toasts/config.types";

import { WON_FAINT, WON_FONT } from "../lib/tokens";
import { WonToastCard } from "./WonToastCard";

export function MiniToast({
  theme,
  type = "added",
  title,
  detail,
  delta,
  label,
  wonType,
  customCss,
  closeable,
}: {
  theme: ToastTheme;
  type?: ToastSemanticType;
  title: string;
  detail: string;
  delta?: string;
  /** Small caption above the card, e.g. "Your global design". */
  label?: string;
  /** The toast TYPE, so `[data-won-type="…"]` custom CSS applies here too (§3k). */
  wonType?: string;
  customCss?: string;
  closeable?: boolean;
}) {
  const tokens = styleTokensFor(theme) as CSSProperties;
  return (
    <div style={{ fontFamily: WON_FONT, minWidth: 0 }}>
      {label ? (
        <div
          style={{
            fontSize: 10.5,
            letterSpacing: ".07em",
            textTransform: "uppercase",
            fontWeight: 700,
            color: WON_FAINT,
            marginBottom: 6,
          }}
        >
          {label}
        </div>
      ) : null}
      <div
        style={{
          ...tokens,
          // The mock storefront behind the card is always light — the app never
          // darkens the shop itself, only the toast.
          background: "#eef1f4",
          borderRadius: 10,
          padding: 10,
        }}
      >
        {customCss ? <style>{customCss}</style> : null}
        <WonToastCard
          theme={theme}
          type={type}
          title={title}
          detail={detail}
          delta={delta}
          accent={accentFor(theme, type)}
          size="sm"
          wonType={wonType}
          closeable={closeable}
        />
      </div>
    </div>
  );
}

/** Two mini toasts side by side — the Without → With shape of §10, full size. */
export function MiniToastPair({
  left,
  right,
}: {
  left: React.ReactNode;
  right: React.ReactNode;
}) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, alignItems: "start" }}>
      {left}
      {right}
    </div>
  );
}
