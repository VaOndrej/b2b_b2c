// Slevy a kódy — the rule list (module "Slevy a kódy"). Each rule leads with its
// real state (§17, §11d: Běží only when it truly runs — model/rule-status.ts),
// its state line from the core formatter, and what needs fixing — "Upravit" of
// a rule that needs attention opens the editor AT the field that fixes it (P3),
// and so do the plan notes. A failed sync carries "Synchronizovat znovu" here.
// The cap on active code rules is said only when it is close (P2, §13). With no
// rule yet the list IS the recipes (§15b). Rendered by
// app/routes/app.discounts._index.tsx and the harness.

import type { DiscountRule, WonDiscountsConfig } from "@won/core/discounts/config";
import { isMilestoneRule } from "@won/core/discounts/milestones";

import { useT } from "../../i18n/context";
import { RecipeGrid } from "../RecipeGrid";
import { RuleRow } from "../RuleRow";
import { collectWarnings, missingCurrencies, ruleName, warningCounts } from "../model/describe";
import { currencyCodes, currencyMarketNames, currencyViews, type MarketNames } from "../model/markets";
import { shopToday } from "../model/rule-form";
import { codesStatus } from "../model/module-status";
import { ruleEditHref, ruleStatus, ruleStatusSummary, type RuleStatus } from "../model/rule-status";
import { codeLimitNear } from "../rule-editor/ApplySection";
import { syncText } from "../model/signals";
import type { CodeRuleLimit, CurrencyView, GateNoteView, RuleSyncMap, SyncView, UiResult } from "../model/types";
import { Notice, ResyncButton } from "../shell/Notice";
import { DiscountsSubNav } from "../shell/SubNav";
import { RowNote, WonRow, WonSection } from "../shell/WonSection";

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
  /** Checkout still runs a config built with those Pro settings; a resync is under way (I-2). */
  gatePending?: boolean;
  /** Handles of the enabled Won markets. */
  enabledMarkets?: string[];
  /** Order discounts that are steps of Milníky (set up on that page; not in `rules`). Absent = none. */
  milestoneDiscounts?: number;
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
    gatePending?: boolean;
  },
): DiscountsScreenProps {
  // Milníky: an order discount that is a step of the ladder is set up there — never listed here as a discount.
  const rules = config.modules.codes.rules.filter((rule) => !isMilestoneRule(rule));
  const milestoneDiscounts = config.modules.codes.rules.length - rules.length;
  const timezone = opts.timezone ?? null;
  return {
    ...(opts.gate && opts.gate.length > 0 ? { gate: opts.gate.map((g) => ({ ...g })) } : {}),
    ...(opts.gateOff && opts.gateOff.length > 0 ? { gateOff: [...opts.gateOff] } : {}),
    ...(opts.gatePending ? { gatePending: true } : {}),
    enabledMarkets: config.markets.filter((m) => m.enabled).map((m) => m.handle),
    ...(milestoneDiscounts > 0 ? { milestoneDiscounts } : {}),
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

/**
 * BILL-1 notes of the list (shell/GateNotes, with one difference): each note
 * about a rule links to that rule in the editor, at the field that fixes it (P3).
 */
function RuleGateNotes({ notes, pending, hrefFor }: { notes: readonly GateNoteView[]; pending: boolean; hrefFor: (ruleId: string) => string | null }) {
  const { t } = useT();
  return (
    <s-banner tone="warning" heading={t(pending ? "gate.pendingHeading" : "gate.heading")}>
      <s-stack direction="block" gap="small-200">
        <s-paragraph>{t(pending ? "gate.pendingBody" : "gate.body")}</s-paragraph>
        <s-unordered-list>
          {notes.map((note, i) => {
            const href = note.ruleId !== undefined ? hrefFor(note.ruleId) : null;
            return (
              <s-list-item key={`${i}-${note.ruleId ?? ""}`}>
                {note.text}
                {href ? (
                  <>
                    {" "}
                    <s-link href={href}>{t("common.edit")}</s-link>
                  </>
                ) : null}
              </s-list-item>
            );
          })}
        </s-unordered-list>
      </s-stack>
      <s-button slot="secondary-actions" href="/app/plan">
        {t("common.upgradeCta")}
      </s-button>
    </s-banner>
  );
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
  gatePending = false,
  enabledMarkets,
  milestoneDiscounts = 0,
}: DiscountsScreenProps) {
  const tr = useT();
  const { t } = tr;
  const codes = currencyCodes(currencies);
  const statuses = rules.map((rule) => ruleStatus(rule, { today, timezone, sync, ruleSync, gateOff, currencies: codes, enabledMarkets }));
  const summary = rules.length === 0 ? t("discounts.list.none") : ruleStatusSummary(statuses, tr);
  // N4: the same count as the home page's "Vyžaduje pozornost" and its tile.
  const warned = warningCounts(rules, collectWarnings(rules, codes, { enabledMarkets }));
  const hints = [
    // §12: say when saved rules are not (all) in Shopify, and why.
    sync.state === "error" || sync.state === "blocked" || sync.state === "running" ? sentence(syncText(sync, tr)) : "",
    codeLimitNear(codeRules) ? t("discounts.codeLimit", { active: codeRules.active, limit: codeRules.limit }) : "",
  ].filter(Boolean);
  const names = {
    marketNames: Object.fromEntries(currencies.flatMap((c) => c.markets.map((m) => [m.handle, m.name] as const))),
    ruleNames: new Map(rules.map((r) => [r.id, r.name])),
  };
  const statusOf = new Map<string, RuleStatus>(rules.map((r, i) => [r.id, statuses[i]]));
  // A plan note is about a Pro setting: the markets when the plan switches the rule off for them, else the Pro section.
  const gateHref = (ruleId: string): string | null => {
    const rule = rules.find((r) => r.id === ruleId);
    const status = statusOf.get(ruleId);
    if (!rule || !status) return null;
    return status.kind === "pro_off" ? ruleEditHref(rule, status, codes) : `/app/discounts/${encodeURIComponent(rule.id)}#pro`;
  };

  return (
    <s-page heading={t("discounts.title")}>
      <DiscountsSubNav active="discounts" />
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
        {gate.length > 0 ? <RuleGateNotes notes={gate} pending={gatePending} hrefFor={gateHref} /> : null}
        {/* Milníky: a discount off the order from a cart value is a step of the ladder — set up there, only linked here. */}
        {milestoneDiscounts > 0 ? (
          <div data-won-milestone-discounts>
            <WonRow
              action={
                <s-button href="/app/rewards#steps" variant="secondary">
                  {t("discounts.milestones.open")}
                </s-button>
              }
            >
              <RowNote>{tr.tp("discounts.milestones.note", milestoneDiscounts)}</RowNote>
            </WonRow>
          </div>
        ) : null}

        <WonSection
          title={t("discounts.list.title")}
          glyph="tag"
          // The same function as the home tile (model/module-status.ts).
          state={rules.length > 0 ? codesStatus(statuses, warned) : undefined}
          anchor="list"
          summary={summary}
          hint={hints.join(" ") || undefined}
          // §13a: a failed sync carries its fix right here.
          proof={sync.state === "error" && !readOnly ? <ResyncButton /> : undefined}
        >
          {rules.length === 0 ? (
            // §15b: the empty list is the next step itself — the recipes, one click from a pre-filled discount.
            <s-stack direction="block" gap="base">
              <s-paragraph>{t("discounts.empty.body")}</s-paragraph>
              <RecipeGrid withBlank />
            </s-stack>
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
                    names={names}
                    attention={
                      missing.length > 0
                        ? t("overview.warning.missingCurrency", { rule: ruleName(rule, tr), currencies: tr.list(missing.map((code) => currencyMarketNames(code, currencies))) })
                        : undefined
                    }
                    action={
                      // P3: a rule that needs attention opens at the field that fixes it.
                      <s-button variant="tertiary" href={ruleEditHref(rule, statuses[i], codes)}>
                        {t("common.edit")}
                      </s-button>
                    }
                  />
                );
              })}
            </div>
          )}
        </WonSection>

        {rules.length > 0 ? (
          <WonSection title={t("discounts.recipes.title")} glyph="spark" summary={t("discounts.recipes.summary")} collapsible defaultOpen={false}>
            <RecipeGrid withBlank />
          </WonSection>
        ) : null}
      </s-stack>
    </s-page>
  );
}
