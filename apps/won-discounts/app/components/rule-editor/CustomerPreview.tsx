// The "Sleva" section's consequence slot (§17 slot 3): what the customer gets,
// from the same draft and the same core formatter as the summary (P5). States
// only what the config guarantees (§17c); the engine's full "what applies and
// why" is in Vyzkoušet košík, one click away.
//   - a rule that does not give its discount right now says so first, whatever
//     the reason (every status but "Běží" / "Zapisuje se");
//   - a code rule shows the code the customer enters;
//   - only the currencies of the markets the rule is limited to are listed;
//   - when every currency reads the same (a percentage, free shipping without a
//     minimum in money) there is one line, not the same line per currency.
// The lines are computed by previewModel (pure, tests/ui/describe.test.ts).

import type { DiscountRule } from "@won/core/discounts/config";
import { ruleHasCodes } from "@won/core/discounts/code-batch";
import { describeRuleParts } from "@won/core/discounts/describe";

import type { Translator } from "../../i18n";
import { describeMethod, missingCurrencies, ruleName } from "../model/describe";
import { PlanBadge } from "../shell/PlanBadge";
import { needsAttention, runsNow, statusLabel, statusText, type RuleStatus } from "../model/rule-status";
import type { CurrencyView } from "../model/types";
import { WON_ATTENTION, WON_FONT, WON_INK, WON_LINE, WON_MUTED, WON_WASH } from "../shell/tokens";

export interface PreviewLine {
  /** The currency the line is for; null = the one line that holds for every listed currency. */
  currency: string | null;
  /** What the customer gets there; null = not offered in that currency. */
  offer: string | null;
}

export interface PreviewModel {
  /** The name shown at checkout. */
  name: string;
  /** Why the customer does not get it right now; null = it runs. */
  notNow: string | null;
  notNowAttention: boolean;
  /** "Zákazník zadá kód VIP10." for a code rule with a code; else null. */
  code: string | null;
  lines: PreviewLine[];
}

/** The currencies a rule can apply in: all of the shop's, or only those of the markets it is limited to. */
export function previewCurrencies(rule: DiscountRule, views: readonly CurrencyView[]): string[] {
  const targeted = rule.targeting?.markets ?? [];
  if (targeted.length === 0) return views.map((v) => v.code);
  const narrowed = views.filter((v) => v.markets.some((m) => targeted.includes(m.handle))).map((v) => v.code);
  // A rule limited only to markets that are off applies nowhere; the status line says so.
  return narrowed;
}

export function previewModel(draft: DiscountRule, views: readonly CurrencyView[], status: RuleStatus, tr: Translator): PreviewModel {
  const codes = previewCurrencies(draft, views);
  const missing = missingCurrencies(draft, codes);
  const offers = codes.map((c): PreviewLine => {
    if (missing.includes(c)) return { currency: c, offer: null };
    const p = describeRuleParts(draft, tr.locale, { currency: c });
    return { currency: c, offer: [p.value, ...p.minimum].join(" · ") };
  });
  const same = offers.length > 0 && offers.every((o) => o.offer !== null && o.offer === offers[0].offer);
  const hasCode = draft.method === "code" && ruleHasCodes(draft);
  return {
    name: ruleName(draft, tr),
    notNow: runsNow(status) ? null : (statusText(status, tr) ?? statusLabel(status, tr)),
    notNowAttention: needsAttention(status),
    code: hasCode ? tr.t("editor.preview.code", { method: describeMethod(draft, tr) }) : null,
    lines: same ? [{ currency: null, offer: offers[0].offer }] : offers,
  };
}

export function CustomerPreview({
  draft,
  currencyViews,
  tr,
  status,
}: {
  draft: DiscountRule;
  currencyViews: readonly CurrencyView[];
  tr: Translator;
  status: RuleStatus;
}) {
  const { t } = tr;
  const model = previewModel(draft, currencyViews, status, tr);
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
      <div style={{ fontSize: 13.5, color: WON_INK }}>{t("editor.preview.checkout", { name: model.name })}</div>
      {model.notNow ? (
        <div style={{ fontSize: 12.5, fontWeight: 600, color: model.notNowAttention ? WON_ATTENTION : WON_MUTED }}>{model.notNow}</div>
      ) : null}
      {model.code ? <div style={{ fontSize: 12.5, color: WON_INK }}>{model.code}</div> : null}
      {model.lines.map((line) => (
        <div
          key={line.currency ?? "all"}
          style={{ display: "flex", justifyContent: "space-between", gap: 10, fontSize: 12.5, borderTop: `1px solid ${WON_LINE}`, paddingTop: 6 }}
        >
          {line.currency ? <span style={{ fontWeight: 700, color: WON_INK }}>{line.currency}</span> : null}
          {line.offer === null ? (
            <span style={{ color: WON_ATTENTION, textAlign: "right" }}>{t("common.notOffered")}</span>
          ) : (
            <span style={{ color: WON_MUTED, textAlign: line.currency ? "right" : "left" }}>{line.offer}</span>
          )}
        </div>
      ))}
      <div style={{ fontSize: 12, color: WON_MUTED }}>{t("editor.preview.unsaved")}</div>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <s-link href="/app/try-cart">{t("editor.preview.try")}</s-link>
        <PlanBadge tier="pro" />
      </div>
    </div>
  );
}
