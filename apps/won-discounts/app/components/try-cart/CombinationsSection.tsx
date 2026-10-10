// "Časté kombinace" (feedback 2026-10-06, bod 16): the common carts the app planned itself, first on Vyzkoušet
// košík — each with its state (V pořádku / Upozornění), what went otherwise than set up and the setting behind
// it, and a link that opens it in the manual cart below. Every plan sees how many have a warning; which ones and
// why is Pro: on Free the list is the amber locked block with what Pro gives (§16) — the server sent no scenario.
// A calculation over the shop's stored products and discounts, never a real order: the section says so once.

import { formatMoney } from "@won/core/discounts/describe";

import { useT } from "../../i18n/context";
import type { MessageKey } from "../../i18n";
import type { CombinationCheckView, CombinationScenarioView } from "../model/types";
import { ProFrame } from "../shell/ProFrame";
import { ProSell } from "../shell/ProSell";
import { SubCard } from "../shell/SubCard";
import { RowNote, WonSection } from "../shell/WonSection";
import { WON_ATTENTION, WON_FONT, WON_INK, WON_LINE, WON_MUTED, WON_WASH } from "../shell/tokens";

const PILL = { display: "inline-flex", alignItems: "center", gap: 6, padding: "2px 9px", borderRadius: 999, fontSize: 12, fontWeight: 700, flex: "0 0 auto" } as const;

/**
 * What to do about a finding, by its kind (6th round: "jasné akce, nejlépe na jeden klik, mnohem lépe
 * vysvětlené"): one plain sentence of the choice the merchant has, and — where the fix may be on another page
 * than the finding's own link — a second button. A kind without an entry shows the finding's link alone.
 */
const TODO: Readonly<Record<string, { text: MessageKey; alt?: { href: string; label: MessageKey } }>> = {
  margin: { text: "combos.todo.margin", alt: { href: "/app/margin#settings", label: "combos.alt.margin" } },
  max: { text: "combos.todo.max", alt: { href: "/app/settings#combination", label: "combos.alt.settings" } },
  not_combinable: { text: "combos.todo.not_combinable" },
  code_loses_gift: { text: "combos.todo.code_loses_gift" },
  step_superseded: { text: "combos.todo.step_superseded" },
  checkout_cut: { text: "combos.todo.checkout_cut", alt: { href: "/app/discounts", label: "combos.alt.discounts" } },
};

function Scenario({ s }: { s: CombinationScenarioView }) {
  const tr = useT();
  const { t } = tr;
  const title = s.market ? `${s.title} · ${s.market}` : s.title;
  const totals = `${t("combos.totals", { subtotal: formatMoney(s.subtotal, s.currency, tr.locale), discount: formatMoney(s.discount, s.currency, tr.locale) })}${s.estimate ? ` ${t("combos.estimate")}` : ""}`;
  const pill = <span style={{ ...PILL, color: s.status === "ok" ? "#0f6b3f" : WON_ATTENTION, background: s.status === "ok" ? "#e6f6ed" : "#fdeeee" }}>{t(`combos.status.${s.status}`)}</span>;
  if (s.status === "ok") {
    // Nothing to do: one quiet row, the cart one click away.
    return (
      <li data-won-combo={s.id} data-won-combo-status={s.status} style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: "6px 12px", padding: "9px 0", borderTop: `1px solid ${WON_LINE}` }}>
        <span style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "4px 10px", minWidth: 0 }}>
          <span style={{ fontSize: 13.5, fontWeight: 700, color: WON_INK, overflowWrap: "anywhere" }}>{title}</span>
          {pill}
          <span style={{ fontSize: 12.5, color: WON_MUTED }}>{totals}</span>
        </span>
        {s.open ? <s-link href={s.open}>{t("combos.open")}</s-link> : null}
      </li>
    );
  }
  return (
    <li data-won-combo={s.id} data-won-combo-status={s.status} style={{ listStyle: "none" }}>
      <SubCard title={title} label={pill} tone="attention">
        <div style={{ fontSize: 12.5, lineHeight: 1.4, color: WON_MUTED }}>{totals}</div>
        {s.findings.map((f) => {
          const todo = TODO[f.kind];
          return (
            <div key={f.kind} data-won-combo-finding={f.kind} style={{ display: "grid", gap: 8, padding: 12, borderRadius: 10, background: WON_WASH, border: `1px solid ${WON_LINE}` }}>
              <div>
                <div style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: ".04em", textTransform: "uppercase", color: WON_MUTED }}>{t("combos.what")}</div>
                <div style={{ fontSize: 13.5, lineHeight: 1.45, fontWeight: 600, color: WON_INK }}>{f.text}</div>
              </div>
              {todo ? (
                <div>
                  <div style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: ".04em", textTransform: "uppercase", color: WON_MUTED }}>{t("combos.how")}</div>
                  <div style={{ fontSize: 13.5, lineHeight: 1.45, color: WON_INK }}>{t(todo.text)}</div>
                </div>
              ) : null}
              <s-stack direction="inline" gap="small-300">
                <s-button href={f.href} variant="primary">
                  {f.label}
                </s-button>
                {todo?.alt ? (
                  <s-button href={todo.alt.href} variant="secondary">
                    {t(todo.alt.label)}
                  </s-button>
                ) : null}
              </s-stack>
            </div>
          );
        })}
        {s.open ? (
          <div>
            <s-button href={s.open} variant="tertiary">
              {t("combos.open")}
            </s-button>
          </div>
        ) : null}
      </SubCard>
    </li>
  );
}

export function CombinationsSection({ check, pro }: { check: CombinationCheckView; pro: boolean }) {
  const tr = useT();
  const { t } = tr;
  const summary = t("combos.summary", { ok: check.ok, warnings: check.warnings });
  const scenarios = check.scenarios ?? [];
  // What needs a decision first; what is fine after it, as quiet rows.
  const warnings = scenarios.filter((s) => s.status !== "ok");
  const fine = scenarios.filter((s) => s.status === "ok");
  return (
    <WonSection title={t("combos.title")} glyph="check" summary={summary} hint={t("combos.hint")} anchor="combos" state={check.warnings > 0 ? "attention" : "active"}>
      <s-stack direction="block" gap="base">
        {check.sample ? <RowNote>{t("combos.sample")}</RowNote> : null}
        {pro ? (
          <div data-won-combos="" style={{ display: "grid", gap: 14, fontFamily: WON_FONT }}>
            {warnings.length > 0 ? (
              <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "grid", gap: 12 }}>
                {warnings.map((s) => (
                  <Scenario key={s.id} s={s} />
                ))}
              </ul>
            ) : null}
            {fine.length > 0 ? (
              <div>
                <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: ".04em", textTransform: "uppercase", color: WON_MUTED, marginBottom: 2 }}>{t("combos.fine", { n: fine.length })}</div>
                <ul style={{ margin: 0, padding: 0, listStyle: "none" }}>
                  {fine.map((s) => (
                    <Scenario key={s.id} s={s} />
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
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
