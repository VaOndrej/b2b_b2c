// The storefront's live cart plan (MVP 4, contract R9): the cart embed posts
// the cart as /cart.js has it to the app proxy (POST /apps/won-discounts/cart-plan)
// and gets back what only the engine knows — the quantity tier hint ("přidej
// 1 ks → nižší cena", R4: checked by re-planning) and the plan's view of the
// rewards. One brain (DATA-4): the SAME planCart on the SAME inputs the
// discount function reads at checkout —
//   shared config  the LIVE shop metafield `$app:won_discounts/function_config`
//                  (what the sync wrote, gated for the plan: BILL-1);
//   line refs      each product's `$app:won_discounts/product` metafield (rule
//                  refs, outlet, margin refs, tierRef) and each variant's cost
//                  metafield, mapped exactly like the function's input adapter
//                  (extensions/won-discounts-engine/tests/reference-adapter.js);
//   rate           Shopify.currency.rate from the page (shop → cart), the rate
//                  K4 v2 already relies on (= presentmentCurrencyRate, verified
//                  live in MVP 3);
//   day            the shop-local date now (schedules, day granularity);
//   campaigns      not applied yet (MVP 6 adds them): the plan is the one
//                  without a campaign.
// The answer carries no purchase cost, margin or rule internals: only the hint
// and what the shopper may see. Every Shopify read is cached for CACHE_MS per
// shop (and per variant), with an injectable clock for tests.

import type { CartLineInput, CartPlanInput } from "@won/core/discounts/cart";
import { shopLocalDates } from "@won/core/discounts/function-payload";
import { isFunctionConfigPayload, planCart, type CartPlan, type PlanConfig } from "@won/core/discounts/plan";

import type { AdminClient } from "../admin-client.server";
import { parseProductRefs } from "./try-cart-plan";

export const CART_PLAN_MAX_LINES = 100;
export const CART_PLAN_CACHE_MS = 60_000;

export interface CartPlanRequestLine {
  /** The /cart.js line key: echoed back so the embed can find the line. */
  key: string;
  variantId: number;
  productId: number;
  quantity: number;
  /** Minor units of the cart currency, before discounts (/cart.js `original_price`, converted). */
  unitPrice: number;
  /** The `_won_gift` line property. */
  gift?: string;
}

export interface CartPlanRequest {
  currency: string;
  country?: string;
  /** Shopify.currency.rate (shop → cart); absent in the shop currency. */
  rate?: number;
  locale: "cs" | "en";
  codes: string[];
  lines: CartPlanRequestLine[];
}

export interface CartPlanAnswer {
  ok: true;
  currency: string;
  /** R4: add `missing` items of the line `key` for the next tier (`percent` or `amount` minor units per item); `capped` = margin lowers it (promise no value). */
  hint?: { key: string; missing: number; minQty: number; percent?: number; amount?: number; capped?: true };
  /** What the plan takes off the lines and the order, minor units (shipping not included: its cost is unknown). */
  saved: number;
  gifts: { tierId: string; key?: string; state: string }[];
  freeShipping?: { threshold: number; remaining: number; reached: boolean };
  giftProgress?: { tierId: string; threshold: number; remaining: number; reached: boolean; afterDiscounts?: { remaining: number; reached: boolean } }[];
  warnings: string[];
}

type Rec = Record<string, unknown>;
const isRecord = (v: unknown): v is Rec => typeof v === "object" && v !== null && !Array.isArray(v);
const positiveInt = (v: unknown, max = Number.MAX_SAFE_INTEGER): number | null =>
  typeof v === "number" && Number.isSafeInteger(v) && v >= 0 && v <= max ? v : null;

/** The request body, validated; null = refuse it (400). Never trusts the browser beyond shape and bounds. */
export function parseCartPlanRequest(body: unknown): CartPlanRequest | null {
  if (!isRecord(body) || typeof body.currency !== "string" || !/^[A-Z]{3}$/.test(body.currency) || !Array.isArray(body.lines)) return null;
  if (body.lines.length > CART_PLAN_MAX_LINES) return null;
  const lines: CartPlanRequestLine[] = [];
  for (const raw of body.lines) {
    if (!isRecord(raw) || typeof raw.key !== "string" || raw.key.length === 0 || raw.key.length > 200) return null;
    const variantId = positiveInt(raw.variantId);
    const productId = positiveInt(raw.productId);
    const quantity = positiveInt(raw.quantity, 1_000_000);
    const unitPrice = positiveInt(raw.unitPrice, 1e12);
    if (variantId === null || productId === null || quantity === null || unitPrice === null) return null;
    const line: CartPlanRequestLine = { key: raw.key, variantId, productId, quantity, unitPrice };
    if (typeof raw.gift === "string" && raw.gift !== "" && raw.gift.length <= 64) line.gift = raw.gift;
    lines.push(line);
  }
  const codes = Array.isArray(body.codes) ? body.codes.filter((c): c is string => typeof c === "string" && c.length > 0 && c.length <= 255).slice(0, 25) : [];
  const out: CartPlanRequest = { currency: body.currency, locale: body.locale === "en" ? "en" : "cs", codes, lines };
  if (typeof body.country === "string" && /^[A-Z]{2}$/.test(body.country)) out.country = body.country;
  if (typeof body.rate === "number" && Number.isFinite(body.rate) && body.rate > 0) out.rate = body.rate;
  return out;
}

/** What Shopify holds for a variant: its product's Won metafield and its own cost metafield (raw JSON text). */
export interface VariantFacts {
  product: string | null;
  cost: string | null;
}

const parseJson = (text: string | null): unknown => {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};

/** The engine's cart, mapped like the function's input adapter (reference-adapter.js `adaptLine`). */
export function cartPlanInput(request: CartPlanRequest, facts: ReadonlyMap<number, VariantFacts>, today?: string): CartPlanInput {
  const lines: CartLineInput[] = request.lines.map((l) => {
    const variantGid = `gid://shopify/ProductVariant/${l.variantId}`;
    const line: CartLineInput = {
      id: l.key,
      variantId: variantGid,
      productId: `gid://shopify/Product/${l.productId}`,
      quantity: l.quantity,
      unitPrice: l.unitPrice,
      ruleIds: [],
    };
    const fact = facts.get(l.variantId);
    const won = parseJson(fact?.product ?? null);
    if (isRecord(won)) {
      const refs = parseProductRefs(fact!.product);
      line.ruleIds = refs.ruleIds;
      line.variantRuleIds = refs.variantRuleIds;
      if (won.outlet === true || (Array.isArray(won.outlet) && won.outlet.includes(variantGid))) line.outlet = true;
      if (Array.isArray(won.marginRefs)) line.marginRefs = won.marginRefs.filter((r): r is string => typeof r === "string");
      if (Object.prototype.hasOwnProperty.call(won, "tierRef")) line.tierRef = won.tierRef as string | null;
    }
    const cost = parseJson(fact?.cost ?? null);
    if (isRecord(cost) && typeof cost.cost === "number") {
      line.unitCost = cost.cost;
      if (cost.cost > 0 && typeof cost.cur === "string") line.unitCostCurrency = cost.cur;
    }
    if (l.gift) line.giftTierId = l.gift;
    return line;
  });
  return {
    currency: request.currency,
    ...(request.country ? { countryCode: request.country } : {}),
    lines,
    enteredCodes: request.codes,
    ...(today ? { today } : {}),
    locale: request.locale,
    ...(request.rate !== undefined ? { shopToCartRate: request.rate } : {}),
  };
}

/** The answer: the plan seen from the shopper's side (no costs, no rule internals). */
export function cartPlanAnswer(plan: CartPlan): CartPlanAnswer {
  const answer: CartPlanAnswer = {
    ok: true,
    currency: plan.currency,
    saved: plan.reason ? 0 : plan.totals.productDiscount + plan.totals.orderDiscount,
    gifts: plan.gifts.map((g) => ({ tierId: g.tierId, ...(g.lineId ? { key: g.lineId } : {}), state: g.state })),
    warnings: [...new Set(plan.warnings.map((w) => w.code))],
  };
  const hint = plan.progress.tierHint;
  if (hint && hint.lineIds[0]) {
    const next = hint.next;
    answer.hint = {
      key: hint.lineIds[0],
      missing: hint.missing,
      minQty: next.minQty,
      ...(next.percent !== null ? { percent: next.percent } : {}),
      ...(next.amount !== null ? { amount: next.amount } : {}),
      ...(hint.marginCapped ? { capped: true as const } : {}),
    };
  }
  if (plan.progress.freeShipping) answer.freeShipping = plan.progress.freeShipping;
  if (plan.progress.gifts) answer.giftProgress = plan.progress.gifts;
  return answer;
}

// --- Shopify reads (cached) ---------------------------------------------------------------------

export const CART_PLAN_DOCUMENTS = Object.freeze({
  config: `query WonCartPlanConfig {
  shop {
    ianaTimezone
    config: metafield(namespace: "$app:won_discounts", key: "function_config") {
      value
    }
  }
}`,
  variants: `query WonCartPlanVariants($ids: [ID!]!) {
  nodes(ids: $ids) {
    ... on ProductVariant {
      id
      cost: metafield(namespace: "$app:won_discounts", key: "variant") {
        value
      }
      product {
        won: metafield(namespace: "$app:won_discounts", key: "product") {
          value
        }
      }
    }
  }
}`,
});

interface CacheEntry<T> {
  at: number;
  value: T;
}
const configCache = new Map<string, CacheEntry<{ config: PlanConfig | null; timezone: string | null }>>();
const variantCache = new Map<string, CacheEntry<VariantFacts>>();
let now = () => Date.now();

/** Tests: a fixed clock and empty caches. */
export function setCartPlanClock(clock: () => number): void {
  now = clock;
}
export function clearCartPlanCache(): void {
  configCache.clear();
  variantCache.clear();
}

const fresh = <T>(entry: CacheEntry<T> | undefined): entry is CacheEntry<T> => entry !== undefined && now() - entry.at < CART_PLAN_CACHE_MS;

async function readConfig(client: AdminClient, shop: string): Promise<{ config: PlanConfig | null; timezone: string | null }> {
  const cached = configCache.get(shop);
  if (fresh(cached)) return cached.value;
  const result = await client.graphql<{ shop: { ianaTimezone?: string; config: { value: string } | null } }>(CART_PLAN_DOCUMENTS.config, {});
  const parsed = parseJson(result.data?.shop?.config?.value ?? null);
  // Over 10 000 B Shopify hands the function null (C7): the same here — planCart then plans nothing.
  const value = { config: isFunctionConfigPayload(parsed) ? (parsed as PlanConfig) : null, timezone: result.data?.shop?.ianaTimezone ?? null };
  configCache.set(shop, { at: now(), value });
  return value;
}

/** The shop-local date at `ms` (YYYY-MM-DD); undefined when the zone is unknown or invalid. */
function shopToday(timezone: string | null, ms: number): string | undefined {
  if (!timezone) return undefined;
  try {
    return shopLocalDates({ startsAt: new Date(ms).toISOString() }, timezone).startsOn;
  } catch {
    return undefined;
  }
}

async function readVariants(client: AdminClient, shop: string, ids: readonly number[]): Promise<Map<number, VariantFacts>> {
  const out = new Map<number, VariantFacts>();
  const missing: number[] = [];
  for (const id of new Set(ids)) {
    const cached = variantCache.get(`${shop}|${id}`);
    if (fresh(cached)) out.set(id, cached.value);
    else missing.push(id);
  }
  if (missing.length > 0) {
    type Node = { id?: string; cost?: { value: string } | null; product?: { won?: { value: string } | null } | null } | null;
    const result = await client.graphql<{ nodes: Node[] }>(CART_PLAN_DOCUMENTS.variants, { ids: missing.map((id) => `gid://shopify/ProductVariant/${id}`) });
    missing.forEach((id, i) => {
      const node = result.data?.nodes?.[i];
      const facts: VariantFacts = { product: node?.product?.won?.value ?? null, cost: node?.cost?.value ?? null };
      variantCache.set(`${shop}|${id}`, { at: now(), value: facts });
      out.set(id, facts);
    });
  }
  return out;
}

/** The live plan of a storefront cart for `shop` (the app proxy's authenticated shop, SEC-2). */
export async function runCartPlan(client: AdminClient, shop: string, request: CartPlanRequest): Promise<CartPlanAnswer> {
  const { config, timezone } = await readConfig(client, shop);
  const facts = await readVariants(client, shop, request.lines.map((l) => l.variantId));
  return cartPlanAnswer(planCart(cartPlanInput(request, facts, shopToday(timezone, now())), config));
}
