// The rule editor's margin note (MVP 2): margin protection is on and lowers
// THIS rule's discount somewhere — "Na N produktech se sleva sníží na hranici
// marže", with the link to exactly those rows in Přehled zásahů (§13c). The
// count is computed on the server from the SAVED rule (ruleMarginImpact), and
// the note says so (§12: an unsaved edit may change it). Neutral, never red:
// a lowered discount is protection working, not a problem (§11a).

import { useT } from "../../i18n/context";
import { marginImpactHref } from "../model/margin";
import { WON_FONT, WON_LINE, WON_MUTED, WON_WASH } from "../shell/tokens";

export function MarginNote({ count, ruleId }: { count: number; ruleId: string }) {
  const tr = useT();
  if (count <= 0) return null;
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
      <s-text type="strong">{tr.tp("editor.margin.note", count)}</s-text>
      <span style={{ color: WON_MUTED }}>{tr.t("editor.margin.saved")}</span>
      <s-link href={marginImpactHref(ruleId)}>{tr.t("editor.margin.link")}</s-link>
    </div>
  );
}
