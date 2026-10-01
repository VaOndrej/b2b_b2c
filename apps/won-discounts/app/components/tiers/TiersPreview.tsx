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
// like the storefront. What it cannot know is said under it (§12): the font
// shows only if the device has it; margin protection may lower a tier; an
// example set / product is labelled "Ukázka".
//
// By design it renders the K8 markup WITHOUT the block's
// `<script type="application/json" data-won-discounts-tiers-data>` (the admin
// never runs the storefront script; the preview is computed here), and like the
// block it renders `data-state="empty"` + `hidden` when nothing is offered in
// the currency (MKT-1) — the note under it then says why.
//
// One component for every preview surface (A1): the Množstevní slevy screen,
// the four looks on Vzhled and the dev harness. The admin controls around it
// (look switcher, items in the cart) are native buttons with no form name —
// they never submit with the page's form.

import { useMemo, useState, type CSSProperties } from "react";

import csStorefront from "../../../extensions/won-discounts-storefront/locales/cs.json?raw";
import enStorefront from "../../../extensions/won-discounts-storefront/locales/en.default.json?raw";
import tiersCss from "../../../extensions/won-discounts-storefront/assets/won-discounts-tiers.css?raw";
import { APPEARANCE_PRESETS } from "@won/core/discounts/config";
import { currencyExponent } from "@won/core/discounts/money";

import { useT } from "../../i18n/context";
import type { Locale } from "../../i18n";
import { presetLabel } from "../model/appearance";
import { formatLiquidMoney, previewTiersLiquid, TIERS_SAMPLE_SET, TIER_MIN_QTY_MAX } from "../model/tiers";
import type { AppearancePresetView, PreviewProductView, ThemeTokensView, TierSetView } from "../model/types";
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

/** The block's text in the admin language (the other language's text when one is missing — never a key). */
export function storefrontText(locale: Locale, key: TextKey, params: Record<string, string | number> = {}): string {
  const template = TEXTS[locale][key] ?? TEXTS[locale === "cs" ? "en" : "cs"][key] ?? "";
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
}

/** The storefront CSS confined to the preview scope, once for a page with several previews. */
export function TiersPreviewStyles() {
  return <style dangerouslySetInnerHTML={{ __html: SCOPED_CSS }} />;
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
}: TiersPreviewProps) {
  const tr = useT();
  const { t, locale } = tr;
  const [look, setLook] = useState<AppearancePresetView>(preset);
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
  const accent = tokens?.colorAccent ?? null;

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
      <p className="won-tiers__heading">{storefrontText(locale, "heading")}</p>
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
            <span className="won-tiers__qty">{storefrontText(locale, "row_qty", { min: row.minQty })}</span>
            <span className="won-tiers__save">
              {row.save.kind === "percent"
                ? storefrontText(locale, "save_pct", { pct: percentText(row.save.percent, locale) })
                : storefrontText(locale, "save_off", { amount: money(row.save.amount) })}
            </span>
            <span className="won-tiers__unit">{storefrontText(locale, "unit", { price: money(row.unitPrice) })}</span>
          </li>
        ))}
      </ol>
      <p className="won-tiers__live" data-won-discounts-live-price="" data-unit-cents={model.unitPrice} aria-live="polite">
        {storefrontText(locale, "live", { qty: quantity, total: money(model.total), price: money(model.unitPrice) })}
      </p>
      {model.next ? (
        <p className="won-tiers__next" data-won-discounts-tier-next="">
          {storefrontText(locale, "next", { count: model.next.add, price: money(model.next.unitPrice) })}
        </p>
      ) : (
        <p className="won-tiers__next" data-won-discounts-tier-next="" hidden />
      )}
    </div>
  );

  const notes: string[] = [];
  if (!bare) {
    if (sample) notes.push(t("tiers.preview.sample"));
    notes.push(tokens?.themeName ? t("tiers.preview.theme", { theme: tokens.themeName }) : t("tiers.preview.noTheme"));
    if (tokens?.fontBody) notes.push(t("tiers.preview.font", { font: tokens.fontBody }));
    if (marginOn) notes.push(t("tiers.preview.marginNote"));
  }

  return (
    <div style={{ fontFamily: WON_FONT, display: "grid", gap: 10, minWidth: 0 }}>
      {bare ? null : (
        <div style={{ fontSize: 13, fontWeight: 700, color: WON_INK }}>
          {t("tiers.preview.title")}
          {sample ? <span style={{ marginLeft: 8, fontSize: 12, fontWeight: 700, color: WON_AMBER_TEXT }}>{t("tiers.sample")}</span> : null}
        </div>
      )}
      {controls ? (
        <div style={{ display: "grid", gap: 8 }}>
          <div role="group" aria-label={t("tiers.preview.look")} style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {APPEARANCE_PRESETS.map((p) => (
              <button
                key={p}
                type="button"
                aria-pressed={look === p}
                onClick={() => setLook(p)}
                style={{ ...selectionRing(look === p), borderRadius: 999, padding: "4px 10px", fontSize: 12.5, fontWeight: look === p ? 700 : 500, color: WON_INK, cursor: "pointer", fontFamily: WON_FONT }}
              >
                {presetLabel(p, tr)}
              </button>
            ))}
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
        {withStyles ? <TiersPreviewStyles /> : null}
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
      {controls && look !== preset ? <div style={{ fontSize: 12, color: WON_MUTED }}>{t("tiers.preview.lookSaved", { preset: presetLabel(preset, tr) })}</div> : null}
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
