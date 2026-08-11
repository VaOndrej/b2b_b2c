import { useEffect, useRef, useState, type CSSProperties } from "react";

import { accentFor, styleTokensFor } from "@won/core/toasts/presentation";
import type {
  ToastPosition,
  ToastSemanticType,
  ToastTheme,
} from "@won/core/toasts/config.types";
import { WonToastCard, WonToastKeyframes, animKeyframeName } from "./WonToastCard";

// Schematic storefront preview. Instead of a floating list of toasts with an
// abstract "40px" you can't picture, this frames a mock product page — WITH the
// shop's own fixed header — and drops the toast where it will actually land, so
// Position / Offset / Max-visible have a VISIBLE effect (the merchant asked:
// "what is 40px if I can't see it on the shop?"). Same style tokens as the real
// storefront; a Desktop/Mobile switch shows both viewports, and an Animate
// switch shows toasts entering/leaving in place (Wave-0: animate everywhere).
//
// Header safety (Wave-0 decision): the faux shop header is a fixed band at the
// top and top-anchored toasts are clamped BELOW it, mirroring how the storefront
// runtime offsets around sticky headers — so the preview never lies by showing a
// toast covering the header, in static OR animated mode.

type StackDirection = "newest-top" | "newest-bottom";

// Height of the faux fixed shop header inside the mock viewport (preview px).
const HEADER_H = 30;
// Toasts anchored to the top start below the header + a small breathing gap.
const HEADER_SAFE = HEADER_H + 8;

interface SceneCard {
  type: ToastSemanticType;
  title: string;
  detail: string;
  delta: string;
}

// One representative burst — enough cards that "Max visible" has something to
// clamp, covering a cart add, a milestone and a quantity change.
// A representative mix of ALL toast kinds — not just cart events — so the
// animated preview shows the whole picture together (merchant-review point 5):
// cart activity, urgency, social proof, announcement and milestones side by side.
const SCENE: readonly SceneCard[] = [
  { type: "added", title: "Added to cart", detail: "Widget Pro", delta: "+1" },
  { type: "shipping", title: "Free shipping unlocked", detail: "You’ve hit the threshold", delta: "" },
  { type: "decreased", title: "Only 3 left", detail: "Selling fast", delta: "" },
  { type: "increased", title: "Updated", detail: "Gizmo Plus", delta: "+1" },
  { type: "info", title: "Free gift this week", detail: "On orders over 1000 Kč", delta: "" },
  { type: "added", title: "Anna from Praha", detail: "just bought Ceramic Mug", delta: "" },
  { type: "gift", title: "Gift unlocked", detail: "Added to your order", delta: "" },
  { type: "removed", title: "Removed", detail: "Gadget Mini", delta: "" },
];

interface Live {
  id: number;
  card: SceneCard;
  leaving: boolean;
}

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
  const [animate, setAnimate] = useState(false);
  const tokens = styleTokensFor(theme) as CSSProperties;
  const mobile = device === "mobile";

  const isTop = position.startsWith("top");
  const isMiddle = position.startsWith("middle");
  const isCenter = position.endsWith("center");
  const isLeft = position.endsWith("left");

  const visible = Math.max(1, Math.min(Math.round(maxVisible) || 1, SCENE.length));
  const shown = SCENE.slice(0, visible);
  const extra = SCENE.length - visible;

  // Animated mode: cycle the scene through the same enter/leave the storefront
  // uses, capped at Max-visible, so motion + clamping read together.
  const [live, setLive] = useState<Live[]>([]);
  const idRef = useRef(0);
  useEffect(() => {
    if (!animate) {
      setLive([]);
      return;
    }
    const timers: ReturnType<typeof setTimeout>[] = [];
    const spawn = () => {
      const id = ++idRef.current;
      const card = SCENE[id % SCENE.length];
      setLive((prev) => [...prev, { id, card, leaving: false }].slice(-visible));
      timers.push(
        setTimeout(() => {
          setLive((prev) => prev.map((x) => (x.id === id ? { ...x, leaving: true } : x)));
          timers.push(setTimeout(() => setLive((prev) => prev.filter((x) => x.id !== id)), 360));
        }, 2600),
      );
    };
    spawn();
    const iv = setInterval(spawn, 1500);
    return () => {
      clearInterval(iv);
      timers.forEach(clearTimeout);
    };
  }, [animate, visible]);

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

  // Horizontal placement mirrors the LIVE storefront on both sizes: the toast
  // keeps its (scaled) width at its chosen edge/centre, capped so it never
  // exceeds the viewport. It does NOT stretch edge-to-edge on mobile — verified
  // against the storefront CSS (width: var(--won-width) capped to
  // calc(100vw - 32px), not full-bleed).
  const CAP = "calc(100% - 20px)";
  const horizontal: CSSProperties = isCenter
    ? { left: "50%", width: toastW, maxWidth: CAP }
    : { [isLeft ? "left" : "right"]: offXpx, width: toastW, maxWidth: CAP };
  // Vertical placement: top / vertically-centred / bottom. Top-anchored stacks
  // start BELOW the fixed header, never over it.
  const vertical: CSSProperties = isMiddle
    ? { top: "50%" }
    : isTop
      ? { top: HEADER_SAFE + offYpx }
      : { bottom: offYpx };
  const translate = [
    isCenter ? "translateX(-50%)" : "",
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

  // The storefront mock always stays light — the renderer never darkens the
  // shop's own background, only the toast card can be dark (merchant-review
  // point 6). A dark toast then reads honestly against a light storefront.
  const isDark = false;
  const animName = animKeyframeName(theme.animationIn);

  const toggleBtn = (active: boolean): CSSProperties => ({
    border: "none",
    background: active ? "var(--won-surface, #fff)" : "transparent",
    color: active ? "#1b1f2a" : "#5b6472",
    boxShadow: active ? "0 1px 2px rgba(0,0,0,.12)" : "none",
    borderRadius: 6,
    padding: "4px 10px",
    fontSize: 12,
    fontWeight: 600,
    cursor: "pointer",
  });

  // The cards to render: animated live set, or the static Max-visible slice.
  const renderCards = animate
    ? (stackDirection === "newest-bottom" ? live : [...live].reverse()).map((it) => (
        <WonToastCard
          key={it.id}
          theme={theme}
          type={it.card.type}
          title={it.card.title}
          detail={it.card.detail}
          delta={it.card.delta}
          accent={accentFor(theme, it.card.type)}
          closeable={closeable}
          size="sm"
          animName={animName}
          leaving={it.leaving}
        />
      ))
    : shown.map((c, i) => (
        <WonToastCard
          key={i}
          theme={theme}
          type={c.type}
          title={c.title}
          detail={c.detail}
          delta={c.delta}
          accent={accentFor(theme, c.type)}
          closeable={closeable}
          size="sm"
        />
      ));

  return (
    <div>
      <WonToastKeyframes />
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
          flexWrap: "wrap",
          marginBottom: 10,
        }}
      >
        <span style={{ fontSize: 11, letterSpacing: ".08em", textTransform: "uppercase", color: "#8892a0", fontWeight: 650 }}>
          On your shop
        </span>
        <div style={{ display: "flex", gap: 8 }}>
          <div style={{ display: "flex", gap: 3, background: "#eef1f4", border: "1px solid #e1e5ea", borderRadius: 8, padding: 3 }}>
            <button type="button" style={toggleBtn(!animate)} onClick={() => setAnimate(false)}>
              Static
            </button>
            <button type="button" style={toggleBtn(animate)} onClick={() => setAnimate(true)}>
              Animate
            </button>
          </div>
          <div style={{ display: "flex", gap: 3, background: "#eef1f4", border: "1px solid #e1e5ea", borderRadius: 8, padding: 3 }}>
            <button type="button" style={toggleBtn(!mobile)} onClick={() => setDevice("desktop")}>
              Desktop
            </button>
            <button type="button" style={toggleBtn(mobile)} onClick={() => setDevice("mobile")}>
              Mobile
            </button>
          </div>
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
        {/* browser chrome bar */}
        <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 10px", borderBottom: "1px solid #edf0f3", background: "#f6f7f9" }}>
          <i style={dot} /><i style={dot} /><i style={dot} />
          <span style={{ flex: 1, marginLeft: 6, height: 14, borderRadius: 5, background: "#e6e9ee" }} />
        </div>

        {/* viewport (padding 0 so the fixed header + absolute toast stack anchor
            to the true top; page content is inset below the header instead). */}
        <div ref={vpRef} style={{ position: "relative", padding: 0, minHeight: 300, background: isDark ? "#0f1317" : "linear-gradient(180deg,#fff,#fafbfc)" }}>
          {/* faux fixed shop header — sits ABOVE the toast stack (zIndex) so the
              preview visibly proves toasts never cover the header. */}
          <div
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              right: 0,
              height: HEADER_H,
              zIndex: 3,
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "0 12px",
              background: isDark ? "rgba(18,22,27,.94)" : "rgba(255,255,255,.94)",
              backdropFilter: "saturate(1.2) blur(2px)",
              borderBottom: `1px solid ${isDark ? "#232a31" : "#eceff3"}`,
              boxShadow: "0 1px 4px rgba(20,28,45,.06)",
            }}
          >
            <span style={{ width: 34, height: 8, borderRadius: 4, background: isDark ? "#3a434d" : "#c9d0d9" }} />
            <span style={{ flex: 1 }} />
            <span style={{ width: 14, height: 8, borderRadius: 4, background: isDark ? "#2f373f" : "#dbe0e7" }} />
            <span style={{ width: 14, height: 8, borderRadius: 4, background: isDark ? "#2f373f" : "#dbe0e7" }} />
          </div>

          {/* faux product page, inset below the header */}
          <div style={{ padding: `${HEADER_H + 14}px 16px 16px` }}>
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
          </div>

          {/* the toast stack, exactly where it will render */}
          <div style={cornerStyle}>
            {renderCards}
            {!animate && extra > 0 ? (
              <div style={{ alignSelf: isCenter ? "center" : isLeft ? "flex-start" : "flex-end", fontSize: 11, fontWeight: 600, color: isDark ? "#c7cfd8" : "#5b6472", background: isDark ? "rgba(255,255,255,.08)" : "rgba(20,28,45,.06)", borderRadius: 12, padding: "2px 8px" }}>
                +{extra} more
              </div>
            ) : null}
          </div>
        </div>
      </div>

      <p style={{ color: "#8892a0", fontSize: 12, marginTop: 10, textAlign: "center" }}>
        To-scale preview · toast sits <strong>{position.replace("-", " ")}</strong>
        {isTop ? " · clears the header" : ""}
      </p>
    </div>
  );
}

const dot: CSSProperties = { width: 8, height: 8, borderRadius: "50%", background: "#dfe3e8", display: "inline-block" };
const skel: CSSProperties = { height: 9, borderRadius: 5, background: "#e6e9ee", marginBottom: 7 };
