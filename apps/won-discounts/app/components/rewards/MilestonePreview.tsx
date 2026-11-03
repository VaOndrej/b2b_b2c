// Milníky: the ladder as the customer sees it, under the steps (Ondřej, 31 Oct 2026: it changes with every edit of
// the steps). Drawn from the page's LIVE form, to scale: the sentence about the next reward and a track with the
// reward above each mark and its amount under it. The cart value is a slider, so the merchant walks the ladder; with
// several markets the preview is of ONE market (a step without an amount there is not offered there, so it is not
// drawn).

import { useState } from "react";

import { formatMoney } from "@won/core/discounts/describe";

import { useT } from "../../i18n/context";
import type { CurrencyView } from "../model/types";
import { hoverMark } from "../shell/hover";
import { WON_CONTROL_EDGE, WON_EDGE, WON_FAINT, WON_FONT, WON_INK, WON_LINE, WON_LIVE, WON_MUTED, WON_SELECT, WON_SELECT_TINT, WON_SURFACE, WON_WASH } from "../shell/tokens";
import { RangeInput } from "../shell/Controls";

export interface PreviewStep {
  key: string;
  /** What the step gives in the previewed market ("Doprava zdarma", "Dárek: Ponožky", "Sleva 5 %"), per amount column. */
  reward: (column: string) => string;
  /** The cart value it starts at, minor units per amount column. */
  threshold: Readonly<Record<string, number>>;
  /** Amount columns it is offered in (a fixed discount needs its amount there too). */
  offered: (column: string) => boolean;
}

const LABEL = { position: "absolute", maxWidth: 150, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 12 } as const;
/** Marks closer than this share of the track take turns on a second line: their labels would touch. */
const CLOSE = 22;
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
  const pct = (minor: number) => Math.max(0, Math.min(100, (minor * 100) / top));
  const sentence = next ? t("milestones.preview.left", { amount: money(next.at - cart), reward: next.reward }) : t("milestones.preview.done");
  const fill = { position: "absolute", left: 0, top: 0, bottom: 0, width: `${pct(cart)}%`, borderRadius: 999, background: WON_LIVE } as const;
  let lifted = false;
  const lift = ladder.map((step, i) => {
    lifted = i > 0 && pct(step.at) - pct(ladder[i - 1]!.at) < CLOSE && !lifted;
    return lifted;
  });
  const tall = lift.some(Boolean);

  return (
    <div data-won-ms-preview="" style={{ fontFamily: WON_FONT, display: "flex", flexDirection: "column", gap: 10 }}>
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
                style={{ ...CHIP, border: `1px solid ${active ? WON_SELECT : WON_CONTROL_EDGE}`, background: active ? WON_SELECT_TINT : WON_SURFACE, color: active ? WON_INK : WON_MUTED }}
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
        <RangeInput min={0} max={100} step={1} defaultValue={share} onChange={(event) => setShare(Number(event.target.value))} style={{ flex: "1 1 180px", minWidth: 0, accentColor: WON_LIVE }} data-won-ms-preview-range="" />
      </label>

      <div data-won-ms-preview-size="compact" style={{ padding: "16px 20px", borderRadius: 12, background: WON_WASH }}>
        <div style={{ fontSize: 15, fontWeight: 600, color: WON_INK }}>{sentence}</div>
        <div style={{ position: "relative", height: 8, margin: tall ? "52px 10px 46px" : "36px 10px 30px", borderRadius: 999, background: WON_EDGE }}>
          <div style={fill} />
          {ladder.map((step, i) => {
            const done = cart >= step.at;
            const last = i === ladder.length - 1;
            const edge = last ? { right: -7 } : { left: "50%", transform: "translateX(-50%)" };
            const off = lift[i] ? 32 : 16;
            return (
              <span key={step.key} data-won-ms-preview-step={done ? "reached" : "ahead"} title={`${step.reward} · ${money(step.at)}`} style={{ position: "absolute", top: "50%", left: `${pct(step.at)}%`, width: 14, height: 14, marginLeft: -7, marginTop: -7, borderRadius: 999, boxSizing: "border-box", border: `2px solid ${done ? WON_LIVE : WON_FAINT}`, background: done ? WON_LIVE : WON_SURFACE }}>
                <span style={{ ...LABEL, ...edge, bottom: off, fontWeight: 600, color: WON_INK }}>{step.reward}</span>
                <span style={{ ...LABEL, ...edge, top: off, color: WON_MUTED }}>{money(step.at)}</span>
              </span>
            );
          })}
        </div>
      </div>
    </div>
  );
}
