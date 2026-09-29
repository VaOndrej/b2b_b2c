// The rule editor's margin note (MVP 2): margin protection is on and lowers
// THIS rule's discount somewhere. Pro: "Na N variantách se sleva sníží na
// hranici marže" (an order rule: "U N variant by sleva z objednávky šla pod
// hranici…"), the same per-rule number Přehled zásahů gives, with the link to
// exactly those rows (§13c). Free: NO number — "přehled zásahů" is Pro
// (rozhodnuti.md) — only that protection lowers the rule on some products,
// with the link to the Pro preview. The number is computed on the server in
// the background from the SAVED rule (ruleMarginImpact), and the note says so
// (§12: an unsaved edit may change it; "počítá se" while it is being computed).
// Neutral, never red: a lowered discount is protection working, not a problem (§11a).

import { useT } from "../../i18n/context";
import { marginImpactHref, marginNoteText } from "../model/margin";
import type { MarginRuleImpactView } from "../model/types";
import { WON_FONT, WON_LINE, WON_MUTED, WON_WASH } from "../shell/tokens";

export function MarginNote({ impact, ruleId }: { impact: MarginRuleImpactView; ruleId: string }) {
  const tr = useT();
  const pro = impact.state !== "computing" && impact.variants !== undefined;
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
      <s-text type={impact.state === "computing" ? undefined : "strong"}>{marginNoteText(impact, tr)}</s-text>
      {impact.state === "computing" ? null : (
        <>
          <span style={{ color: WON_MUTED }}>
            {tr.t("editor.margin.saved")}
            {impact.state === "updating" ? ` ${tr.t("editor.margin.updating")}` : ""}
          </span>
          <s-link href={pro ? marginImpactHref(ruleId) : marginImpactHref(null)}>{tr.t(pro ? "editor.margin.link" : "editor.margin.linkPro")}</s-link>
        </>
      )}
    </div>
  );
}
