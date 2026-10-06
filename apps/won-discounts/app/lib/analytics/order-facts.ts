// Analytics (MVP 7, contract M4, decision P2; spec §8): one `orders/create` payload → one fact about the order's
// discounts. Pure — the webhook route stores what this returns (OrderDiscountFact).
//
// What is read: the order's id and time, its SHOP-currency totals (`currency`, `subtotal_price`), its discount
// applications and what each took off the lines and the shipping (`discount_allocations`), the line quantities,
// the `_won_gift` line property and the variant ids (sale items). Nothing of the customer is read (PRIV-1).
//
// Which rule a discount belongs to (P2 — not verified live: orders wait for Shopify's approval): the checkout
// names a function discount by its candidate's message, which is
//   - a rule's name (describe.ts) → that rule; a code discount → the rule owning the code (normalizeCode);
//   - a quantity tier's text ("Od 3 ks −10 %", "From 3 items …", "Množstevní sleva od …") → "tiers";
//   - "Dárek zdarma" / "Free gift" → "gift";
//   - anything else (a renamed rule's old name, another app's or Shopify's own discount) → "other".
// A rule on shipping is `kind: "shipping"`. Parts are in the order of the first application of each key.

import { ruleCodes } from "@won/core/discounts/code-batch";
import { normalizeCode } from "@won/core/discounts/cart";
import type { ReadonlyDeep, WonDiscountsConfig } from "@won/core/discounts/config";
import { toMinorUnits } from "@won/core/discounts/money";
import { GIFT_LABEL } from "@won/core/discounts/plan-rewards";
import { TIER_LABEL } from "@won/core/discounts/plan-tiers";

export type OrderFactKind = "rule" | "tier" | "gift" | "shipping" | "other";

export interface OrderFactPart {
  /** A rule id, or "tiers" / "gift" / "other". */
  key: string;
  kind: OrderFactKind;
  amountMinor: number;
}

export interface OrderFact {
  /** The order's numeric id. */
  orderId: string;
  createdAt: Date;
  /** The shop currency of the amounts. */
  currency: string;
  /** After line discounts, before shipping and tax (Shopify's `subtotal_price`). */
  subtotalMinor: number;
  /** Everything the parts took off. */
  discountMinor: number;
  parts: OrderFactPart[];
  /** Gift items in the order (`_won_gift` lines). */
  gifts: number;
  /** Items of variants that were on sale (Výprodej) when the order came. */
  outletItems: number;
}

export interface OrderFactOptions {
  /** Numeric variant ids on sale right now. */
  outletVariantIds?: ReadonlySet<number>;
}

const GIFT_PROPERTY = "_won_gift";
const TIER_TEXT = new RegExp(`^(?:Od \\d+ ks |From \\d+ items? |${TIER_LABEL.cs} |${TIER_LABEL.en} )`);

const isRec = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

export function orderFactFromWebhook(payload: unknown, config: ReadonlyDeep<Pick<WonDiscountsConfig, "modules">>, opts: OrderFactOptions = {}): OrderFact | null {
  if (!isRec(payload)) return null;
  const id = payload.id;
  const currency = typeof payload.currency === "string" ? payload.currency.toUpperCase() : "";
  const created = typeof payload.created_at === "string" ? Date.parse(payload.created_at) : Number.NaN;
  if ((typeof id !== "number" && typeof id !== "string") || !/^[A-Z]{3}$/.test(currency) || Number.isNaN(created)) return null;
  const minor = (v: unknown) => (typeof v === "string" || typeof v === "number" ? (toMinorUnits(v, currency) ?? 0) : 0);

  const byName = new Map<string, { id: string; shipping: boolean }>();
  const byCode = new Map<string, { id: string; shipping: boolean }>();
  for (const rule of config.modules.codes.rules) {
    const entry = { id: rule.id, shipping: rule.target.kind === "shipping" };
    if (rule.name && !byName.has(rule.name)) byName.set(rule.name, entry);
    // Generated codes belong to their rule too (ruleCodes = hand-typed + generated).
    for (const code of rule.method === "code" ? ruleCodes(rule) : (rule.codes ?? [])) byCode.set(normalizeCode(code), entry);
  }
  const partOf = (application: unknown): Omit<OrderFactPart, "amountMinor"> => {
    const a = isRec(application) ? application : {};
    const title = typeof a.title === "string" ? a.title : "";
    const rule = (a.type === "discount_code" && typeof a.code === "string" ? byCode.get(normalizeCode(a.code)) : undefined) ?? byName.get(title);
    if (rule) return { key: rule.id, kind: rule.shipping ? "shipping" : "rule" };
    if (title === GIFT_LABEL.cs || title === GIFT_LABEL.en) return { key: "gift", kind: "gift" };
    if (TIER_TEXT.test(title)) return { key: "tiers", kind: "tier" };
    return { key: "other", kind: "other" };
  };

  const applications = list(payload.discount_applications).map(partOf);
  const parts: OrderFactPart[] = [];
  const add = (allocation: unknown) => {
    if (!isRec(allocation)) return;
    const part = typeof allocation.discount_application_index === "number" ? applications[allocation.discount_application_index] : undefined;
    const amountMinor = minor(allocation.amount);
    if (!part || amountMinor <= 0) return;
    const existing = parts.find((p) => p.key === part.key);
    if (existing) existing.amountMinor += amountMinor;
    else parts.push({ ...part, amountMinor });
  };

  let gifts = 0;
  let outletItems = 0;
  for (const line of list(payload.line_items)) {
    if (!isRec(line)) continue;
    const quantity = typeof line.quantity === "number" && Number.isFinite(line.quantity) && line.quantity > 0 ? Math.floor(line.quantity) : 0;
    if (list(line.properties).some((p) => isRec(p) && p.name === GIFT_PROPERTY)) gifts += quantity;
    if (typeof line.variant_id === "number" && opts.outletVariantIds?.has(line.variant_id)) outletItems += quantity;
    list(line.discount_allocations).forEach(add);
  }
  for (const line of list(payload.shipping_lines)) if (isRec(line)) list(line.discount_allocations).forEach(add);

  // The parts in the order their discount first appears among the applications.
  const order = new Map<string, number>();
  applications.forEach((a, i) => {
    if (!order.has(a.key)) order.set(a.key, i);
  });
  parts.sort((a, b) => (order.get(a.key) ?? 0) - (order.get(b.key) ?? 0));

  return {
    orderId: String(id),
    createdAt: new Date(created),
    currency,
    subtotalMinor: minor(payload.subtotal_price),
    discountMinor: parts.reduce((sum, p) => sum + p.amountMinor, 0),
    parts,
    gifts,
    outletItems,
  };
}
