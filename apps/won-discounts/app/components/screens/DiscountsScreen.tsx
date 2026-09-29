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
import { syncText } from "../model/signals";
import type { CodeRuleLimit, CurrencyView, GateNoteView, RuleSyncMap, SyncView, UiResult } from "../model/types";
import { GateNotes } from "../shell/GateNotes";
import { Notice } from "../shell/Notice";
import { WonSection } from "../shell/WonSection";

export interface DiscountsScreenProps {
  readOnly: boolean;
  rules: DiscountRule[];
  currencies: CurrencyView[];
  sync: SyncView;
  /** Per-rule sync facts (Běží = this version is in Shopify). */
  ruleSync?: RuleSyncMap;
  today: string;
  timezone: string | null;
  codeRules: CodeRuleLimit;
  result?: UiResult | null;
  /** Pro settings stored but not in force on the shop's plan (BILL-1, explainGate). */
  gate?: GateNoteView[];
  /** Rules the plan switches off. */
  gateOff?: string[];
  /** Handles of the enabled Won markets. */
  enabledMarkets?: string[];
}

export function buildDiscountsProps(
  config: WonDiscountsConfig,
  opts: {
    readOnly: boolean;
    sync: SyncView;
    ruleSync?: RuleSyncMap;
    codeRules: CodeRuleLimit;
    shopCurrency?: string | null;
    timezone?: string | null;
    marketNames?: MarketNames;
    now?: Date;
    result?: UiResult | null;
    gate?: GateNoteView[];
    gateOff?: string[];
  },
): DiscountsScreenProps {
  const rules = config.modules.codes.rules;
  const timezone = opts.timezone ?? null;
  return {
    ...(opts.gate && opts.gate.length > 0 ? { gate: opts.gate.map((g) => ({ ...g })) } : {}),
    ...(opts.gateOff && opts.gateOff.length > 0 ? { gateOff: [...opts.gateOff] } : {}),
    enabledMarkets: config.markets.filter((m) => m.enabled).map((m) => m.handle),
    readOnly: opts.readOnly,
    rules,
    currencies: currencyViews(config.markets, { shopCurrency: opts.shopCurrency, rules, marketNames: opts.marketNames }),
    sync: opts.sync,
    ...(opts.ruleSync ? { ruleSync: { ...opts.ruleSync } } : {}),
    today: shopToday(timezone, opts.now),
    timezone,
    codeRules: opts.codeRules,
    result: opts.result ?? null,
  };
}

/** Hints are joined into one line: each ends with a full stop. */
const sentence = (text: string) => (/[.!?…]$/.test(text) ? text : `${text}.`);

export function DiscountsScreen({
  readOnly,
  rules,
  currencies,
  sync,
  ruleSync,
  today,
  timezone,
  codeRules,
  result,
  gate = [],
  gateOff,
  enabledMarkets,
}: DiscountsScreenProps) {
  const tr = useT();
  const { t } = tr;
  const codes = currencyCodes(currencies);
  const statuses = rules.map((rule) => ruleStatus(rule, { today, timezone, sync, ruleSync, gateOff, currencies: codes, enabledMarkets }));
  const summary = rules.length === 0 ? t("discounts.list.none") : ruleStatusSummary(statuses, tr);
  const hints = [
    // §12: say when saved rules are not (all) in Shopify, and why.
    sync.state === "not_wired" ? t("result.notWired.sync") : "",
    sync.state === "error" || sync.state === "blocked" || sync.state === "running" ? sentence(syncText(sync, tr)) : "",
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
        {gate.length > 0 ? <GateNotes notes={gate} /> : null}

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
