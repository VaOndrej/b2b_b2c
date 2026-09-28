// Pro "Cílení a kombinace" (A2/§16: visible, amber, never blocks Free; BILL-1:
// the server decides what is saved). Only what checkout can evaluate is offered:
// segment targeting is shown as "připravujeme", disabled, never as working
// (core SEGMENT_TARGETING_SUPPORTED / unsupportedInFunction).

import { SEGMENT_TARGETING_SUPPORTED, unsupportedInFunction } from "@won/core/discounts/plan";

import { describeProSettings } from "../model/describe";
import type { MarketNames } from "../model/markets";
import { FIELD } from "../model/rule-form";
import type { MarketView } from "../model/types";
import { boolAttr } from "../shell/attrs";
import { ProFrame } from "../shell/ProFrame";
import { ProSell } from "../shell/ProSell";
import { RowNote, WonSection } from "../shell/WonSection";
import type { EditorView } from "./parts";

export function ProSection({
  ed,
  pro,
  markets,
  otherRules,
}: {
  ed: EditorView;
  pro: boolean;
  markets: MarketView[];
  otherRules: { id: string; name: string }[];
}) {
  const { draft, defaults, tr } = ed;
  const { t } = tr;
  const ruleNames = new Map(otherRules.map((r) => [r.id, r.name]));
  const marketNames: MarketNames = Object.fromEntries(markets.map((m) => [m.handle, m.name]));
  const hasStoredSegments = unsupportedInFunction(draft).length > 0;
  return (
    <WonSection
      title={t("editor.pro.title")}
      glyph="target"
      pro
      locked={!pro}
      summary={describeProSettings(draft, tr, ruleNames, marketNames)}
      collapsible
      defaultOpen={hasStoredSegments}
      anchor="pro"
    >
      <s-stack direction="block" gap="base">
        {!pro ? <ProSell benefit={t("editor.pro.benefit")} /> : null}
        <ProFrame locked={!pro}>
          <s-stack direction="block" gap="base">
            <s-stack direction="block" gap="small-200">
              <s-text type="strong">{t("editor.pro.markets")}</s-text>
              {markets.length === 0 ? (
                <s-text color="subdued">{t("editor.pro.marketsNone")}</s-text>
              ) : (
                markets.map((m) => (
                  <s-checkbox
                    key={m.handle}
                    name={FIELD.markets}
                    value={m.handle}
                    label={m.name}
                    checked={boolAttr(defaults.markets.includes(m.handle))}
                    disabled={boolAttr(!pro)}
                  />
                ))
              )}
            </s-stack>
            <s-stack direction="block" gap="small-200">
              {/* Visible so it can be wanted (§16a), disabled because checkout
                  cannot evaluate it yet — never sold as working (§12). */}
              <s-checkbox
                label={t("editor.pro.segments")}
                disabled={boolAttr(!SEGMENT_TARGETING_SUPPORTED || !pro)}
                details={SEGMENT_TARGETING_SUPPORTED ? undefined : t("editor.pro.segmentsSoon")}
              />
              {hasStoredSegments ? <RowNote tone="attention">{t("editor.pro.segmentsStored")}</RowNote> : null}
            </s-stack>
            <s-stack direction="block" gap="small-200">
              <s-text type="strong">{t("editor.pro.combines")}</s-text>
              {otherRules.length === 0 ? (
                <s-text color="subdued">{t("editor.pro.combinesNone")}</s-text>
              ) : (
                otherRules.map((other) => (
                  <s-checkbox
                    key={other.id}
                    name={FIELD.combinesWith}
                    value={other.id}
                    label={other.name || t("common.untitled")}
                    checked={boolAttr(defaults.combinesWith.includes(other.id))}
                    disabled={boolAttr(!pro)}
                  />
                ))
              )}
            </s-stack>
          </s-stack>
        </ProFrame>
      </s-stack>
    </WonSection>
  );
}
