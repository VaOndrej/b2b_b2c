// Vyzkoušet košík (Pro) — build a cart (products/variants + market/currency + the
// shop's own discounts + day and time) and see what applies and WHY, in human
// sentences (spec §5). The plan itself is computed on the server — Shopify prices
// for the chosen market and the product refs checkout reads, then the engine
// (planCart + explainPlan) on the discount function's own payload and checkout's
// own output mapping — and arrives as a ready CartPlanView with its warnings; this
// screen never does discount math (DATA-4, §10b). The market choice submits
// `CZK:cz` (currency + market).
//
// Plan 6 Oct 2026, point 10 + B13:
//   - Pro only. On Free the page is the amber locked frame with the sentence of
//     what the tool is for and the plan link (ProSell); the server refuses the
//     run as well (pages.server tryCartAction).
//   - Discounts are PICKED, not typed (P6): automatic ones are listed as "uplatní
//     se samy", discounts with a code are ticked by name; one that cannot apply
//     for the chosen market or date is disabled and says why. The form submits
//     rule ids; the server resolves each to its first code.
//   - The form is the one source of the summaries (P5): the market select is
//     uncontrolled and only read; the lines summary and the section summary are
//     built from the same FormData snapshot (quantities as typed, variant names).
//   - The product picker's result IS the cart: unticking a product removes it.
//   - Cart lines are always visible (P7). Time is a choice: now / the campaign
//     start (when opened from a campaign) / own date and time.
//   - After the cart or a choice changes, the result is marked as the previous
//     cart's. The result section exists only once there is a result (P2).
// Ochrana marže (MVP 2): a line the protection lowered carries a "Hranice marže"
// marker (the engine's sentence says why), and the plan says when the cost
// prices were converted with an estimated rate (checkout uses Shopify's own).
// Odměny (MVP 4): a reached gift tier shows the gift line the cart on the
// website adds (tagged "Dárek", free at checkout), planned by the server too.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Form } from "react-router";

import type { WonDiscountsConfig } from "@won/core/discounts/config";
import { unsupportedInFunction } from "@won/core/discounts/plan";

import { useT } from "../../i18n/context";
import type { Translator } from "../../i18n";
import { pickProducts } from "../model/app-bridge";
import { formatDate, formatMoney } from "@won/core/discounts/describe";

import { ruleDays } from "../model/describe";
import { currencyViews, marketView, type MarketNames } from "../model/markets";
import { TRY_CART_LIMITS, type TryCartWhen, firstRuleCode } from "../model/try-cart-form";
import { shopToday } from "../model/rule-form";
import { uiText } from "../model/result-copy";
import type { CartPlanView, CurrencyView, ExplainView, FieldError, TryCartLineView, UiResult } from "../model/types";
import { boolAttr } from "../shell/attrs";
import { Notice, ResyncButton } from "../shell/Notice";
import { ProFrame } from "../shell/ProFrame";
import { ProSell } from "../shell/ProSell";
import { SegmentedChoice } from "../shell/SegmentedChoice";
import { RowNote, WonRow, WonSection } from "../shell/WonSection";
import { WON_ATTENTION, WON_FONT, WON_INK, WON_LINE, WON_MUTED, WON_WASH } from "../shell/tokens";

/** One of the shop's discounts as the cart form offers it. */
export interface TryCartRuleView {
  id: string;
  name: string;
  method: "automatic" | "code";
  codes: string[];
  enabled: boolean;
  /** Shop-local first / last day it applies (absent = no limit). */
  startsOn?: string;
  endsOn?: string;
  /** Handles of the markets it is limited to (empty = every market). */
  markets: string[];
  /** Those markets by name, for the "neplatí pro trh" reason. */
  marketNames: string[];
  /** Checkout cannot evaluate it yet (core unsupportedInFunction): it never applies, whatever the cart. */
  unsupported?: boolean;
}

export interface TryCartScreenProps {
  /** The plan runs the tool (BILL-1: the server decides; Free sees the locked frame). */
  pro: boolean;
  currencies: CurrencyView[];
  timezone: string | null;
  /** Shop-local today (default day of the simulation). */
  today: string;
  /** Lines already in the simulated cart (the last run, or a harness fixture). */
  lines: TryCartLineView[];
  /** The shop's discounts: automatic ones are listed, code ones are ticked. */
  rules: TryCartRuleView[];
  /** Code discounts ticked on load (a harness fixture). */
  ruleIds?: string[];
  currency?: string;
  /** Opened from a campaign (?date=&time=): its start, offered as the "začátek kampaně" time choice. */
  date?: string;
  /** Shop-local time of day `HH:MM` that goes with `date`. */
  time?: string;
  plan: CartPlanView | null;
  result: UiResult | null;
}

export function buildTryCartProps(
  config: WonDiscountsConfig,
  opts: { timezone: string | null; shopCurrency?: string | null; marketNames?: MarketNames; now?: Date; date?: string | null; time?: string | null; pro?: boolean },
): TryCartScreenProps {
  return {
    pro: opts.pro === true,
    currencies: currencyViews(config.markets, {
      shopCurrency: opts.shopCurrency,
      rules: config.modules.codes.rules,
      marketNames: opts.marketNames,
    }),
    timezone: opts.timezone,
    today: shopToday(opts.timezone, opts.now),
    // MVP 6: a link from a campaign opens the simulation at its time (?date=&time=).
    ...(opts.date && /^\d{4}-\d{2}-\d{2}$/.test(opts.date) ? { date: opts.date } : {}),
    ...(opts.time && /^([01]\d|2[0-3]):[0-5]\d$/.test(opts.time) ? { time: opts.time } : {}),
    rules: config.modules.codes.rules.map((rule) => {
      const days = ruleDays(rule, opts.timezone);
      const markets = [...(rule.targeting?.markets ?? [])];
      return {
        id: rule.id,
        name: rule.name,
        method: rule.method,
        // The picker shows one code a rule (its first; a rule with generated codes only shows one of those).
        codes: [firstRuleCode(rule)].filter((code): code is string => !!code),
        enabled: rule.enabled,
        ...(days.startsOn ? { startsOn: days.startsOn } : {}),
        ...(days.endsOn ? { endsOn: days.endsOn } : {}),
        markets,
        marketNames: markets.map((handle) => marketView(handle, opts.marketNames ?? {}).name),
        ...(unsupportedInFunction(rule).length > 0 ? { unsupported: true } : {}),
      };
    }),
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

/**
 * Why a discount cannot apply to this cart's market or day (null = it can): switched off, no code yet,
 * not started / already over on that day, or limited to other markets. The engine is still the authority —
 * this only stops the merchant from ticking something that cannot do anything.
 */
export function ruleBlockedReason(rule: TryCartRuleView, ctx: { market: string | null; date: string }, tr: Translator): string | null {
  if (!rule.enabled) return tr.t("tryCart.rules.off");
  if (rule.unsupported) return tr.t("status.unsupportedText");
  if (rule.method === "code" && rule.codes.length === 0) return tr.t("tryCart.rules.noCode");
  if (rule.startsOn && ctx.date < rule.startsOn) return tr.t("tryCart.rules.notYet", { date: formatDate(rule.startsOn, tr.locale) });
  if (rule.endsOn && ctx.date > rule.endsOn) return tr.t("tryCart.rules.ended", { date: formatDate(rule.endsOn, tr.locale) });
  if (ctx.market && rule.markets.length > 0 && !rule.markets.includes(ctx.market)) {
    return tr.t("tryCart.rules.otherMarket", { markets: tr.list(rule.marketNames.length > 0 ? rule.marketNames : rule.markets) });
  }
  return null;
}

/** What the form holds right now: the one snapshot both summaries, the discount list and the "stale" mark read. */
export interface CartSnapshot {
  currency: string;
  when: TryCartWhen;
  date: string;
  time: string;
  ruleIds: string[];
  /** Variant id → quantity as typed (0 = not a number yet). */
  quantities: Record<string, number>;
}

/** FormData → the snapshot (pure: unit tested). */
export function cartSnapshot(fd: { get(name: string): unknown; getAll(name: string): unknown[] }): CartSnapshot {
  const text = (v: unknown) => (typeof v === "string" ? v : "");
  const variants = fd.getAll("variantId").map(text);
  const quantities = fd.getAll("quantity").map(text);
  const out: Record<string, number> = {};
  variants.forEach((id, i) => {
    const n = Number(quantities[i]);
    out[id] = Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
  });
  const when = text(fd.get("when"));
  return {
    currency: text(fd.get("currency")),
    when: when === "campaign" || when === "custom" ? when : "now",
    date: text(fd.get("date")),
    time: text(fd.get("time")),
    ruleIds: fd.getAll("ruleId").map(text).filter(Boolean),
    quantities: out,
  };
}

/** "Mikina Won (M / černá) × 2": the variant is named, so two variants of one product never look the same. */
export function lineLabel(line: Pick<TryCartLineView, "title" | "variantTitle">, quantity: number): string {
  return `${line.title}${line.variantTitle ? ` (${line.variantTitle})` : ""} × ${quantity}`;
}

/**
 * The picker's answer IS the selection (B13): a variant it no longer holds leaves the cart, a new one comes
 * in with 1 piece, and a line that stays keeps its place (its quantity lives in its field).
 */
export function reconcileLines(
  lines: readonly TryCartLineView[],
  picked: readonly { id: string; title: string; variants: readonly { id: string; title: string }[] }[],
  limit: number = TRY_CART_LIMITS.lines,
): TryCartLineView[] {
  const wanted = new Map<string, TryCartLineView>();
  for (const product of picked) {
    for (const variant of product.variants) {
      wanted.set(variant.id, {
        variantId: variant.id,
        productId: product.id,
        title: product.title,
        variantTitle: variant.title && variant.title !== "Default Title" ? variant.title : undefined,
        quantity: 1,
        unitPrice: {},
      });
    }
  }
  const kept = lines.filter((line) => wanted.has(line.variantId));
  const known = new Set(kept.map((line) => line.variantId));
  return [...kept, ...[...wanted.values()].filter((line) => !known.has(line.variantId))].slice(0, limit);
}

function explainFor(explain: readonly ExplainView[], lineId: string | null): ExplainView[] {
  return explain.filter((e) => (lineId === null ? !e.lineIds || e.lineIds.length === 0 : e.lineIds?.includes(lineId)));
}

/**
 * The engine's sentences. An entered code losing to a better discount is an
 * expected outcome, not an error: shown in ink with "!" — never red (§11a: red is
 * "needs attention" in the setup). A sentence about one discount links to it (P3).
 */
function ExplainList({ items }: { items: ExplainView[] }) {
  const { t } = useT();
  if (items.length === 0) return null;
  return (
    <ul style={{ margin: "6px 0 0", padding: 0, listStyle: "none", fontFamily: WON_FONT }}>
      {items.map((item, i) => (
        <li key={i} style={{ display: "flex", gap: 8, fontSize: 12.5, lineHeight: 1.45, color: item.tone === "info" ? WON_MUTED : WON_INK }}>
          <span aria-hidden="true" style={{ flex: "0 0 auto", width: 10, color: WON_INK, fontWeight: 700 }}>
            {item.tone === "success" ? "✓" : item.tone === "warning" ? "!" : "·"}
          </span>
          <span>
            {item.text}
            {item.ruleId ? (
              <>
                {" "}
                <s-link href={`/app/discounts/${encodeURIComponent(item.ruleId)}`}>{t("tryCart.explain.open")}</s-link>
              </>
            ) : null}
          </span>
        </li>
      ))}
    </ul>
  );
}

function resultSummary(plan: CartPlanView | null, tr: Translator): string {
  if (!plan) return tr.t("tryCart.result.failed");
  const discount = plan.totals.productDiscount + plan.totals.orderDiscount;
  if (discount <= 0) return tr.t("tryCart.result.noDiscount");
  return tr.t("tryCart.result.summary", {
    discount: formatMoney(discount, plan.currency, tr.locale),
    total: formatMoney(plan.totals.total, plan.currency, tr.locale),
  });
}

/** Warnings that mean "what is saved is not in Shopify": the fix is a resync, offered right there (§13a). */
const RESYNC_WARNINGS: readonly string[] = ["tryCart.warning.syncFailed", "tryCart.warning.notApplied"];

const signature = (snap: CartSnapshot) => JSON.stringify(snap);

export function TryCartScreen(props: TryCartScreenProps) {
  const { pro, currencies, timezone, today, plan, result, rules } = props;
  const tr = useT();
  const { t } = tr;
  const locked = !pro;
  const options = useMemo(() => marketOptions(currencies), [currencies]);
  const [lines, setLines] = useState<TryCartLineView[]>(props.lines);
  // A run answers with the cart as Shopify priced it: show those titles and prices.
  // (An empty list is a revalidated loader, never a run: the cart being built stays.)
  useEffect(() => {
    if (props.lines.length > 0) setLines(props.lines);
  }, [props.lines]);
  const [unavailable, setUnavailable] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  // Initial values only: the fields are never written back from this state (B13).
  const initialCurrency = props.currency ?? options[0]?.value ?? "";
  const campaign = props.date ? { date: props.date, time: props.time ?? "" } : null;
  const initialWhen: TryCartWhen = campaign ? "campaign" : "now";
  const initial: CartSnapshot = useMemo(
    () => ({
      currency: initialCurrency,
      when: initialWhen,
      date: campaign?.date ?? today,
      time: campaign?.time ?? "",
      ruleIds: props.ruleIds ?? [],
      quantities: Object.fromEntries(props.lines.map((l) => [l.variantId, l.quantity])),
    }),
    // The first render's values; the form is the source afterwards.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  const [snap, setSnap] = useState<CartSnapshot>(initial);
  /** The merchant changed the cart or a choice after the shown result arrived (a real edit, never a re-render). */
  const [edited, setEdited] = useState(false);

  // §2 / P5: every summary follows what is in the form (native events, one FormData read).
  const recompute = useCallback(() => {
    const form = formRef.current;
    if (!form) return;
    const next = cartSnapshot(new FormData(form));
    setSnap((prev) => (signature(prev) === signature(next) ? prev : next));
  }, []);
  useEffect(() => {
    const el = formRef.current;
    if (!el) return;
    const onEdit = () => {
      recompute();
      setEdited(true);
    };
    el.addEventListener("input", onEdit);
    el.addEventListener("change", onEdit);
    return () => {
      el.removeEventListener("input", onEdit);
      el.removeEventListener("change", onEdit);
    };
  }, [recompute]);
  // A line added or removed, or the time choice showing other fields, changes the form: read it again.
  useEffect(() => {
    recompute();
  }, [lines, snap.when, recompute]);
  // A new result belongs to the cart as it is now; any later edit makes it the previous cart's.
  useEffect(() => {
    setEdited(false);
  }, [plan, result]);
  const stale = edited && (plan !== null || result !== null);
  const changeLines = (next: TryCartLineView[]) => {
    setLines(next);
    setEdited(true);
  };

  const addProducts = async () => {
    const res = await pickProducts([...new Set(lines.map((l) => l.productId))]);
    if (!res.ok) {
      if (res.reason === "unavailable") setUnavailable(true);
      return;
    }
    changeLines(reconcileLines(lines, res.items));
  };

  const errors: FieldError[] = result && !result.ok && result.reason === "invalid" ? result.errors : [];
  const errorFor = (field: string) => {
    const e = errors.find((x) => x.field === field);
    return e ? t(e.key, e.params) : undefined;
  };
  const currencyValue = snap.currency || initialCurrency;
  const selected = options.find((o) => o.value === currencyValue);
  const liveCurrency = selected?.currency ?? currencyValue.split(":")[0] ?? "";
  const market = currencyValue.includes(":") ? currencyValue.split(":")[1] || null : null;
  const when = snap.when;
  const dateValue = when === "now" ? today : when === "campaign" && campaign ? campaign.date : snap.date || today;
  const timeValue = when === "now" ? "" : when === "campaign" && campaign ? campaign.time : snap.time;
  const whenText = when === "now" ? t("tryCart.when.now") : [formatDate(dateValue, tr.locale), timeValue].filter(Boolean).join(" ");

  // As typed; a field that holds no number yet (or is not in the form yet) counts as the line's own quantity.
  const quantityOf = (line: TryCartLineView) => snap.quantities[line.variantId] || line.quantity;
  const totalQuantity = lines.reduce((sum, line) => sum + quantityOf(line), 0);
  const ruleCtx = { market, date: dateValue };
  const automatic = rules.filter((r) => r.method === "automatic" && ruleBlockedReason(r, ruleCtx, tr) === null);
  const codeRules = rules.filter((r) => r.method === "code");
  const ticked = codeRules.filter((r) => snap.ruleIds.includes(r.id) && ruleBlockedReason(r, ruleCtx, tr) === null);
  const cartSummary =
    lines.length === 0
      ? t("tryCart.cart.empty")
      : [
          lines.map((line) => lineLabel(line, quantityOf(line))).join(", "),
          selected?.label ?? currencyValue,
          ticked.length > 0 ? tr.list(ticked.map((r) => r.codes[0] ?? r.name)) : "",
          whenText,
        ]
          .filter(Boolean)
          .join(" · ");

  const whenOptions = [
    { value: "now", label: t("tryCart.when.now") },
    ...(campaign ? [{ value: "campaign", label: t("tryCart.when.campaign", { date: [formatDate(campaign.date, tr.locale), campaign.time].filter(Boolean).join(" ") }) }] : []),
    { value: "custom", label: t("tryCart.when.custom") },
  ];

  const cart = (
    <Form method="post" ref={formRef}>
      <input type="hidden" name="intent" value="run" />
      <input type="hidden" name="locale" value={tr.locale} />
      <WonSection title={t("tryCart.cart.title")} glyph="cart" summary={cartSummary}>
        <s-stack direction="block" gap="base">
          {/* P7: the lines are the cart — always visible. An empty cart is one sentence (the summary) and the button. */}
          {lines.length > 0 ? (
            <div data-won-try-cart-lines>
              <s-text color="subdued">{tr.tp("count.item", totalQuantity)}</s-text>
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
                            disabled={boolAttr(locked)}
                          />
                        </div>
                        <s-button variant="tertiary" disabled={boolAttr(locked)} onClick={() => changeLines(lines.filter((l) => l.variantId !== line.variantId))}>
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
          ) : null}
          <div>
            <s-button disabled={boolAttr(locked)} onClick={() => void addProducts()}>
              {t(lines.length > 0 ? "tryCart.change" : "tryCart.add")}
            </s-button>
            {unavailable ? (
              <div style={{ marginTop: 6 }}>
                <s-text color="subdued">{t("editor.pick.unavailable")}</s-text>
              </div>
            ) : null}
          </div>
          {errorFor("lines") ? <RowNote tone="attention">{errorFor("lines")}</RowNote> : null}

          <div style={{ maxWidth: 320 }}>
            {/* Uncontrolled (B13): the initial option is marked once; the choice is only read from the form. */}
            <s-select name="currency" label={t("tryCart.market")} disabled={boolAttr(locked)}>
              {options.map((o) => (
                <s-option key={o.value} value={o.value} selected={boolAttr(o.value === initialCurrency)}>
                  {o.label}
                </s-option>
              ))}
            </s-select>
            {errorFor("currency") ? <RowNote tone="attention">{errorFor("currency")}</RowNote> : null}
          </div>

          <div data-won-try-cart-when>
            <SegmentedChoice name="when" label={t("tryCart.when.label")} options={whenOptions} defaultValue={initialWhen} disabled={locked} />
            {when === "campaign" && campaign ? (
              <>
                <input type="hidden" name="date" value={campaign.date} />
                <input type="hidden" name="time" value={campaign.time} />
              </>
            ) : null}
            {when === "custom" ? (
              <div style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-start", gap: 12, marginTop: 10 }}>
                <div style={{ flex: "0 1 220px" }}>
                  <s-date-field
                    name="date"
                    label={t("tryCart.date")}
                    value={campaign?.date ?? today}
                    details={timezone ? t("tryCart.dateDetails", { tz: timezone }) : t("tryCart.dateDetailsUtc")}
                  />
                </div>
                <label style={{ display: "flex", flexDirection: "column", gap: 4, fontFamily: WON_FONT, fontSize: 13, color: WON_INK }}>
                  {t("tryCart.time")}
                  {/* A native time picker: nothing to type in a format, real input events, submits `HH:MM`. */}
                  <input
                    type="time"
                    name="time"
                    defaultValue={campaign?.time || "12:00"}
                    style={{ font: "inherit", padding: "6px 8px", border: `1px solid ${WON_LINE}`, borderRadius: 8, minHeight: 32 }}
                  />
                </label>
              </div>
            ) : null}
            {errorFor("date") ? <RowNote tone="attention">{errorFor("date")}</RowNote> : null}
            {errorFor("time") ? <RowNote tone="attention">{errorFor("time")}</RowNote> : null}
          </div>

          {rules.length === 0 ? (
            <div data-won-try-cart-rules>
              <s-text type="strong">{t("tryCart.rules.title")}</s-text>
              <WonRow action={<s-link href="/app/discounts">{t("tryCart.rules.create")}</s-link>}>
                <RowNote>{t("tryCart.rules.none")}</RowNote>
              </WonRow>
            </div>
          ) : (
            <div data-won-try-cart-rules>
              <s-text type="strong">{t("tryCart.rules.title")}</s-text>
              {automatic.length > 0 ? (
                <WonRow>
                  <RowNote>{t("tryCart.rules.automatic", { names: tr.list(automatic.map((r) => r.name.trim() || t("common.untitled"))) })}</RowNote>
                </WonRow>
              ) : null}
              {codeRules.map((rule) => {
                const reason = ruleBlockedReason(rule, ruleCtx, tr);
                const off = locked || reason !== null;
                return (
                  <WonRow key={rule.id}>
                    <label style={{ display: "flex", alignItems: "flex-start", gap: 8, fontFamily: WON_FONT, fontSize: 13, color: WON_INK, opacity: off ? 0.6 : 1, cursor: off ? "not-allowed" : "pointer" }}>
                      {/* A native checkbox: a disabled one is not submitted, and disabling it never resets the others. */}
                      <input type="checkbox" name="ruleId" value={rule.id} defaultChecked={(props.ruleIds ?? []).includes(rule.id)} disabled={off} style={{ marginTop: 2 }} />
                      <span>
                        <span style={{ fontWeight: 600 }}>{rule.name.trim() || t("common.untitled")}</span>
                        {rule.codes[0] ? <span style={{ color: WON_MUTED }}> · {t("overview.native.kind.code", { code: rule.codes[0] })}</span> : null}
                      </span>
                    </label>
                    {reason ? <RowNote>{reason}</RowNote> : null}
                  </WonRow>
                );
              })}
            </div>
          )}
          {errorFor("plan") ? <RowNote tone="attention">{errorFor("plan")}</RowNote> : null}
          <div>
            <s-button type="submit" variant="primary" disabled={boolAttr(locked)}>
              {t("tryCart.run")}
            </s-button>
          </div>
        </s-stack>
      </WonSection>
    </Form>
  );

  const showResult = !locked && (plan !== null || (result !== null && !(result.ok === false && result.reason === "invalid")));
  const needsResync = (plan?.warnings ?? []).some((w) => RESYNC_WARNINGS.includes(w.key));

  return (
    <s-page heading={t("tryCart.title")}>
      <s-stack direction="block" gap="base">
        <s-paragraph color="subdued">{t("tryCart.intro")}</s-paragraph>

        {locked ? (
          // Free: what the tool is for + the plan link, above the amber locked form (nothing runs; the server refuses too).
          <>
            <ProSell benefit={t("tryCart.pro.benefit")} />
            <ProFrame locked>{cart}</ProFrame>
          </>
        ) : (
          cart
        )}

        {showResult ? (
          <WonSection title={t("tryCart.result.title")} glyph="receipt" summary={stale ? t("tryCart.result.stale") : resultSummary(plan, tr)}>
            <s-stack direction="block" gap="base">
              {stale ? (
                <div data-won-try-cart-stale style={{ fontFamily: WON_FONT, fontSize: 12.5, color: WON_ATTENTION }}>
                  {t("tryCart.result.staleBody")}
                </div>
              ) : null}
              {result && !(result.ok === false && result.reason === "invalid") ? <Notice result={result} /> : null}
              {plan?.warnings && plan.warnings.length > 0 ? (
                // Item 8: where checkout gives (or may give) something else than the plan, before the numbers.
                <s-banner tone="warning" heading={t("tryCart.warning.heading")}>
                  <s-unordered-list>
                    {plan.warnings.map((w, i) => (
                      <s-list-item key={`${i}-${w.key}`}>{uiText(w, tr)}</s-list-item>
                    ))}
                  </s-unordered-list>
                  {needsResync ? <ResyncButton slot="secondary-actions" /> : null}
                </s-banner>
              ) : null}
              {plan ? (
                <div style={stale ? { opacity: 0.6 } : undefined}>
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
            </s-stack>
          </WonSection>
        ) : null}
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
    <WonRow action={<s-link href="/app/margin#costs">{t("tryCart.margin.settings")}</s-link>}>
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
