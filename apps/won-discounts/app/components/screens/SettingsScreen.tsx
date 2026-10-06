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
// A presentational component: app/routes/app.settings.tsx renders it from
// loadSettingsScreen (app/lib/integration/settings.server.ts) and loadPlanScreen.

import { useCallback, useEffect, useRef, useState } from "react";
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
} from "../model/combination";
import { PLAN_ACTION, type PlanActionResult, type PlanScreenData } from "../model/plan";
import type { CombinationView, SettingsScreenData, UiResult } from "../model/types";
import { boolAttr } from "../shell/attrs";
import { Notice } from "../shell/Notice";
import { PlanBadge } from "../shell/PlanBadge";
import { RowNote, WonRow, WonSection } from "../shell/WonSection";
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

export function SettingsScreen({ currencies, combination: stored, configVersion, plan, result, planScreen, planAction = PLAN_ACTION }: SettingsScreenProps) {
  const tr = useT();
  const { t } = tr;
  const withMarkets = currencies.filter((c) => c.markets.length > 0);

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

  return (
    <s-page heading={t("nav.settings")}>
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
            withMarkets.length === 0
              ? t("settings.markets.none")
              : t("settings.markets.list", {
                  currencies: tr.list(withMarkets.map((c) => `${c.code} (${c.markets.map((m) => m.name).join(", ")})`)),
                })
          }
          hint={t("settings.language")}
          anchor="markets"
        >
          <div>
            <s-button href={SHOPIFY_MARKETS_URL} target="_top" variant="secondary">
              {t("settings.markets.manage")}
            </s-button>
          </div>
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
    </s-page>
  );
}
