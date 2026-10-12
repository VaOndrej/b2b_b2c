// A warning the merchant can act on (doctrine §20g; pravidla vzhledu P7): two labelled lines — "Co se stalo" (the
// fact) and "Co s tím" (the choice in plain words, including "if this is what you want, do nothing") — and the
// primary button that goes to the fix; a second button when the fix may be elsewhere. A link at the end of a
// sentence is not an action. ONE piece for every place that warns (Časté kombinace, the cart's result, Přehled), so
// the rule holds wherever it is used (walkthrough before the first review, nálezy 2 and 17).
import type { ReactNode } from "react";

import { useT } from "../../i18n/context";
import { WON_INK, WON_LINE, WON_MUTED, WON_WASH } from "./tokens";

const LABEL = { fontSize: 11.5, fontWeight: 700, letterSpacing: ".04em", textTransform: "uppercase", color: WON_MUTED } as const;

export interface FindingLink {
  href: string;
  label: string;
}

export function Finding({
  what,
  how,
  primary,
  alt,
  actions,
  marker,
}: {
  what: ReactNode;
  how?: ReactNode;
  primary?: FindingLink;
  alt?: FindingLink;
  /** A button that is not a link (a retry that posts), drawn after the links. */
  actions?: ReactNode;
  marker?: Record<string, string>;
}) {
  const { t } = useT();
  return (
    <div data-won-finding="" {...marker} style={{ display: "grid", gap: 8, padding: 12, borderRadius: 10, background: WON_WASH, border: `1px solid ${WON_LINE}` }}>
      <div>
        <div style={LABEL}>{t("combos.what")}</div>
        <div style={{ fontSize: 13.5, lineHeight: 1.45, fontWeight: 600, color: WON_INK }}>{what}</div>
      </div>
      {how ? (
        <div>
          <div style={LABEL}>{t("combos.how")}</div>
          <div data-won-finding-how="" style={{ fontSize: 13.5, lineHeight: 1.45, color: WON_INK }}>
            {how}
          </div>
        </div>
      ) : null}
      {primary || alt || actions ? (
        <s-stack direction="inline" gap="small-300">
          {primary ? (
            <s-button href={primary.href} variant="primary">
              {primary.label}
            </s-button>
          ) : null}
          {alt ? (
            <s-button href={alt.href} variant="secondary">
              {alt.label}
            </s-button>
          ) : null}
          {actions}
        </s-stack>
      ) : null}
    </div>
  );
}
