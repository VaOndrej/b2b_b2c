import type { CSSProperties } from "react";

import { accentFor, styleTokensFor } from "@won/core/toasts/presentation";
import type {
  ToastSemanticType,
  ToastTheme,
} from "@won/core/toasts/config.types";

// Live preview for a single notification recipe. Uses the SAME theme tokens as
// the storefront (styleTokensFor) so "how it looks" here matches shoppers, and
// reflects the recipe's surface (toast / banner / inline / persistent) — because
// anything that changes the storefront visual must move the preview (doctrine
// §3c). Renders the rendered message with representative sample data.

type RecipeKey =
  | "countdown"
  | "announcement"
  | "stock.low"
  | "cart.activity"
  | "order.summary"
  | "order.created";

type Surface = "toast" | "banner" | "persistent-toast" | "inline";

const ACCENT_OF: Record<RecipeKey, ToastSemanticType> = {
  countdown: "shipping",
  announcement: "info",
  "stock.low": "decreased",
  "cart.activity": "added",
  "order.summary": "info",
  "order.created": "added",
};

const DEFAULT_MSG: Record<RecipeKey, string> = {
  countdown: "Sale ends in {countdown}",
  announcement: "Free gift on orders over 1000 Kč this week!",
  "stock.low": "Only {count} left",
  "cart.activity": "{count} people added this recently",
  "order.summary": "{count} orders this week",
  "order.created": "{name} from {city} bought {product}",
};

const SAMPLE: Record<string, string> = {
  "{countdown}": "02:14:30",
  "{count}": "3",
  "{name}": "Anna",
  "{city}": "Praha",
  "{product}": "Ceramic Mug",
  "{time}": "2 min ago",
  "{qty}": "1",
  "{delta}": "+1",
  "{remaining}": "250 Kč",
  "{threshold}": "1000 Kč",
};

function fillSample(message: string): string {
  return message.replace(/\{[a-z]+\}/gi, (m) => SAMPLE[m] ?? m);
}

const TITLE_OF: Partial<Record<RecipeKey, string>> = {
  "order.created": "Recent order",
};

export function NotificationPreview({
  type,
  message,
  surface = "toast",
  theme,
}: {
  type: RecipeKey;
  message?: string;
  surface?: Surface;
  theme: ToastTheme;
}) {
  const tokens = styleTokensFor(theme) as CSSProperties;
  const accent = accentFor(theme, ACCENT_OF[type]);
  const raw = (message ?? "").trim() || DEFAULT_MSG[type];
  const text = fillSample(raw);
  const title = TITLE_OF[type];
  const isDark = theme.mode === "dark";

  // Surface changes the SHAPE, so switching surface visibly moves the preview.
  const inner: CSSProperties =
    surface === "banner"
      ? {
          width: "100%",
          borderRadius: 8,
          borderLeft: `4px solid ${accent}`,
          padding: "12px 14px",
          background: "var(--won-bg)",
          color: "var(--won-text)",
          boxShadow: "none",
          border: "var(--won-border)",
        }
      : surface === "inline"
        ? {
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            padding: "2px 0",
            color: accent,
            fontWeight: 700,
            background: "transparent",
          }
        : {
            // toast / persistent-toast: floating card
            width: "var(--won-width)",
            maxWidth: "100%",
            borderRadius: "var(--won-radius)",
            borderLeft: `4px solid ${accent}`,
            padding: "var(--won-pad)",
            background: "var(--won-bg)",
            color: "var(--won-text)",
            boxShadow: "var(--won-shadow)",
            border: "var(--won-border)",
          };

  const surfaceLabel =
    surface === "banner"
      ? "Banner · full width"
      : surface === "inline"
        ? "Inline · on the page"
        : surface === "persistent-toast"
          ? "Toast · stays until dismissed"
          : "Toast · floating";

  return (
    <div>
      <div
        style={{
          ...tokens,
          background: isDark ? "#0f1317" : "#eef1f4",
          borderRadius: 14,
          padding: 16,
          display: "flex",
          justifyContent: surface === "banner" ? "stretch" : "flex-start",
        }}
      >
        <div
          data-won-toast=""
          data-type={type}
          style={{
            boxSizing: "border-box",
            display: surface === "inline" ? "inline-flex" : "flex",
            flexDirection: "column",
            gap: 2,
            font: "14px/1.4 system-ui, sans-serif",
            ...inner,
          }}
        >
          {title ? <div style={{ fontWeight: 700 }}>{title}</div> : null}
          <div style={{ fontWeight: title ? 400 : surface === "inline" ? 700 : 600 }}>
            {text}
          </div>
        </div>
      </div>
      <p style={{ color: "#8892a0", fontSize: 12, marginTop: 6 }}>
        Live preview · {surfaceLabel} · sample data
      </p>
    </div>
  );
}
