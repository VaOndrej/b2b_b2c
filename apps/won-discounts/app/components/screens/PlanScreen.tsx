// Tarif (placeholder until billing, spec §7). States the plan actually in force
// (BILL-1: Free unless a verified subscription says otherwise), the real limits
// (never "neomezeně": at most N active code discounts, and why), and Pro in amber
// with only what checkout can do today (§16, §12) — no fake checkout button.

import { useT } from "../../i18n/context";
import type { CodeRuleLimit } from "../model/types";
import { WonSection } from "../shell/WonSection";

export interface PlanScreenProps {
  pro: boolean;
  codeRules: CodeRuleLimit;
  /** Most rules a shop can have at all (CONFIG_LIMITS.rules). */
  maxRules: number;
}

export function PlanScreen({ pro, codeRules, maxRules }: PlanScreenProps) {
  const { t } = useT();
  return (
    <s-page heading={t("nav.plan")}>
      <s-stack direction="block" gap="base">
        <WonSection
          title={t("plan.free.title")}
          glyph="check"
          summary={t("plan.free.summary", { rules: maxRules, codes: codeRules.limit })}
          hint={[pro ? "" : t("plan.current"), t("plan.codeLimit", { codes: codeRules.limit, shopify: codeRules.shopifyLimit })]
            .filter(Boolean)
            .join(" · ")}
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
