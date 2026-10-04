// Vzhled (MVP 3, contract K7) — the four ready-made looks of the quantity-tier
// table on the product page. Each is shown as it will look on THIS shop (§1,
// A1: TiersPreview — the storefront's markup, CSS and texts on the live theme's
// tokens) with the shop's set (else a labelled example) and a real product; the
// choice is a native radio group (§2: the state line follows the pick at once,
// §11b: the shared selection ring), one save for the page. Below: the table on
// the product page (the one deep link to add it, §13) and the app embed.
// MVP 7: the custom look (Pro; amber and locked on Free, §16) — three colours, the corner radius and the merchant's
// own CSS, which the app scopes under the Won blocks (SEC-3), with a brief to hand to an AI; prices by quantity on
// product cards (BETA); the storefront texts per language (empty = the extension's own).
// A presentational component: app/routes/app.appearance.tsx renders it from
// loadAppearanceScreen (app/lib/integration/appearance.server.ts).

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Form, useSubmit } from "react-router";

import { APPEARANCE_PRESETS } from "@won/core/discounts/config";

import { useT } from "../../i18n/context";
import { APPEARANCE_FIELD, APPEARANCE_INTENT, isAppearancePreset, presetDetails, presetLabel, TEXT_LANGS } from "../model/appearance";
import { embedText } from "../model/signals";
import type { AppearancePresetView, AppearanceScreenData, UiResult } from "../model/types";
import { FieldMessage } from "../rule-editor/parts";
import { Notice } from "../shell/Notice";
import { boolAttr } from "../shell/attrs";
import { ProFrame } from "../shell/ProFrame";
import { RowNote, WonRow, WonSection } from "../shell/WonSection";
import { selectionRing, WON_FONT, WON_INK, WON_MUTED } from "../shell/tokens";
import { TiersBlockSection } from "../tiers/TiersBlockSection";
import { TiersPreview, TiersPreviewStyles } from "../tiers/TiersPreview";

export interface AppearanceScreenProps extends AppearanceScreenData {
  result?: UiResult | null;
}

export function AppearanceScreen(props: AppearanceScreenProps) {
  const { plan, configVersion, preset, tokens, sample, product, block, embed, cardPrices, custom, customIssue, texts, cardBlockUrl, aiPrompt, result } = props;
  const pro = plan === "pro";
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

  const errors = result && !result.ok && result.reason === "invalid" ? (result.errors ?? []) : [];
  const presetError = errors.find((e) => e.field === APPEARANCE_FIELD.preset);
  const errorOf = (field: string) => {
    const e = errors.find((x) => x.field === field);
    return e ? t(e.key, e.params) : undefined;
  };
  const changedTexts = texts.reduce((n, x) => n + (x.values.cs ? 1 : 0) + (x.values.sk ? 1 : 0) + (x.values.en ? 1 : 0), 0);
  const customSet = custom.accent !== "" || custom.line !== "" || custom.tint !== "" || custom.radius !== "" || custom.css.trim() !== "";
  const [copied, setCopied] = useState(false);
  const copyPrompt = () => {
    if (typeof navigator === "undefined" || !navigator.clipboard) return;
    void navigator.clipboard.writeText(aiPrompt).then(() => setCopied(true));
  };
  const customFields = (
    <s-stack direction="block" gap="base">
      {customIssue ? <s-banner tone="warning" heading={t("appearance.custom.issue")} /> : null}
      <s-grid gridTemplateColumns="repeat(auto-fit, minmax(160px, 1fr))" gap="base" alignItems="start">
        {(["accent", "line", "tint"] as const).map((key) => (
          <s-text-field
            key={key}
            name={APPEARANCE_FIELD[key]}
            label={t(`appearance.custom.${key}` as "appearance.custom.accent")}
            value={custom[key]}
            placeholder="#0a7d4f"
            error={errorOf(APPEARANCE_FIELD[key])}
            disabled={boolAttr(!pro)}
          />
        ))}
        <s-number-field name={APPEARANCE_FIELD.radius} label={t("appearance.custom.radius")} value={custom.radius} min={0} max={32} step={1} inputMode="numeric" error={errorOf(APPEARANCE_FIELD.radius)} disabled={boolAttr(!pro)} />
      </s-grid>
      <RowNote>{t("appearance.custom.colorHint")}</RowNote>
      <s-text-area name={APPEARANCE_FIELD.css} label={t("appearance.custom.css")} value={custom.css} rows={8} error={errorOf(APPEARANCE_FIELD.css)} disabled={boolAttr(!pro)} />
      <RowNote>{t("appearance.custom.cssHint")}</RowNote>
      <s-stack direction="block" gap="small-300">
        <s-text>{t("appearance.ai.title")}</s-text>
        <RowNote>{t("appearance.ai.hint")}</RowNote>
        <pre data-won-ai-prompt style={{ margin: 0, padding: 10, border: "1px solid #e3e3e3", borderRadius: 8, fontSize: 12, lineHeight: 1.45, whiteSpace: "pre-wrap", overflowWrap: "anywhere", maxHeight: 180, overflow: "auto" }}>
          {aiPrompt}
        </pre>
        <div>
          <s-button variant="secondary" onClick={copyPrompt} disabled={boolAttr(!pro)}>
            {copied ? `${t("appearance.ai.copy")} ✓` : t("appearance.ai.copy")}
          </s-button>
        </div>
      </s-stack>
    </s-stack>
  );
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
        <input type="hidden" name={APPEARANCE_FIELD.extras} value="1" />
        {configVersion ? <input type="hidden" name={APPEARANCE_FIELD.configVersion} value={configVersion} /> : null}
        <s-stack direction="block" gap="base">
          <Notice result={result} onReplace={replaceUnreadable} />
          <WonSection title={t("module.appearance")} glyph="spark" summary={t("appearance.summary", { preset: presetLabel(chosen, tr) })} hint={t("appearance.hint")} anchor="looks">
            <s-stack direction="block" gap="base">
              <TiersPreviewStyles />
              <div role="radiogroup" aria-label={t("appearance.choose")} style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 380px), 1fr))", gap: 12 }}>
                {APPEARANCE_PRESETS.map((p) => (
                  <LookCard
                    key={p}
                    preset={p}
                    active={chosen === p}
                    saved={p === preset}
                    onPick={setChosen}
                    preview={<TiersPreview set={sample} preset={p} tokens={tokens} product={product} bare withStyles={false} quantity={sample?.breaks[0]?.minQty ?? 3} />}
                  />
                ))}
              </div>
              <FieldMessage text={presetError ? t(presetError.key, presetError.params) : undefined} />
              <div style={{ fontSize: 12, lineHeight: 1.4, color: WON_MUTED }}>
                {sample ? null : `${t("tiers.preview.sample")} `}
                {tokens?.themeName ? t("tiers.preview.theme", { theme: tokens.themeName }) : t("tiers.preview.noTheme")}
                {tokens?.fontBody ? ` ${t("tiers.preview.font", { font: tokens.fontBody })}` : ""}
              </div>
            </s-stack>
          </WonSection>

          <WonSection
            title={t("appearance.custom.title")}
            glyph="spark"
            pro
            locked={!pro}
            on={pro && customSet}
            summary={t(customSet ? "appearance.custom.summary.on" : "appearance.custom.summary.off")}
            anchor="custom"
            collapsible
            defaultOpen={customSet || errors.some((e) => e.field.startsWith("look."))}
          >
            {pro ? (
              customFields
            ) : (
              <ProFrame locked>
                <s-stack direction="block" gap="small-300">
                  <RowNote>{t("appearance.custom.locked")}</RowNote>
                  {customFields}
                </s-stack>
              </ProFrame>
            )}
          </WonSection>

          <WonSection
            title={`${t("appearance.cards.title")} · ${t("appearance.beta")}`}
            glyph="tag"
            on={cardPrices}
            summary={t(cardPrices ? "appearance.cards.summary.on" : "appearance.cards.summary.off")}
            anchor="cards"
            collapsible
            defaultOpen={cardPrices}
          >
            <s-stack direction="block" gap="small-300">
              <s-checkbox name={APPEARANCE_FIELD.cardPrices} value="on" label={t("appearance.cards.toggle")} checked={boolAttr(cardPrices)} />
              <RowNote>{t("appearance.cards.what")}</RowNote>
              <RowNote>{t("appearance.cards.auto")}</RowNote>
              <WonRow
                action={
                  cardBlockUrl ? (
                    <s-button href={cardBlockUrl} target="_blank" variant="secondary">
                      {t("appearance.cards.addBlock")}
                    </s-button>
                  ) : undefined
                }
              >
                <RowNote>{t("appearance.cards.block")}</RowNote>
              </WonRow>
            </s-stack>
          </WonSection>

          <WonSection
            title={t("appearance.texts.title")}
            glyph="code"
            summary={changedTexts > 0 ? t("appearance.texts.summary.some", { n: changedTexts }) : t("appearance.texts.summary.none")}
            anchor="texts"
            collapsible
            defaultOpen={errors.some((e) => e.field.startsWith(APPEARANCE_FIELD.text))}
          >
            <s-stack direction="block" gap="base">
              <RowNote>{t("appearance.texts.hint")}</RowNote>
              {texts.map((x) => (
                <s-grid key={x.key} gridTemplateColumns="repeat(auto-fit, minmax(200px, 1fr))" gap="small-300" alignItems="start">
                  {TEXT_LANGS.map((lang) => (
                    <s-text-field
                      key={lang}
                      name={`${APPEARANCE_FIELD.text}${lang}.${x.key}`}
                      label={`${x.key} · ${lang}`}
                      value={x.values[lang]}
                      placeholder={x.defaults[lang]}
                      error={errorOf(`${APPEARANCE_FIELD.text}${lang}.${x.key}`)}
                    />
                  ))}
                </s-grid>
              ))}
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

/**
 * One look (review fix 12): a native radio whose accessible name is the look's
 * name only (`aria-labelledby`) and whose description is its one-line detail —
 * the preview beside it is decoration for sighted users, not part of the name.
 * The card shows keyboard focus with a visible ring (`:focus-visible`), never
 * the selection blue alone (§11b: selection and focus are told apart).
 */
function LookCard({
  preset,
  active,
  saved,
  onPick,
  preview,
}: {
  preset: AppearancePresetView;
  active: boolean;
  saved: boolean;
  onPick: (preset: AppearancePresetView) => void;
  preview: ReactNode;
}) {
  const tr = useT();
  const nameId = useId();
  const detailsId = useId();
  const [focusVisible, setFocusVisible] = useState(false);
  return (
    <label
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
        ...(focusVisible ? { outline: `3px solid ${WON_INK}`, outlineOffset: 2 } : {}),
      }}
    >
      <input
        type="radio"
        name={APPEARANCE_FIELD.preset}
        value={preset}
        checked={active}
        aria-labelledby={nameId}
        aria-describedby={detailsId}
        onChange={(e) => {
          if (isAppearancePreset(e.currentTarget.value)) onPick(e.currentTarget.value);
        }}
        onFocus={(e) => setFocusVisible(e.currentTarget.matches(":focus-visible"))}
        onBlur={() => setFocusVisible(false)}
        style={{ position: "absolute", opacity: 0, width: 1, height: 1, margin: 0, pointerEvents: "none" }}
      />
      <span style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <span id={nameId} style={{ fontSize: 14, fontWeight: 700, color: WON_INK }}>
          {presetLabel(preset, tr)}
        </span>
        {saved ? <span style={{ fontSize: 11, fontWeight: 700, color: WON_MUTED }}>{tr.t("appearance.current")}</span> : null}
      </span>
      <span id={detailsId} style={{ fontSize: 12.5, lineHeight: 1.4, color: WON_MUTED }}>
        {presetDetails(preset, tr)}
      </span>
      <span aria-hidden="true" style={{ display: "block", minWidth: 0 }}>
        {preview}
      </span>
    </label>
  );
}
