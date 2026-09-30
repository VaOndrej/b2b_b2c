// The rule editor's tier note (MVP 3, A1): a product discount and a quantity
// tier on the same line never add up — the better one for the customer wins.
// Shown while the draft is a product rule and a tier set runs on the plan; the
// link goes to the tiers (§13). Neutral: it is how the engine works, not a problem.

import { useT } from "../../i18n/context";
import { WON_FONT, WON_LINE, WON_WASH } from "../shell/tokens";

export function TiersNote() {
  const { t } = useT();
  return (
    <div
      style={{
        fontFamily: WON_FONT,
        display: "flex",
        flexWrap: "wrap",
        alignItems: "baseline",
        gap: "4px 10px",
        padding: "8px 10px",
        borderRadius: 9,
        border: `1px solid ${WON_LINE}`,
        background: WON_WASH,
        fontSize: 12.5,
        lineHeight: 1.4,
      }}
    >
      <s-text>{t("editor.tiers.note")}</s-text>
      <s-link href="/app/tiers">{t("module.tiers")}</s-link>
    </div>
  );
}
