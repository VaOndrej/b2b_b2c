// Pro "Přehled zásahů": where margin protection lowers an ACTIVE discount and by
// how much — pravidlo → produkt, the wanted vs. the allowed discount for one
// item, and why. Computed on the server from the config and the cost mirror,
// never from orders (spec: orders need read_orders, protected customer data;
// real intervention counts arrive with analytics in MVP 7) — the section says
// so (§12). BILL-1: on Free the server sends no data (`impact` null); Free sees
// the amber frame with a sample labelled "Ukázka" (§16c), never the shop's rows.
// The rule editor deep-links to one rule's rows (`?rule=<id>#impact`, §13c).

import { formatMoney } from "@won/core/discounts/describe";
import { currencyExponent } from "@won/core/discounts/money";

import { useT } from "../../i18n/context";
import type { Translator } from "../../i18n";
import { impactGroups, impactProductCount, impactReason, marginImpactHref } from "../model/margin";
import type { MarginImpactRowView, MarginImpactView } from "../model/types";
import { ProFrame } from "../shell/ProFrame";
import { ProSell } from "../shell/ProSell";
import { RowNote, WonBlock, WonRow, WonSection } from "../shell/WonSection";
import { WON_AMBER_TEXT } from "../shell/tokens";

/** Rows shown per rule before "a další" (§3i: never an endless list). */
const ROWS_PER_RULE = 5;

/** The section's state line. */
export function impactSummary(impact: MarginImpactView | null, pro: boolean, enabled: boolean, tr: Translator): string {
  if (!pro) return tr.t("margin.impact.freeSummary");
  if (!impact) return tr.t(enabled ? "margin.impact.waiting" : "margin.impact.unknown");
  const n = impactProductCount(impact);
  const orders = impact.orderRules.length;
  if (n === 0 && orders === 0) return tr.t("margin.impact.none");
  const text = n > 0 ? tr.tp("margin.impact.products", n) : tr.t("margin.impact.orderRules");
  return enabled ? text : `${text} · ${tr.t("margin.impact.off")}`;
}

function ImpactRow({ row, currency, sample = false }: { row: MarginImpactRowView; currency: string; sample?: boolean }) {
  const tr = useT();
  const { t } = tr;
  const money = (minor: number) => formatMoney(minor, currency, tr.locale);
  return (
    <WonRow>
      {sample ? <span style={{ fontSize: 12, fontWeight: 700, color: WON_AMBER_TEXT }}>{t("margin.impact.sample")} · </span> : null}
      <s-text type="strong">{row.title}</s-text>
      <RowNote>
        {t("margin.impact.change", { wanted: money(row.wanted), allowed: money(row.allowed) })} · {impactReason(row, tr)}
      </RowNote>
    </WonRow>
  );
}

function RuleGroup({ ruleId, ruleName, rows, currency }: { ruleId: string; ruleName: string; rows: MarginImpactRowView[]; currency: string }) {
  const tr = useT();
  const { t } = tr;
  const shown = rows.slice(0, ROWS_PER_RULE);
  const rest = rows.slice(ROWS_PER_RULE);
  return (
    <WonBlock title={ruleName.trim() || t("common.untitled")} summary={tr.tp("margin.impact.products", new Set(rows.map((r) => r.productId)).size)}>
      <div>
        {shown.map((row) => (
          <ImpactRow key={`${row.ruleId}-${row.variantId}`} row={row} currency={currency} />
        ))}
        {rest.length > 0 ? (
          <WonBlock title={t("margin.costs.more", { n: rest.length })} collapsible defaultOpen={false}>
            <div>
              {rest.map((row) => (
                <ImpactRow key={`${row.ruleId}-${row.variantId}`} row={row} currency={currency} />
              ))}
            </div>
          </WonBlock>
        ) : null}
        <div style={{ paddingTop: 8 }}>
          <s-link href={`/app/discounts/${encodeURIComponent(ruleId)}#value`}>{t("margin.impact.editRule")}</s-link>
        </div>
      </div>
    </WonBlock>
  );
}

/** The Free preview: two sample rows in the shop currency, labelled "Ukázka" (never the shop's data). */
function samplePreview(currency: string, tr: Translator): MarginImpactRowView[] {
  const scale = 10 ** currencyExponent(currency);
  const base = { ruleId: "sample", ruleName: tr.t("margin.impact.sampleRule"), productId: "sample", title: tr.t("margin.impact.sampleProduct") };
  return [
    { ...base, variantId: "sample-1", wanted: 387 * scale, allowed: 290 * scale, basis: "cost", source: "global" },
    { ...base, variantId: "sample-2", productId: "sample-2", title: tr.t("margin.collections.sampleName"), wanted: 150 * scale, allowed: 100 * scale, basis: "max_percent", source: "collection" },
  ];
}

export function ImpactSection({
  pro,
  enabled,
  impact,
  currency,
  focusRuleId,
}: {
  pro: boolean;
  enabled: boolean;
  /** Null on Free (BILL-1) and when nothing could be computed yet. */
  impact: MarginImpactView | null;
  currency: string;
  /** Only this rule's rows (the rule editor's link). */
  focusRuleId?: string | null;
}) {
  const tr = useT();
  const { t } = tr;
  const groups = pro && impact ? impactGroups(impact.rows, focusRuleId) : [];
  const focused = focusRuleId && impact ? impact.rows.find((r) => r.ruleId === focusRuleId) : undefined;
  const orderRules = pro && impact ? impact.orderRules.filter((r) => !focusRuleId || r.ruleId === focusRuleId) : [];
  return (
    <WonSection
      title={t("margin.impact.title")}
      glyph="target"
      pro
      locked={!pro}
      summary={impactSummary(impact, pro, enabled, tr)}
      collapsible
      defaultOpen={pro || !!focusRuleId}
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
            {focusRuleId ? (
              <s-stack direction="inline" gap="base" alignItems="center">
                <s-text>{t("margin.impact.filtered", { rule: focused?.ruleName || orderRules[0]?.ruleName || t("common.untitled") })}</s-text>
                <s-link href={marginImpactHref(null)}>{t("margin.impact.showAll")}</s-link>
              </s-stack>
            ) : null}
            {!enabled ? <s-text>{t("margin.impact.off")}</s-text> : null}
            {groups.length === 0 && orderRules.length === 0 ? <s-text color="subdued">{t("margin.impact.none")}</s-text> : null}
            {groups.map((group) => (
              <RuleGroup key={group.ruleId} {...group} currency={currency} />
            ))}
            {orderRules.length > 0 ? (
              <WonBlock title={t("margin.impact.orderRules")}>
                <div>
                  {orderRules.map((rule) => (
                    <WonRow
                      key={rule.ruleId}
                      action={<s-link href={`/app/discounts/${encodeURIComponent(rule.ruleId)}#value`}>{t("margin.impact.editRule")}</s-link>}
                    >
                      <s-text type="strong">{rule.ruleName.trim() || t("common.untitled")}</s-text>
                      <RowNote>{tr.tp("margin.impact.orderRule", rule.variantsBelow)}</RowNote>
                    </WonRow>
                  ))}
                </div>
              </WonBlock>
            ) : null}
            {impact.withoutCost > 0 && !focusRuleId ? (
              <s-text color="subdued">
                {t("margin.impact.withoutCost", { variants: tr.tp("count.variant", impact.withoutCost) })}
              </s-text>
            ) : null}
            {impact.rows.length >= 50 && !focusRuleId ? <s-text color="subdued">{t("margin.impact.top", { n: impact.rows.length })}</s-text> : null}
            <s-text color="subdued">{t("margin.impact.model", { currency })}</s-text>
          </>
        )}
      </s-stack>
    </WonSection>
  );
}
