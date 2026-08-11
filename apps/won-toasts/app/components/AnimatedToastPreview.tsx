import { useEffect, useRef, useState, type CSSProperties } from "react";

import { accentFor, styleTokensFor } from "@won/core/toasts/presentation";
import type {
  ToastSemanticType,
  ToastTheme,
} from "@won/core/toasts/config.types";
import { WonToastCard, WonToastKeyframes, animKeyframeName } from "./WonToastCard";

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
  const animName = animKeyframeName(theme.animationIn);

  return (
    <div>
      <WonToastKeyframes />
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
        {ordered.map((it) => (
          <WonToastCard
            key={it.id}
            theme={theme}
            type={it.sample.type}
            title={it.sample.title}
            detail={it.sample.detail}
            delta={it.sample.delta}
            accent={accentFor(theme, it.sample.type)}
            closeable={closeable}
            animName={animName}
            leaving={it.leaving}
          />
        ))}
      </div>
      <p style={{ color: "#8892a0", fontSize: 12, marginTop: 8 }}>
        Animated · toasts stay {Math.round(dur / 100) / 10}s · {stackDirection}
      </p>
    </div>
  );
}
