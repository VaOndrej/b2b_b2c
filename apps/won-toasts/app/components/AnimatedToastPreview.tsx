import { useEffect, useRef, useState, type CSSProperties } from "react";

import { accentFor, styleTokensFor } from "@won/core/toasts/presentation";
import type {
  ToastSemanticType,
  ToastTheme,
} from "@won/core/toasts/config.types";
import { WonToastCard, WonToastKeyframes, animKeyframeName } from "./WonToastCard";
import { WON_FAINT, WON_FONT } from "../lib/tokens";
import { PreviewStage } from "./PreviewStage";
import { previewTiming } from "../lib/preview-timing";

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

  // Animation dwell is capped for a lively loop, but the footer label states the
  // REAL configured duration — the preview must never lie about the setting.
  const { dwellMs, labelSec, spawnEveryMs: spawnEvery } = previewTiming(durationMs);
  const cap = Math.max(1, Math.min(maxVisible || 3, 6));

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
        }, dwellMs),
      );
    };
    spawn();
    const spawnTimer = setInterval(spawn, spawnEvery);
    return () => {
      clearInterval(spawnTimer);
      removeTimers.forEach(clearTimeout);
    };
  }, [dwellMs, cap, spawnEvery]);

  const ordered = stackDirection === "newest-bottom" ? items : [...items].reverse();

  // The enter animation reflects the merchant's chosen entry style so the
  // animated preview isn't lying about which animation they picked.
  const animName = animKeyframeName(theme.animationIn);

  // Same wording the merchant chose, not the enum (§4c).
  const orderLabel =
    stackDirection === "newest-bottom" ? "newest on bottom" : "newest on top";

  return (
    <div style={{ fontFamily: WON_FONT }}>
      <WonToastKeyframes />
      {/* The stage carries the shop header and clamps the stack below it, so the
          ANIMATED preview can't show a toast sliding over the navigation either
          (A4 — the same guarantee the static and to-scale previews give). */}
      <div style={tokens}>
        {customCss ? <style>{customCss}</style> : null}
        <PreviewStage
          minHeight={240}
          align={stackDirection === "newest-bottom" ? "end" : "start"}
        >
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
              wonType="cart"
            />
          ))}
        </PreviewStage>
      </div>
      <p style={{ color: WON_FAINT, fontSize: 12, marginTop: 8 }}>
        Animated · toasts stay {labelSec} s · {orderLabel}
      </p>
    </div>
  );
}
