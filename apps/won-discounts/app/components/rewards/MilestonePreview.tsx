// Milníky: the ladder as the customer sees it (feedback 6 Oct 2026, bod 9: "náhled nahoře, mění se s každou
// úpravou"). Drawn from the page's LIVE form in the three sizes the storefront has (extensions/…/snippets/
// won-milestones.liquid): the strip (one sentence + a thin track), the compact one (a track with a mark per step
// + the next step's sentence) and the full list (every step, the reached ones ticked). The cart value is a slider,
// so the merchant walks the ladder; with several markets the preview is of ONE market (a step without an amount
// there is not offered there, so it is not drawn).

import { useState } from "react";

import { formatMoney } from "@won/core/discounts/describe";

import { useT } from "../../i18n/context";
import type { CurrencyView } from "../model/types";
import { hoverMark } from "../shell/hover";
import { WON_FONT, WON_INK, WON_LINE, WON_LIVE, WON_MUTED, WON_SELECT, WON_SURFACE, WON_WASH } from "../shell/tokens";

export interface PreviewStep {
  key: string;
  /** What the step gives in the previewed market ("Doprava zdarma", "Dárek: Ponožky", "Sleva 5 %"), per amount column. */
  reward: (column: string) => string;
  /** The cart value it starts at, minor units per amount column. */
  threshold: Readonly<Record<string, number>>;
  /** Amount columns it is offered in (a fixed discount needs its amount there too). */
  offered: (column: string) => boolean;
}

const TRACK = { position: "relative", height: 8, borderRadius: 999, background: "#e3e7ec" } as const;
const CHIP = { padding: "4px 10px", borderRadius: 999, fontSize: 12.5, fontWeight: 600, cursor: "pointer", fontFamily: WON_FONT } as const;

export function MilestonePreview({ steps, currencies }: { steps: readonly PreviewStep[]; currencies: readonly CurrencyView[] }) {
  const tr = useT();
  const { t } = tr;
  const [column, setColumn] = useState(currencies[0]?.code ?? "");
  const [share, setShare] = useState(45);
  const ladder = steps
    .filter((step) => typeof step.threshold[column] === "number" && step.offered(column))
    .map((step) => ({ key: step.key, at: step.threshold[column]!, reward: step.reward(column) }))
    .sort((a, b) => a.at - b.at);
  const money = (minor: number) => formatMoney(minor, column, tr.locale);
  const marketName = (view: CurrencyView) => (view.markets.length > 0 ? view.markets.map((m) => m.name).join(", ") : view.code);

  if (ladder.length === 0) {
    return (
      <div data-won-ms-preview="empty" style={{ fontFamily: WON_FONT, fontSize: 13, color: WON_MUTED, padding: 12, borderRadius: 12, background: WON_WASH, border: `1px dashed ${WON_LINE}` }}>
        {t(steps.length === 0 ? "milestones.preview.empty" : "milestones.preview.emptyMarket")}
      </div>
    );
  }

  const top = ladder[ladder.length - 1]!.at;
  // The slider runs a little past the last step, so "everything reached" can be seen too.
  const max = Math.round(top * 1.15);
  const cart = Math.round((max * share) / 100);
  const next = ladder.find((step) => cart < step.at) ?? null;
  const reached = ladder.filter((step) => cart >= step.at);
  const pct = (minor: number) => Math.max(0, Math.min(100, (minor * 100) / top));
  const sentence = next ? t("milestones.preview.left", { amount: money(next.at - cart), reward: next.reward }) : t("milestones.preview.done");
  const fill = { position: "absolute", left: 0, top: 0, bottom: 0, width: `${pct(cart)}%`, borderRadius: 999, background: WON_INK } as const;

  return (
    <div data-won-ms-preview="" style={{ fontFamily: WON_FONT, display: "flex", flexDirection: "column", gap: 14 }}>
      {currencies.length > 1 ? (
        <div role="group" aria-label={t("milestones.preview.market")} style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {currencies.map((view) => {
            const active = view.code === column;
            return (
              <button
                key={view.code}
                type="button"
                data-won-ms-preview-market={view.code}
                aria-pressed={active}
                onClick={() => setColumn(view.code)}
                {...hoverMark("chip")}
                style={{ ...CHIP, border: `1px solid ${active ? WON_SELECT : "#d6dbe1"}`, background: active ? "#f2f7ff" : WON_SURFACE, color: active ? WON_INK : WON_MUTED }}
              >
                {marketName(view)}
              </button>
            );
          })}
        </div>
      ) : null}

      <label style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "6px 12px", fontSize: 13, color: WON_MUTED }}>
        <span>{t("milestones.preview.cart", { amount: money(cart) })}</span>
        {/* Uncontrolled: the page's form re-reads itself on every native `input` and re-renders before React hears
            the event — a controlled slider was written back to its old value and never moved. */}
        <input type="range" min={0} max={100} step={1} defaultValue={share} onChange={(event) => setShare(Number(event.target.value))} style={{ flex: "1 1 180px", minWidth: 0, accentColor: WON_INK }} data-won-ms-preview-range="" />
      </label>

      {/* Compact: the track with a mark per step and the sentence about the next one (product page, cart drawer). */}
      <div data-won-ms-preview-size="compact" style={{ padding: 14, borderRadius: 12, border: `1px solid ${WON_LINE}`, background: WON_SURFACE }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: WON_INK, marginBottom: 10 }}>{sentence}</div>
        <div style={{ ...TRACK, margin: "0 6px" }}>
          <div style={fill} />
          {ladder.map((step) => (
            <span
              key={step.key}
              title={`${step.reward} · ${money(step.at)}`}
              style={{
                position: "absolute",
                top: "50%",
                left: `${pct(step.at)}%`,
                width: 14,
                height: 14,
                marginLeft: -7,
                marginTop: -7,
                borderRadius: 999,
                boxSizing: "border-box",
                border: `2px solid ${cart >= step.at ? WON_INK : "#c3cad2"}`,
                background: cart >= step.at ? WON_INK : WON_SURFACE,
              }}
            />
          ))}
        </div>
      </div>

      {/* Full: every step with its reward, the reached ones ticked (cart page). */}
      <ol data-won-ms-preview-size="full" style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 6 }}>
        {ladder.map((step) => {
          const done = cart >= step.at;
          return (
            <li key={step.key} data-won-ms-preview-step={done ? "reached" : "ahead"} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", borderRadius: 10, border: `1px solid ${WON_LINE}`, background: done ? "rgba(26,143,75,.07)" : WON_SURFACE }}>
              <span aria-hidden="true" style={{ flex: "0 0 auto", width: 20, height: 20, borderRadius: 999, display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700, color: "#fff", background: done ? WON_LIVE : "#c3cad2" }}>
                {done ? "✓" : ""}
              </span>
              <span style={{ flex: "1 1 auto", minWidth: 0, fontSize: 13.5, fontWeight: 600, color: WON_INK, overflowWrap: "anywhere" }}>{step.reward}</span>
              <span style={{ flex: "0 0 auto", fontSize: 13, color: WON_MUTED }}>{t("milestones.preview.from", { amount: money(step.at) })}</span>
            </li>
          );
        })}
      </ol>
      <div style={{ fontSize: 12.5, color: WON_MUTED }}>{t("milestones.preview.note", { n: reached.length, total: ladder.length })}</div>
    </div>
  );
}
