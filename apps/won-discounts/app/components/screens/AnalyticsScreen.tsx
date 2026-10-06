// Přehledy (MVP 7, contract M4; spec §8) — what the discounts cost and what the orders with them brought, for the
// last 30 days. Free: the basic numbers and a day-by-day chart. Pro: per discount, cost next to the revenue of
// its orders, gifts given and sale items sold (Free: a labelled example in the amber frame, §16).
// Nothing here claims the app earned money (§12): cost and revenue are stated, the merchant concludes.
// A presentational component: app/routes/app.analytics.tsx renders it from loadAnalyticsScreen, the dev harness
// from a fixture.
// P2: without numbers (no access to orders, or no order yet) the page is one sentence and one next step — no
// tiles of zeros, no empty chart. P8: a Pro shop never sees invented rows; the example lives only in the locked
// Free frame, under the sentence that says what Pro adds (ProSell). P3/P4: rows link to where they are set up,
// gifts and sale items to their modules, and the currencies left out are named.

import { useT } from "../../i18n/context";
import type { AnalyticsScreenData } from "../model/analytics";
import { ProFrame } from "../shell/ProFrame";
import { ProSell } from "../shell/ProSell";
import { RowNote, WonRow, WonSection } from "../shell/WonSection";
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
            {row.href ? (
              <s-link href={row.href}>
                <span style={{ fontWeight: 600 }}>{row.name}</span>
              </s-link>
            ) : (
              <span style={{ color: WON_INK, fontWeight: 600 }}>{row.name}</span>
            )}
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
  const { plan, available, days, empty, tiles, series, otherCurrencyOrders, otherCurrencies = [], rules, gifts, outletItems, sample } = props;
  const pro = plan === "pro";
  const noData = !available || empty;
  return (
    <s-page heading={t("nav.analytics")}>
      <s-stack direction="block" gap="base">
        {noData ? (
          // One sentence and one next step: there is nothing to chart yet.
          <WonSection
            title={t("analytics.basic.title", { days })}
            glyph="check"
            summary={t(available ? "analytics.empty.summary" : "analytics.unavailable.summary")}
            anchor="basic"
          >
            <div data-won-analytics-empty>
              <s-button href="/app/discounts" variant="secondary">
                {t("analytics.empty.next")}
              </s-button>
            </div>
          </WonSection>
        ) : (
          <WonSection title={t("analytics.basic.title", { days })} glyph="check" summary={t("analytics.basic.summary", { cost: tiles.find((x) => x.id === "cost")?.value ?? "" })} anchor="basic">
            <s-stack direction="block" gap="base">
              <Tiles tiles={tiles} />
              <s-text>{t("analytics.chart.title")}</s-text>
              <Chart series={series} />
              {otherCurrencyOrders > 0 ? (
                <RowNote>
                  {otherCurrencies.length > 0
                    ? t("analytics.otherCurrencyNamed", { n: otherCurrencyOrders, currencies: tr.list(otherCurrencies) })
                    : t("analytics.otherCurrency", { n: otherCurrencyOrders })}
                </RowNote>
              ) : null}
            </s-stack>
          </WonSection>
        )}
        {pro ? (
          // Pro: the shop's own rows; without any, one sentence (never an example). Nothing at all while the page has no numbers.
          noData ? null : (
            <WonSection title={t("analytics.pro.title")} glyph="plan" summary={t(rules.length > 0 ? "analytics.pro.summary" : "analytics.pro.none")} anchor="rules">
              {rules.length > 0 ? (
                <s-stack direction="block" gap="small-300">
                  <RuleTable rows={rules} />
                  <div>
                    <WonRow action={<s-link href="/app/rewards">{t("nav.rewards")}</s-link>}>
                      <RowNote>{t("analytics.pro.gifts", { n: gifts })}</RowNote>
                    </WonRow>
                    <WonRow action={<s-link href="/app/outlet">{t("module.outlet")}</s-link>}>
                      <RowNote>{t("analytics.pro.outlet", { n: outletItems })}</RowNote>
                    </WonRow>
                  </div>
                  <RowNote>{t("analytics.pro.honest")}</RowNote>
                </s-stack>
              ) : null}
            </WonSection>
          )
        ) : (
          <WonSection title={t("analytics.pro.title")} glyph="plan" pro locked summary={t("analytics.pro.locked")} anchor="rules">
            <s-stack direction="block" gap="small-300">
              <ProSell benefit={t("analytics.pro.benefit")} />
              <ProFrame locked>
                <s-stack direction="block" gap="small-300">
                  {sample ? <RowNote>{t("analytics.pro.sample")}</RowNote> : null}
                  <RuleTable rows={rules} />
                </s-stack>
              </ProFrame>
            </s-stack>
          </WonSection>
        )}
      </s-stack>
    </s-page>
  );
}
