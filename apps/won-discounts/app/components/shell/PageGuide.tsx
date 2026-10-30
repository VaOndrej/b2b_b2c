// The explanation at the top of a page (model/page-guides.ts): the sentence and three numbered steps on the left, what
// the customer sees on the right. The name of the page stays in the s-page heading above. It starts open; a merchant
// who knows the page hides it, per page, in this browser.

import { useSyncExternalStore, type CSSProperties, type ReactNode } from "react";

import { useT } from "../../i18n/context";
import type { MessageKey } from "../../i18n";
import { guideHidden, guideIsPro, guideSteps, setGuideHidden, subscribeGuideHidden, type GuidePage } from "../model/page-guides";
import { hoverMark } from "./hover";
import { PlanBadge } from "./PlanBadge";
import { WON_FONT, WON_INK, WON_LINE, WON_LIVE, WON_MUTED, WON_SELECT, WON_SURFACE, WON_WASH } from "./tokens";

const ROW: CSSProperties = { display: "flex", justifyContent: "space-between", gap: 12, padding: "3px 0" };
const OFF: CSSProperties = { color: WON_LIVE, fontWeight: 600 };
const TOTAL: CSSProperties = { ...ROW, marginTop: 4, paddingTop: 7, borderTop: `1px solid ${WON_LINE}`, fontWeight: 700 };
const BAR: CSSProperties = { height: 8, margin: "10px 0 6px", borderRadius: 999, background: WON_LINE, overflow: "hidden" };
const CELL: CSSProperties = { padding: "5px 0", borderTop: `1px solid ${WON_LINE}` };
const HEAD_CELL: CSSProperties = { padding: "5px 0", fontSize: 12, color: WON_MUTED };

function Rows({ rows, total }: { rows: [MessageKey, MessageKey, boolean?][]; total?: [MessageKey, MessageKey] }) {
  const { t } = useT();
  return (
    <>
      {rows.map(([label, value, good]) => (
        <div key={label} style={ROW}>
          <span>{t(label)}</span>
          <span style={good === undefined ? undefined : good ? OFF : { color: WON_MUTED }}>{t(value)}</span>
        </div>
      ))}
      {total ? (
        <div style={TOTAL}>
          <span>{t(total[0])}</span>
          <span style={OFF}>{t(total[1])}</span>
        </div>
      ) : null}
    </>
  );
}

function Preview({ page }: { page: GuidePage }) {
  const { t } = useT();
  switch (page) {
    case "discounts":
      return (
        <>
          <div style={ROW}>
            <span>{t("guide.preview.subtotal")}</span>
            <span>{t("guide.preview.price")}</span>
          </div>
          <div style={{ ...ROW, ...OFF }}>
            <span>{t("guide.preview.code")}</span>
            <span>{t("guide.preview.codeOff")}</span>
          </div>
          <div style={{ ...TOTAL }}>
            <span>{t("guide.preview.total")}</span>
            <span>{t("guide.preview.totalValue")}</span>
          </div>
        </>
      );
    case "rewards":
      return (
        <>
          <div style={{ fontWeight: 700 }}>{t("guide.preview.reward")}</div>
          <div style={BAR}>
            <div style={{ width: "80%", height: "100%", background: WON_LIVE }} />
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: WON_MUTED }}>
            <span>{t("guide.preview.rewardFrom")}</span>
            <span>{t("guide.preview.rewardTo")}</span>
          </div>
        </>
      );
    case "tiers":
      return (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr" }}>
          <span style={HEAD_CELL}>{t("guide.preview.tierQty")}</span>
          <span style={HEAD_CELL}>{t("guide.preview.tierOff")}</span>
          <span style={CELL}>{t("guide.preview.tier3")}</span>
          <span style={{ ...CELL, ...OFF }}>{t("guide.preview.tier3Off")}</span>
          <span style={CELL}>{t("guide.preview.tier5")}</span>
          <span style={{ ...CELL, ...OFF }}>{t("guide.preview.tier5Off")}</span>
        </div>
      );
    case "outlet":
      return (
        <>
          <span style={{ display: "inline-flex", padding: "2px 8px", borderRadius: 6, background: WON_INK, color: "#fff", fontSize: 12, fontWeight: 600 }}>{t("guide.preview.outletBadge")}</span>
          <div style={{ marginTop: 8 }}>
            <b>{t("guide.preview.outletPrice")}</b>
            <s style={{ marginLeft: 6, color: WON_MUTED }}>{t("guide.preview.price")}</s>
          </div>
        </>
      );
    case "campaigns":
      return <div style={{ padding: "9px 12px", borderRadius: 8, background: WON_INK, color: "#fff", textAlign: "center", fontWeight: 600 }}>{t("guide.preview.campaign")}</div>;
    case "placements":
      return (
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <span aria-hidden="true" style={{ position: "relative", flex: "0 0 auto", width: 96, height: 72, borderRadius: 6, background: WON_WASH, border: "1px solid #d6dbe1", overflow: "hidden" }}>
            <span style={{ position: "absolute", left: 0, right: 0, top: 0, height: 12, background: WON_SELECT }} />
            <span style={{ position: "absolute", right: 0, top: 12, bottom: 0, width: 30, background: "rgba(26,115,232,.45)" }} />
          </span>
          <span>{t("guide.preview.places")}</span>
        </div>
      );
    case "margin":
      return (
        <Rows
          rows={[
            ["guide.preview.marginPrice", "guide.preview.price"],
            ["guide.preview.marginCost", "guide.preview.marginCostValue"],
            ["guide.preview.marginOff", "guide.preview.marginOffValue"],
          ]}
          total={["guide.preview.marginResult", "guide.preview.marginResultValue"]}
        />
      );
    case "tryCart":
      return (
        <Rows
          rows={[
            ["guide.preview.tryTier", "guide.preview.tryApplies", true],
            ["guide.preview.tryShipping", "guide.preview.tryApplies", true],
            ["guide.preview.code", "guide.preview.tryNot", false],
          ]}
        />
      );
    case "analytics":
      return (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: 8 }}>
          {(
            [
              ["analytics.tile.orders", "guide.preview.statOrders"],
              ["analytics.tile.discounted", "guide.preview.statDiscounted"],
              ["analytics.tile.cost", "guide.preview.statCost"],
              ["analytics.tile.average", "guide.preview.statAverage"],
            ] as const
          ).map(([label, value]) => (
            <div key={label} style={{ padding: "8px 10px", borderRadius: 8, background: WON_WASH }}>
              <span style={{ display: "block", fontSize: 12, color: WON_MUTED }}>{t(label)}</span>
              <b style={{ fontSize: 16 }}>{t(value)}</b>
            </div>
          ))}
        </div>
      );
    case "translations":
      return (
        <div style={{ display: "grid", gridTemplateColumns: "30px minmax(0,1fr)", gap: "6px 8px" }}>
          <b style={{ fontSize: 12, color: WON_MUTED, paddingTop: 2 }}>CS</b>
          <span>{t("guide.preview.langCs")}</span>
          <b style={{ fontSize: 12, color: WON_MUTED, paddingTop: 2 }}>EN</b>
          <span>{t("guide.preview.langEn")}</span>
        </div>
      );
    case "settings":
      return (
        <Rows
          rows={[
            ["guide.preview.setCombine", "guide.preview.setCombineValue", false],
            ["guide.preview.setMarkets", "guide.preview.setMarketsValue", false],
            ["guide.preview.setPlan", "guide.preview.setPlanValue", false],
          ]}
        />
      );
  }
}

function Toggle({ page, hidden, children }: { page: GuidePage; hidden: boolean; children: ReactNode }) {
  return (
    <button
      type="button"
      data-won-guide-toggle=""
      {...hoverMark("chip")}
      onClick={() => setGuideHidden(page, !hidden)}
      style={{ flex: "0 0 auto", padding: "3px 10px", border: `1px solid ${WON_LINE}`, borderRadius: 999, background: WON_SURFACE, font: "inherit", fontSize: 12, fontWeight: 500, color: WON_MUTED, cursor: "pointer" }}
    >
      {children}
    </button>
  );
}

export function PageGuide({ page }: { page: GuidePage }) {
  const { t } = useT();
  const hidden = useSyncExternalStore(
    subscribeGuideHidden,
    () => guideHidden(page),
    () => false,
  );
  if (hidden) {
    return (
      <div data-won-guide-closed={page} style={{ display: "flex", justifyContent: "flex-end", marginBottom: 12, fontFamily: WON_FONT }}>
        <Toggle page={page} hidden>
          {t("guide.show")}
        </Toggle>
      </div>
    );
  }
  return (
    <div data-won-guide={page} style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,320px),1fr))", gap: "16px 32px", alignItems: "center", marginBottom: 16, fontFamily: WON_FONT, color: WON_INK }}>
      <div style={{ minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
          <p style={{ margin: 0, fontSize: 15, lineHeight: 1.5, fontWeight: 600 }}>
            {t(`guide.${page}.about`)}
            {guideIsPro(page) ? (
              <span data-won-guide-pro="" style={{ marginLeft: 8, verticalAlign: 1 }}>
                <PlanBadge tier="pro" />
              </span>
            ) : null}
          </p>
          <Toggle page={page} hidden={false}>
            {t("guide.hide")}
          </Toggle>
        </div>
        <ol style={{ display: "flex", flexDirection: "column", gap: 10, margin: "14px 0 0", padding: 0, listStyle: "none" }}>
          {guideSteps(page).map((step, index) => (
            <li key={step.title} data-won-guide-step="" style={{ display: "flex", gap: 10, minWidth: 0 }}>
              <span aria-hidden="true" style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", flex: "0 0 auto", width: 24, height: 24, borderRadius: "50%", background: WON_INK, color: "#fff", fontSize: 12, fontWeight: 700 }}>
                {index + 1}
              </span>
              <span style={{ minWidth: 0 }}>
                <b style={{ display: "block", paddingTop: 3, fontSize: 13.5, lineHeight: 1.3 }}>{t(step.title)}</b>
                <span style={{ display: "block", fontSize: 13, lineHeight: 1.4, color: WON_MUTED }}>{t(step.text)}</span>
              </span>
            </li>
          ))}
        </ol>
      </div>
      <div style={{ minWidth: 0, padding: 18, borderRadius: 14, background: WON_WASH }}>
        <small style={{ display: "block", marginBottom: 10, fontSize: 12, fontWeight: 600, color: WON_MUTED }}>{t(`guide.${page}.preview`)}</small>
        <div style={{ padding: 14, borderRadius: 10, background: WON_SURFACE, border: `1px solid ${WON_LINE}`, fontSize: 13.5, lineHeight: 1.4 }}>
          <Preview page={page} />
        </div>
      </div>
    </div>
  );
}
