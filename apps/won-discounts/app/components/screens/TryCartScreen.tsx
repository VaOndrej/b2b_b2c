// Vyzkoušet košík — build a cart (products/variants + market/currency + codes +
// day) and see what applies and WHY, in human sentences (spec §5). The plan
// itself is computed on the server — Shopify prices for the chosen market and
// the product refs checkout reads, then the engine (planCart + explainPlan) on
// the discount function's own payload and checkout's own output mapping — and
// arrives as a ready CartPlanView with its warnings; this screen never does
// discount math (DATA-4, §10b). The market choice submits `CZK:cz` (currency + market).
// Ochrana marže (MVP 2): a line the protection lowered carries a "Hranice marže"
// marker (the engine's sentence says why), and the plan says when the cost
// prices were converted with an estimated rate (checkout uses Shopify's own).
// Odměny (MVP 4): a reached gift tier shows the gift line the cart on the
// website adds (tagged "Dárek", free at checkout), planned by the server too.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Form } from "react-router";

import type { WonDiscountsConfig } from "@won/core/discounts/config";

import { useT } from "../../i18n/context";
import type { Translator } from "../../i18n";
import { pickProducts } from "../model/app-bridge";
import { formatDate, formatMoney } from "@won/core/discounts/describe";

import { currencyViews, type MarketNames } from "../model/markets";
import { TRY_CART_LIMITS } from "../model/try-cart-form";
import { shopToday } from "../model/rule-form";
import { uiText } from "../model/result-copy";
import type { CartPlanView, CurrencyView, ExplainView, FieldError, TryCartLineView, UiResult } from "../model/types";
import { boolAttr } from "../shell/attrs";
import { Notice } from "../shell/Notice";
import { RowNote, WonBlock, WonRow, WonSection } from "../shell/WonSection";
import { WON_FONT, WON_INK, WON_LINE, WON_MUTED, WON_WASH } from "../shell/tokens";

export interface TryCartScreenProps {
  currencies: CurrencyView[];
  timezone: string | null;
  /** Shop-local today (default day of the simulation). */
  today: string;
  /** Lines already in the simulated cart (the last run, or a harness fixture). */
  lines: TryCartLineView[];
  currency?: string;
  codes?: string;
  date?: string;
  plan: CartPlanView | null;
  result: UiResult | null;
}

export function buildTryCartProps(
  config: WonDiscountsConfig,
  opts: { timezone: string | null; shopCurrency?: string | null; marketNames?: MarketNames; now?: Date },
): TryCartScreenProps {
  return {
    currencies: currencyViews(config.markets, {
      shopCurrency: opts.shopCurrency,
      rules: config.modules.codes.rules,
      marketNames: opts.marketNames,
    }),
    timezone: opts.timezone,
    today: shopToday(opts.timezone, opts.now),
    lines: [],
    plan: null,
    result: null,
  };
}

/** One select option per enabled market (`CZK:cz` "CZK · Česko"), or per currency when it has none. */
export function marketOptions(currencies: readonly CurrencyView[]): { value: string; label: string; currency: string }[] {
  return currencies.flatMap((c) =>
    c.markets.length > 0
      ? c.markets.map((m) => ({ value: `${c.code}:${m.handle}`, label: `${c.code} · ${m.name}`, currency: c.code }))
      : [{ value: c.code, label: c.code, currency: c.code }],
  );
}

function explainFor(explain: readonly ExplainView[], lineId: string | null): ExplainView[] {
  return explain.filter((e) => (lineId === null ? !e.lineIds || e.lineIds.length === 0 : e.lineIds?.includes(lineId)));
}

/**
 * The engine's sentences. An entered code losing to a better discount is an
 * expected outcome, not an error: shown in ink with "!" — never red (§11a: red is
 * "needs attention" in the setup).
 */
function ExplainList({ items }: { items: ExplainView[] }) {
  if (items.length === 0) return null;
  return (
    <ul style={{ margin: "6px 0 0", padding: 0, listStyle: "none", fontFamily: WON_FONT }}>
      {items.map((item, i) => (
        <li key={i} style={{ display: "flex", gap: 8, fontSize: 12.5, lineHeight: 1.45, color: item.tone === "info" ? WON_MUTED : WON_INK }}>
          <span aria-hidden="true" style={{ flex: "0 0 auto", width: 10, color: WON_INK, fontWeight: 700 }}>
            {item.tone === "success" ? "✓" : item.tone === "warning" ? "!" : "·"}
          </span>
          <span>{item.text}</span>
        </li>
      ))}
    </ul>
  );
}

function resultSummary(plan: CartPlanView | null, tr: Translator): string {
  if (!plan) return tr.t("tryCart.result.none");
  const discount = plan.totals.productDiscount + plan.totals.orderDiscount;
  if (discount <= 0) return tr.t("tryCart.result.noDiscount");
  return tr.t("tryCart.result.summary", {
    discount: formatMoney(discount, plan.currency, tr.locale),
    total: formatMoney(plan.totals.total, plan.currency, tr.locale),
  });
}

export function TryCartScreen(props: TryCartScreenProps) {
  const { currencies, timezone, today, plan, result } = props;
  const tr = useT();
  const { t } = tr;
  const options = useMemo(() => marketOptions(currencies), [currencies]);
  const [lines, setLines] = useState<TryCartLineView[]>(props.lines);
  // A run answers with the cart as Shopify priced it: show those titles and prices.
  // (An empty list is a revalidated loader, never a run: the cart being built stays.)
  useEffect(() => {
    if (props.lines.length > 0) setLines(props.lines);
  }, [props.lines]);
  const [unavailable, setUnavailable] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const [live, setLive] = useState({
    currency: props.currency ?? options[0]?.value ?? "",
    codes: props.codes ?? "",
    date: props.date ?? today,
    quantity: props.lines.reduce((s, l) => s + l.quantity, 0),
  });

  // §2: the section's state line follows what is typed (native events, FormData).
  const recompute = useCallback(() => {
    const form = formRef.current;
    if (!form) return;
    const fd = new FormData(form);
    const quantity = fd.getAll("quantity").reduce<number>((s, v) => s + (Number(v) > 0 ? Number(v) : 0), 0);
    setLive({
      currency: String(fd.get("currency") ?? ""),
      codes: String(fd.get("codes") ?? ""),
      date: String(fd.get("date") ?? ""),
      quantity,
    });
  }, []);
  useEffect(() => {
    const el = formRef.current;
    if (!el) return;
    el.addEventListener("input", recompute);
    el.addEventListener("change", recompute);
    return () => {
      el.removeEventListener("input", recompute);
      el.removeEventListener("change", recompute);
    };
  }, [recompute]);

  const addProducts = async () => {
    const res = await pickProducts([...new Set(lines.map((l) => l.productId))]);
    if (!res.ok) {
      if (res.reason === "unavailable") setUnavailable(true);
      return;
    }
    const next = [...lines];
    // The picker returns each product with the variants picked (all of them when the product was picked whole).
    for (const product of res.items) {
      for (const variant of product.variants) {
        if (next.length >= TRY_CART_LIMITS.lines) break;
        if (next.some((l) => l.variantId === variant.id)) continue;
        next.push({
          variantId: variant.id,
          productId: product.id,
          title: product.title,
          variantTitle: variant.title && variant.title !== "Default Title" ? variant.title : undefined,
          quantity: 1,
          unitPrice: {},
        });
      }
    }
    setLines(next);
    setLive((s) => ({ ...s, quantity: next.reduce((sum, l) => sum + l.quantity, 0) }));
  };

  const errors: FieldError[] = result && !result.ok && result.reason === "invalid" ? result.errors : [];
  const errorFor = (field: string) => {
    const e = errors.find((x) => x.field === field);
    return e ? t(e.key, e.params) : undefined;
  };
  const selected = options.find((o) => o.value === live.currency);
  const liveCurrency = selected?.currency ?? live.currency.split(":")[0] ?? "";
  const cartSummary = [
    tr.tp("count.item", live.quantity),
    selected?.label ?? live.currency,
    live.codes.trim() ? live.codes.trim().toUpperCase() : "",
    live.date ? formatDate(live.date, tr.locale) : "",
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <s-page heading={t("tryCart.title")}>
      <s-stack direction="block" gap="base">
        <s-paragraph color="subdued">{t("tryCart.intro")}</s-paragraph>

        <Form method="post" ref={formRef}>
          <input type="hidden" name="intent" value="run" />
          <input type="hidden" name="locale" value={tr.locale} />
          <WonSection title={t("tryCart.cart.title")} glyph="cart" summary={cartSummary}>
            <s-stack direction="block" gap="base">
              {/* §7c calm: the per-line controls sit in one collapsed block; the
                  summary names what is in the cart. Hidden ≠ unmounted: every
                  line still submits (§17d). */}
              <WonBlock
                title={t("tryCart.lines.title")}
                summary={
                  lines.length === 0
                    ? t("tryCart.lines.none")
                    : lines.map((l) => `${l.title} × ${l.quantity}`).join(", ")
                }
                collapsible
                defaultOpen={false}
              >
                {lines.length === 0 ? (
                  <s-text color="subdued">{t("tryCart.cart.empty")}</s-text>
                ) : (
                  <div>
                    {lines.map((line) => {
                      const price = line.unitPrice[liveCurrency];
                      return (
                        <WonRow
                          key={line.variantId}
                          action={
                            <div style={{ display: "flex", alignItems: "flex-end", gap: 8 }}>
                              <div style={{ width: 96 }}>
                                <s-number-field
                                  name="quantity"
                                  label={t("tryCart.qty")}
                                  value={String(line.quantity)}
                                  min={1}
                                  max={999}
                                  inputMode="numeric"
                                />
                              </div>
                              <s-button
                                variant="tertiary"
                                onClick={() => {
                                  const next = lines.filter((l) => l.variantId !== line.variantId);
                                  setLines(next);
                                  setLive((s) => ({ ...s, quantity: next.reduce((sum, l) => sum + l.quantity, 0) }));
                                }}
                              >
                                {t("tryCart.remove")}
                              </s-button>
                            </div>
                          }
                        >
                          <input type="hidden" name="variantId" value={line.variantId} />
                          <input type="hidden" name="productId" value={line.productId} />
                          <s-text type="strong">{line.title}</s-text>
                          <RowNote>
                            {[
                              line.variantTitle,
                              typeof price === "number"
                                ? formatMoney(price, liveCurrency, tr.locale)
                                : liveCurrency
                                  ? t("tryCart.noPrice", { currency: liveCurrency })
                                  : "",
                            ]
                              .filter(Boolean)
                              .join(" · ")}
                          </RowNote>
                        </WonRow>
                      );
                    })}
                  </div>
                )}
              </WonBlock>
              <div>
                <s-button onClick={() => void addProducts()}>{t("tryCart.add")}</s-button>
                {unavailable ? (
                  <div style={{ marginTop: 6 }}>
                    <s-text color="subdued">{t("editor.pick.unavailable")}</s-text>
                  </div>
                ) : null}
              </div>
              {errorFor("lines") ? <RowNote tone="attention">{errorFor("lines")}</RowNote> : null}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 200px), 1fr))", gap: 12 }}>
                <s-select name="currency" label={t("tryCart.market")} value={live.currency} error={errorFor("currency")}>
                  {options.map((o) => (
                    <s-option key={o.value} value={o.value} selected={boolAttr(o.value === live.currency)}>
                      {o.label}
                    </s-option>
                  ))}
                </s-select>
                <s-text-field
                  name="codes"
                  label={t("tryCart.codes")}
                  value={props.codes ?? ""}
                  details={t("tryCart.codesDetails")}
                />
                <s-date-field
                  name="date"
                  label={t("tryCart.date")}
                  value={props.date ?? today}
                  details={timezone ? t("tryCart.dateDetails", { tz: timezone }) : t("tryCart.dateDetailsUtc")}
                  error={errorFor("date")}
                />
              </div>
              <div>
                <s-button type="submit" variant="primary">
                  {t("tryCart.run")}
                </s-button>
              </div>
            </s-stack>
          </WonSection>
        </Form>

        <WonSection title={t("tryCart.result.title")} glyph="receipt" summary={resultSummary(plan, tr)}>
          <s-stack direction="block" gap="base">
            {result && !(result.ok === false && result.reason === "invalid") ? <Notice result={result} /> : null}
            {plan?.warnings && plan.warnings.length > 0 ? (
              // Item 8: where checkout gives (or may give) something else than the plan, before the numbers.
              <s-banner tone="warning" heading={t("tryCart.warning.heading")}>
                <s-unordered-list>
                  {plan.warnings.map((w, i) => (
                    <s-list-item key={`${i}-${w.key}`}>{uiText(w, tr)}</s-list-item>
                  ))}
                </s-unordered-list>
              </s-banner>
            ) : null}
            {plan ? (
              <div>
                {plan.market ? <s-text color="subdued">{t("tryCart.result.market", { market: plan.market })}</s-text> : null}
                {plan.lines.map((line) => (
                  <WonRow key={line.lineId}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                        <s-text type="strong">
                          {line.title} × {line.quantity}
                        </s-text>
                        {line.tier ? <LineChip label={t("tryCart.tier")} /> : null}
                        {line.marginCapped ? <LineChip label={t("tryCart.margin.capped")} /> : null}
                        {line.gift ? <LineChip label={t("tryCart.gift")} /> : null}
                      </span>
                      <span style={{ fontFamily: WON_FONT, fontSize: 13 }}>
                        {line.discount > 0 ? (
                          <>
                            <s-text type="redundant">{formatMoney(line.subtotal, plan.currency, tr.locale)}</s-text>{" "}
                            <strong>{formatMoney(line.total, plan.currency, tr.locale)}</strong>
                          </>
                        ) : (
                          formatMoney(line.total, plan.currency, tr.locale)
                        )}
                      </span>
                    </div>
                    {line.gift ? (
                      <RowNote>{(line.giftChoices ?? 1) > 1 ? t("tryCart.giftChoice", { count: line.giftChoices ?? 1 }) : t("tryCart.giftAdded")}</RowNote>
                    ) : null}
                    <ExplainList items={explainFor(plan.explain, line.lineId)} />
                  </WonRow>
                ))}
                {explainFor(plan.explain, null).length > 0 ? (
                  <WonRow>
                    <s-text type="strong">{t("tryCart.order")}</s-text>
                    <ExplainList items={explainFor(plan.explain, null)} />
                  </WonRow>
                ) : null}
                {plan.margin ? <MarginNotes margin={plan.margin} currency={plan.currency} /> : null}
                <div style={{ borderTop: `1px solid ${WON_LINE}`, paddingTop: 10, fontFamily: WON_FONT, fontSize: 13 }}>
                  <TotalRow label={t("tryCart.totals.subtotal")} value={formatMoney(plan.totals.subtotal, plan.currency, tr.locale)} />
                  {plan.totals.productDiscount > 0 ? (
                    <TotalRow label={t("tryCart.totals.products")} value={`−${formatMoney(plan.totals.productDiscount, plan.currency, tr.locale)}`} />
                  ) : null}
                  {plan.totals.orderDiscount > 0 ? (
                    <TotalRow label={t("tryCart.totals.order")} value={`−${formatMoney(plan.totals.orderDiscount, plan.currency, tr.locale)}`} />
                  ) : null}
                  <TotalRow strong label={t("tryCart.totals.total")} value={formatMoney(plan.totals.total, plan.currency, tr.locale)} />
                </div>
              </div>
            ) : null}
            <s-text color="subdued">{t("tryCart.liveCheck")}</s-text>
          </s-stack>
        </WonSection>
      </s-stack>
    </s-page>
  );
}

/**
 * Margin protection lowered this line's discount (the engine's sentence under
 * it says from what, to what and why). Neutral ink, never red: protection
 * working is not a problem (§11a), and never amber: it is not a plan marker.
 */
/** A quiet tag on a cart line: what shaped its discount (a quantity tier, the margin floor). Neutral, never a status colour. */
function LineChip({ label }: { label: string }) {
  return (
    <span
      style={{
        fontFamily: WON_FONT,
        fontSize: 11,
        fontWeight: 700,
        lineHeight: 1.4,
        padding: "1px 8px",
        borderRadius: 999,
        whiteSpace: "nowrap",
        color: WON_INK,
        background: WON_WASH,
        border: "1px solid #c9d0d8",
      }}
    >
      {label}
    </span>
  );
}

/**
 * What the simulation assumed about margin protection (§12): costs converted
 * with a rate ESTIMATED from market prices when the cart is not in the shop
 * currency (checkout uses Shopify's current rate), how many lines had no
 * cost price, and how many had one that could not be converted into the cart
 * currency (never called "no cost price", audit P2-1c) — with the way to the
 * settings (§13).
 */
function MarginNotes({ margin, currency }: { margin: NonNullable<CartPlanView["margin"]>; currency: string }) {
  const tr = useT();
  const { t } = tr;
  const notConverted = margin.linesCostNotConverted ?? 0;
  if (!margin.rateEstimated && margin.linesWithoutCost === 0 && notConverted === 0) return null;
  return (
    <WonRow action={<s-link href="/app/margin">{t("tryCart.margin.settings")}</s-link>}>
      {margin.rateEstimated ? <RowNote>{t("tryCart.margin.rateEstimated", { currency })}</RowNote> : null}
      {margin.linesWithoutCost > 0 ? <RowNote>{tr.tp("tryCart.margin.withoutCost", margin.linesWithoutCost)}</RowNote> : null}
      {notConverted > 0 ? <RowNote>{tr.tp("tryCart.margin.notConverted", notConverted, { currency })}</RowNote> : null}
    </WonRow>
  );
}

function TotalRow({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "3px 0", fontWeight: strong ? 700 : 400, color: WON_INK }}>
      <span>{label}</span>
      <span>{value}</span>
    </div>
  );
}
