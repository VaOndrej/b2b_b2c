// Přehled v1 — the admin home (doctrine A3: status first, "what's running and
// what could I turn on next?"). A presentational component rendered by the
// embedded route (app/routes/app._index.tsx, the shop's config + store signals)
// and by the dev harness (app/routes/dev.preview.$.tsx, fixtures), so the harness
// screenshots the real screen (audit P2-5). Props are plain serializable data
// built by buildOverviewProps(); every word comes from i18n + the core formatter.
//
// "Běží" is green only for a rule that really runs (model/rule-status.ts):
// switched on, inside its schedule, evaluable at checkout, written to Shopify.
// With only { schemaVersion, ruleCount, readOnly } the screen still renders every
// section, each stating honestly what is not known yet (§12). No router hook runs
// at this level, so the component also renders outside a router (unit renders).

import type { DiscountRule, OnboardingGoal, WonDiscountsConfig } from "@won/core/discounts/config";

import { useT } from "../../i18n/context";
import type { Translator } from "../../i18n";
import { NativeDiscountsPanel, nativeSummary } from "../NativeDiscounts";
import { RecipeGrid } from "../RecipeGrid";
import { RuleRow } from "../RuleRow";
import { collectWarnings, type RuleWarning } from "../model/describe";
import { currencyCodes, currencyViews } from "../model/markets";
import { orderedModules, UPCOMING_MODULES, UPCOMING_MODULE_META } from "../model/modules";
import { shopToday } from "../model/rule-form";
import { ruleStatus, ruleStatusSummary } from "../model/rule-status";
import { NOT_WIRED_SIGNALS, checkoutText, embedText, statusSummary, syncText } from "../model/signals";
import type { AdminSignals, CurrencyView } from "../model/types";
import { PlanBadge } from "../shell/PlanBadge";
import { RowNote, WonRow, WonSection } from "../shell/WonSection";
import { WON_ATTENTION, WON_FAINT } from "../shell/tokens";

export interface OverviewScreenProps {
  schemaVersion: number;
  ruleCount: number;
  /** The stored config belongs to a newer app version (DATA-3): changes are not saved. */
  readOnly: boolean;
  /** The shop's rules (what runs). Absent → only the count is known. */
  rules?: DiscountRule[];
  currencies?: CurrencyView[];
  /** Onboarding step 1–5 and goals from the config (goals order the modules). */
  onboardingStep?: number;
  goals?: OnboardingGoal[];
  /** Shop-local today and zone: a rule's schedule is judged on the shop's day. */
  today?: string;
  timezone?: string | null;
  /** Store signals (embed, checkout, sync, native discounts). Absent → not connected yet. */
  signals?: AdminSignals;
}

export function buildOverviewProps(
  config: WonDiscountsConfig,
  opts: {
    readOnly: boolean;
    signals?: AdminSignals;
    shopCurrency?: string | null;
    timezone?: string | null;
    marketNames?: Readonly<Record<string, string>>;
    now?: Date;
  },
): OverviewScreenProps {
  const rules = config.modules.codes.rules;
  const timezone = opts.timezone ?? null;
  const props: OverviewScreenProps = {
    schemaVersion: config.schemaVersion,
    ruleCount: rules.length,
    readOnly: opts.readOnly,
    rules,
    currencies: currencyViews(config.markets, { shopCurrency: opts.shopCurrency, rules, marketNames: opts.marketNames }),
    onboardingStep: config.onboarding.step,
    goals: [...config.onboarding.goals],
    today: shopToday(timezone, opts.now),
    timezone,
  };
  if (opts.signals) props.signals = opts.signals;
  return props;
}

const RUNNING_SHOWN = 5;

function warningText(w: RuleWarning, tr: Translator): string {
  const rule = w.ruleName.trim() || tr.t("common.untitled");
  if (w.kind === "unsupported") return tr.t("overview.warning.unsupported", { rule });
  if (w.kind === "missingCurrency") return tr.t("overview.warning.missingCurrency", { rule, currencies: tr.list(w.currencies ?? []) });
  if (w.kind === "noCode") return tr.t("overview.warning.noCode", { rule });
  return tr.t("overview.warning.noTarget", { rule });
}

function warningFix(w: RuleWarning, tr: Translator): string {
  if (w.kind === "unsupported") return tr.t("overview.warning.unsupported.fix");
  if (w.kind === "missingCurrency") return tr.t("overview.warning.missingCurrency.fix");
  if (w.kind === "noCode") return tr.t("overview.warning.noCode.fix");
  return tr.t("overview.warning.noTarget.fix");
}

export function OverviewScreen({
  schemaVersion,
  ruleCount,
  readOnly,
  rules,
  currencies = [],
  onboardingStep,
  goals = [],
  today,
  timezone = null,
  signals,
}: OverviewScreenProps) {
  const tr = useT();
  const { t } = tr;
  const codes = currencyCodes(currencies);
  const status = signals ?? NOT_WIRED_SIGNALS;
  const warnings = rules ? collectWarnings(rules, codes) : [];
  const statusCtx = { today: today ?? null, timezone, sync: status.sync };
  const statuses = (rules ?? []).map((rule) => ruleStatus(rule, statusCtx));
  const liveCount = statuses.filter((s) => s.kind === "live").length;
  const showOnboarding = onboardingStep !== undefined && onboardingStep <= 3 && ruleCount === 0;
  const embedNeedsAction = status.embed.state !== "on" && status.embed.activateUrl !== null;
  const summary =
    ruleCount === 0 ? t("overview.running.none") : rules ? ruleStatusSummary(statuses, tr) : tr.tp("count.discount", ruleCount);

  return (
    <s-page heading="Won Discounts">
      {readOnly ? (
        <s-banner tone="warning" heading={t("common.readOnly.heading")}>
          {t("common.readOnly.body")}
        </s-banner>
      ) : null}

      <s-stack direction="block" gap="base">
        {showOnboarding ? (
          <WonSection
            title={t("overview.onboarding.title")}
            glyph="spark"
            summary={t("overview.onboarding.summary", { step: Math.max(1, onboardingStep ?? 1) })}
          >
            <s-button variant="primary" href="/app/onboarding">
              {t("overview.onboarding.cta")}
            </s-button>
          </WonSection>
        ) : null}

        <WonSection
          title={t("overview.running.title")}
          glyph="tag"
          summary={summary}
          // Green only when something really runs; otherwise the summary says what is going on.
          on={liveCount > 0 ? true : undefined}
        >
          {ruleCount === 0 ? (
            // §15: the empty state teaches — the shape of success + one next step.
            <s-stack direction="block" gap="base">
              <s-paragraph>{t("overview.running.emptyBody")}</s-paragraph>
              <RecipeGrid />
            </s-stack>
          ) : (
            <div>
              {(rules ?? []).slice(0, RUNNING_SHOWN).map((rule, i) => (
                <RuleRow key={rule.id} rule={rule} status={statuses[i]} currencies={codes} timezone={timezone} />
              ))}
              <WonRow
                action={
                  <s-button href="/app/discounts" variant="secondary">
                    {t("overview.running.manage")}
                  </s-button>
                }
              >
                {rules && rules.length > RUNNING_SHOWN ? (
                  <s-text color="subdued">{t("overview.running.more", { n: rules.length - RUNNING_SHOWN })}</s-text>
                ) : null}
              </WonRow>
            </div>
          )}
        </WonSection>

        {warnings.length > 0 ? (
          <WonSection title={t("overview.warnings.title")} glyph="alert" summary={tr.tp("count.warning", warnings.length)}>
            <div>
              {warnings.map((w) => (
                <WonRow
                  key={`${w.kind}-${w.ruleId}`}
                  tone="attention"
                  action={
                    // §13a: the diagnosis ships its own fix link, to the exact field (§13c).
                    <s-button href={`/app/discounts/${encodeURIComponent(w.ruleId)}#${w.field}`} variant="secondary">
                      {warningFix(w, tr)}
                    </s-button>
                  }
                >
                  <span style={{ color: WON_ATTENTION, fontWeight: 600, fontSize: 12.5 }}>{t("common.attention")} · </span>
                  <s-text>{warningText(w, tr)}</s-text>
                </WonRow>
              ))}
            </div>
          </WonSection>
        ) : null}

        <WonSection title={t("overview.status.title")} glyph="store" summary={statusSummary(status, tr)}>
          <div>
            <WonRow
              action={
                embedNeedsAction ? (
                  <s-button href={status.embed.activateUrl ?? undefined} target="_blank" variant="secondary">
                    {t("overview.embed.activate")}
                  </s-button>
                ) : undefined
              }
            >
              <s-text type="strong">{t("overview.embed.label")}</s-text>
              <RowNote>{embedText(status.embed.state, tr)}</RowNote>
            </WonRow>
            <WonRow>
              <s-text type="strong">{t("overview.checkout.label")}</s-text>
              <RowNote>{checkoutText(status.checkout, tr)}</RowNote>
            </WonRow>
            <WonRow
              action={
                status.sync.state === "error" ? (
                  <s-button href="/app/discounts" variant="secondary">
                    {t("overview.sync.errorFix")}
                  </s-button>
                ) : undefined
              }
            >
              <s-text type="strong">{t("overview.sync.label")}</s-text>
              <RowNote>{syncText(status.sync, tr)}</RowNote>
            </WonRow>
          </div>
        </WonSection>

        <WonSection title={t("overview.native.title")} glyph="move" summary={nativeSummary(status.native, tr)}>
          <NativeDiscountsPanel native={status.native} mode="each" />
        </WonSection>

        <WonSection
          title={t("overview.modules.title")}
          glyph="layers"
          summary={t("overview.modules.summary", { modules: tr.tp("count.module", UPCOMING_MODULES.length) })}
          collapsible
          defaultOpen={false}
        >
          <div>
            {orderedModules(goals).map((key) => {
              const meta = UPCOMING_MODULE_META[key];
              return (
                <WonRow key={key} action={<s-link href={`/app/${key}`}>{t("soon.state")}</s-link>}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    <s-text type="strong">{t(meta.title)}</s-text>
                    {meta.pro ? <PlanBadge tier="pro" /> : null}
                  </div>
                  <RowNote>{t(meta.body)}</RowNote>
                </WonRow>
              );
            })}
          </div>
        </WonSection>

        <div style={{ fontSize: 12, color: WON_FAINT, padding: "0 4px" }}>
          <s-paragraph color="subdued">
            {t("overview.configLine", { version: schemaVersion, rules: tr.tp("count.rule", ruleCount) })}
          </s-paragraph>
        </div>
      </s-stack>
    </s-page>
  );
}
