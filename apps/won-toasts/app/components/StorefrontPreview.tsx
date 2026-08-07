import { useEffect, useRef, useState, type CSSProperties } from "react";

import { accentFor, styleTokensFor } from "@won/core/toasts/presentation";
import type {
  ToastPosition,
  ToastSemanticType,
  ToastTheme,
} from "@won/core/toasts/config.types";

// Schematic storefront preview. Instead of a floating list of toasts with an
// abstract "40px" you can't picture, this frames a mock product page and drops
// the toast where it will actually land — so Position / Offset / Max-visible have
// a VISIBLE effect (the merchant asked: "what is 40px if I can't see it on the
// shop?"). Same style tokens as the real storefront; a Desktop/Mobile switch
// shows both viewports (mobile spans the width, matching storefront behaviour).

type StackDirection = "newest-top" | "newest-bottom";

interface SceneCard {
  type: ToastSemanticType;
  title: string;
  detail: string;
  delta: string;
}

// One representative burst — enough cards that "Max visible" has something to
// clamp, covering a cart add, a milestone and a quantity change.
const SCENE: readonly SceneCard[] = [
  { type: "added", title: "Added to cart", detail: "Widget Pro", delta: "+1" },
  { type: "shipping", title: "Free shipping unlocked", detail: "You’ve hit the threshold", delta: "" },
  { type: "increased", title: "Updated", detail: "Gizmo Plus", delta: "+1" },
  { type: "removed", title: "Removed", detail: "Gadget Mini", delta: "" },
];

export function StorefrontPreview({
  theme,
  position,
  offsetTop,
  offsetInline,
  maxVisible,
  stackDirection,
  closeable,
  customCss,
}: {
  theme: ToastTheme;
  position: ToastPosition;
  offsetTop: number;
  offsetInline: number;
  maxVisible: number;
  stackDirection: StackDirection;
  closeable?: boolean;
  customCss?: string;
}) {
  const [device, setDevice] = useState<"desktop" | "mobile">("desktop");
  const tokens = styleTokensFor(theme) as CSSProperties;
  const mobile = device === "mobile";

  const isTop = position.startsWith("top");
  const isMiddle = position.startsWith("middle");
  const isCenter = position.endsWith("center");
  const isLeft = position.endsWith("left");

  const visible = Math.max(1, Math.min(Math.round(maxVisible) || 1, SCENE.length));
  const shown = SCENE.slice(0, visible);
  const extra = SCENE.length - visible;

  // TRUE SCALE: the frame is a scale model of a real screen. We measure the frame's
  // width and scale every px value (toast width, offsets) by the same factor, so
  // "40px" and "400px" are visibly, proportionally different and nothing is capped
  // or clamped — the merchant sees the real effect of the number. REF_W is the
  // screen width the frame stands in for (a modest desktop / a phone).
  const REF_W = mobile ? 390 : 680;
  const vpRef = useRef<HTMLDivElement>(null);
  const [vpW, setVpW] = useState(300);
  useEffect(() => {
    const el = vpRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const measure = () => setVpW(el.clientWidth);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [device]);
  const scale = vpW > 0 ? vpW / REF_W : 0.4;

  const offXpx = Math.round(Math.max(0, offsetInline) * scale);
  const offYpx = Math.round(Math.max(0, offsetTop) * scale);
  // Proportional width (no upper cap); a small floor keeps the card legible below
  // the minimum configurable width — it never limits how wide the toast can grow.
  const toastW = Math.max(108, Math.round((Number(theme.width) || 300) * scale));

  // Horizontal placement (mobile always spans the width, like the storefront).
  const horizontal: CSSProperties = mobile
    ? { left: offXpx, right: offXpx }
    : isCenter
      ? { left: "50%", width: toastW }
      : { [isLeft ? "left" : "right"]: offXpx, width: toastW };
  // Vertical placement: top / vertically-centred / bottom.
  const vertical: CSSProperties = isMiddle
    ? { top: "50%" }
    : isTop
      ? { top: offYpx }
      : { bottom: offYpx };
  const translate = [
    isCenter && !mobile ? "translateX(-50%)" : "",
    isMiddle ? "translateY(-50%)" : "",
  ]
    .filter(Boolean)
    .join(" ");
  const cornerStyle: CSSProperties = {
    position: "absolute",
    display: "flex",
    flexDirection: stackDirection === "newest-bottom" ? "column-reverse" : "column",
    alignItems: isCenter ? "center" : "stretch",
    gap: 8,
    zIndex: 2,
    ...vertical,
    ...horizontal,
    ...(translate ? { transform: translate } : {}),
  };

  const isDark = theme.mode === "dark";

  const toggleBtn = (key: "desktop" | "mobile"): CSSProperties => ({
    border: "none",
    background: device === key ? "var(--won-surface, #fff)" : "transparent",
    color: device === key ? "#1b1f2a" : "#5b6472",
    boxShadow: device === key ? "0 1px 2px rgba(0,0,0,.12)" : "none",
    borderRadius: 6,
    padding: "4px 10px",
    fontSize: 12,
    fontWeight: 600,
    cursor: "pointer",
  });

  return (
    <div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 10,
        }}
      >
        <span style={{ fontSize: 11, letterSpacing: ".08em", textTransform: "uppercase", color: "#8892a0", fontWeight: 650 }}>
          On your shop
        </span>
        <div style={{ display: "flex", gap: 3, background: "#eef1f4", border: "1px solid #e1e5ea", borderRadius: 8, padding: 3 }}>
          <button type="button" style={toggleBtn("desktop")} onClick={() => setDevice("desktop")}>
            Desktop
          </button>
          <button type="button" style={toggleBtn("mobile")} onClick={() => setDevice("mobile")}>
            Mobile
          </button>
        </div>
      </div>

      {/* browser frame */}
      <div
        style={{
          ...tokens,
          maxWidth: mobile ? 236 : "100%",
          margin: mobile ? "0 auto" : undefined,
          background: "#fff",
          border: "1px solid #e1e5ea",
          borderRadius: 12,
          overflow: "hidden",
          boxShadow: "0 6px 20px rgba(20,28,45,.10)",
          transition: "max-width .25s ease",
        }}
      >
        {customCss ? <style>{customCss}</style> : null}
        {/* chrome bar */}
        <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 10px", borderBottom: "1px solid #edf0f3", background: "#f6f7f9" }}>
          <i style={dot} /><i style={dot} /><i style={dot} />
          <span style={{ flex: 1, marginLeft: 6, height: 14, borderRadius: 5, background: "#e6e9ee" }} />
        </div>

        {/* viewport with a faux product page + the positioned toast stack */}
        <div ref={vpRef} style={{ position: "relative", padding: 16, minHeight: 300, background: isDark ? "#0f1317" : "linear-gradient(180deg,#fff,#fafbfc)" }}>
          <div style={{ display: "grid", gridTemplateColumns: "68px 1fr", gap: 12 }}>
            <div style={{ aspectRatio: "1", borderRadius: 9, border: "1px solid #e6e9ee", background: "repeating-linear-gradient(135deg,#e9edf1,#e9edf1 7px,transparent 7px,transparent 14px)" }} />
            <div>
              <div style={{ ...skel, width: "85%" }} />
              <div style={{ ...skel, width: "60%" }} />
              <div style={{ ...skel, width: "34%", height: 12, background: "#c3cad4" }} />
              <div style={{ marginTop: 10, height: 26, borderRadius: 7, background: "#4b5bd6", opacity: 0.85 }} />
            </div>
          </div>
          <div style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ ...skel, width: "90%" }} />
            <div style={{ ...skel, width: "100%" }} />
            <div style={{ ...skel, width: "70%" }} />
          </div>

          {/* the toast stack, exactly where it will render */}
          <div style={cornerStyle}>
            {shown.map((c, i) => (
              <ToastCard key={i} theme={theme} card={c} closeable={closeable} />
            ))}
            {extra > 0 ? (
              <div style={{ alignSelf: isCenter ? "center" : isLeft ? "flex-start" : "flex-end", fontSize: 11, fontWeight: 600, color: isDark ? "#c7cfd8" : "#5b6472", background: isDark ? "rgba(255,255,255,.08)" : "rgba(20,28,45,.06)", borderRadius: 12, padding: "2px 8px" }}>
                +{extra} more
              </div>
            ) : null}
          </div>
        </div>
      </div>

      <p style={{ color: "#8892a0", fontSize: 12, marginTop: 10, textAlign: "center" }}>
        To-scale preview · toast sits <strong>{position.replace("-", " ")}</strong>
      </p>
    </div>
  );
}

const dot: CSSProperties = { width: 8, height: 8, borderRadius: "50%", background: "#dfe3e8", display: "inline-block" };
const skel: CSSProperties = { height: 9, borderRadius: 5, background: "#e6e9ee", marginBottom: 7 };

function ToastCard({
  theme,
  card,
  closeable,
}: {
  theme: ToastTheme;
  card: SceneCard;
  closeable?: boolean;
}) {
  const accent = accentFor(theme, card.type);
  return (
    <div
      data-won-toast=""
      data-type={card.type}
      style={{
        boxSizing: "border-box",
        width: "100%",
        display: "flex",
        gap: 8,
        alignItems: "center",
        padding: "8px 9px",
        background: "var(--won-bg)",
        color: "var(--won-text)",
        borderRadius: "var(--won-radius)",
        boxShadow: "var(--won-shadow)",
        border: "var(--won-border)",
        borderLeft: `3px solid ${accent}`,
        font: "12px/1.3 system-ui, sans-serif",
      }}
    >
      {theme.showImage ? (
        <div style={{ width: 26, height: 26, borderRadius: 6, background: "rgba(127,127,127,.18)", flex: "0 0 auto" }} />
      ) : null}
      <div style={{ flex: "1 1 auto", minWidth: 0 }}>
        <div style={{ fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{card.title}</div>
        <div style={{ color: "#8892a0", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{card.detail}</div>
      </div>
      {theme.showDelta && card.delta ? (
        <div data-won-toast-delta="" style={{ fontWeight: 800, color: accent, flex: "0 0 auto" }}>{card.delta}</div>
      ) : null}
      {closeable ? (
        <span aria-hidden="true" data-won-toast-close="" style={{ color: "#9aa4b0", fontSize: 15, lineHeight: 1, flex: "0 0 auto" }}>×</span>
      ) : null}
    </div>
  );
}
