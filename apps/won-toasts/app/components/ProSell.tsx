// Plan-gating that SELLS (doctrine §16c), not just tints.
//
// The old treatment was a `ProFrame` whose locked and unlocked states differed
// only by the alpha of an amber wash (0.10 vs 0.18). A Free merchant saw greyed
// inputs and a sentence of prose — the feature was locked, but never desired.
//
// §16c says the proof of a locked feature MAY run in the admin preview. So the
// locked state shows the merchant the actual mechanism (a real WonToastCard
// pair, the same renderer the storefront uses — A1) plus one plain sentence of
// what they'd get, and a deep link to the exact place they can get it (§13).
//
// This is PREVIEW ONLY. Entitlement stays server-side (BILL-1): a locked feature
// never emits on the storefront, and `gateConfigForPlan` is untouched.

import type { ReactNode } from "react";

import {
  WON_AMBER,
  WON_AMBER_TEXT,
  WON_AMBER_TINT,
  WON_FONT,
  WON_MUTED,
} from "../lib/tokens";

export function ProSell({
  /** One sentence: what the merchant GETS, in their terms — not the feature name. */
  benefit,
  /** The mechanism, shown not described (§10a). Usually a Without → With pair. */
  proof,
  href = "/app/plan",
  cta = "Upgrade to Pro",
}: {
  benefit: string;
  proof?: ReactNode;
  href?: string;
  cta?: string;
}) {
  return (
    <div
      style={{
        fontFamily: WON_FONT,
        border: `1px solid ${WON_AMBER}`,
        background: WON_AMBER_TINT,
        borderRadius: 11,
        padding: 14,
        display: "flex",
        flexDirection: "column",
        gap: 10,
      }}
    >
      <div style={{ fontSize: 13, lineHeight: 1.45, color: WON_MUTED }}>{benefit}</div>
      {proof ? <div>{proof}</div> : null}
      {/* Never a dead end — the lock carries the merchant to the fix (§13b). */}
      <div>
        <s-link href={href}>
          <span style={{ fontWeight: 700, color: WON_AMBER_TEXT }}>{cta} →</span>
        </s-link>
      </div>
    </div>
  );
}
