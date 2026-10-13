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
import { CartCard } from "../shell/CartCard";
import { Finding } from "../shell/Finding";
import { RowNote, WonSection } from "../shell/WonSection";
import { WON_ATTENTION, WON_FONT, WON_INK, WON_MUTED } from "../shell/tokens";


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

/** One planned cart, drawn as the manual cart's result is (shell/CartCard): which product it is built on, its lines, what it comes to. */
function ScenarioCard({ s }: { s: CombinationScenarioView }) {
  const tr = useT();
  const { t } = tr;
  const money = (minor: number) => formatMoney(minor, s.currency, tr.locale);
  return (
    <CartCard
      marker={{ "data-won-combo": s.id, "data-won-combo-status": s.status, "data-won-combo-basket": s.kind ?? "" }}
      eyebrow={t(s.kind ? `combos.basket.${s.kind}` : "combos.basket.single")}
      pill={{ label: t(`combos.status.${s.status}`), tone: s.status === "ok" ? "ok" : "warning" }}
      tone={s.status === "ok" ? "plain" : "warning"}
      lines={s.lines.map((line, i) => ({ key: `${i}`, name: `${line.title} × ${line.quantity}`, price: money(line.total) }))}
      after={
        s.findings.length > 0 || s.estimate ? (
          <div style={{ display: "grid", gap: 4 }}>
            {s.findings.map((finding) => (
              <span key={`${finding.kind}|${finding.href}`} style={{ fontSize: 12.5, lineHeight: 1.4, color: WON_ATTENTION }}>
                {finding.text}
              </span>
            ))}
            {s.estimate ? <span style={{ fontSize: 12.5, color: WON_MUTED }}>{t("combos.estimate")}</span> : null}
          </div>
        ) : undefined
      }
      totals={[
        { label: t("combos.card.subtotal"), value: money(s.subtotal) },
        { label: t("combos.card.discount"), value: s.discount > 0 ? `−${money(s.discount)}` : money(0) },
        { label: t("combos.card.total"), value: money(s.subtotal - s.discount), strong: true },
      ]}
      footer={s.open ? <s-link href={s.open}>{t("combos.open")}</s-link> : undefined}
    />
  );
}

const BASKET_ORDER = ["cheap", "mid", "expensive", "mix"] as const;

/**
 * 13 Oct 2026: every combination with the carts it was planned on — one cart, or (a shop with more products known)
 * the shop's cheapest, a middle and the most expensive product and a mix of them, side by side. A basket that is not
 * there would need more pieces of the product than anybody buys.
 */
function CombinationCarts({ scenarios }: { scenarios: readonly CombinationScenarioView[] }) {
  const { t } = useT();
  const combos = [...new Set(scenarios.map((s) => s.combo))];
  return (
    <div data-won-combo-matrix="" style={{ display: "grid", gap: 22 }}>
      {combos.map((combo) => {
        const cells = scenarios.filter((s) => s.combo === combo);
        const first = cells[0]!;
        const warnings = cells.filter((s) => s.status !== "ok").length;
        const missing = first.kind ? BASKET_ORDER.filter((kind) => !cells.some((s) => s.kind === kind)) : [];
        return (
          <section key={combo} data-won-combo-row={combo} style={{ display: "grid", gap: 10 }}>
            <div style={{ display: "flex", flexWrap: "wrap", alignItems: "baseline", gap: "4px 10px", paddingBottom: 6, borderBottom: `2px solid ${WON_INK}` }}>
              <span style={{ fontSize: 15.5, fontWeight: 700, color: WON_INK, letterSpacing: "-0.01em" }}>{first.market ? `${first.title} · ${first.market}` : first.title}</span>
              {cells.length > 1 ? <span style={{ fontSize: 12.5, fontWeight: 600, color: warnings > 0 ? WON_ATTENTION : "#0f6b3f" }}>{t("combos.summary", { ok: cells.length - warnings, warnings })}</span> : null}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(205px, 1fr))", gap: 12, alignItems: "stretch" }}>
              {cells.map((s) => (
                <ScenarioCard key={s.id} s={s} />
              ))}
            </div>
            {missing.length > 0 ? <div style={{ fontSize: 12.5, color: WON_MUTED }}>{t("combos.basket.skipped", { kinds: missing.map((kind) => t(`combos.basket.${kind}`).toLowerCase()).join(", ") })}</div> : null}
          </section>
        );
      })}
    </div>
  );
}

type ScenarioFinding = CombinationScenarioView["findings"][number];

/**
 * The same finding in five combinations is ONE thing to decide (nález 16: the page repeated two cards five times,
 * 2 500 px above the cart). A finding is the same when it says the same and leads to the same place.
 */
export function distinctFindings(scenarios: readonly CombinationScenarioView[]): { finding: ScenarioFinding; titles: string[]; scenarios: CombinationScenarioView[] }[] {
  const seen = new Map<string, { finding: ScenarioFinding; titles: string[]; scenarios: CombinationScenarioView[] }>();
  for (const s of scenarios) {
    const title = s.market ? `${s.title} · ${s.market}` : s.title;
    for (const finding of s.findings) {
      const key = `${finding.kind}|${finding.href}|${finding.text}`;
      const entry = seen.get(key) ?? { finding, titles: [], scenarios: [] };
      entry.titles.push(title);
      entry.scenarios.push(s);
      seen.set(key, entry);
    }
  }
  return [...seen.values()];
}

export function CombinationsSection({ check, pro }: { check: CombinationCheckView; pro: boolean }) {
  const tr = useT();
  const { t } = tr;
  const summary = t("combos.summary", { ok: check.ok, warnings: check.warnings });
  const scenarios = check.scenarios ?? [];
  // What needs a decision first; what is fine after it, as quiet rows.
  const warnings = scenarios.filter((s) => s.status !== "ok");
  return (
    <WonSection title={t("combos.title")} glyph="check" summary={summary} hint={t("combos.hint")} anchor="combos" state={check.warnings > 0 ? "attention" : "active"}>
      <s-stack direction="block" gap="base">
        {check.sample ? <RowNote>{t("combos.sample")}</RowNote> : null}
        {pro ? (
          <div data-won-combos="" style={{ display: "grid", gap: 14, fontFamily: WON_FONT }}>
            {/* What needs a decision, each thing once, with the combinations it shows in. */}
            {distinctFindings(warnings).map(({ finding, titles, scenarios: seenIn }) => {
              const todo = TODO[finding.kind];
              return (
                <div key={`${finding.kind}|${finding.href}`} style={{ display: "grid", gap: 4 }}>
                  <Finding
                    marker={{ "data-won-combo-finding": finding.kind }}
                    what={finding.text}
                    how={todo ? t(todo.text) : undefined}
                    primary={{ href: finding.href, label: finding.label }}
                    alt={todo?.alt ? { href: todo.alt.href, label: t(todo.alt.label) } : undefined}
                  />
                  {/* 12 Oct 2026, bod 4: a warning without its cart cannot be understood — which product, how many, for how much. */}
                  {seenIn.some((s) => s.kind) ? (
                    // Per basket the carts themselves are in the table below: here only where to look.
                    <div data-won-combo-where="" style={{ fontSize: 12.5, lineHeight: 1.5, color: WON_MUTED }}>
                      {t("combos.whereCarts")}{" "}
                      {[...new Set(titles)]
                        .map((title) => {
                          const kinds = seenIn.filter((s, i) => titles[i] === title && s.kind).map((s) => t(`combos.basket.${s.kind!}`).toLowerCase());
                          return kinds.length > 0 ? `${title} (${kinds.join(", ")})` : title;
                        })
                        .join("; ")}
                      .
                    </div>
                  ) : (
                  <div data-won-combo-where="" style={{ fontSize: 12.5, lineHeight: 1.5, color: WON_MUTED }}>
                    {t("combos.whereCarts")}
                    <ul style={{ margin: "2px 0 0", paddingLeft: 18 }}>
                      {seenIn.map((s, i) => (
                        <li key={s.id}>
                          <strong style={{ color: WON_INK }}>{titles[i]}</strong>
                          {": "}
                          {s.basket ? `${s.basket}, ` : ""}
                          {t("combos.whereTotals", { subtotal: formatMoney(s.subtotal, s.currency, tr.locale), discount: formatMoney(s.discount, s.currency, tr.locale) })}
                          {s.open ? (
                            <>
                              {" "}
                              <s-link href={s.open}>{t("combos.open")}</s-link>
                            </>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  </div>
                  )}
                </div>
              );
            })}
            {scenarios.some((s) => s.kind) ? <RowNote>{t("combos.basket.about")}</RowNote> : null}
            <CombinationCarts scenarios={scenarios} />
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
