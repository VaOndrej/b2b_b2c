// The faithful preview of the quantity-tier block (MVP 3; doctrine §1, A1, A4;
// C5 fallback): the storefront's OWN markup (contract K8, mirrored from
// extensions/won-discounts-storefront/blocks/quantity_tiers.liquid), its OWN CSS
// (assets/won-discounts-tiers.css, imported as text — the same file the theme
// loads) confined to the preview container (scope-css.ts), its OWN texts (the
// extension's locales, cs or en by the admin language) and its arithmetic
// (model/tiers.ts previewTiers, a port of won-discounts-tiers-core.js `compute`
// pinned by a parity test), on the live theme's
// tokens (fonts, colors, the input radius the CSS reads, the block's accent —
// integration/themes.server.ts). Prices are written with the shop's money format
// like the storefront. On top of the ready-made look it renders what the stored
// config adds (`extras`): the Pro custom look exactly as the storefront gets it
// (core customLookCss, confined to the preview like the block's own CSS) and the
// storefront texts the merchant changed. What it cannot know is said under it
// (§12): the theme could not be read; margin protection may lower a tier; an
// example set / product is labelled "Ukázka".
//
// By design it renders the K8 markup WITHOUT the block's
// `<script type="application/json" data-won-discounts-tiers-data>` (the admin
// never runs the storefront script; the preview is computed here), and like the
// block it renders `data-state="empty"` + `hidden` when nothing is offered in
// the currency (MKT-1) — the note under it then says why.
//
// One component for every preview surface (A1): the Množstevní slevy screen,
// the four looks on Vzhled and the dev harness. The items-in-the-cart stepper is
// native buttons with no form name (never submitted). The look switcher is a
// native radio group: with `lookField` it is a field of the page's form — the
// pick is SAVED with the page (config.storefront.appearancePreset, the same
// field Vzhled writes) and its change event reaches the form (the save bar and
// the live draft see it); without `lookField` the radios have no name and
// nothing is submitted.

import { useId, useMemo, useState, type CSSProperties } from "react";

import csStorefront from "../../../extensions/won-discounts-storefront/locales/cs.json?raw";
import enStorefront from "../../../extensions/won-discounts-storefront/locales/en.default.json?raw";
import tiersCss from "../../../extensions/won-discounts-storefront/assets/won-discounts-tiers.css?raw";
import { APPEARANCE_PRESETS } from "@won/core/discounts/config";
import { ACCENT_PRESETS } from "@won/core/discounts/config";
import { ACCENT_COLORS } from "@won/core/discounts/custom-look";
import { currencyExponent } from "@won/core/discounts/money";

import { useT } from "../../i18n/context";
import type { Locale } from "../../i18n";
import { presetLabel } from "../model/appearance";
import { formatLiquidMoney, previewTiersLiquid, TIERS_SAMPLE_SET, TIER_MIN_QTY_MAX } from "../model/tiers";
import type { AppearancePresetView, PreviewLookView, PreviewProductView, ThemeTokensView, TierSetView } from "../model/types";
import { selectionRing, WON_AMBER_TEXT, WON_FAINT, WON_FONT, WON_INK, WON_LINE, WON_MUTED, WON_SURFACE } from "../shell/tokens";
import { scopeCss } from "./scope-css";

/** The texts the block uses (extension locales, `tiers.*`). */
export const STOREFRONT_TEXT_KEYS = ["heading", "row_qty", "save_pct", "save_off", "unit", "live", "next"] as const;
type TextKey = (typeof STOREFRONT_TEXT_KEYS)[number];

function parseTexts(raw: string): Partial<Record<TextKey, string>> {
  try {
    const tiers = (JSON.parse(raw) as { tiers?: Record<string, unknown> }).tiers ?? {};
    const out: Partial<Record<TextKey, string>> = {};
    for (const key of STOREFRONT_TEXT_KEYS) if (typeof tiers[key] === "string") out[key] = tiers[key] as string;
    return out;
  } catch {
    return {};
  }
}

const TEXTS: Readonly<Record<Locale, Partial<Record<TextKey, string>>>> = { cs: parseTexts(csStorefront), en: parseTexts(enStorefront) };

/**
 * The block's text in the admin language (the other language's text when one is missing — never a key).
 * `changed` = the texts the merchant changed for that language, by the extension's key (`tiers.heading`): a
 * non-empty one wins, like on the storefront.
 */
export function storefrontText(locale: Locale, key: TextKey, params: Record<string, string | number> = {}, changed?: Readonly<Record<string, string>>): string {
  const own = changed?.[`tiers.${key}`];
  const template = (typeof own === "string" && own.trim() !== "" ? own : undefined) ?? TEXTS[locale][key] ?? TEXTS[locale === "cs" ? "en" : "cs"][key] ?? "";
  return template.replace(/\{(\w+)\}/g, (whole, name: string) => (name in params ? String(params[name]) : whole));
}

/** The scope every rule of the storefront CSS is nested under in the admin. */
export const PREVIEW_SCOPE = "won-tiers-preview";

const SCOPED_CSS = scopeCss(tiersCss, `.${PREVIEW_SCOPE}`);

/** A percent as the block writes it: one decimal, whole numbers without; a decimal comma except in English. */
function percentText(pct: number, locale: Locale): string {
  const rounded = Math.round(pct * 10) / 10;
  const text = String(rounded);
  return locale === "en" ? text : text.replace(".", ",");
}

/** The sample product's price when the shop has no product to show: 200 in the currency's major unit. */
const SAMPLE_PRICE = 20000;

export interface TiersPreviewProps {
  /** The set to show; null = the labelled example (§15a). */
  set: TierSetView | null;
  /** The look the preview starts in (the saved one). */
  preset: AppearancePresetView;
  tokens: ThemeTokensView | null;
  product: PreviewProductView | null;
  /** The shop currency (the sample product's currency when there is no product). */
  currency?: string;
  /** Show the look switcher and the items-in-the-cart stepper. */
  controls?: boolean;
  /** Margin protection is on: say the preview does not apply it. */
  marginOn?: boolean;
  /** Items in the cart the preview starts with. */
  quantity?: number;
  /** No frame title / notes (the Vzhled cards). */
  bare?: boolean;
  /** Include the scoped storefront CSS (false when the page renders <TiersPreviewStyles /> once for several previews). */
  withStyles?: boolean;
  /** What the config adds on top of the look: the Pro custom look (CSS as the storefront gets it) and the merchant's texts. */
  extras?: PreviewLookView | null;
  /** With `controls`: the form field the picked look is submitted as (the page saves it). Absent = the switcher only changes the preview. */
  lookField?: string;
  /** With `controls`: the form field of the ready-made highlight colour (every plan). Absent = no colour picker. */
  accentField?: string;
}

/**
 * The storefront CSS confined to the preview scope, once for a page with several previews. `customCss` = the Pro
 * custom look as the storefront gets it (core customLookCss — never contains `<`), confined the same way, after
 * the block's own CSS (the order the storefront loads them in).
 */
export function TiersPreviewStyles({ customCss }: { customCss?: string | null }) {
  const custom = customCss ? scopeCss(customCss, `.${PREVIEW_SCOPE}`) : "";
  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: SCOPED_CSS }} />
      {custom ? <style data-won-custom-look="" dangerouslySetInnerHTML={{ __html: custom }} /> : null}
    </>
  );
}

function fontStack(family: string | null): string {
  const system = 'system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';
  return family ? `"${family}", ${system}` : system;
}

/** The theme page around the block: its font, colors, text size and the radius variables the block CSS reads. */
function pageStyle(tokens: ThemeTokensView | null): CSSProperties {
  const radius = tokens?.radius;
  return {
    fontFamily: fontStack(tokens?.fontBody ?? null),
    color: tokens?.colorText ?? "#121212",
    background: tokens?.colorBackground ?? "#ffffff",
    fontSize: tokens?.fontSize ? `${tokens.fontSize}px` : "16px",
    lineHeight: 1.5,
    padding: 16,
    borderRadius: 10,
    border: `1px solid ${WON_LINE}`,
    textAlign: "start",
    letterSpacing: "normal",
    ...(typeof radius === "number" ? { ["--style-border-radius-inputs" as string]: `${radius}px`, ["--inputs-radius" as string]: `${radius}px` } : {}),
  };
}

export function TiersPreview({
  set,
  preset,
  tokens,
  product,
  currency,
  controls = false,
  marginOn = false,
  quantity: initialQuantity,
  bare = false,
  withStyles = true,
  extras = null,
  lookField,
  accentField,
}: TiersPreviewProps) {
  const tr = useT();
  const { t, locale } = tr;
  const [look, setLook] = useState<AppearancePresetView>(preset);
  const [lookFocus, setLookFocus] = useState<AppearancePresetView | null>(null);
  const lookLabelId = useId();
  const accentLabelId = useId();
  const storedAccent = extras?.accent && extras.accent in ACCENT_COLORS ? extras.accent : "theme";
  const [accentPick, setAccentPick] = useState<string>(storedAccent);
  const changed = extras?.texts[locale];
  const text = (key: TextKey, params: Record<string, string | number> = {}) => storefrontText(locale, key, params, changed);
  const shown = set && set.breaks.length > 0 ? set : TIERS_SAMPLE_SET;
  const sample = shown === TIERS_SAMPLE_SET;
  const firstMin = shown.breaks[0]?.minQty ?? 1;
  const [quantity, setQuantity] = useState<number>(Math.max(1, initialQuantity ?? firstMin));
  const shopCurrency = product?.currency ?? (currency && /^[A-Z]{3}$/.test(currency) ? currency : "CZK");
  const unitPrice = product?.unitPrice ?? SAMPLE_PRICE;
  // The block computes and writes money in Liquid money units (major × 100) — so does the preview.
  const money = (cents: number) => formatLiquidMoney(cents, shopCurrency, product?.moneyFormat ?? null, locale);
  const model = useMemo(() => previewTiersLiquid(shown, { unitPrice, currency: shopCurrency, quantity }), [shown, unitPrice, shopCurrency, quantity]);
  const priceCents = Math.round(unitPrice * 10 ** (2 - currencyExponent(shopCurrency)));
  const activePreset = controls ? look : preset;
  // The ready-made colour goes over the theme's (as on the storefront); a Pro custom look that sets its own accent goes over both.
  const customAccent = /--won-tiers-accent\s*:/.test(extras?.customCss ?? "");
  const pickedColor = ACCENT_COLORS[controls && accentField ? accentPick : storedAccent];
  const accent = customAccent ? null : (pickedColor ?? tokens?.colorAccent ?? null);

  const block = (
    <div
      className={`won-tiers won-tiers--${activePreset}`}
      data-won-discounts-tiers=""
      data-state={model.empty ? "empty" : "ready"}
      data-set-id={shown.id}
      data-count-mode={shown.countAcross}
      data-preset={activePreset}
      style={accent ? ({ ["--won-tiers-accent" as string]: accent } as CSSProperties) : undefined}
      hidden={model.empty}
    >
      <p className="won-tiers__heading">{text("heading")}</p>
      {/* K8 markup, as the storefront renders it: `role="list"` keeps the list semantics Safari drops for a list without bullets. */}
      {/* eslint-disable-next-line jsx-a11y/no-redundant-roles */}
      <ol className="won-tiers__list" role="list">
        {model.rows.map((row) => (
          <li
            key={row.minQty}
            className="won-tiers__row"
            data-won-discounts-tier-row=""
            data-min={row.minQty}
            data-active={row.active ? "true" : "false"}
            // K8 (audit P3-7): the tier that applies is announced, not only shown in bold.
            aria-current={row.active ? "true" : undefined}
            hidden={row.hidden}
          >
            <span className="won-tiers__qty">{text("row_qty", { min: row.minQty })}</span>
            <span className="won-tiers__save">
              {row.save.kind === "percent"
                ? text("save_pct", { pct: percentText(row.save.percent, locale) })
                : text("save_off", { amount: money(row.save.amount) })}
            </span>
            <span className="won-tiers__unit">{text("unit", { price: money(row.unitPrice) })}</span>
          </li>
        ))}
      </ol>
      <p className="won-tiers__live" data-won-discounts-live-price="" data-unit-cents={model.unitPrice} aria-live="polite">
        {text("live", { qty: quantity, total: money(model.total), price: money(model.unitPrice) })}
      </p>
      {model.next ? (
        <p className="won-tiers__next" data-won-discounts-tier-next="">
          {text("next", { count: model.next.add, price: money(model.next.unitPrice) })}
        </p>
      ) : (
        <p className="won-tiers__next" data-won-discounts-tier-next="" hidden />
      )}
    </div>
  );

  const notes: string[] = [];
  if (!bare) {
    if (sample) notes.push(t("tiers.preview.sample"));
    // Only the failure is said (P2): a theme that was read needs no sentence.
    if (!tokens?.themeName) notes.push(t("tiers.preview.noTheme"));
    if (marginOn) notes.push(t("tiers.preview.marginNote"));
  }

  return (
    <div style={{ fontFamily: WON_FONT, display: "grid", gap: 10, minWidth: 0 }}>
      {bare ? null : (
        <div id={controls ? lookLabelId : undefined} style={{ fontSize: 13, fontWeight: 700, color: WON_INK }}>
          {/* With the look picker the block IS "Vzhled na webu": one heading, not "Náhled" over "Vzhled". */}
          {t(controls ? "tiers.preview.look" : "tiers.preview.title")}
          {sample ? <span style={{ marginLeft: 8, fontSize: 12, fontWeight: 700, color: WON_AMBER_TEXT }}>{t("tiers.sample")}</span> : null}
        </div>
      )}
      {controls ? (
        <div style={{ display: "grid", gap: 8 }}>
          <div style={{ display: "grid", gap: 5 }}>
            {bare ? (
              <div id={lookLabelId} style={{ fontSize: 13, fontWeight: 500, color: WON_INK }}>
                {t("tiers.preview.look")}
              </div>
            ) : null}
            <div role="radiogroup" aria-labelledby={lookLabelId} style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {APPEARANCE_PRESETS.map((p) => (
                <label
                  key={p}
                  style={{
                    ...selectionRing(look === p),
                    position: "relative",
                    borderRadius: 999,
                    padding: "4px 10px",
                    fontSize: 12.5,
                    fontWeight: look === p ? 700 : 500,
                    color: WON_INK,
                    cursor: "pointer",
                    fontFamily: WON_FONT,
                    ...(lookFocus === p ? { outline: `3px solid ${WON_INK}`, outlineOffset: 2 } : {}),
                  }}
                >
                  <input
                    type="radio"
                    name={lookField}
                    value={p}
                    checked={look === p}
                    onChange={() => setLook(p)}
                    onFocus={(e) => setLookFocus(e.currentTarget.matches(":focus-visible") ? p : null)}
                    onBlur={() => setLookFocus(null)}
                    style={{ position: "absolute", opacity: 0, width: 1, height: 1, margin: 0, pointerEvents: "none" }}
                  />
                  {presetLabel(p, tr)}
                </label>
              ))}
            </div>
            {accentField ? (
              <div style={{ display: "grid", gap: 5, marginTop: 4 }}>
                <div id={accentLabelId} style={{ fontSize: 13, fontWeight: 500, color: WON_INK }}>
                  {t("tiers.preview.accent")}
                </div>
                <div role="radiogroup" aria-labelledby={accentLabelId} data-won-accent-picker style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {ACCENT_PRESETS.map((a) => (
                    <label
                      key={a}
                      style={{
                        ...selectionRing(accentPick === a),
                        position: "relative",
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 6,
                        borderRadius: 999,
                        padding: "4px 10px 4px 6px",
                        fontSize: 12.5,
                        fontWeight: accentPick === a ? 700 : 500,
                        color: WON_INK,
                        cursor: "pointer",
                        fontFamily: WON_FONT,
                      }}
                    >
                      <input
                        type="radio"
                        name={accentField}
                        value={a}
                        checked={accentPick === a}
                        onChange={() => setAccentPick(a)}
                        style={{ position: "absolute", opacity: 0, width: 1, height: 1, margin: 0, pointerEvents: "none" }}
                      />
                      <span
                        aria-hidden="true"
                        style={{ width: 14, height: 14, borderRadius: 999, flex: "0 0 auto", background: ACCENT_COLORS[a] ?? "conic-gradient(#111418 0 50%, #c9d0d8 0 100%)", border: "1px solid rgba(17,20,24,.18)" }}
                      />
                      {t(`tiers.preview.accent.${a}` as "tiers.preview.accent.theme")}
                    </label>
                  ))}
                </div>
                {accentPick !== storedAccent ? <div style={{ fontSize: 12, color: WON_MUTED }}>{t("tiers.preview.accentNote")}</div> : null}
              </div>
            ) : null}
            {look !== preset ? (
              <div style={{ fontSize: 12, color: WON_MUTED }}>{t(lookField ? "tiers.preview.lookUnsaved" : "tiers.preview.lookSaved", { preset: presetLabel(preset, tr) })}</div>
            ) : null}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, color: WON_MUTED }}>
            <span>{t("tiers.preview.quantity")}</span>
            <button type="button" aria-label={t("tiers.preview.less")} onClick={() => setQuantity((q) => Math.max(1, q - 1))} style={stepper}>
              −
            </button>
            <span style={{ minWidth: 20, textAlign: "center", fontWeight: 700, color: WON_INK }} aria-live="polite">
              {quantity}
            </span>
            <button type="button" aria-label={t("tiers.preview.more")} onClick={() => setQuantity((q) => Math.min(TIER_MIN_QTY_MAX, q + 1))} style={stepper}>
              +
            </button>
          </div>
        </div>
      ) : null}
      <div className={PREVIEW_SCOPE}>
        {/* The storefront's own CSS, nested under the preview scope (never styles the admin). */}
        {withStyles ? <TiersPreviewStyles customCss={extras?.customCss} /> : null}
        <div style={pageStyle(tokens)}>
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontFamily: fontStack(tokens?.fontHeading ?? tokens?.fontBody ?? null), fontWeight: 600, fontSize: "1.15em" }}>
              {product?.title?.trim() || (product ? t("common.untitledProduct") : t("tiers.preview.sampleProduct"))}
            </div>
            <div style={{ opacity: 0.85 }}>{money(priceCents)}</div>
          </div>
          {block}
          {model.empty ? <div style={{ fontSize: 13, opacity: 0.8 }}>{t("tiers.preview.notOffered", { currency: shopCurrency })}</div> : null}
        </div>
      </div>
      {notes.length > 0 ? (
        <div style={{ display: "grid", gap: 2 }}>
          {notes.map((note) => (
            <div key={note} style={{ fontSize: 12, lineHeight: 1.4, color: WON_FAINT }}>
              {note}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

const stepper: CSSProperties = {
  width: 28,
  height: 28,
  borderRadius: 8,
  border: `1px solid #c9d0d8`,
  background: WON_SURFACE,
  color: WON_INK,
  fontSize: 15,
  lineHeight: 1,
  cursor: "pointer",
};
