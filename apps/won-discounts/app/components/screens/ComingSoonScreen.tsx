// A module that is visible but not built yet (Admin IA: all five modules always
// visible). It says so in one line, keeps the Pro marker where the module is Pro
// (§16a), and never dead-ends (§13b): one button back to Přehled, one link to
// the module that works today.

import { useT } from "../../i18n/context";
import { UPCOMING_MODULE_META, type UpcomingModule } from "../model/modules";
import { WonSection } from "../shell/WonSection";

export interface ComingSoonScreenProps {
  module: UpcomingModule;
}

export function ComingSoonScreen({ module }: ComingSoonScreenProps) {
  const { t } = useT();
  const meta = UPCOMING_MODULE_META[module];
  return (
    <s-page heading={t(meta.title)}>
      <WonSection title={t(meta.title)} glyph="layers" pro={meta.pro} summary={t("soon.state")} hint={t(meta.body)}>
        <s-stack direction="block" gap="base">
          <s-paragraph>
            <s-link href="/app/discounts">{t("soon.meanwhile")}</s-link>
          </s-paragraph>
          <div>
            <s-button variant="primary" href="/app">
              {t("common.backToOverview")}
            </s-button>
          </div>
        </s-stack>
      </WonSection>
    </s-page>
  );
}
