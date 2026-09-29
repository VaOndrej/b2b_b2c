// §10 Effect Proof for the margin floor: one product (1 000 in the shop
// currency, cost 600, a 50 % discount) without protection, with it, and without
// a cost price — each as a bar of what the shopper pays against the cost price.
// The numbers are core marginFloorUnit (model/margin.ts marginProof), the same
// floor checkout uses (§10b), and follow what is typed (§10c, §17b).

import { formatMoney } from "@won/core/discounts/describe";

import { useT } from "../../i18n/context";
import { marginProof, percentText } from "../model/margin";
import type { MarginSettingsView } from "../model/types";
import { WON_FAINT, WON_FONT, WON_INK, WON_LINE, WON_MUTED, WON_WASH } from "../shell/tokens";

function Bar({ label, pays, price, cost, note }: { label: string; pays: number; price: number; cost: number | null; note: string }) {
  const width = price > 0 ? Math.max(0, Math.min(100, (pays / price) * 100)) : 0;
  const costAt = cost !== null && price > 0 ? Math.min(100, (cost / price) * 100) : null;
  return (
    <div style={{ display: "grid", gap: 4 }}>
      <div style={{ fontSize: 12.5, lineHeight: 1.4 }}>
        <span style={{ fontWeight: 700, color: WON_INK }}>{label}</span>
        <span style={{ display: "block", color: WON_MUTED }}>{note}</span>
      </div>
      <div aria-hidden="true" style={{ position: "relative", height: 10, borderRadius: 999, background: "#e9edf1", overflow: "hidden" }}>
        <div style={{ position: "absolute", inset: 0, width: `${width}%`, background: "#48525f", borderRadius: 999 }} />
        {costAt !== null ? (
          <div style={{ position: "absolute", top: 0, bottom: 0, left: `calc(${costAt}% - 1px)`, width: 2, background: "#ffffff" }} />
        ) : null}
      </div>
    </div>
  );
}

export function MarginProof({ settings, currency }: { settings: MarginSettingsView; currency: string }) {
  const tr = useT();
  const { t } = tr;
  const proof = marginProof(settings, currency);
  const money = (minor: number) => formatMoney(minor, currency, tr.locale);
  const pct = (n: number) => percentText(n, tr);
  return (
    <div
      style={{
        fontFamily: WON_FONT,
        background: WON_WASH,
        border: `1px solid ${WON_LINE}`,
        borderRadius: 11,
        padding: 12,
        display: "grid",
        gap: 10,
      }}
    >
      <div>
        <div style={{ fontSize: 13, fontWeight: 700, color: WON_INK }}>{t("margin.proof.title")}</div>
        <div style={{ fontSize: 12.5, lineHeight: 1.4, color: WON_MUTED, marginTop: 2 }}>
          {t("margin.proof.item", { price: money(proof.price), cost: money(proof.cost), percent: pct(proof.wantedPercent) })}
        </div>
      </div>
      <Bar
        label={t("margin.proof.without")}
        pays={proof.withoutPays}
        price={proof.price}
        cost={proof.cost}
        note={[t("margin.proof.pays", { price: money(proof.withoutPays) }), t("margin.proof.margin", { percent: pct(proof.withoutMarginPercent) })].join(" · ")}
      />
      <Bar
        label={t("margin.proof.with")}
        pays={proof.withPays}
        price={proof.price}
        cost={proof.cost}
        note={[
          t("margin.proof.pays", { price: money(proof.withPays) }),
          t("margin.proof.margin", { percent: pct(proof.withMarginPercent) }),
          t("margin.proof.discount", { percent: pct(proof.withDiscountPercent) }),
        ].join(" · ")}
      />
      <Bar
        label={t("margin.proof.noCost")}
        pays={proof.noCostPays}
        price={proof.price}
        cost={null}
        note={[t("margin.proof.pays", { price: money(proof.noCostPays) }), t("margin.proof.discount", { percent: pct(proof.noCostDiscountPercent) })].join(" · ")}
      />
      {!settings.enabled ? <div style={{ fontSize: 12, color: WON_FAINT }}>{t("margin.proof.off")}</div> : null}
    </div>
  );
}
