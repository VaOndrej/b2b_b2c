// Tarif (placeholder until billing, spec §7). States the plan actually in force
// (BILL-1: Free unless a verified subscription says otherwise) and shows Pro in
// amber with what it adds (§16) — no fake checkout button.

import { useT } from "../../i18n/context";
import { WonSection } from "../shell/WonSection";

export interface PlanScreenProps {
  pro: boolean;
}

export function PlanScreen({ pro }: PlanScreenProps) {
  const { t } = useT();
  return (
    <s-page heading={t("nav.plan")}>
      <s-stack direction="block" gap="base">
        <WonSection
          title={t("plan.free.title")}
          glyph="check"
          summary={t("plan.free.summary")}
          hint={pro ? undefined : t("plan.current")}
          on={!pro}
        />
        <WonSection title={t("plan.pro.title")} glyph="plan" pro locked={!pro} summary={t("plan.pro.summary")} hint={t("plan.pro.soon")}>
          <div>
            <s-button href="/app" variant="secondary">
              {t("common.backToOverview")}
            </s-button>
          </div>
        </WonSection>
      </s-stack>
    </s-page>
  );
}
