// Přehled v1 — the admin home (doctrine A3: status first, "what's running and
// what could I turn on next?"). A presentational component rendered by the
// embedded route (app/routes/app._index.tsx, the shop's config + store signals)
// and by the dev harness (app/routes/dev.preview.$.tsx, fixtures), so the harness
// screenshots the real screen (audit P2-5). Props are plain serializable data
// built by buildOverviewProps(); every word comes from i18n + model/describe.ts.
//
// With only { schemaVersion, ruleCount, readOnly } (a shop whose store signals are
// not connected yet) the screen still renders every section, each stating
// honestly what is not known yet (§12). No router hook runs at this level, so the
// component also renders outside a router (unit renders); the parts that submit
// (native discounts) mount only when there is something to submit.

import type { DiscountRule, WonDiscountsConfig } from "@won/core/discounts/config";

import { useT } from "../../i18n/context";
import type { Translator } from "../../i18n";
import { NativeDiscountsPanel, nativeSummary } from "../NativeDiscounts";
import { RecipeGrid } from "../RecipeGrid";
import { collectWarnings, describeRuleLine, ruleName, type RuleWarning } from "../model/describe";
import { currencyCodes, currencyViews } from "../model/markets";
import { UPCOMING_MODULES, UPCOMING_MODULE_META } from "../model/modules";
import { NOT_WIRED_SIGNALS, checkoutText, embedText, statusSummary, syncText } from "../model/signals";
import type { AdminSignals, CurrencyView } from "../model/types";
import { PlanBadge } from "../shell/PlanBadge";
import { StatusPill, WonRow, WonSection } from "../shell/WonSection";
import { WON_ATTENTION, WON_FAINT, WON_MUTED } from "../shell/tokens";

export interface OverviewScreenProps {
  schemaVersion: number;
  ruleCount: number;
  /** The stored config belongs to a newer app version (DATA-3): changes are not saved. */
  readOnly: boolean;
  /** The shop's rules (what runs). Absent → only the count is known. */
  rules?: DiscountRule[];
  currencies?: CurrencyView[];
  /** Onboarding step 1–5 from the config. */
  onboardingStep?: number;
  /** Store signals (embed, checkout, sync, native discounts). Absent → not connected yet. */
  signals?: AdminSignals;
}

export function buildOverviewProps(
  config: WonDiscountsConfig,
  opts: { readOnly: boolean; signals?: AdminSignals; shopCurrency?: string | null },
): OverviewScreenProps {
  const rules = config.modules.codes.rules;
  const props: OverviewScreenProps = {
    schemaVersion: config.schemaVersion,
    ruleCount: rules.length,
    readOnly: opts.readOnly,
    rules,
    currencies: currencyViews(config.markets, { shopCurrency: opts.shopCurrency, rules }),
    onboardingStep: config.onboarding.step,
  };
  if (opts.signals) props.signals = opts.signals;
  return props;
}

const RUNNING_SHOWN = 5;

function runningSummary(rules: readonly DiscountRule[] | undefined, ruleCount: number, tr: Translator): string {
  if (ruleCount === 0) return tr.t("overview.running.none");
  if (!rules) return tr.tp("count.discount", ruleCount);
  const live = rules.filter((r) => r.enabled).length;
  const off = rules.length - live;
  return [tr.tp("count.discount", rules.length), tr.tp("count.live", live), off > 0 ? tr.tp("count.off", off) : ""]
    .filter(Boolean)
    .join(" · ");
}

function warningText(w: RuleWarning, tr: Translator): string {
  const rule = w.ruleName.trim() || tr.t("common.untitled");
  if (w.kind === "missingCurrency") return tr.t("overview.warning.missingCurrency", { rule, currencies: tr.list(w.currencies ?? []) });
  if (w.kind === "noCode") return tr.t("overview.warning.noCode", { rule });
  return tr.t("overview.warning.noTarget", { rule });
}

function warningFix(w: RuleWarning, tr: Translator): string {
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
  signals,
}: OverviewScreenProps) {
  const tr = useT();
  const { t } = tr;
  const codes = currencyCodes(currencies);
  const status = signals ?? NOT_WIRED_SIGNALS;
  const warnings = rules ? collectWarnings(rules, codes) : [];
  const liveCount = rules ? rules.filter((r) => r.enabled).length : 0;
  const showOnboarding = onboardingStep !== undefined && onboardingStep <= 3 && ruleCount === 0;
  const embedNeedsAction = status.embed.state !== "on" && status.embed.activateUrl !== null;

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
          summary={runningSummary(rules, ruleCount, tr)}
          on={ruleCount > 0 ? liveCount > 0 : undefined}
        >
          {ruleCount === 0 ? (
            // §15: the empty state teaches — the shape of success + one next step.
            <s-stack direction="block" gap="base">
              <s-paragraph>{t("overview.running.emptyBody")}</s-paragraph>
              <RecipeGrid />
            </s-stack>
          ) : (
            <div>
              {(rules ?? []).slice(0, RUNNING_SHOWN).map((rule) => (
                <WonRow key={rule.id}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    <s-text type="strong">{ruleName(rule, tr)}</s-text>
                    <StatusPill on={rule.enabled} />
                  </div>
                  <div style={{ fontSize: 12.5, color: WON_MUTED, marginTop: 2 }}>{describeRuleLine(rule, tr, codes)}</div>
                </WonRow>
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
              <div style={{ fontSize: 12.5, color: WON_MUTED, marginTop: 2 }}>{embedText(status.embed.state, tr)}</div>
            </WonRow>
            <WonRow>
              <s-text type="strong">{t("overview.checkout.label")}</s-text>
              <div style={{ fontSize: 12.5, color: WON_MUTED, marginTop: 2 }}>{checkoutText(status.checkout, tr)}</div>
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
              <div style={{ fontSize: 12.5, color: WON_MUTED, marginTop: 2 }}>{syncText(status.sync, tr)}</div>
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
            {UPCOMING_MODULES.map((key) => {
              const meta = UPCOMING_MODULE_META[key];
              return (
                <WonRow key={key} action={<s-link href={`/app/${key}`}>{t("soon.state")}</s-link>}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    <s-text type="strong">{t(meta.title)}</s-text>
                    {meta.pro ? <PlanBadge tier="pro" /> : null}
                  </div>
                  <div style={{ fontSize: 12.5, color: WON_MUTED, marginTop: 2 }}>{t(meta.body)}</div>
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
