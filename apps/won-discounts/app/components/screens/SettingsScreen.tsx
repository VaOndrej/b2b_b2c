// Nastavení (placeholder for MVP 1): shows the state that exists today — the
// shop's market currencies and the admin language rule — and says the rest comes
// later, with a way back (§13b).

import { useT } from "../../i18n/context";
import type { CurrencyView } from "../model/types";
import { WonSection } from "../shell/WonSection";

export interface SettingsScreenProps {
  currencies: CurrencyView[];
}

export function SettingsScreen({ currencies }: SettingsScreenProps) {
  const tr = useT();
  const { t } = tr;
  const withMarkets = currencies.filter((c) => c.markets.length > 0);
  return (
    <s-page heading={t("nav.settings")}>
      <s-stack direction="block" gap="base">
        <WonSection
          title={t("settings.markets.title")}
          glyph="store"
          summary={
            withMarkets.length === 0
              ? t("settings.markets.none")
              : t("settings.markets.list", {
                  currencies: tr.list(withMarkets.map((c) => `${c.code} (${c.markets.map((m) => m.name).join(", ")})`)),
                })
          }
          hint={t("settings.language")}
        />
        <WonSection title={t("nav.settings")} glyph="sliders" summary={t("soon.state")} hint={t("soon.settings")}>
          <div>
            <s-button variant="primary" href="/app">
              {t("common.backToOverview")}
            </s-button>
          </div>
        </WonSection>
      </s-stack>
    </s-page>
  );
}
