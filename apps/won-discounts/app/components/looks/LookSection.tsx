// One storefront element's look, on the page of the module it belongs to (feedback 2026-10-06, bod 13; looks are
// not shared between modules): the ready-made looks as native radios, each previewed live (§1: the extension's
// markup and CSS), the highlight colour on every plan, and on Pro own colours and CSS confined to the element —
// with a brief to hand to an AI. On Free the Pro part is amber and locked with what Pro gives (§16).
// The section is its own form: it posts to /app/looks (looks.server.ts looksAction) and says how the save went.
// The table's ready-made look and colour are picked in its preview (the page's form); here it has its Pro part.

import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { useFetcher } from "react-router";

import { accentCss, LOOK_ROOT } from "@won/core/discounts/custom-look";
import { LOOK_PRESET_CSS, MILESTONE_BLINK_CSS, type LooksElement } from "@won/core/discounts/looks";

import { useT } from "../../i18n/context";
import { customLookSet, liveCustomLookCss, LOOK_FIELD, LOOK_INTENT, LOOKS_ACTION, presetDetails, presetLabel } from "../model/looks";
import type { EmbedView, LookView, UiResult } from "../model/types";
import { FieldMessage } from "../rule-editor/parts";
import { boolAttr } from "../shell/attrs";
import { snapshotOf } from "../shell/form-snapshot";
import { Notice } from "../shell/Notice";
import { ProFrame } from "../shell/ProFrame";
import { ProSell } from "../shell/ProSell";
import { RowNote, WonSection } from "../shell/WonSection";
import { selectionRing, WON_FONT, WON_INK, WON_MUTED } from "../shell/tokens";
import { AccentPicker } from "./AccentPicker";
import { LookPreview, LookPreviewStyles } from "./LookPreview";

export interface LookSectionProps {
  look: LookView;
  plan: "free" | "pro";
  configVersion: string | null;
  /** Won on the storefront: every look reaches it through it. */
  embed?: EmbedView | null;
  /** The table: its preview with the custom look as typed (the other elements preview themselves). */
  preview?: (customCss: string) => ReactNode;
  /** The dev harness: the outcome of a save, as the action would answer. */
  result?: UiResult | null;
}

export function LookSection({ look, plan, configVersion, embed, preview, result: given = null }: LookSectionProps) {
  const pro = plan === "pro";
  const tr = useT();
  const { t } = tr;
  const { element } = look;
  const fetcher = useFetcher<UiResult>();
  const result = fetcher.data ?? given;
  const formRef = useRef<HTMLFormElement>(null);
  const [preset, setPreset] = useState(look.preset);
  const [accent, setAccent] = useState(look.accent);
  const groupId = useId();

  // P5: the previews follow the form — re-read on every native input / change (never React's onChange on an `s-*` field).
  const [snapshot, setSnapshot] = useState<Map<string, string> | null>(null);
  const recompute = useCallback(() => {
    if (formRef.current) setSnapshot(snapshotOf(formRef.current));
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

  const errors = result && !result.ok && result.reason === "invalid" ? (result.errors ?? []) : [];
  const errorOf = (field: string) => {
    const e = errors.find((x) => x.field === field);
    return e ? t(e.key, e.params) : undefined;
  };
  const stored = useMemo(
    () =>
      new Map<string, string>([
        [LOOK_FIELD.accent, look.custom.accent],
        [LOOK_FIELD.line, look.custom.line],
        [LOOK_FIELD.tint, look.custom.tint],
        [LOOK_FIELD.radius, look.custom.radius],
        [LOOK_FIELD.css, look.custom.css],
      ]),
    [look.custom],
  );
  // On Free the custom-look fields are locked (disabled fields are not in the form): nothing of it is shown, as on the storefront.
  const typed = (field: string) => (snapshot ? (snapshot.get(field) ?? "") : (stored.get(field) ?? ""));
  const storedSet = customLookSet((field) => stored.get(field) ?? "");
  const customSet = pro ? customLookSet(typed) : storedSet;
  const customCss = pro ? liveCustomLookCss(element, typed) : "";
  const blink = snapshot ? snapshot.has(LOOK_FIELD.blink) : look.blink;
  /** A ready-made look as the storefront would get it with what is picked and typed now. */
  const cssOf = (el: LooksElement, p: string) => (LOOK_PRESET_CSS[el][p] ?? "") + (el === "milestones" && blink ? MILESTONE_BLINK_CSS : "") + accentCss(accent, LOOK_ROOT[el]) + customCss;

  // "Zkopírovat zadání pro AI": says when it worked — and when it did not (no clipboard in this browser / frame).
  const [copied, setCopied] = useState<"done" | "failed" | null>(null);
  const copyPrompt = () => {
    if (typeof navigator === "undefined" || !navigator.clipboard?.writeText) {
      setCopied("failed");
      return;
    }
    navigator.clipboard.writeText(look.aiPrompt).then(
      () => setCopied("done"),
      () => setCopied("failed"),
    );
  };

  const customFields = (
    <s-stack direction="block" gap="base">
      {look.customIssue ? <s-banner tone="warning" heading={t("appearance.custom.issue")} /> : null}
      <s-grid gridTemplateColumns="repeat(auto-fit, minmax(160px, 1fr))" gap="base" alignItems="start">
        {(["accent", "line", "tint"] as const).map((key) => (
          // P6: a colour is picked, not typed — the field submits a hex the server takes (#rrggbb); empty = the theme's.
          <s-color-field key={key} name={LOOK_FIELD[key]} label={t(`appearance.custom.${key}` as "appearance.custom.accent")} value={look.custom[key]} placeholder="#0a7d4f" error={errorOf(LOOK_FIELD[key])} disabled={boolAttr(!pro)} />
        ))}
        <s-number-field name={LOOK_FIELD.radius} label={t("appearance.custom.radius")} value={look.custom.radius} min={0} max={32} step={1} inputMode="numeric" error={errorOf(LOOK_FIELD.radius)} disabled={boolAttr(!pro)} />
      </s-grid>
      <RowNote>{t("appearance.custom.colorHint")}</RowNote>
      <s-text-area name={LOOK_FIELD.css} label={t("appearance.custom.css")} value={look.custom.css} rows={6} error={errorOf(LOOK_FIELD.css)} disabled={boolAttr(!pro)} />
      <RowNote>{t(`looks.cssHint.${element}`)}</RowNote>
      <s-stack direction="block" gap="small-300">
        <s-text>{t("appearance.ai.title")}</s-text>
        <RowNote>{t("appearance.ai.hint")}</RowNote>
        <pre data-won-ai-prompt={element} style={{ margin: 0, padding: 10, border: "1px solid #e3e3e3", borderRadius: 8, fontSize: 12, lineHeight: 1.45, whiteSpace: "pre-wrap", overflowWrap: "anywhere", maxHeight: 180, overflow: "auto" }}>
          {look.aiPrompt}
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

  return (
    <WonSection
      title={t(`looks.title.${element}`)}
      glyph="spark"
      summary={element === "tiers" ? t(customSet ? "appearance.custom.summary.on" : "appearance.custom.summary.off") : t("looks.summary", { preset: presetLabel(element, preset, tr) })}
      // The table's section is its Pro part alone; the others hold the looks of every plan with a Pro part inside.
      pro={element === "tiers" ? true : undefined}
      locked={element === "tiers" ? !pro : undefined}
      on={element !== "tiers" || !pro ? undefined : customSet ? (storedSet ? true : undefined) : false}
      anchor={`look-${element}`}
      collapsible
      defaultOpen={element !== "tiers" || storedSet || errors.length > 0}
    >
      <fetcher.Form method="post" action={LOOKS_ACTION} ref={formRef} data-won-look-form={element}>
        <input type="hidden" name={LOOK_FIELD.intent} value={LOOK_INTENT.save} />
        <input type="hidden" name={LOOK_FIELD.element} value={element} />
        {configVersion ? <input type="hidden" name={LOOK_FIELD.configVersion} value={configVersion} /> : null}
        <s-stack direction="block" gap="base">
          {fetcher.data || given ? <Notice result={result} /> : null}
          {element !== "tiers" ? (
            <>
              <LookPreviewStyles />
              <div role="radiogroup" aria-label={t("appearance.choose")} style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 260px), 1fr))", gap: 12 }}>
                {look.presets.map((p) => (
                  <label key={p} style={{ ...selectionRing(preset === p), position: "relative", display: "grid", alignContent: "start", gap: 8, padding: 12, borderRadius: 12, cursor: "pointer", fontFamily: WON_FONT, minWidth: 0 }}>
                    <input
                      type="radio"
                      name={LOOK_FIELD.preset}
                      value={p}
                      checked={preset === p}
                      aria-labelledby={`${groupId}-${p}`}
                      aria-describedby={`${groupId}-${p}-details`}
                      onChange={() => setPreset(p)}
                      style={{ position: "absolute", opacity: 0, width: 1, height: 1, margin: 0, pointerEvents: "none" }}
                    />
                    <span style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                      <span id={`${groupId}-${p}`} style={{ fontSize: 14, fontWeight: 700, color: WON_INK }}>
                        {presetLabel(element, p, tr)}
                      </span>
                      {p === look.preset ? <span style={{ fontSize: 11, fontWeight: 700, color: WON_MUTED }}>{t("appearance.current")}</span> : null}
                    </span>
                    <span id={`${groupId}-${p}-details`} style={{ fontSize: 12.5, lineHeight: 1.4, color: WON_MUTED }}>
                      {presetDetails(element, p, tr)}
                    </span>
                    <span aria-hidden="true" style={{ display: "block", minWidth: 0 }}>
                      <LookPreview element={element} css={cssOf(element, p)} />
                    </span>
                  </label>
                ))}
              </div>
              <FieldMessage text={errorOf(LOOK_FIELD.preset)} />
              <AccentPicker name={LOOK_FIELD.accentPreset} value={accent} stored={look.accent} onPick={setAccent} embed={embed} />
              {element === "milestones" ? (
                <div>
                  <s-checkbox name={LOOK_FIELD.blink} value="on" label={t("looks.blink")} checked={boolAttr(look.blink)} />
                  <RowNote>{t("looks.blinkHint")}</RowNote>
                </div>
              ) : null}
            </>
          ) : preview ? (
            preview(customCss)
          ) : null}

          {element === "tiers" ? (
            pro ? (
              customFields
            ) : (
              <s-stack direction="block" gap="base">
                <ProSell benefit={t("appearance.custom.benefit")} />
                <ProFrame locked>{customFields}</ProFrame>
              </s-stack>
            )
          ) : (
            <div data-won-look-custom={element}>
              <div style={{ fontSize: 13, fontWeight: 700, color: WON_INK, marginBottom: 8 }}>{t("appearance.custom.title")}</div>
              {pro ? (
                customFields
              ) : (
                <s-stack direction="block" gap="base">
                  <ProSell benefit={t(`looks.benefit.${element}`)} />
                  <ProFrame locked>{customFields}</ProFrame>
                </s-stack>
              )}
            </div>
          )}
          {element === "tiers" && !pro ? null : (
            <div>
              <s-button type="submit" variant="primary" disabled={boolAttr(fetcher.state !== "idle")}>
                {t("looks.save")}
              </s-button>
            </div>
          )}
        </s-stack>
      </fetcher.Form>
    </WonSection>
  );
}
