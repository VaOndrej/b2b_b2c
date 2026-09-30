// Nastavení (MVP 3; before: the MVP 1 placeholder). Two sections:
//   1. Kombinování slev — the Free per-category switches (decision A1,
//      engine.combination; the MVP 1 debt): outlet with anything, product with
//      order, product with shipping, order with shipping. Each switch says in one
//      sentence what checkout does in its position (§4c, §10d), re-read from the
//      form on every native change (§2/§17b) — a switch that differs from what
//      is stored says "Po uložení:". Product with product is fixed (the better
//      one wins, A1) and said, not switched. The link to Vyzkoušet košík checks
//      the change on a real cart (§13). One save for the page.
//   2. Trhy a měny — the shop's market currencies and the admin language rule.
// A presentational component: app/routes/app.settings.tsx renders it from
// loadSettingsScreen (app/lib/integration/settings.server.ts).

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
import type { CombinationView, SettingsScreenData, UiResult } from "../model/types";
import { boolAttr } from "../shell/attrs";
import { Notice } from "../shell/Notice";
import { RowNote, WonRow, WonSection } from "../shell/WonSection";

export interface SettingsScreenProps extends Partial<SettingsScreenData> {
  currencies: SettingsScreenData["currencies"];
  result?: UiResult | null;
}

export function SettingsScreen({ currencies, combination, configVersion = null, result }: SettingsScreenProps) {
  const tr = useT();
  const { t } = tr;
  const withMarkets = currencies.filter((c) => c.markets.length > 0);
  const stored = combination ?? null;

  // §2/§17b: the live switches, re-read from the form on native events.
  const formRef = useRef<HTMLFormElement>(null);
  const [draft, setDraft] = useState<CombinationView | null>(stored);
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

  return (
    <s-page heading={t("nav.settings")}>
      <Form method="post" ref={formRef} data-save-bar>
        <input type="hidden" name={COMBINATION_FIELD.intent} value={COMBINATION_INTENT.save} />
        {configVersion ? <input type="hidden" name={COMBINATION_FIELD.configVersion} value={configVersion} /> : null}
        <s-stack direction="block" gap="base">
          <Notice result={result} onReplace={replaceUnreadable} />
          {stored && draft ? (
            <WonSection
              title={t("settings.combination.title")}
              glyph="sliders"
              summary={combinationSummary(draft, tr)}
              hint={t("settings.combination.hint")}
              anchor="combination"
            >
              <s-stack direction="block" gap="base">
                <s-text color="subdued">{t("settings.combination.fixed")}</s-text>
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
                <WonRow
                  action={
                    <s-button href="/app/try-cart" variant="secondary">
                      {t("settings.combination.tryCart")}
                    </s-button>
                  }
                >
                  <RowNote>{t("settings.combination.tryCartHint")}</RowNote>
                </WonRow>
              </s-stack>
            </WonSection>
          ) : null}
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
          />
          {stored ? (
            <div>
              <s-button type="submit" variant="primary">
                {t("common.save")}
              </s-button>
            </div>
          ) : null}
        </s-stack>
      </Form>
    </s-page>
  );
}
