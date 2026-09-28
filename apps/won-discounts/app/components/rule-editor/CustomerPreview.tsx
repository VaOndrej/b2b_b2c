// The "Sleva" section's consequence slot (§17 slot 3): what the customer gets in
// each market currency, from the same draft and the same core formatter as the
// summary. States only what the config guarantees (§17c); the engine's full
// "what applies and why" is in Vyzkoušet košík, one click away.

import type { DiscountRule } from "@won/core/discounts/config";
import { describeRuleParts } from "@won/core/discounts/describe";

import type { Translator } from "../../i18n";
import { missingCurrencies, ruleName } from "../model/describe";
import { needsAttention, statusText, type RuleStatus } from "../model/rule-status";
import { WON_ATTENTION, WON_FONT, WON_INK, WON_LINE, WON_MUTED, WON_WASH } from "../shell/tokens";

export function CustomerPreview({
  draft,
  codes,
  tr,
  status,
}: {
  draft: DiscountRule;
  codes: string[];
  tr: Translator;
  status: RuleStatus;
}) {
  const { t } = tr;
  // A rule that does not run today says so first (§17c): the amounts below are
  // what it WOULD give, not what a customer gets now.
  const notNow = ["off", "unsupported", "no_code", "scheduled", "ended"].includes(status.kind) ? statusText(status, tr) ?? t("status.off") : null;
  const missing = missingCurrencies(draft, codes);
  const offerIn = (c: string): string => {
    const p = describeRuleParts(draft, tr.locale, { currency: c });
    return [p.value, ...p.minimum].join(" · ");
  };
  return (
    <div
      style={{
        fontFamily: WON_FONT,
        background: WON_WASH,
        border: `1px solid ${WON_LINE}`,
        borderRadius: 12,
        padding: 12,
        display: "flex",
        flexDirection: "column",
        gap: 8,
      }}
    >
      <div style={{ fontSize: 12, fontWeight: 700, color: WON_MUTED, textTransform: "uppercase", letterSpacing: ".04em" }}>
        {t("editor.preview.title")}
      </div>
      <div style={{ fontSize: 13.5, color: WON_INK }}>{t("editor.preview.checkout", { name: ruleName(draft, tr) })}</div>
      {notNow ? (
        <div style={{ fontSize: 12.5, fontWeight: 600, color: needsAttention(status) ? WON_ATTENTION : WON_MUTED }}>{notNow}</div>
      ) : null}
      {codes.map((c) => (
        <div key={c} style={{ display: "flex", justifyContent: "space-between", gap: 10, fontSize: 12.5, borderTop: `1px solid ${WON_LINE}`, paddingTop: 6 }}>
          <span style={{ fontWeight: 700, color: WON_INK }}>{c}</span>
          {missing.includes(c) ? (
            <span style={{ color: WON_ATTENTION, textAlign: "right" }}>{t("common.notOffered")}</span>
          ) : (
            <span style={{ color: WON_MUTED, textAlign: "right" }}>{offerIn(c)}</span>
          )}
        </div>
      ))}
      <div style={{ fontSize: 12, color: WON_MUTED }}>{t("editor.preview.unsaved")}</div>
      <div>
        <s-link href="/app/try-cart">{t("editor.preview.try")}</s-link>
      </div>
    </div>
  );
}
