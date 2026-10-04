// Přehledy (MVP 7, contract M4; spec §8) — what the discounts cost and what the orders with them brought, for the
// last 30 days. Free: the basic numbers and a day-by-day chart. Pro: per discount, cost next to the revenue of
// its orders, gifts given and sale items sold (Free: a labelled example in the amber frame, §16).
// Nothing here claims the app earned money (§12): cost and revenue are stated, the merchant concludes.
// A presentational component: app/routes/app.analytics.tsx renders it from loadAnalyticsScreen, the dev harness
// from a fixture.

import { useT } from "../../i18n/context";
import type { AnalyticsScreenData } from "../model/analytics";
import { ProFrame } from "../shell/ProFrame";
import { RowNote, WonSection } from "../shell/WonSection";
import { WON_AMBER, WON_INK, WON_MUTED } from "../shell/tokens";

export type AnalyticsScreenProps = AnalyticsScreenData;

const BAR = "#2f6fed";

function Tiles({ tiles }: { tiles: AnalyticsScreenData["tiles"] }) {
  const { t } = useT();
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 12 }} data-won-analytics-tiles>
      {tiles.map((tile) => (
        <div key={tile.id} style={{ border: "1px solid #e3e3e3", borderRadius: 12, padding: 12 }}>
          <div style={{ color: WON_MUTED, fontSize: 12 }}>{t(`analytics.tile.${tile.id}` as "analytics.tile.orders")}</div>
          <div style={{ color: WON_INK, fontSize: 22, fontWeight: 600 }}>{tile.value}</div>
        </div>
      ))}
    </div>
  );
}

function Chart({ series }: { series: AnalyticsScreenData["series"] }) {
  const { t } = useT();
  return (
    <div role="img" aria-label={t("analytics.chart.label")} data-won-analytics-chart>
      <div style={{ display: "flex", alignItems: "flex-end", gap: 2, height: 120, borderBottom: "1px solid #e3e3e3" }}>
        {series.map((day) => (
          <div key={day.label} title={day.title} style={{ flex: "1 1 0", minWidth: 0, height: `${Math.max(day.height, day.height > 0 ? 3 : 0)}%`, background: BAR, borderRadius: "3px 3px 0 0" }} />
        ))}
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", color: WON_MUTED, fontSize: 12, marginTop: 4 }}>
        <span>{series[0]?.label}</span>
        <span>{series[series.length - 1]?.label}</span>
      </div>
    </div>
  );
}

function RuleTable({ rows }: { rows: AnalyticsScreenData["rules"] }) {
  const { t } = useT();
  return (
    <div style={{ display: "grid", gap: 8 }} data-won-analytics-rules>
      {rows.map((row) => (
        <div key={row.key} style={{ display: "grid", gap: 4 }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
            <span style={{ color: WON_INK, fontWeight: 600 }}>{row.name}</span>
            <span style={{ color: WON_MUTED }}>{t("analytics.row.line", { orders: row.orders, cost: row.cost, revenue: row.revenue })}</span>
          </div>
          <div style={{ height: 6, background: "#f1f1f1", borderRadius: 3 }}>
            <div style={{ width: `${row.share}%`, height: 6, background: WON_AMBER, borderRadius: 3 }} />
          </div>
        </div>
      ))}
    </div>
  );
}

export function AnalyticsScreen(props: AnalyticsScreenProps) {
  const tr = useT();
  const { t } = tr;
  const { plan, available, days, empty, tiles, series, otherCurrencyOrders, rules, gifts, outletItems, sample } = props;
  const pro = plan === "pro";
  const details = (
    <s-stack direction="block" gap="small-300">
      {sample ? <RowNote>{t(pro ? "analytics.pro.empty" : "analytics.pro.sample")}</RowNote> : null}
      <RuleTable rows={rules} />
      {pro && !sample ? <RowNote>{t("analytics.pro.extras", { gifts, outlet: outletItems })}</RowNote> : null}
      <RowNote>{t("analytics.pro.honest")}</RowNote>
    </s-stack>
  );
  return (
    <s-page heading={t("nav.analytics")}>
      <s-stack direction="block" gap="base">
        {!available ? (
          <s-banner tone="info" heading={t("analytics.unavailable.title")}>
            <s-paragraph>{t("analytics.unavailable.body")}</s-paragraph>
          </s-banner>
        ) : null}
        <WonSection title={t("analytics.basic.title", { days })} glyph="check" summary={empty ? t("analytics.basic.empty") : t("analytics.basic.summary", { cost: tiles.find((x) => x.id === "cost")?.value ?? "" })} anchor="basic">
          <s-stack direction="block" gap="base">
            <Tiles tiles={tiles} />
            <s-text>{t("analytics.chart.title")}</s-text>
            <Chart series={series} />
            {otherCurrencyOrders > 0 ? <RowNote>{t("analytics.otherCurrency", { n: otherCurrencyOrders })}</RowNote> : null}
            <RowNote>{t("analytics.basic.note")}</RowNote>
          </s-stack>
        </WonSection>
        <WonSection title={t("analytics.pro.title")} glyph="plan" pro={!pro} locked={!pro} summary={t(pro ? "analytics.pro.summary" : "analytics.pro.locked")} anchor="rules">
          {pro ? details : <ProFrame locked>{details}</ProFrame>}
        </WonSection>
      </s-stack>
    </s-page>
  );
}
