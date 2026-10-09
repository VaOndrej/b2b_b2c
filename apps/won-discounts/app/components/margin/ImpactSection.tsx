// Pro "Přehled zásahů": where margin protection lowers an ACTIVE discount and by
// how much — pravidlo → produkt, the wanted vs. the allowed discount for one
// item, and why. Computed on the server IN THE BACKGROUND from the config and
// the cost mirror, never from orders (spec: orders need read_orders, protected
// customer data; real intervention counts arrive with analytics in MVP 7) —
// the section says so (§12). Counted PER RULE from the core's full counts
// (audit P2-2): each rule says on how many variants it is lowered, and lists
// only its largest losses; the rule editor's number is the same. While the
// numbers are being (re)computed the section says so and shows the last ones.
// BILL-1: on Free the server sends no data (`impact` null); Free sees the
// amber section with one sentence of what it is for and the plan link — no
// invented sample rows (§12). The numbers come from the SAVED settings: while
// the form differs from them the section says so (`unsaved`), and its on / off
// wording follows the live switch.
// The rule editor deep-links to one rule (`?rule=<id>#impact`, §13c) — the
// server narrows the view to it, so it is never empty for a rule outside the
// largest losses.

import { formatMoney } from "@won/core/discounts/describe";

import { useT } from "../../i18n/context";
import { impactReason, impactRuleSummary, marginImpactHref } from "../model/margin";
import type { MarginImpactRowView, MarginImpactRuleView, MarginImpactView } from "../model/types";
import { ProSell } from "../shell/ProSell";
import { RowNote, WonBlock, WonRow, WonSection } from "../shell/WonSection";

/** Rows shown per rule before "a další" (§3i: never an endless list). */
const ROWS_PER_RULE = 5;

function ImpactRow({ row, currency }: { row: MarginImpactRowView; currency: string }) {
  const tr = useT();
  const { t } = tr;
  const money = (minor: number) => formatMoney(minor, currency, tr.locale);
  return (
    <WonRow>
      <s-text type="strong">{row.title.trim() || t("margin.impact.untitledProduct")}</s-text>
      <RowNote>
        {t("margin.impact.change", { wanted: money(row.wanted), allowed: money(row.allowed) })} · {impactReason(row, tr)}
      </RowNote>
    </WonRow>
  );
}

function RuleGroup({ rule, currency, focused }: { rule: MarginImpactRuleView; currency: string; focused: boolean }) {
  const tr = useT();
  const { t } = tr;
  const shown = rule.rows.slice(0, ROWS_PER_RULE);
  const rest = rule.rows.slice(ROWS_PER_RULE);
  const title = rule.ruleName.trim() || t("common.untitled");
  const edit = <s-link href={`/app/discounts/${encodeURIComponent(rule.ruleId)}#value`}>{t("margin.impact.editRule")}</s-link>;
  if (rule.discountClass === "order") {
    return (
      <WonRow action={edit}>
        <s-text type="strong">{title}</s-text>
        <RowNote>{impactRuleSummary(rule, tr)}</RowNote>
      </WonRow>
    );
  }
  return (
    <WonBlock title={title} summary={impactRuleSummary(rule, tr)}>
      <div>
        {shown.map((row) => (
          <ImpactRow key={`${rule.ruleId}-${row.variantId}`} row={row} currency={currency} />
        ))}
        {rest.length > 0 ? (
          <WonBlock title={t("margin.costs.more", { n: rest.length })} collapsible defaultOpen={false}>
            <div>
              {rest.map((row) => (
                <ImpactRow key={`${rule.ruleId}-${row.variantId}`} row={row} currency={currency} />
              ))}
            </div>
          </WonBlock>
        ) : null}
        {rule.rows.length > 0 && rule.variants > rule.rows.length ? (
          <RowNote>{t("margin.impact.shown", { shown: rule.rows.length, total: rule.variants })}</RowNote>
        ) : null}
        {rule.rows.length === 0 && !focused ? (
          // The 200-row cap of the page reached before this rule: its own view lists them.
          <RowNote>
            {t("margin.impact.rowsCapped")} <s-link href={marginImpactHref(rule.ruleId)}>{t("margin.impact.showRule")}</s-link>
          </RowNote>
        ) : null}
        <div style={{ paddingTop: 8 }}>{edit}</div>
      </div>
    </WonBlock>
  );
}

export function ImpactSection({
  pro,
  enabled,
  unsaved = false,
  impact,
  currency,
}: {
  pro: boolean;
  /** The switch as it is in the form now (the section's on / off wording follows it). */
  enabled: boolean;
  /** The form differs from what is saved: the numbers are the saved state's, and say so. */
  unsaved?: boolean;
  /** Null on Free (BILL-1) and when nothing could be computed yet. Narrowed to one rule on the server (`impact.focus`). */
  impact: MarginImpactView | null;
  currency: string;
}) {
  const tr = useT();
  const { t } = tr;
  const focus = impact?.focus ?? null;
  const productRules = impact ? impact.rules.filter((r) => r.discountClass === "product") : [];
  const orderRules = impact ? impact.rules.filter((r) => r.discountClass === "order") : [];
  return (
    <WonSection
      title={t("margin.impact.title")}
      glyph="target"
      pro
      locked={!pro}
      summary={t("margin.view.impact.about")}
      anchor="impact"
    >
      <s-stack direction="block" gap="base">
        {!pro ? (
          <ProSell benefit={t("margin.impact.benefit")} />
        ) : !impact ? (
          // Nothing computed yet: what it waits for and where that is, not an explanation of absent numbers.
          <s-text color="subdued">
            {t(enabled ? "margin.impact.waiting" : "margin.impact.unknown")}.{" "}
            <s-link href={enabled ? "#costs" : "#settings"}>{t(enabled ? "margin.costs.link" : "margin.impact.enableLink")}</s-link>
          </s-text>
        ) : (
          <>
            {unsaved ? <s-text type="strong">{t("margin.impact.saved")}</s-text> : null}
            {focus ? (
              <s-stack direction="inline" gap="base" alignItems="center">
                <s-text>{t("margin.impact.filtered", { rule: focus.ruleName.trim() || t("common.untitled") })}</s-text>
                <s-link href={marginImpactHref(null)}>{t("margin.impact.showAll")}</s-link>
              </s-stack>
            ) : null}
            {impact.status === "computing" ? <s-text color="subdued">{t("margin.impact.computingBody")}</s-text> : null}
            {impact.status === "updating" ? <s-text color="subdued">{t("margin.impact.updatingBody")}</s-text> : null}
            {/* Said only above rows it describes; with none the header already says the protection is off. */}
            {!enabled && impact.rules.length > 0 ? <s-text>{t("margin.impact.off")}</s-text> : null}
            {impact.status !== "computing" && impact.rules.length === 0 ? <s-text color="subdued">{t("margin.impact.none")}</s-text> : null}
            {productRules.map((rule) => (
              <RuleGroup key={rule.ruleId} rule={rule} currency={currency} focused={!!focus} />
            ))}
            {orderRules.length > 0 ? (
              <WonBlock title={t("margin.impact.orderRules")}>
                <div>
                  {orderRules.map((rule) => (
                    <RuleGroup key={rule.ruleId} rule={rule} currency={currency} focused={!!focus} />
                  ))}
                </div>
              </WonBlock>
            ) : null}
            {impact.withoutCost > 0 && !focus ? (
              <s-text color="subdued">{t("margin.impact.withoutCost", { variants: tr.tp("count.variant", impact.withoutCost) })}</s-text>
            ) : null}
            {impact.rules.length > 0 ? <s-text color="subdued">{t("margin.impact.model", { currency })}</s-text> : null}
          </>
        )}
      </s-stack>
    </WonSection>
  );
}
