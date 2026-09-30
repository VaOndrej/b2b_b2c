// Vzhled (MVP 3, contract K7) — the four ready-made looks of the quantity-tier
// table on the product page. Each is shown as it will look on THIS shop (§1,
// A1: TiersPreview — the storefront's markup, CSS and texts on the live theme's
// tokens) with the shop's set (else a labelled example) and a real product; the
// choice is a native radio group (§2: the state line follows the pick at once,
// §11b: the shared selection ring), one save for the page. Below: the table on
// the product page (the one deep link to add it, §13) and the app embed. A
// custom look (colors, layout) is Pro in a later version — said, not faked.
// A presentational component: app/routes/app.appearance.tsx renders it from
// loadAppearanceScreen (app/lib/integration/appearance.server.ts).

import { useEffect, useRef, useState } from "react";
import { Form, useSubmit } from "react-router";

import { APPEARANCE_PRESETS } from "@won/core/discounts/config";

import { useT } from "../../i18n/context";
import { APPEARANCE_FIELD, APPEARANCE_INTENT, isAppearancePreset, presetDetails, presetLabel } from "../model/appearance";
import { embedText } from "../model/signals";
import type { AppearancePresetView, AppearanceScreenData, UiResult } from "../model/types";
import { FieldMessage } from "../rule-editor/parts";
import { Notice } from "../shell/Notice";
import { PlanBadge } from "../shell/PlanBadge";
import { WonRow, WonSection } from "../shell/WonSection";
import { selectionRing, WON_FONT, WON_INK, WON_MUTED } from "../shell/tokens";
import { TiersBlockSection } from "../tiers/TiersBlockSection";
import { TiersPreview, TiersPreviewStyles } from "../tiers/TiersPreview";

export interface AppearanceScreenProps extends AppearanceScreenData {
  result?: UiResult | null;
}

export function AppearanceScreen(props: AppearanceScreenProps) {
  const { plan, configVersion, preset, tokens, sample, product, block, embed, result } = props;
  const tr = useT();
  const { t } = tr;
  const [chosen, setChosen] = useState<AppearancePresetView>(preset);
  const formRef = useRef<HTMLFormElement>(null);

  // "Discard" in the App Bridge save bar: back to the stored look.
  useEffect(() => {
    const el = formRef.current;
    if (!el) return;
    const onReset = () => setChosen(preset);
    el.addEventListener("reset", onReset);
    return () => el.removeEventListener("reset", onReset);
  }, [preset]);

  const errors = result && !result.ok && result.reason === "invalid" ? result.errors : [];
  const presetError = errors.find((e) => e.field === APPEARANCE_FIELD.preset);
  const submit = useSubmit();
  const replaceUnreadable = () => {
    const form = formRef.current;
    if (!form) return;
    const data = new FormData(form);
    data.set(APPEARANCE_FIELD.replaceUnreadable, "1");
    submit(data, { method: "post" });
  };

  return (
    <s-page heading={t("module.appearance")}>
      <Form method="post" ref={formRef} data-save-bar>
        <input type="hidden" name={APPEARANCE_FIELD.intent} value={APPEARANCE_INTENT.save} />
        {configVersion ? <input type="hidden" name={APPEARANCE_FIELD.configVersion} value={configVersion} /> : null}
        <s-stack direction="block" gap="base">
          <Notice result={result} onReplace={replaceUnreadable} />
          <WonSection title={t("module.appearance")} glyph="spark" summary={t("appearance.summary", { preset: presetLabel(chosen, tr) })} hint={t("appearance.hint")} anchor="looks">
            <s-stack direction="block" gap="base">
              <TiersPreviewStyles />
              <div role="radiogroup" aria-label={t("appearance.choose")} style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 380px), 1fr))", gap: 12 }}>
                {APPEARANCE_PRESETS.map((p) => {
                  const active = chosen === p;
                  return (
                    <label
                      key={p}
                      style={{
                        ...selectionRing(active),
                        position: "relative",
                        display: "grid",
                        alignContent: "start",
                        gap: 10,
                        padding: 12,
                        borderRadius: 12,
                        cursor: "pointer",
                        fontFamily: WON_FONT,
                        minWidth: 0,
                      }}
                    >
                      <input
                        type="radio"
                        name={APPEARANCE_FIELD.preset}
                        value={p}
                        checked={active}
                        onChange={(e) => {
                          if (isAppearancePreset(e.currentTarget.value)) setChosen(e.currentTarget.value);
                        }}
                        style={{ position: "absolute", opacity: 0, width: 1, height: 1, margin: 0, pointerEvents: "none" }}
                      />
                      <span style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                        <span style={{ fontSize: 14, fontWeight: 700, color: WON_INK }}>{presetLabel(p, tr)}</span>
                        {p === preset ? <span style={{ fontSize: 11, fontWeight: 700, color: WON_MUTED }}>{t("appearance.current")}</span> : null}
                      </span>
                      <span style={{ fontSize: 12.5, lineHeight: 1.4, color: WON_MUTED }}>{presetDetails(p, tr)}</span>
                      <TiersPreview set={sample} preset={p} tokens={tokens} product={product} bare withStyles={false} quantity={sample?.breaks[0]?.minQty ?? 3} />
                    </label>
                  );
                })}
              </div>
              <FieldMessage text={presetError ? t(presetError.key, presetError.params) : undefined} />
              <div style={{ fontSize: 12, lineHeight: 1.4, color: WON_MUTED }}>
                {sample ? null : `${t("tiers.preview.sample")} `}
                {tokens?.themeName ? t("tiers.preview.theme", { theme: tokens.themeName }) : t("tiers.preview.noTheme")}
                {tokens?.fontBody ? ` ${t("tiers.preview.font", { font: tokens.fontBody })}` : ""}
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <PlanBadge tier="pro" locked={plan !== "pro"} />
                <s-text color="subdued">{t("appearance.custom")}</s-text>
              </div>
            </s-stack>
          </WonSection>
          <TiersBlockSection block={block} product={product} />
          <WonSection title={t("appearance.embed")} glyph="store" summary={embedText(embed.state, tr)}>
            {embed.state !== "on" && embed.activateUrl ? (
              <WonRow
                action={
                  <s-button href={embed.activateUrl} target="_blank" variant="secondary">
                    {t("overview.embed.activate")}
                  </s-button>
                }
              >
                {null}
              </WonRow>
            ) : null}
          </WonSection>
          <div>
            <s-button type="submit" variant="primary">
              {t("common.save")}
            </s-button>
          </div>
        </s-stack>
      </Form>
    </s-page>
  );
}
