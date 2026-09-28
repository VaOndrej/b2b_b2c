// "Vyzkoušet košík" form → the simulated cart the engine plans (SEC-1: one parser,
// run by the server action). Only ids, quantities, a known currency, codes and a
// shop-local day are read; prices never come from the browser — the engine step
// reads them from Shopify for the chosen currency.

import { PRODUCT_GID, VARIANT_GID, splitCodes } from "./ids";
import { isCalendarDate, type FormDataLike } from "./rule-form";
import type { FieldError } from "./types";

export const TRY_CART_LIMITS = Object.freeze({ lines: 50, quantity: 999, codes: 10, codeLength: 255 });

export interface TryCartInput {
  lines: { variantId: string; productId: string; quantity: number }[];
  currency: string;
  codes: string[];
  /** Shop-local day `YYYY-MM-DD` the schedules are evaluated on. */
  date: string;
}

export function readTryCartForm(
  form: FormDataLike,
  ctx: { currencies: readonly string[]; today: string },
): { input: TryCartInput; errors: FieldError[] } {
  const errors: FieldError[] = [];
  const all = (name: string) => form.getAll(name).map((v) => (typeof v === "string" ? v : ""));
  const str = (name: string) => {
    const v = form.get(name);
    return typeof v === "string" ? v.trim() : "";
  };

  const variantIds = all("variantId");
  const productIds = all("productId");
  const quantities = all("quantity");
  const lines: TryCartInput["lines"] = [];
  for (let i = 0; i < variantIds.length && lines.length < TRY_CART_LIMITS.lines; i++) {
    const variantId = variantIds[i];
    const productId = productIds[i] ?? "";
    const quantity = /^\d{1,9}$/.test(quantities[i] ?? "") ? Number(quantities[i]) : 0;
    if (!VARIANT_GID.test(variantId) || !PRODUCT_GID.test(productId) || quantity < 1) continue;
    lines.push({ variantId, productId, quantity: Math.min(quantity, TRY_CART_LIMITS.quantity) });
  }
  if (lines.length === 0) errors.push({ field: "lines", key: "tryCart.error.lines" });

  const currency = str("currency").toUpperCase();
  if (!ctx.currencies.includes(currency)) errors.push({ field: "currency", key: "tryCart.error.currency" });

  const codes = splitCodes(str("codes"))
    .filter((code) => code.length <= TRY_CART_LIMITS.codeLength)
    .slice(0, TRY_CART_LIMITS.codes);

  const rawDate = str("date");
  let date = ctx.today;
  if (rawDate !== "") {
    if (isCalendarDate(rawDate)) date = rawDate;
    else errors.push({ field: "date", key: "tryCart.error.date" });
  }

  return { input: { lines, currency, codes, date }, errors };
}
