// Nastavení. Since the menu change of 6 Oct 2026 (P1: five sidebar items) the page also holds what left the menu:
//   1. Kombinování slev — the Free per-category switches (decision A1,
//      engine.combination): outlet with anything, product with order, product
//      with shipping, order with shipping. Each switch says in one sentence what
//      checkout does in its position (§4c, §10d), re-read from the form on every
//      native change (§2/§17b) — a switch that differs from what is stored says
//      "Po uložení:". Product with product is not a switch: the better one wins
//      (A1) — on Pro unless the rule editor combines them (combinesWith); a
//      quantity tier never stacks. Said per plan. "Vyzkoušet v košíku" checks the
//      change on a real cart (§13) — only once it is saved (the cart reads the
//      stored settings), so with unsaved switches the button gives way to a note.
//      One save for the form.
//   2. Trhy a měny — the shop's market currencies, with the one action there is:
//      Shopify's own Markets settings.
//   3. Nástroje — Vyzkoušet košík (Pro).
//   4. Tarif — the plan sections (PlanScreen.tsx); their actions post to /app/plan.
// On the side (above on a narrow screen) the list of these sections, each one click away (SectionNav).
// A presentational component: app/routes/app.settings.tsx renders it from
// loadSettingsScreen (app/lib/integration/settings.server.ts) and loadPlanScreen.

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Form, useSubmit } from "react-router";

import { useT } from "../../i18n/context";
import {
  COMBINATION_FIELD,
  COMBINATION_INTENT,
  COMBINATION_KEYS,
  combinationLabel,
  combinationSentence,
  combinationSummary,
  readCombinationForm,
  UNKNOWN_MARKET_KINDS,
  UNKNOWN_MARKET_PICKS,
} from "../model/combination";
import { PLAN_ACTION, type PlanActionResult, type PlanScreenData } from "../model/plan";
import type { CombinationView, SettingsScreenData, UiResult } from "../model/types";
import { boolAttr } from "../shell/attrs";
import { Notice } from "../shell/Notice";
import { PlanBadge } from "../shell/PlanBadge";
import { SectionNav } from "../shell/SectionNav";
import type { MarketCell } from "../model/markets-overview";
import { RowNote, WonRow, WonSection } from "../shell/WonSection";
import { WON_INK, WON_LINE, WON_MUTED } from "../shell/tokens";
import { PlanSections } from "./PlanScreen";

/** Shopify's own Markets settings (opens in the admin frame, outside the app). */
const SHOPIFY_MARKETS_URL = "shopify://admin/settings/markets";

export interface SettingsScreenProps extends SettingsScreenData {
  result?: UiResult | null;
  /** The plan sections at the end of the page (loadPlanScreen); the dev harness may add a `result`. */
  planScreen?: (PlanScreenData & { result?: PlanActionResult | null }) | null;
  /** Where the plan sections post (the dev harness posts to itself). */
  planAction?: string;
}

const MARKETS_CSS = `
.won-markets{display:grid;gap:0}
.won-market{display:grid;grid-template-columns:minmax(0,1.3fr) repeat(4,minmax(0,1fr));gap:6px 14px;padding:12px 0;border-top:1px solid ${WON_LINE};align-items:start}
.won-market--head{border-top:0;padding:0 0 8px;font-size:12px;font-weight:600;color:${WON_MUTED}}
.won-market__label{display:none;font-size:12px;color:${WON_MUTED}}
.won-market--off{color:${WON_MUTED}}
@media (max-width:720px){.won-market{grid-template-columns:1fr}.won-market--head{display:none}.won-market__label{display:block}.won-market__cell{display:flex;justify-content:space-between;gap:12px}}
`;

/** One cell of the markets table: the amount, or what is missing with the link to the field that adds it. */
function MarketCellView({ cell, label, off }: { cell: MarketCell; label: string; off: boolean }) {
  const tr = useT();
  const { t } = tr;
  let body: ReactNode;
  if (cell.kind === "amount") body = <span style={{ fontWeight: 600 }}>{cell.text}</span>;
  else if (cell.kind === "ok") body = t("settings.markets.cell.ok");
  else if (cell.kind === "percent") body = t("settings.markets.cell.percent");
  else if (cell.kind === "none") body = <span style={{ color: WON_MUTED }}>{t("settings.markets.cell.none")}</span>;
  else if (off) body = <span>{cell.count ? tr.tp("settings.markets.cell.missingN", cell.count) : t("settings.markets.cell.missing")}</span>;
  else
    body = (
      <s-link href={cell.href} tone="critical">
        {cell.count ? tr.tp("settings.markets.cell.missingN", cell.count) : t("settings.markets.cell.missing")}
      </s-link>
    );
  return (
    <div className="won-market__cell" {...(cell.kind === "missing" && !off ? { "data-won-market-missing": "" } : {})} style={{ fontSize: 13, minWidth: 0, overflowWrap: "anywhere" }}>
      <span className="won-market__label">{label}</span>
      <span>{body}</span>
    </div>
  );
}

export function SettingsScreen({ currencies, combination: stored, configVersion, plan, result, planScreen, planAction = PLAN_ACTION, markets = [], unknownMarketLowest = false, unknownMarketHighest = [] }: SettingsScreenProps) {
  const tr = useT();
  const { t } = tr;
  // Two enabled markets of one currency, by name: only there can their amounts differ (the switch below).
  const sameCurrency = markets.filter((m) => m.enabled && markets.some((o) => o.enabled && o.handle !== m.handle && o.currency === m.currency));
  const withMarkets = currencies.filter((c) => c.markets.length > 0);
  const liveMarkets = markets.filter((m) => m.enabled);
  const missingIn = liveMarkets.filter((m) => m.missing > 0).map((m) => m.name);
  const columns = [
    ["shipping", t("settings.markets.col.shipping")],
    ["gift", t("settings.markets.col.gift")],
    ["discounts", t("settings.markets.col.discounts")],
    ["tiers", t("settings.markets.col.tiers")],
  ] as const;

  // §2/§17b: the live switches, re-read from the form on native events.
  const formRef = useRef<HTMLFormElement>(null);
  const [draft, setDraft] = useState<CombinationView>(stored);
  const recompute = useCallback(() => {
    const form = formRef.current;
    if (form) setDraft(readCombinationForm(new FormData(form)));
  }, []);
  useEffect(() => {
    const el = formRef.current;
    if (!el) return;
    el.addEventListener("input", recompute);
    el.addEventListener("change", recompute);
    const onReset = () => window.setTimeout(recompute, 0);
    el.addEventListener("reset", onReset);
    return () => {
      el.removeEventListener("input", recompute);
      el.removeEventListener("change", recompute);
      el.removeEventListener("reset", onReset);
    };
  }, [recompute]);

  const submit = useSubmit();
  const replaceUnreadable = () => {
    const form = formRef.current;
    if (!form) return;
    const data = new FormData(form);
    data.set(COMBINATION_FIELD.replaceUnreadable, "1");
    submit(data, { method: "post" });
  };

  // The cart reads the STORED switches: with unsaved ones it would show the old behaviour.
  const dirty = COMBINATION_KEYS.some((key) => draft[key] !== stored[key]);

  const sections = [
    { anchor: "combination", label: t("settings.combination.title") },
    { anchor: "unknown-market", label: t("settings.unknownMarket.title") },
    // The one section here with a state of its own: a market that misses an amount somewhere (its header says where).
    { anchor: "markets", label: t("settings.markets.title"), ...(missingIn.length > 0 ? { state: "attention" as const } : {}) },
    { anchor: "tools", label: t("settings.tools.title") },
    ...(planScreen ? [{ anchor: "plan", label: t("nav.plan") }] : []),
  ];

  return (
    <s-page heading={t("nav.settings")}>
      <SectionNav label={t("common.onThisPage")} items={sections}>
      <s-stack direction="block" gap="base">
        <Form method="post" ref={formRef} data-save-bar>
          <input type="hidden" name={COMBINATION_FIELD.intent} value={COMBINATION_INTENT.save} />
          {configVersion ? <input type="hidden" name={COMBINATION_FIELD.configVersion} value={configVersion} /> : null}
          <s-stack direction="block" gap="base">
            <Notice result={result} onReplace={replaceUnreadable} />
            <WonSection
              title={t("settings.combination.title")}
              glyph="sliders"
              summary={combinationSummary(draft, tr)}
              hint={t("settings.combination.hint")}
              anchor="combination"
            >
              <s-stack direction="block" gap="base">
                {/* Plan-aware (review fix 3): on Pro a rule may stack with the ones picked in its editor (combinesWith). */}
                <s-text color="subdued">{t(plan === "pro" ? "settings.combination.fixedPro" : "settings.combination.fixed")}</s-text>
                <div>
                  {COMBINATION_KEYS.map((key) => {
                    const on = draft[key];
                    const changed = on !== stored[key];
                    return (
                      <WonRow key={key}>
                        <s-switch name={COMBINATION_FIELD[key]} value="on" label={combinationLabel(key, tr)} checked={boolAttr(stored[key])} />
                        <RowNote>{changed ? `${t("settings.combination.changed")} ${combinationSentence(key, on, tr)}` : combinationSentence(key, on, tr)}</RowNote>
                        {key === "outletWithAnything" ? <RowNote>{t("combination.outletWithAnything.note")}</RowNote> : null}
                      </WonRow>
                    );
                  })}
                </div>
                <WonRow action={<s-link href="/app/discounts">{t("settings.combination.perDiscount.link")}</s-link>}>
                  <RowNote>{t("settings.combination.perDiscount")}</RowNote>
                </WonRow>
                {dirty ? (
                  <WonRow>
                    <RowNote>{t("settings.combination.tryCartDirty")}</RowNote>
                  </WonRow>
                ) : (
                  <WonRow
                    action={
                      <s-button href="/app/try-cart" variant="secondary">
                        {t("settings.combination.tryCart")}
                      </s-button>
                    }
                  >
                    <RowNote>{t("settings.combination.tryCartHint")}</RowNote>
                  </WonRow>
                )}
              </s-stack>
            </WonSection>
            {/* 7 Oct 2026: amounts are per market. What a customer from a country in none of them gets is the merchant's call. */}
            <WonSection
              title={t("settings.unknownMarket.title")}
              glyph="store"
              summary={t(
                !unknownMarketLowest
                  ? "settings.unknownMarket.summary.off"
                  : unknownMarketHighest.length === 0
                    ? "settings.unknownMarket.summary.on"
                    : unknownMarketHighest.length === UNKNOWN_MARKET_KINDS.length
                      ? "settings.unknownMarket.summary.highest"
                      : "settings.unknownMarket.summary.mixed",
              )}
              anchor="unknown-market"
            >
              <s-stack direction="block" gap="base">
                <s-text color="subdued">{t("settings.unknownMarket.body")}</s-text>
                <WonRow>
                  <s-switch name={COMBINATION_FIELD.unknownMarketLowest} value="on" label={t("settings.unknownMarket.label")} checked={boolAttr(unknownMarketLowest)} />
                  <RowNote>{t("settings.unknownMarket.on")}</RowNote>
                  <RowNote>{t("settings.unknownMarket.off")}</RowNote>
                  <RowNote>{t("settings.unknownMarket.empty")}</RowNote>
                </WonRow>
                {/* 8 Oct 2026: the lowest or the highest, chosen for every kind of amount on its own (engine.unknownMarketHighest). */}
                <WonRow>
                  <s-stack direction="block" gap="base">
                    <s-text type="strong">{t("settings.unknownMarket.pick.title")}</s-text>
                    <RowNote>{t("settings.unknownMarket.pick.note")}</RowNote>
                    {UNKNOWN_MARKET_KINDS.map((kind) => {
                      const pick = unknownMarketHighest.includes(kind) ? "highest" : "lowest";
                      return (
                        <s-stack key={kind} direction="block" gap="small-300">
                          <s-select name={`${COMBINATION_FIELD.unknownMarketPick}${kind}`} label={t(`settings.unknownMarket.kind.${kind}` as "settings.unknownMarket.kind.discount")} value={pick}>
                            {UNKNOWN_MARKET_PICKS.map((p) => (
                              <s-option key={p} value={p} selected={boolAttr(p === pick)}>
                                {t(`settings.unknownMarket.pick.${p}` as "settings.unknownMarket.pick.lowest")}
                              </s-option>
                            ))}
                          </s-select>
                          <RowNote>{t(`settings.unknownMarket.kind.${kind}.note` as "settings.unknownMarket.kind.discount.note")}</RowNote>
                        </s-stack>
                      );
                    })}
                  </s-stack>
                </WonRow>
                <RowNote>
                  {sameCurrency.length > 0
                    ? t("settings.unknownMarket.yours", { markets: tr.list(sameCurrency.map((m) => `${m.name} (${m.currency})`)) })
                    : t("settings.unknownMarket.notNow")}
                </RowNote>
              </s-stack>
            </WonSection>
            <div>
              <s-button type="submit" variant="primary">
                {t("common.save")}
              </s-button>
            </div>
          </s-stack>
        </Form>

        <WonSection
          title={t("settings.markets.title")}
          glyph="store"
          summary={
            liveMarkets.length > 0
              ? `${tr.tp("settings.markets.count", liveMarkets.length)} · ${missingIn.length > 0 ? t("settings.markets.missingIn", { markets: tr.list(missingIn) }) : t("settings.markets.allSet")}`
              : withMarkets.length === 0
                ? t("settings.markets.none")
                : t("settings.markets.list", {
                    currencies: tr.list(withMarkets.map((c) => `${c.code} (${c.markets.map((m) => m.name).join(", ")})`)),
                  })
          }
          hint={t("settings.language")}
          anchor="markets"
        >
          <s-stack direction="block" gap="base">
            {markets.length > 0 ? (
              // N15: every market next to the others — what it gets, and in red what it does not, with the link to the field.
              <div className="won-markets" data-won-markets>
                <style dangerouslySetInnerHTML={{ __html: MARKETS_CSS }} />
                <div className="won-market won-market--head">
                  <span>{t("settings.markets.title")}</span>
                  {columns.map(([key, label]) => (
                    <span key={key}>{label}</span>
                  ))}
                </div>
                {markets.map((m) => (
                  <div key={m.handle} className={m.enabled ? "won-market" : "won-market won-market--off"} data-won-market={m.handle} {...(m.enabled ? {} : { "data-won-market-off": "" })}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 14, fontWeight: 700, color: m.enabled ? WON_INK : WON_MUTED, overflowWrap: "anywhere" }}>
                        {m.name} ({m.currency})
                      </div>
                      {m.enabled ? null : <div style={{ fontSize: 12.5 }}>{t("settings.markets.off")}</div>}
                    </div>
                    {columns.map(([key, label]) => (
                      <MarketCellView key={key} cell={m[key]} label={label} off={!m.enabled} />
                    ))}
                  </div>
                ))}
              </div>
            ) : null}
            {markets.some((m) => !m.enabled) ? <RowNote>{t("settings.markets.offNote")}</RowNote> : null}
            {markets.length > 0 ? <RowNote>{t("settings.markets.source")}</RowNote> : null}
            <div>
              <s-button href={SHOPIFY_MARKETS_URL} target="_top" variant="secondary">
                {t("settings.markets.manage")}
              </s-button>
            </div>
          </s-stack>
        </WonSection>

        <WonSection title={t("settings.tools.title")} glyph="cart" summary={t("settings.tools.summary")} anchor="tools">
          <WonRow action={<s-link href="/app/try-cart">{t("settings.tools.open")}</s-link>}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <s-text type="strong">{t("nav.tryCart")}</s-text>
              <PlanBadge tier="pro" />
            </div>
            <RowNote>{t("settings.tools.tryCart")}</RowNote>
          </WonRow>
        </WonSection>

        {planScreen ? <PlanSections {...planScreen} action={planAction} heading /> : null}
      </s-stack>
      </SectionNav>
    </s-page>
  );
}
