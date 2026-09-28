// Slevy a kódy — the rule list (module "Slevy a kódy"). Each rule leads with its
// state at rest (§17: name + Live/Off + one describe line + "not offered in"
// warnings); recipes are the next step (§15b). Rendered by
// app/routes/app.discounts._index.tsx and the dev harness.

import type { DiscountRule, WonDiscountsConfig } from "@won/core/discounts/config";

import { useT } from "../../i18n/context";
import { RecipeGrid } from "../RecipeGrid";
import { describeRuleLine, missingCurrencies, ruleName } from "../model/describe";
import { currencyCodes, currencyViews } from "../model/markets";
import type { CurrencyView, SyncView, UiResult } from "../model/types";
import { Notice } from "../shell/Notice";
import { StatusPill, WonRow, WonSection } from "../shell/WonSection";
import { WON_ATTENTION, WON_MUTED } from "../shell/tokens";

export interface DiscountsScreenProps {
  readOnly: boolean;
  rules: DiscountRule[];
  currencies: CurrencyView[];
  sync: SyncView;
  result?: UiResult | null;
}

export function buildDiscountsProps(
  config: WonDiscountsConfig,
  opts: { readOnly: boolean; sync: SyncView; shopCurrency?: string | null; result?: UiResult | null },
): DiscountsScreenProps {
  const rules = config.modules.codes.rules;
  return {
    readOnly: opts.readOnly,
    rules,
    currencies: currencyViews(config.markets, { shopCurrency: opts.shopCurrency, rules }),
    sync: opts.sync,
    result: opts.result ?? null,
  };
}

export function DiscountsScreen({ readOnly, rules, currencies, sync, result }: DiscountsScreenProps) {
  const tr = useT();
  const { t } = tr;
  const codes = currencyCodes(currencies);
  const live = rules.filter((r) => r.enabled).length;
  const off = rules.length - live;
  const summary =
    rules.length === 0
      ? t("discounts.list.none")
      : [tr.tp("count.discount", rules.length), tr.tp("count.live", live), off > 0 ? tr.tp("count.off", off) : ""]
          .filter(Boolean)
          .join(" · ");

  return (
    <s-page heading={t("discounts.title")}>
      <s-button slot="primary-action" variant="primary" href="/app/discounts/new">
        {t("discounts.new")}
      </s-button>
      <s-stack direction="block" gap="base">
        {readOnly ? (
          <s-banner tone="warning" heading={t("common.readOnly.heading")}>
            {t("common.readOnly.body")}
          </s-banner>
        ) : null}
        <Notice result={result} />

        <WonSection
          title={t("discounts.list.title")}
          glyph="tag"
          summary={summary}
          // §12: until sync is connected, saving a rule does not make it live in Shopify — say so.
          hint={sync.state === "not_wired" ? t("result.notWired.sync") : undefined}
        >
          {rules.length === 0 ? (
            <s-paragraph>{t("discounts.empty.body")}</s-paragraph>
          ) : (
            <div>
              {rules.map((rule) => {
                const missing = missingCurrencies(rule, codes);
                return (
                  <WonRow
                    key={rule.id}
                    tone={rule.enabled && missing.length > 0 ? "attention" : undefined}
                    action={
                      <s-button variant="tertiary" href={`/app/discounts/${encodeURIComponent(rule.id)}`}>
                        {t("common.edit")}
                      </s-button>
                    }
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                      <s-text type="strong">{ruleName(rule, tr)}</s-text>
                      <StatusPill on={rule.enabled} />
                    </div>
                    <div style={{ fontSize: 12.5, color: WON_MUTED, marginTop: 2 }}>{describeRuleLine(rule, tr, codes)}</div>
                    {rule.enabled && missing.length > 0 ? (
                      <div style={{ fontSize: 12.5, color: WON_ATTENTION, marginTop: 2 }}>
                        {t("overview.warning.missingCurrency", { rule: ruleName(rule, tr), currencies: tr.list(missing) })}
                      </div>
                    ) : null}
                  </WonRow>
                );
              })}
            </div>
          )}
        </WonSection>

        <WonSection
          title={t("discounts.recipes.title")}
          glyph="spark"
          summary={t("discounts.recipes.summary")}
          collapsible
          defaultOpen={rules.length === 0}
        >
          <RecipeGrid withBlank />
        </WonSection>
      </s-stack>
    </s-page>
  );
}
