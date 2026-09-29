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
// amber frame with a sample labelled "Ukázka" (§16c), never the shop's rows.
// The rule editor deep-links to one rule (`?rule=<id>#impact`, §13c) — the
// server narrows the view to it, so it is never empty for a rule outside the
// largest losses.

import { formatMoney } from "@won/core/discounts/describe";
import { currencyExponent } from "@won/core/discounts/money";

import { useT } from "../../i18n/context";
import type { Translator } from "../../i18n";
import { impactReason, impactRuleSummary, impactSummary, marginImpactHref } from "../model/margin";
import type { MarginImpactRowView, MarginImpactRuleView, MarginImpactView } from "../model/types";
import { ProFrame } from "../shell/ProFrame";
import { ProSell } from "../shell/ProSell";
import { RowNote, WonBlock, WonRow, WonSection } from "../shell/WonSection";
import { WON_AMBER_TEXT } from "../shell/tokens";

/** Rows shown per rule before "a další" (§3i: never an endless list). */
const ROWS_PER_RULE = 5;

export { impactSummary };

function ImpactRow({ row, currency, sample = false }: { row: MarginImpactRowView; currency: string; sample?: boolean }) {
  const tr = useT();
  const { t } = tr;
  const money = (minor: number) => formatMoney(minor, currency, tr.locale);
  return (
    <WonRow>
      {sample ? <span style={{ fontSize: 12, fontWeight: 700, color: WON_AMBER_TEXT }}>{t("margin.impact.sample")} · </span> : null}
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

/** The Free preview: two sample rows in the shop currency, labelled "Ukázka" (never the shop's data). */
function samplePreview(currency: string, tr: Translator): MarginImpactRowView[] {
  const scale = 10 ** currencyExponent(currency);
  return [
    { productId: "sample", variantId: "sample-1", title: tr.t("margin.impact.sampleProduct"), wanted: 387 * scale, allowed: 290 * scale, basis: "cost", source: "global" },
    {
      productId: "sample-2",
      variantId: "sample-2",
      title: tr.t("margin.collections.sampleName"),
      wanted: 150 * scale,
      allowed: 100 * scale,
      basis: "max_percent",
      source: "collection",
    },
  ];
}

export function ImpactSection({
  pro,
  enabled,
  impact,
  currency,
}: {
  pro: boolean;
  enabled: boolean;
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
      summary={impactSummary(impact, pro, enabled, tr)}
      collapsible
      defaultOpen={pro || !!focus}
      anchor="impact"
    >
      <s-stack direction="block" gap="base">
        {!pro ? (
          <>
            <ProSell benefit={t("margin.impact.benefit")} />
            <ProFrame locked>
              <div>
                {samplePreview(currency, tr).map((row) => (
                  <ImpactRow key={row.variantId} row={row} currency={currency} sample />
                ))}
              </div>
            </ProFrame>
          </>
        ) : !impact ? (
          <s-text color="subdued">{t("margin.impact.model", { currency })}</s-text>
        ) : (
          <>
            {focus ? (
              <s-stack direction="inline" gap="base" alignItems="center">
                <s-text>{t("margin.impact.filtered", { rule: focus.ruleName.trim() || t("common.untitled") })}</s-text>
                <s-link href={marginImpactHref(null)}>{t("margin.impact.showAll")}</s-link>
              </s-stack>
            ) : null}
            {impact.status === "computing" ? <s-text color="subdued">{t("margin.impact.computingBody")}</s-text> : null}
            {impact.status === "updating" ? <s-text color="subdued">{t("margin.impact.updatingBody")}</s-text> : null}
            {!enabled ? <s-text>{t("margin.impact.off")}</s-text> : null}
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
            <s-text color="subdued">{t("margin.impact.model", { currency })}</s-text>
          </>
        )}
      </s-stack>
    </WonSection>
  );
}
