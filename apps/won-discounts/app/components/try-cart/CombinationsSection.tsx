// "Časté kombinace" (feedback 2026-10-06, bod 16): the common carts the app planned itself, first on Vyzkoušet
// košík — each with its state (V pořádku / Upozornění), what went otherwise than set up and the setting behind
// it, and a link that opens it in the manual cart below. Every plan sees how many have a warning; which ones and
// why is Pro: on Free the list is the amber locked block with what Pro gives (§16) — the server sent no scenario.
// A calculation over the shop's stored products and discounts, never a real order: the section says so once.

import { formatMoney } from "@won/core/discounts/describe";

import { useT } from "../../i18n/context";
import type { CombinationCheckView } from "../model/types";
import { ProFrame } from "../shell/ProFrame";
import { ProSell } from "../shell/ProSell";
import { RowNote, WonSection } from "../shell/WonSection";
import { WON_ATTENTION, WON_FONT, WON_INK, WON_LINE, WON_MUTED } from "../shell/tokens";

const PILL = { display: "inline-flex", alignItems: "center", gap: 6, padding: "2px 9px", borderRadius: 999, fontSize: 12, fontWeight: 700, flex: "0 0 auto" } as const;

export function CombinationsSection({ check, pro }: { check: CombinationCheckView; pro: boolean }) {
  const tr = useT();
  const { t } = tr;
  const summary = t("combos.summary", { ok: check.ok, warnings: check.warnings });
  const scenarios = check.scenarios ?? [];
  return (
    <WonSection title={t("combos.title")} glyph="check" summary={summary} hint={t("combos.hint")} anchor="combos" state={check.warnings > 0 ? "attention" : "active"}>
      <s-stack direction="block" gap="base">
        {check.sample ? <RowNote>{t("combos.sample")}</RowNote> : null}
        {pro ? (
          <ul data-won-combos="" style={{ margin: 0, padding: 0, listStyle: "none", fontFamily: WON_FONT }}>
            {scenarios.map((s) => (
              <li key={s.id} data-won-combo={s.id} data-won-combo-status={s.status} style={{ padding: "10px 0", borderTop: `1px solid ${WON_LINE}`, display: "grid", gap: 4 }}>
                <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "6px 10px" }}>
                  <span style={{ fontSize: 13.5, fontWeight: 700, color: WON_INK, minWidth: 0, overflowWrap: "anywhere" }}>{s.market ? `${s.title} · ${s.market}` : s.title}</span>
                  <span style={{ ...PILL, color: s.status === "ok" ? "#0f6b3f" : WON_ATTENTION, background: s.status === "ok" ? "#e6f6ed" : "#fdeeee" }}>{t(`combos.status.${s.status}`)}</span>
                </div>
                <div style={{ fontSize: 12.5, lineHeight: 1.4, color: WON_MUTED }}>
                  {t("combos.totals", { subtotal: formatMoney(s.subtotal, s.currency, tr.locale), discount: formatMoney(s.discount, s.currency, tr.locale) })}
                  {s.estimate ? ` ${t("combos.estimate")}` : ""}
                </div>
                {s.findings.map((f) => (
                  <div key={f.kind} data-won-combo-finding={f.kind} style={{ fontSize: 13, lineHeight: 1.45, color: WON_INK }}>
                    {f.text} <s-link href={f.href}>{f.label}</s-link>
                  </div>
                ))}
                {s.open ? (
                  <div>
                    <s-link href={s.open}>{t("combos.open")}</s-link>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <s-stack direction="block" gap="base">
            <ProSell benefit={t("combos.locked.benefit")} />
            <ProFrame locked>
              <div data-won-combos-locked="" style={{ fontFamily: WON_FONT, fontSize: 13, lineHeight: 1.45, color: WON_MUTED }}>
                {t("combos.locked.rows")}
              </div>
            </ProFrame>
          </s-stack>
        )}
      </s-stack>
    </WonSection>
  );
}
