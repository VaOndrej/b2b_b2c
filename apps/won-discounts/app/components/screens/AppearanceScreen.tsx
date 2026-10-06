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

import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { Form, useSubmit } from "react-router";

import { APPEARANCE_PRESETS } from "@won/core/discounts/config";

import { useT } from "../../i18n/context";
import {
  APPEARANCE_FIELD,
  APPEARANCE_INTENT,
  changedTextCount,
  customLookSet,
  isAppearancePreset,
  liveCustomLookCss,
  presetDetails,
  presetLabel,
  TEXT_LANGS,
  textField,
  textLabel,
  textLangLabel,
} from "../model/appearance";
import { embedText } from "../model/signals";
import type { AppearancePresetView, AppearanceScreenData, PreviewLookView, UiResult } from "../model/types";
import { FieldMessage } from "../rule-editor/parts";
import { Notice } from "../shell/Notice";
import { boolAttr } from "../shell/attrs";
import { ProFrame } from "../shell/ProFrame";
import { ProSell } from "../shell/ProSell";
import { RowNote, WonRow, WonSection } from "../shell/WonSection";
import { selectionRing, WON_FONT, WON_INK, WON_MUTED } from "../shell/tokens";
import { TiersBlockSection } from "../tiers/TiersBlockSection";
import { TiersPreview, TiersPreviewStyles } from "../tiers/TiersPreview";

export interface AppearanceScreenProps extends AppearanceScreenData {
  result?: UiResult | null;
}

/** The last read value of every field (the first one of a name). */
function snapshotOf(form: HTMLFormElement): Map<string, string> {
  const out = new Map<string, string>();
  for (const [name, value] of new FormData(form).entries()) if (!out.has(name) && typeof value === "string") out.set(name, value);
  return out;
}

export function AppearanceScreen(props: AppearanceScreenProps) {
  const { plan, configVersion, preset, tokens, sample, product, block, embed, cardPrices, custom, customIssue, texts, cardBlockUrl, aiPrompt, previewLook, result } = props;
  const pro = plan === "pro";
  const tr = useT();
  const { t, locale } = tr;
  const [chosen, setChosen] = useState<AppearancePresetView>(preset);
  const formRef = useRef<HTMLFormElement>(null);
  const langs = props.languages && props.languages.length > 0 ? TEXT_LANGS.filter((lang) => props.languages!.includes(lang)) : TEXT_LANGS;

  // P5: the state lines and the previews follow the form — re-read on every native input / change (never React's
  // onChange on an `s-*` field). null = nothing typed yet: what is stored.
  const [snapshot, setSnapshot] = useState<Map<string, string> | null>(null);
  const recompute = useCallback(() => {
    if (formRef.current) setSnapshot(snapshotOf(formRef.current));
  }, []);
  useEffect(() => {
    const el = formRef.current;
    if (!el) return;
    // "Discard" in the App Bridge save bar: back to the stored look and the stored values.
    const onReset = () => {
      setChosen(preset);
      setSnapshot(null);
      window.setTimeout(recompute, 0);
    };
    el.addEventListener("input", recompute);
    el.addEventListener("change", recompute);
    el.addEventListener("reset", onReset);
    return () => {
      el.removeEventListener("input", recompute);
      el.removeEventListener("change", recompute);
      el.removeEventListener("reset", onReset);
    };
  }, [preset, recompute]);

  const errors = result && !result.ok && result.reason === "invalid" ? (result.errors ?? []) : [];
  const presetError = errors.find((e) => e.field === APPEARANCE_FIELD.preset);
  const errorOf = (field: string) => {
    const e = errors.find((x) => x.field === field);
    return e ? t(e.key, e.params) : undefined;
  };

  // What is stored, by field name — the form's values before anything is typed.
  const stored = useMemo(() => {
    const map = new Map<string, string>([
      [APPEARANCE_FIELD.accent, custom.accent],
      [APPEARANCE_FIELD.line, custom.line],
      [APPEARANCE_FIELD.tint, custom.tint],
      [APPEARANCE_FIELD.radius, custom.radius],
      [APPEARANCE_FIELD.css, custom.css],
    ]);
    for (const x of texts) for (const lang of TEXT_LANGS) map.set(textField(lang, x.key), x.values[lang]);
    return map;
  }, [custom, texts]);
  const storedCustomSet = customLookSet((field) => stored.get(field) ?? "");
  // On Free the custom-look fields are locked (disabled fields are not in the form): what is stored is what there is.
  const lookValue = (field: string) => (pro && snapshot ? (snapshot.get(field) ?? "") : (stored.get(field) ?? ""));
  const customSet = customLookSet(lookValue);
  const cardsOn = snapshot ? snapshot.has(APPEARANCE_FIELD.cardPrices) : cardPrices;
  const textValues: [string, string][] = texts.flatMap((x) => langs.map((lang): [string, string] => [textField(lang, x.key), snapshot ? (snapshot.get(textField(lang, x.key)) ?? "") : x.values[lang]]));
  const changedTexts = changedTextCount(textValues);

  // The previews: the custom look as the storefront would get it and the texts in the admin language — live on what
  // is typed; before that (and for the look on Free, which the plan does not ship) what the server read.
  const extras: PreviewLookView = useMemo(() => {
    if (!snapshot) return previewLook ?? { customCss: null, texts: {} };
    const typed: Record<string, string> = {};
    for (const x of texts) {
      const value = (snapshot.get(textField(locale, x.key)) ?? "").trim();
      if (value !== "") typed[x.key] = value;
    }
    return { customCss: pro ? liveCustomLookCss((field) => snapshot.get(field) ?? "") || null : (previewLook?.customCss ?? null), texts: { ...previewLook?.texts, [locale]: typed } };
  }, [snapshot, previewLook, texts, locale, pro]);

  // "Zkopírovat zadání pro AI": says when it worked — and when it did not (no clipboard in this browser / frame).
  const [copied, setCopied] = useState<"done" | "failed" | null>(null);
  const copyPrompt = () => {
    if (typeof navigator === "undefined" || !navigator.clipboard?.writeText) {
      setCopied("failed");
      return;
    }
    navigator.clipboard.writeText(aiPrompt).then(
      () => setCopied("done"),
      () => setCopied("failed"),
    );
  };
  const customFields = (
    <s-stack direction="block" gap="base">
      {customIssue ? <s-banner tone="warning" heading={t("appearance.custom.issue")} /> : null}
      <s-grid gridTemplateColumns="repeat(auto-fit, minmax(160px, 1fr))" gap="base" alignItems="start">
        {(["accent", "line", "tint"] as const).map((key) => (
          // P6: a colour is picked, not typed — the field submits a hex the server takes (#rrggbb); empty = the theme's.
          <s-color-field
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
            {copied === "done" ? `${t("appearance.ai.copy")} ✓` : t("appearance.ai.copy")}
          </s-button>
        </div>
        {copied === "failed" ? <RowNote tone="attention">{t("appearance.ai.copyFailed")}</RowNote> : null}
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
  // The app on the storefront: a section only when there is something to do (P2), then marked with its one fix (P3).
  const embedAction = embed.state !== "on" && embed.activateUrl ? embed.activateUrl : null;

  return (
    <s-page heading={t("module.appearance")}>
      <Form method="post" ref={formRef} data-save-bar>
        <input type="hidden" name={APPEARANCE_FIELD.intent} value={APPEARANCE_INTENT.save} />
        <input type="hidden" name={APPEARANCE_FIELD.extras} value="1" />
        {configVersion ? <input type="hidden" name={APPEARANCE_FIELD.configVersion} value={configVersion} /> : null}
        <s-stack direction="block" gap="base">
          <Notice result={result} onReplace={replaceUnreadable} />
          {embedAction ? (
            <WonSection title={t("appearance.embed")} glyph="store" summary={embedText(embed.state, tr)} anchor="embed">
              <WonRow
                tone="attention"
                action={
                  <s-button href={embedAction} target="_blank" variant="primary">
                    {t("overview.embed.activate")}
                  </s-button>
                }
              >
                <RowNote tone="attention">{t("appearance.embed.needed")}</RowNote>
              </WonRow>
            </WonSection>
          ) : null}
          <WonSection title={t("module.appearance")} glyph="spark" summary={t("appearance.summary", { preset: presetLabel(chosen, tr) })} hint={t("appearance.hint")} anchor="looks">
            <s-stack direction="block" gap="base">
              <TiersPreviewStyles customCss={extras.customCss} />
              <div role="radiogroup" aria-label={t("appearance.choose")} style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 380px), 1fr))", gap: 12 }}>
                {APPEARANCE_PRESETS.map((p) => (
                  <LookCard
                    key={p}
                    preset={p}
                    active={chosen === p}
                    saved={p === preset}
                    onPick={setChosen}
                    preview={<TiersPreview set={sample} preset={p} tokens={tokens} product={product} bare withStyles={false} extras={extras} quantity={sample?.breaks[0]?.minQty ?? 3} />}
                  />
                ))}
              </div>
              <FieldMessage text={presetError ? t(presetError.key, presetError.params) : undefined} />
              {/* Only what the merchant should know (P2): the set is an example; the theme could not be read. */}
              {!sample || !tokens?.themeName ? (
                <div style={{ fontSize: 12, lineHeight: 1.4, color: WON_MUTED }}>
                  {sample ? null : `${t("tiers.preview.sample")} `}
                  {tokens?.themeName ? null : t("tiers.preview.noTheme")}
                </div>
              ) : null}
            </s-stack>
          </WonSection>

          <WonSection
            title={t("appearance.custom.title")}
            glyph="spark"
            pro
            locked={!pro}
            // Green only for what is stored AND still set; a look typed but not saved yet has no pill.
            on={!pro ? undefined : customSet ? (storedCustomSet ? true : undefined) : false}
            summary={t(customSet ? "appearance.custom.summary.on" : "appearance.custom.summary.off")}
            anchor="custom"
            collapsible
            defaultOpen={storedCustomSet || errors.some((e) => e.field.startsWith("look."))}
          >
            {pro ? (
              customFields
            ) : (
              <s-stack direction="block" gap="base">
                <ProSell benefit={t("appearance.custom.benefit")} />
                <ProFrame locked>{customFields}</ProFrame>
              </s-stack>
            )}
          </WonSection>

          <WonSection
            title={`${t("appearance.cards.title")} · ${t("appearance.beta")}`}
            glyph="tag"
            on={cardsOn ? (cardPrices ? true : undefined) : false}
            summary={t(cardsOn ? "appearance.cards.summary.on" : "appearance.cards.summary.off")}
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
              {texts.map((x) => {
                // A name the merchant understands ("Nadpis tabulky · česky"), never the extension's key; one field per language.
                const name = textLabel(x.key, x.defaults[locale] || x.defaults.en, tr);
                return (
                  <div key={x.key} data-won-text={x.key}>
                    <s-grid gridTemplateColumns="repeat(auto-fit, minmax(200px, 1fr))" gap="small-300" alignItems="start">
                      {langs.map((lang) => (
                        <s-text-field
                          key={lang}
                          name={textField(lang, x.key)}
                          label={`${name} · ${textLangLabel(lang, tr)}`}
                          value={x.values[lang]}
                          placeholder={x.defaults[lang]}
                          error={errorOf(textField(lang, x.key))}
                        />
                      ))}
                    </s-grid>
                    {/* A language the shop does not use keeps what is stored for it (a save never erases it). */}
                    {TEXT_LANGS.filter((lang) => !langs.includes(lang) && x.values[lang] !== "").map((lang) => (
                      <input key={lang} type="hidden" name={textField(lang, x.key)} value={x.values[lang]} />
                    ))}
                  </div>
                );
              })}
            </s-stack>
          </WonSection>
          <TiersBlockSection block={block} product={product} />
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
