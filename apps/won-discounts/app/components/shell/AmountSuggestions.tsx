// An amount suggested for the other markets (audit 6 Oct 2026, návrh 2; Ondřej 7 Oct 2026: only from the rate set
// by hand in Shopify, and say so where there is none). The merchant types the amount in the shop currency; under
// the fields each other market whose field is still empty gets one row — the suggestion with the button that
// fills the field, or the sentence that no rate is set. Nothing is filled or saved without the click (MKT-1).
//
// The component reads its form itself (native input / change — React 18 fires no onChange on `s-*` fields), so it
// works in every amount form: Odměny, Množstevní slevy, the discount editor.

import { useEffect, useRef, useState } from "react";

import { formatMoney } from "@won/core/discounts/describe";
import { amountKeyCurrency, currencyExponent } from "@won/core/discounts/money";

import { useT } from "../../i18n/context";
import { suggestedAmount, type AmountSuggestView } from "../model/markets";
import type { CurrencyView } from "../model/types";
import { WON_FONT, WON_INK, WON_LINE, WON_MUTED, WON_SELECT, WON_WASH } from "./tokens";

const BOX = { display: "flex", flexWrap: "wrap", alignItems: "center", gap: "6px 10px", marginTop: 8, padding: "8px 10px", borderRadius: 10, fontFamily: WON_FONT } as const;
const CHIP = { flex: "0 0 auto", padding: "2px 8px", borderRadius: 999, fontSize: 11.5, fontWeight: 700, letterSpacing: "0.01em" } as const;

function majorOf(raw: string | undefined): number {
  return Number((raw ?? "").trim().replace(/\s/g, "").replace(",", "."));
}

export function AmountSuggestions({
  suggest,
  currencies,
  field,
  initial,
}: {
  /** Absent = the shop currency is not known: nothing is shown. */
  suggest?: AmountSuggestView;
  currencies: readonly CurrencyView[];
  /** The name of the amount field of a currency. */
  field: (code: string) => string;
  /** What the fields hold when rendered (major units as typed; "" = empty). */
  initial: Readonly<Record<string, string>>;
}) {
  const tr = useT();
  const { t } = tr;
  const ref = useRef<HTMLDivElement>(null);
  const [values, setValues] = useState<Readonly<Record<string, string>>>(initial);
  const codes = currencies.map((c) => c.code);
  const names = codes.map(field).join("|");
  useEffect(() => {
    const form = ref.current?.closest("form");
    if (!form) return;
    const read = () => {
      const data = new FormData(form);
      setValues(Object.fromEntries(codes.map((code) => [code, typeof data.get(field(code)) === "string" ? String(data.get(field(code))) : ""])));
    };
    form.addEventListener("input", read);
    form.addEventListener("change", read);
    return () => {
      form.removeEventListener("input", read);
      form.removeEventListener("change", read);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the field names say when the set of fields changed
  }, [names]);

  // The field the merchant types first: the (first) market selling in the shop currency. Amounts are per market
  // (7 Oct 2026), so every other market gets its own suggestion — one in the same currency the same amount.
  const base = suggest ? codes.find((code) => amountKeyCurrency(code) === suggest.base) : undefined;
  const baseMajor = base ? majorOf(values[base]) : NaN;
  const rows = suggest && base && baseMajor > 0 ? currencies.filter((c) => c.code !== base && (values[c.code] ?? "").trim() === "") : [];
  const use = (code: string, value: string) => {
    const form = ref.current?.closest("form");
    const el = form?.querySelector(`[name="${CSS.escape(field(code))}"]`) as (HTMLElement & { value?: string }) | null;
    if (!el) return;
    el.value = value;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  };

  return (
    <div ref={ref} data-won-amount-suggest>
      {rows.map((c) => {
        const market = c.markets.length > 0 ? `${c.markets.map((m) => m.name).join(", ")} (${amountKeyCurrency(c.code)})` : amountKeyCurrency(c.code);
        const exponent = currencyExponent(c.code);
        const currency = amountKeyCurrency(c.code);
        // The market's own manual rate first (two markets of one currency may have different ones), then its currency's.
        const rate = c.markets.map((m) => suggest?.marketRates?.[m.handle]).find((r) => typeof r === "number") ?? suggest?.rates[currency];
        const major = currency === suggest?.base ? baseMajor : suggestedAmount(baseMajor, rate, exponent);
        // A box of its own, apart from the field notes (Ondřej 7 Oct 2026): blue = something to pick (§11a), grey = nothing to offer.
        if (major === null) {
          return (
            <div key={c.code} data-won-suggest="none" style={{ ...BOX, background: WON_WASH, border: `1px solid ${WON_LINE}` }}>
              <span style={{ ...CHIP, background: "#e3e7ec", color: WON_MUTED }}>{t("suggest.labelNone")}</span>
              <span style={{ flex: "1 1 220px", minWidth: 0, fontSize: 12.5, lineHeight: 1.4, color: WON_MUTED }}>{t("suggest.none", { market })}</span>
            </div>
          );
        }
        const amount = formatMoney(Math.round(major * 10 ** exponent), c.code, tr.locale);
        return (
          <div key={c.code} data-won-suggest="offer" style={{ ...BOX, background: "#f2f7ff", border: "1px solid rgba(26,115,232,.3)" }}>
            <span style={{ ...CHIP, background: WON_SELECT, color: "#fff" }}>{t("suggest.label")}</span>
            <span style={{ flex: "1 1 220px", minWidth: 0, fontSize: 12.5, lineHeight: 1.4, color: WON_INK }}>{t("suggest.offer", { market, amount })}</span>
            <s-button variant="secondary" onClick={() => use(c.code, String(major))}>
              {t("suggest.use", { amount })}
            </s-button>
          </div>
        );
      })}
    </div>
  );
}
