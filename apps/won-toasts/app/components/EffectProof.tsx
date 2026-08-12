import type { CSSProperties, ReactNode } from "react";

import { WON_FONT } from "../lib/tokens";

// Effect Proof (doctrine §10): a tiny inline "Without → With" illustration glued
// to ONE setting, showing its effect on a faithful mock of the same primitive the
// shopper sees — the toast chip. It shows the mechanism, it doesn't describe it.
// Use only where a setting has a non-obvious consequence; a proof on a trivial
// on/off is noise. The chips are deliberately fake-but-true: they mirror what the
// runtime actually does (see capProof in @won/core for the Cap proof's numbers).

const frame: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  flexWrap: "wrap",
  fontFamily: WON_FONT,
  fontSize: 12,
  color: "#5b6472",
  background: "#fff",
  border: "1px solid #e6e9ee",
  borderRadius: 8,
  padding: "8px 10px",
};

const sideLabel: CSSProperties = { color: "#8892a0", fontWeight: 600 };
const arrow: CSSProperties = { color: "#c2c8d0", fontSize: 13, margin: "0 2px" };

/**
 * One mini toast chip. Defaults to the faint amber "before" look; `solid` is the
 * emphasised "after" toast, `ghost` is a quieted/held-back toast, `dot` adds an
 * accent mark, `badge` adds a green "+N"/"×N", and `children` is an optional tiny
 * label inside the chip (e.g. a product name for the Group-by proof).
 */
export function ProofChip({
  width = 14,
  solid = false,
  ghost = false,
  dot,
  badge,
  children,
}: {
  width?: number;
  solid?: boolean;
  ghost?: boolean;
  dot?: string;
  badge?: string;
  children?: ReactNode;
}) {
  const hasContent = dot != null || badge != null || children != null;
  const style: CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    minWidth: hasContent ? undefined : width,
    height: 16,
    padding: hasContent ? "0 6px" : 0,
    borderRadius: 4,
    background: ghost
      ? "repeating-linear-gradient(45deg,#eef0f3,#eef0f3 3px,#f7f8fa 3px,#f7f8fa 6px)"
      : solid
        ? "#f4a259"
        : "rgba(244,162,89,0.5)",
    border: ghost ? "1px dashed #d5d9e0" : "none",
    color: solid ? "#7a3d10" : "#8892a0",
    fontSize: 11,
    fontWeight: 600,
    lineHeight: 1,
  };
  return (
    <span style={style}>
      {dot != null && (
        <span
          style={{ width: 6, height: 6, borderRadius: 999, background: dot, flex: "0 0 auto" }}
        />
      )}
      {children}
      {badge != null && <strong style={{ color: "#2f9e6f" }}>{badge}</strong>}
    </span>
  );
}

/** The framed Without→With row. Pass chips (or any node) for each side. */
export function EffectProof({
  before,
  after,
  beforeLabel = "Without",
  afterLabel = "With",
}: {
  before: ReactNode;
  after: ReactNode;
  beforeLabel?: string;
  afterLabel?: string;
}) {
  return (
    <div style={frame} aria-hidden="true">
      <span style={sideLabel}>{beforeLabel}</span>
      {before}
      <span style={arrow}>→</span>
      <span style={sideLabel}>{afterLabel}</span>
      {after}
    </div>
  );
}
