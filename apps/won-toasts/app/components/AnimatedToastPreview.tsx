import { useEffect, useRef, useState, type CSSProperties } from "react";

import { accentFor, styleTokensFor } from "@won/core/toasts/presentation";
import type {
  ToastSemanticType,
  ToastTheme,
} from "@won/core/toasts/config.types";

// Animated live preview (doctrine §3e): loops through sample toasts that appear,
// stay for `durationMs`, then fade out — respecting stack order and max-visible —
// so the merchant sees the actual timing/stacking behaviour, not a static image.
// Same theme tokens as the storefront.

interface Sample {
  type: ToastSemanticType;
  title: string;
  detail: string;
  delta: string;
}

const SAMPLES: Sample[] = [
  { type: "added", title: "Added to cart", detail: "Widget Pro", delta: "+1" },
  { type: "increased", title: "Updated", detail: "Gizmo Plus", delta: "+1" },
  { type: "shipping", title: "Free shipping unlocked", detail: "You hit the threshold", delta: "" },
  { type: "removed", title: "Removed", detail: "Gadget Mini", delta: "" },
  { type: "gift", title: "Gift unlocked", detail: "Added to your order", delta: "" },
];

interface Live {
  id: number;
  sample: Sample;
  leaving: boolean;
}

export function AnimatedToastPreview({
  theme,
  durationMs,
  stackDirection,
  maxVisible,
  customCss,
  closeable,
}: {
  theme: ToastTheme;
  durationMs: number;
  stackDirection: "newest-top" | "newest-bottom";
  maxVisible: number;
  customCss?: string;
  closeable?: boolean;
}) {
  const tokens = styleTokensFor(theme) as CSSProperties;
  const [items, setItems] = useState<Live[]>([]);
  const idRef = useRef(0);

  const dur = Math.max(1000, Math.min(durationMs || 3500, 8000));
  const cap = Math.max(1, Math.min(maxVisible || 3, 6));
  const spawnEvery = Math.max(1100, Math.min(dur, 2600));

  useEffect(() => {
    const removeTimers: ReturnType<typeof setTimeout>[] = [];
    const spawn = () => {
      const id = ++idRef.current;
      const sample = SAMPLES[id % SAMPLES.length];
      setItems((prev) => [...prev, { id, sample, leaving: false }].slice(-cap));
      // Begin fade-out just before removal, then unmount.
      removeTimers.push(
        setTimeout(() => {
          setItems((prev) => prev.map((x) => (x.id === id ? { ...x, leaving: true } : x)));
          removeTimers.push(
            setTimeout(() => setItems((prev) => prev.filter((x) => x.id !== id)), 360),
          );
        }, dur),
      );
    };
    spawn();
    const spawnTimer = setInterval(spawn, spawnEvery);
    return () => {
      clearInterval(spawnTimer);
      removeTimers.forEach(clearTimeout);
    };
  }, [dur, cap, spawnEvery]);

  const ordered = stackDirection === "newest-bottom" ? items : [...items].reverse();
  const isDark = theme.mode === "dark";

  // The enter animation reflects the merchant's chosen entry style so the
  // animated preview isn't lying about which animation they picked.
  const animName =
    ({ slide: "wonSlide", fade: "wonFade", pop: "wonPop", "slide-scale": "wonSlideScale" } as Record<string, string>)[
      theme.animationIn
    ] ?? "wonSlide";

  return (
    <div>
      <style>{`
        @keyframes wonSlide{0%{opacity:0;transform:translateY(10px) scale(.96)}60%{opacity:1}100%{opacity:1;transform:none}}
        @keyframes wonFade{0%{opacity:0}100%{opacity:1}}
        @keyframes wonPop{0%{opacity:0;transform:scale(.82)}70%{transform:scale(1.03)}100%{opacity:1;transform:none}}
        @keyframes wonSlideScale{0%{opacity:0;transform:translateX(16px) scale(.94)}100%{opacity:1;transform:none}}
      `}</style>
      <div
        style={{
          ...tokens,
          background: isDark ? "#0f1317" : "#eef1f4",
          borderRadius: 14,
          padding: 18,
          display: "flex",
          flexDirection: "column",
          gap: `var(--won-gap)`,
          minHeight: 220,
          justifyContent: stackDirection === "newest-bottom" ? "flex-end" : "flex-start",
          overflow: "hidden",
        }}
      >
        {customCss ? <style>{customCss}</style> : null}
        {ordered.map((it) => {
          const accent = accentFor(theme, it.sample.type);
          return (
            <div
              key={it.id}
              data-won-toast=""
              data-type={it.sample.type}
              style={{
                boxSizing: "border-box",
                display: "flex",
                gap: 10,
                alignItems: "center",
                width: "var(--won-width)",
                maxWidth: "100%",
                padding: "var(--won-pad)",
                background: "var(--won-bg)",
                color: "var(--won-text)",
                borderRadius: "var(--won-radius)",
                boxShadow: "var(--won-shadow)",
                border: "var(--won-border)",
                borderLeft: `4px solid ${accent}`,
                font: "14px/1.35 system-ui, sans-serif",
                // Smooth enter (the merchant's chosen entry style) + collapse-on-
                // leave so the rest of the stack slides up gently, not snapping.
                animation: `${animName} .42s cubic-bezier(.16,1,.3,1)`,
                opacity: it.leaving ? 0 : 1,
                transform: it.leaving ? "translateX(14px) scale(.97)" : "none",
                maxHeight: it.leaving ? 0 : 80,
                paddingTop: it.leaving ? 0 : undefined,
                paddingBottom: it.leaving ? 0 : undefined,
                overflow: "hidden",
                transition:
                  "opacity .3s ease, transform .3s cubic-bezier(.16,1,.3,1), max-height .32s ease, padding .32s ease",
              }}
            >
              {theme.showImage ? (
                <div style={{ width: 36, height: 36, borderRadius: 8, background: "rgba(127,127,127,.18)", flex: "0 0 auto" }} />
              ) : null}
              {theme.showIcon ? (
                <div aria-hidden="true" data-won-toast-icon="" style={{ width: 18, height: 18, borderRadius: 5, background: accent, opacity: 0.9, flex: "0 0 auto" }} />
              ) : null}
              <div style={{ flex: "1 1 auto", minWidth: 0 }}>
                <div style={{ fontWeight: 700 }}>{it.sample.title}</div>
                <div style={{ color: "#8892a0", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {it.sample.detail}
                </div>
              </div>
              {theme.showDelta && it.sample.delta ? (
                <div data-won-toast-delta="" style={{ fontWeight: 800, color: accent }}>{it.sample.delta}</div>
              ) : null}
              {closeable ? (
                <span aria-hidden="true" data-won-toast-close="" style={{ color: "#9aa4b0", fontSize: 18, lineHeight: 1, paddingLeft: 4, flex: "0 0 auto" }}>×</span>
              ) : null}
            </div>
          );
        })}
      </div>
      <p style={{ color: "#8892a0", fontSize: 12, marginTop: 8 }}>
        Animated · toasts stay {Math.round(dur / 100) / 10}s · {stackDirection}
      </p>
    </div>
  );
}
