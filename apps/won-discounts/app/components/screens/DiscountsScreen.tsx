// Slevy a kódy — the rule list (module "Slevy a kódy"). Each rule leads with its
// real state (§17, §11d: Běží only when it truly runs — model/rule-status.ts),
// its state line from the core formatter, and what needs fixing. The cap on
// active code rules is shown before a save would refuse (§13). Recipes are the
// next step (§15b). Rendered by app/routes/app.discounts._index.tsx and the harness.

import type { DiscountRule, WonDiscountsConfig } from "@won/core/discounts/config";

import { useT } from "../../i18n/context";
import { RecipeGrid } from "../RecipeGrid";
import { RuleRow } from "../RuleRow";
import { missingCurrencies, ruleName } from "../model/describe";
import { currencyCodes, currencyViews, type MarketNames } from "../model/markets";
import { shopToday } from "../model/rule-form";
import { ruleStatus, ruleStatusSummary } from "../model/rule-status";
import type { CodeRuleLimit, CurrencyView, SyncView, UiResult } from "../model/types";
import { Notice } from "../shell/Notice";
import { WonSection } from "../shell/WonSection";

export interface DiscountsScreenProps {
  readOnly: boolean;
  rules: DiscountRule[];
  currencies: CurrencyView[];
  sync: SyncView;
  today: string;
  timezone: string | null;
  codeRules: CodeRuleLimit;
  result?: UiResult | null;
}

export function buildDiscountsProps(
  config: WonDiscountsConfig,
  opts: {
    readOnly: boolean;
    sync: SyncView;
    codeRules: CodeRuleLimit;
    shopCurrency?: string | null;
    timezone?: string | null;
    marketNames?: MarketNames;
    now?: Date;
    result?: UiResult | null;
  },
): DiscountsScreenProps {
  const rules = config.modules.codes.rules;
  const timezone = opts.timezone ?? null;
  return {
    readOnly: opts.readOnly,
    rules,
    currencies: currencyViews(config.markets, { shopCurrency: opts.shopCurrency, rules, marketNames: opts.marketNames }),
    sync: opts.sync,
    today: shopToday(timezone, opts.now),
    timezone,
    codeRules: opts.codeRules,
    result: opts.result ?? null,
  };
}

export function DiscountsScreen({ readOnly, rules, currencies, sync, today, timezone, codeRules, result }: DiscountsScreenProps) {
  const tr = useT();
  const { t } = tr;
  const codes = currencyCodes(currencies);
  const statuses = rules.map((rule) => ruleStatus(rule, { today, timezone, sync }));
  const summary = rules.length === 0 ? t("discounts.list.none") : ruleStatusSummary(statuses, tr);
  const hints = [
    // §12: until sync is connected, saving a rule does not make it live in Shopify.
    sync.state === "not_wired" ? t("result.notWired.sync") : "",
    codeRules.active > 0 ? t("discounts.codeLimit", { active: codeRules.active, limit: codeRules.limit }) : "",
  ].filter(Boolean);

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

        <WonSection title={t("discounts.list.title")} glyph="tag" summary={summary} hint={hints.join(" ") || undefined}>
          {rules.length === 0 ? (
            <s-paragraph>{t("discounts.empty.body")}</s-paragraph>
          ) : (
            <div>
              {rules.map((rule, i) => {
                const missing = rule.enabled ? missingCurrencies(rule, codes) : [];
                return (
                  <RuleRow
                    key={rule.id}
                    rule={rule}
                    status={statuses[i]}
                    currencies={codes}
                    timezone={timezone}
                    attention={
                      missing.length > 0
                        ? t("overview.warning.missingCurrency", { rule: ruleName(rule, tr), currencies: tr.list(missing) })
                        : undefined
                    }
                    action={
                      <s-button variant="tertiary" href={`/app/discounts/${encodeURIComponent(rule.id)}`}>
                        {t("common.edit")}
                      </s-button>
                    }
                  />
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
