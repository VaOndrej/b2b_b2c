// Výprodej (MVP 5, Pro; contract O10) — the form model shared by the screen and the server (SEC-1: the action
// parses exactly these fields). A new sale: one variant (Shopify's picker), the quota, a whole percent, an
// optional end date (shop-local), the price lists with a fixed price. The module settings: how the web shows a
// sale (4 levels) and what a return after the end does.

import { OUTLET_DISPLAY_MODES, REOPEN_ON_RETURN_MODES, type OutletDisplay, type ReopenOnReturnMode } from "@won/core/discounts/config";

import type { FormDataLike } from "./rule-form";

export const OUTLET_ACTION = "/app/outlet";
export const OUTLET_INTENT = { start: "start", end: "end", reopen: "reopen", keep: "keep", settings: "settings" } as const;
export type OutletIntent = (typeof OUTLET_INTENT)[keyof typeof OUTLET_INTENT];

export const OUTLET_FIELD = {
  intent: "intent",
  run: "run",
  variant: "ol.variant",
  product: "ol.product",
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
