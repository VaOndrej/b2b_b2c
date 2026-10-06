// "Vyzkoušet košík" form → the simulated cart the engine plans (SEC-1: one parser,
// run by the server action). Only ids, quantities, a known currency (optionally
// with one of its enabled Won markets: `CZK:cz`), the ticked discounts (`ruleId`,
// P6: what the app knows is picked, not typed), codes and a shop-local day are
// read; prices never come from the browser — the engine step reads them from
// Shopify for the chosen market and currency. `when=now` ignores the date and
// time fields (SEC-1: a field that does not apply is not read). The server
// turns each ticked discount into its first code (resolveRuleCodes) and feeds
// the same codes path the engine always had.

import { listBatchCodes, type CodeBatchView } from "@won/core/discounts/code-batch";

import { PRODUCT_GID, VARIANT_GID, splitCodes } from "./ids";
import { isCalendarDate, type FormDataLike } from "./rule-form";
import type { FieldError } from "./types";

export const TRY_CART_LIMITS = Object.freeze({ lines: 50, quantity: 999, codes: 10, codeLength: 255 });

/** The time choice: now, the campaign start the page was opened with, or a date and time of one's own. */
export const TRY_CART_WHEN = ["now", "campaign", "custom"] as const;
export type TryCartWhen = (typeof TRY_CART_WHEN)[number];

const RULE_ID = /^[A-Za-z0-9_-]{1,64}$/;

export interface TryCartInput {
  lines: { variantId: string; productId: string; quantity: number }[];
  currency: string;
  /** Enabled Won market handle the prices and the buyer country come from (null = the currency's default). */
  market: string | null;
  codes: string[];
  /** Ids of the code discounts the merchant ticked (the server resolves each to its first code). */
  ruleIds: string[];
  /** Shop-local day `YYYY-MM-DD` the schedules are evaluated on. */
  date: string;
  /** Shop-local time of day `HH:MM` (campaign windows, MVP 6); null = the time now. */
  time: string | null;
}

export function readTryCartForm(
  form: FormDataLike,
  ctx: { currencies: readonly string[]; today: string; markets?: readonly { handle: string; currency: string }[] },
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

  // "CZK" or "CZK:cz" (a currency and one of its enabled Won markets).
  const [rawCurrency, rawMarket] = str("currency").split(":", 2);
  const currency = (rawCurrency ?? "").trim().toUpperCase();
  const handle = rawMarket?.trim() || null;
  let market: string | null = null;
  if (!ctx.currencies.includes(currency)) errors.push({ field: "currency", key: "tryCart.error.currency" });
  else if (handle !== null) {
    if ((ctx.markets ?? []).some((m) => m.handle === handle && m.currency === currency)) market = handle;
    else errors.push({ field: "currency", key: "tryCart.error.currency" });
  }

  const codes = splitCodes(str("codes"))
    .filter((code) => code.length <= TRY_CART_LIMITS.codeLength)
    .slice(0, TRY_CART_LIMITS.codes);
  const ruleIds = [...new Set(all("ruleId").filter((id) => RULE_ID.test(id)))].slice(0, TRY_CART_LIMITS.codes);

  // "Teď": today and the time now, whatever the (hidden) date and time fields hold.
  const now = str("when") === "now";
  const rawDate = now ? "" : str("date");
  let date = ctx.today;
  if (rawDate !== "") {
    if (isCalendarDate(rawDate)) date = rawDate;
    else errors.push({ field: "date", key: "tryCart.error.date" });
  }

  const rawTime = now ? "" : str("time");
  let time: string | null = null;
  if (rawTime !== "") {
    if (/^([01]\d|2[0-3]):[0-5]\d$/.test(rawTime)) time = rawTime;
    else errors.push({ field: "time", key: "tryCart.error.time" });
  }

  return { input: { lines, currency, market, codes, ruleIds, date, time }, errors };
}

/**
 * The ticked discounts → the codes the engine is given: each existing code discount contributes its FIRST
 * code (any of its codes opens it); ids that are not a code discount of this shop are ignored. Codes typed
 * directly stay (an internal path: a code that is not in Won). Each code once, at most TRY_CART_LIMITS.codes.
 */
/** One code of a code rule, for trying it out: its first hand-typed code, else its first generated one. */
export function firstRuleCode(rule: { codes?: readonly string[]; codeBatches?: readonly CodeBatchView[] }): string | undefined {
  const typed = rule.codes?.[0]?.trim().toUpperCase();
  if (typed) return typed;
  for (const batch of rule.codeBatches ?? []) {
    const code = listBatchCodes(batch)[0];
    if (code) return code;
  }
  return undefined;
}

export function resolveRuleCodes(
  ruleIds: readonly string[],
  rules: readonly { id: string; method: string; codes?: readonly string[]; codeBatches?: readonly CodeBatchView[] }[],
  codes: readonly string[] = [],
): string[] {
  const out = [...codes];
  for (const id of ruleIds) {
    const rule = rules.find((r) => r.id === id);
    // A hand-typed code first; a rule with generated codes only is tried with one of those.
    const code = rule && rule.method === "code" ? firstRuleCode(rule) : undefined;
    if (code && !out.includes(code)) out.push(code);
  }
  return out.slice(0, TRY_CART_LIMITS.codes);
}
