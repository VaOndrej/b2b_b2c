// Plan-gating that SELLS (doctrine §16c), not just tints: one plain sentence of
// what the merchant gets, and a link to where they can get it (§13b — a lock is
// never a dead end). Preview only: entitlement stays server-side (BILL-1).

import { useT } from "../../i18n/context";
import { WON_AMBER, WON_AMBER_TEXT, WON_AMBER_TINT, WON_FONT, WON_MUTED } from "./tokens";

export function ProSell({ benefit, href = "/app/plan" }: { benefit: string; href?: string }) {
  const { t } = useT();
  return (
    <div
      style={{
        fontFamily: WON_FONT,
        border: `1px solid ${WON_AMBER}`,
        background: WON_AMBER_TINT,
        borderRadius: 11,
        padding: 12,
        display: "flex",
        flexDirection: "column",
        gap: 8,
      }}
    >
      <div style={{ fontSize: 13, lineHeight: 1.45, color: WON_MUTED }}>{benefit}</div>
      <div>
        <s-link href={href}>
          <span style={{ fontWeight: 700, color: WON_AMBER_TEXT }}>{t("common.upgradeCta")} →</span>
        </s-link>
      </div>
    </div>
  );
}
