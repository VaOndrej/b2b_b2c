// Výprodej (MVP 5, Pro; contract O10) — the form model shared by the screen and the server (SEC-1: the action
// parses exactly these fields). A new sale: one variant (Shopify's picker), the quota, a whole percent, an
// optional end date (shop-local), the price lists with a fixed price. The module settings: how the web shows a
// sale (4 levels) and what a return after the end does.

import { OUTLET_DISPLAY_MODES, REOPEN_ON_RETURN_MODES, type OutletDisplay, type ReopenOnReturnMode } from "@won/core/discounts/config";
import { toMinorUnits } from "@won/core/discounts/money";
import { outletPricesFor } from "@won/core/discounts/outlet";

import type { FormDataLike } from "./rule-form";

export const OUTLET_ACTION = "/app/outlet";
export const OUTLET_INTENT = { start: "start", end: "end", retry: "retry", reopen: "reopen", keep: "keep", settings: "settings" } as const;
export type OutletIntent = (typeof OUTLET_INTENT)[keyof typeof OUTLET_INTENT];

export const OUTLET_FIELD = {
  intent: "intent",
  run: "run",
  variant: "ol.variant",
  product: "ol.product",
  /** The picked variant's name and price as the picker gave them: only echoed back to a refused form, never read. */
  variantTitle: "ol.variantTitle",
  variantPrice: "ol.variantPrice",
  quota: "ol.quota",
  percent: "ol.percent",
  /** `YYYY-MM-DD` in the shop's time zone; the sale ends at the start of that day (00:00). Empty = no end. */
  endsOn: "ol.endsOn",
  /** Price list GIDs (one value per list). */
  priceList: "ol.priceList",
  display: "ol.display",
  reopen: "ol.reopen",
} as const;

/** The raw draft core validateOutletDraft checks (strings as typed; endsAt as an ISO instant or null). */
export function readOutletDraft(form: FormDataLike, toInstant: (day: string) => string | null): Record<string, unknown> {
  const text = (name: string) => String(form.get(name) ?? "").trim();
  const day = text(OUTLET_FIELD.endsOn);
  return {
    variantId: text(OUTLET_FIELD.variant),
    productId: text(OUTLET_FIELD.product),
    quota: text(OUTLET_FIELD.quota) === "" ? Number.NaN : Number(text(OUTLET_FIELD.quota)),
    percent: text(OUTLET_FIELD.percent) === "" ? Number.NaN : Number(text(OUTLET_FIELD.percent)),
    endsAt: day === "" ? null : (/^\d{4}-\d{2}-\d{2}$/.test(day) ? toInstant(day) : "invalid") ?? "invalid",
    priceListIds: form.getAll(OUTLET_FIELD.priceList).map(String),
  };
}

/** The module settings from the form; an unknown value keeps the stored one. */
export function readOutletSettings(form: FormDataLike, stored: { display: OutletDisplay; reopenOnReturnAfterEnd: ReopenOnReturnMode }) {
  const display = String(form.get(OUTLET_FIELD.display) ?? "");
  const reopen = String(form.get(OUTLET_FIELD.reopen) ?? "");
  return {
    display: (OUTLET_DISPLAY_MODES as readonly string[]).includes(display) ? (display as OutletDisplay) : stored.display,
    reopenOnReturnAfterEnd: (REOPEN_ON_RETURN_MODES as readonly string[]).includes(reopen) ? (reopen as ReopenOnReturnMode) : stored.reopenOnReturnAfterEnd,
  };
}

/** The new-sale fields a refused form gets back (B14). */
export const OUTLET_START_FIELDS = [
  OUTLET_FIELD.variant,
  OUTLET_FIELD.product,
  OUTLET_FIELD.variantTitle,
  OUTLET_FIELD.variantPrice,
  OUTLET_FIELD.quota,
  OUTLET_FIELD.percent,
  OUTLET_FIELD.endsOn,
  OUTLET_FIELD.priceList,
] as const;

/** The new sale as typed, for the live summary only (the server parses the form itself, SEC-1). */
export interface OutletLiveDraft {
  /** null = empty or not a whole number. */
  quota: number | null;
  percent: number | null;
  /** `YYYY-MM-DD` or "". */
  endsOn: string;
  priceListIds: string[];
}

export function readOutletLive(form: FormDataLike): OutletLiveDraft {
  const whole = (name: string) => {
    const text = String(form.get(name) ?? "").trim();
    return /^\d{1,7}$/.test(text) ? Number(text) : null;
  };
  const day = String(form.get(OUTLET_FIELD.endsOn) ?? "").trim();
  return {
    quota: whole(OUTLET_FIELD.quota),
    percent: whole(OUTLET_FIELD.percent),
    endsOn: /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : "",
    priceListIds: form.getAll(OUTLET_FIELD.priceList).map(String),
  };
}

/**
 * The picked variant's price before and during the sale (minor units), by the same core rule the start uses.
 * null = the picker gave no readable price, or this percent would not lower it.
 */
export function outletPreviewPrice(priceText: string | undefined, currency: string, percent: number | null, display: OutletDisplay): { before: number; after: number } | null {
  if (!priceText || !currency || percent === null) return null;
  const before = toMinorUnits(priceText, currency);
  if (before === null || before <= 0) return null;
  const sale = outletPricesFor({ price: before, compareAt: null }, percent, display);
  return sale ? { before, after: sale.price } : null;
}
