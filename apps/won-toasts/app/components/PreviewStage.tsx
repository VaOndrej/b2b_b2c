// The shared preview STAGE: the mock shop surface every toast preview sits on.
//
// A4 says a preview renders the real surrounding context, not a void — "a
// preview showing an impossible state is lying". Only StorefrontPreview honoured
// that; the close-up panel previews (static + animated) dropped their toasts
// into a plain grey rectangle with no shop, no header, and therefore no reason
// for a merchant to believe the toast can't land on top of their navigation.
//
// The header band, its height, and the "toasts anchored to the top start BELOW
// it" clamp now live here once, so all three surfaces can't disagree about how
// much room the shop's fixed header takes.

import type { CSSProperties, ReactNode } from "react";

/** Height of the faux fixed shop header inside a preview frame (preview px). */
export const HEADER_H = 30;
/** Top-anchored toasts start below the header plus a breathing gap. */
export const HEADER_SAFE = HEADER_H + 8;

/**
 * The faux fixed shop header. Deliberately rendered ABOVE the toast stack
 * (zIndex 3 vs 2) so the preview visibly PROVES toasts never cover it — if the
 * clamp ever regressed, the header would visibly win and the bug would be
 * obvious instead of silent.
 */
export function ShopHeaderBand({ height = HEADER_H }: { height?: number }) {
  return (
    <div
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        height,
        zIndex: 3,
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "0 12px",
        background: "rgba(255,255,255,.94)",
        backdropFilter: "saturate(1.2) blur(2px)",
        borderBottom: "1px solid #eceff3",
        boxShadow: "0 1px 4px rgba(20,28,45,.06)",
      }}
    >
      <span style={{ width: 34, height: 8, borderRadius: 4, background: "#c9d0d9" }} />
      <span style={{ flex: 1 }} />
      <span style={{ width: 14, height: 8, borderRadius: 4, background: "#dbe0e7" }} />
      <span style={{ width: 14, height: 8, borderRadius: 4, background: "#dbe0e7" }} />
    </div>
  );
}

/**
 * A close-up stage: the shop's header on top, the toast stack clamped below it.
 *
 * Unlike StorefrontPreview this is NOT to scale — it's the zoomed-in view used
 * when the merchant is judging the LOOK of a card rather than its placement. It
 * still carries the header so the close-up can never imply an overlap the
 * storefront would not produce.
 */
export function PreviewStage({
  children,
  minHeight = 200,
  align = "start",
  style,
}: {
  children: ReactNode;
  minHeight?: number;
  /** Where the stack sits vertically — mirrors newest-top / newest-bottom. */
  align?: "start" | "end";
  style?: CSSProperties;
}) {
  return (
    <div
      style={{
        position: "relative",
        background: "linear-gradient(180deg,#eef1f4,#e9edf1)",
        borderRadius: 14,
        overflow: "hidden",
        minHeight,
        ...style,
      }}
    >
      <ShopHeaderBand />
      <div
        style={{
          position: "relative",
          zIndex: 2,
          // The clamp: nothing in the stack may start above the header line.
          padding: `${HEADER_SAFE}px 16px 16px`,
          minHeight,
          display: "flex",
          flexDirection: "column",
          justifyContent: align === "end" ? "flex-end" : "flex-start",
          gap: "var(--won-gap)",
        }}
      >
        {children}
      </div>
    </div>
  );
}
