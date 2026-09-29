// Vyzkoušet košík, the engine part (spec §5, DATA-4 one brain): the simulated
// cart is planned by the SAME engine on the SAME inputs the discount function
// reads at checkout, and shown as the checkout will APPLY it —
//   shared config  buildShopFunctionConfig(config, { now, shopTimezone }) of
//                  the config GATED for the shop's plan (BILL-1: what the sync
//                  ships), as the JSON the sync writes (over the budget → the
//                  function gets null → planCart(…, null), exactly like checkout);
//   node vars      buildNodeVars(automatic) → campaignInputFromVars at `now`;
//   targeting      each line's refs FROM THE PRODUCT METAFIELD Shopify holds
//                  (`productRefs`, read by try-cart.server.ts — item 2: what
//                  checkout reads, even while a collection change is still
//                  being propagated); only the dev harness, which has no
//                  Shopify, recomputes them with productRuleIndex;
//   day            `today` = the chosen shop-local date;
//   output         core checkoutPreview (item 8): every node's output mapped
//                  exactly as the function maps it — the per-line amounts and
//                  totals are what checkout takes off, with warnings when the
//                  output was over Shopify's size budget (degraded, relaxed
//                  rounding ties), when a percentage may round at a tie, or
//                  when a fixed shipping discount reaches only the first of
//                  several shipments.
// then explainPlan → the TryCartScreen view model. Pure (prices and refs are
// read from Shopify by try-cart.server.ts), so the harness renders a real plan.

import type { WonDiscountsConfig } from "@won/core/discounts/config";
import { formatMoney } from "@won/core/discounts/describe";
import { explainPlan } from "@won/core/discounts/explain";
import { checkoutPreview, roundingTiePossible, type CheckoutPreview } from "@won/core/discounts/function-output";
import { buildNodeVars, buildShopFunctionConfig, campaignInputFromVars } from "@won/core/discounts/function-payload";
import { planCart, type CartPlan, type PlanConfig } from "@won/core/discounts/plan";
import type { CartLineInput, CartPlanInput } from "@won/core/discounts/cart";
import { productRuleIndex } from "@won/core/discounts/targeting";

import type { CartPlanView, UiText } from "../../components/model/types";

export interface PricedLine {
  variantId: string;
  productId: string;
  /** "Mikina Won" or "Mikina Won — M / černá". */
  title: string;
  quantity: number;
  /** Minor units of the cart currency (from Shopify, never the browser). */
  unitPrice: number;
  /** Collections the product is in (only for the harness's recomputed targeting). */
  collectionIds: readonly string[];
}

/** A product's refs as its `$app:won_discounts/product` metafield holds them. */
export interface ProductRefs {
  ruleIds: readonly string[];
  variantRuleIds: Readonly<Record<string, readonly string[]>>;
}

export interface TryCartPlanInput {
  lines: readonly PricedLine[];
  currency: string;
  /** Buyer country (Pro market targeting); null = unknown. */
  countryCode: string | null;
  codes: readonly string[];
  /** Shop-local `YYYY-MM-DD` the plan is evaluated on. */
  date: string;
  /** Shop-local time of day `HH:MM:SS` on that date (campaign windows). */
  time: string;
  shopTimezone: string;
  locale: "cs" | "en";
  /** Market name shown with the result. */
  market?: string | null;
  /**
   * The refs checkout reads, per product id (a product without a metafield =
   * no refs). Absent → recomputed from `lines[].collectionIds` (dev harness only).
   */
  productRefs?: ReadonlyMap<string, ProductRefs>;
  /** Sentences about the sync state the caller knows (last sync failed, targeting being refreshed). */
  warnings?: readonly UiText[];
}

const lineId = (index: number) => `L${index + 1}`;

/** A product metafield value → its refs (junk → no refs, like the function). */
export function parseProductRefs(value: string | null | undefined): ProductRefs {
  if (!value) return { ruleIds: [], variantRuleIds: {} };
  try {
    const parsed = JSON.parse(value) as { ruleIds?: unknown; variantRuleIds?: unknown };
    const strings = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
    const variantRuleIds: Record<string, string[]> = {};
    if (parsed.variantRuleIds && typeof parsed.variantRuleIds === "object" && !Array.isArray(parsed.variantRuleIds)) {
      for (const [variant, refs] of Object.entries(parsed.variantRuleIds as Record<string, unknown>)) {
        const list = strings(refs);
        if (list.length > 0) variantRuleIds[variant] = list;
      }
    }
    return { ruleIds: strings(parsed.ruleIds), variantRuleIds };
  } catch {
    return { ruleIds: [], variantRuleIds: {} };
  }
}

function recomputedRefs(config: WonDiscountsConfig, lines: readonly PricedLine[]): Map<string, ProductRefs> {
  const byProduct = new Map<string, { variantIds: Set<string>; collectionIds: Set<string> }>();
  for (const line of lines) {
    const entry = byProduct.get(line.productId) ?? { variantIds: new Set<string>(), collectionIds: new Set<string>() };
    entry.variantIds.add(line.variantId);
    for (const id of line.collectionIds) entry.collectionIds.add(id);
    byProduct.set(line.productId, entry);
  }
  const index = productRuleIndex(
    config,
    [...byProduct].map(([productId, e]) => ({ productId, variantIds: [...e.variantIds], collectionIds: [...e.collectionIds] })),
  );
  return new Map([...index].map(([productId, entry]) => [productId, { ruleIds: entry.ruleIds, variantRuleIds: entry.variantRuleIds }]));
}

/** Where the checkout output differs, or may differ, from the plan (item 8). */
function previewWarnings(plan: CartPlan, preview: CheckoutPreview, locale: "cs" | "en", titles: ReadonlyMap<string, string>): UiText[] {
  const out: UiText[] = [];
  const name = (id: string) => titles.get(id) ?? id;
  const list = (ids: Iterable<string>) => [...new Set([...ids].map(name))].join(", ");
  if (preview.degraded && preview.shortfall > 0) {
    out.push({ key: "tryCart.warning.degraded", params: { amount: formatMoney(preview.shortfall, plan.currency, locale) } });
  }
  const tieLines = new Set<string>(preview.relaxedTies.map((t) => t.lineId));
  let orderTie = false;
  const byId = new Map(plan.lines.map((l) => [l.lineId, l]));
  for (const node of preview.nodes) {
    for (const op of node.output.lines.operations) {
      if ("productDiscountsAdd" in op) {
        for (const c of op.productDiscountsAdd.candidates) {
          if (!("percentage" in c.value)) continue;
          for (const t of c.targets) {
            const line = byId.get(t.cartLine.id);
            if (line && roundingTiePossible(line.subtotal, c.value.percentage.value)) tieLines.add(line.lineId);
          }
        }
      } else {
        for (const c of op.orderDiscountsAdd.candidates) {
          if ("percentage" in c.value && roundingTiePossible(preview.order.base, c.value.percentage.value)) orderTie = true;
        }
      }
    }
  }
  if (tieLines.size > 0) out.push({ key: "tryCart.warning.tie", params: { lines: list(tieLines) } });
  if (orderTie) out.push({ key: "tryCart.warning.orderTie" });
  if (preview.shippingFirstGroupOnly) out.push({ key: "tryCart.warning.shippingFirstGroup" });
  return out;
}

export function planTryCart(config: WonDiscountsConfig, input: TryCartPlanInput): CartPlanView {
  const now = `${input.date}T${input.time}`;
  const encoded = buildShopFunctionConfig(config, { now, shopTimezone: input.shopTimezone });
  // Exactly what the function reads: the JSON as written, or null over the budget (C7).
  const shared = encoded.fits ? (JSON.parse(encoded.json) as PlanConfig) : null;
  const refs = input.productRefs ?? recomputedRefs(config, input.lines);

  const lines: CartLineInput[] = input.lines.map((line, i) => {
    const entry = refs.get(line.productId);
    return {
      id: lineId(i),
      variantId: line.variantId,
      productId: line.productId,
      quantity: line.quantity,
      unitPrice: line.unitPrice,
      ruleIds: entry ? [...entry.ruleIds] : [],
      ...(entry && Object.keys(entry.variantRuleIds).length > 0 ? { variantRuleIds: entry.variantRuleIds } : {}),
    };
  });

  const cart: CartPlanInput = {
    currency: input.currency,
    ...(input.countryCode ? { countryCode: input.countryCode } : {}),
    lines,
    enteredCodes: [...input.codes],
    campaign: campaignInputFromVars(buildNodeVars({ kind: "automatic" }, config, now), now),
    today: input.date,
    now,
    locale: input.locale,
  };
  const plan = planCart(cart, shared);
  const preview = checkoutPreview(plan, { lineCount: plan.lines.length });
  const applied = new Map(preview.lines.map((l) => [l.lineId, l.applied]));
  const titles = new Map(input.lines.map((line, i) => [lineId(i), line.title]));
  const productDiscount = plan.lines.reduce((sum, line) => sum + (applied.get(line.lineId) ?? 0), 0);
  const orderDiscount = preview.order.applied;
  const warnings = [...previewWarnings(plan, preview, input.locale, titles), ...(input.warnings ?? [])];
  return {
    currency: input.currency,
    date: input.date,
    market: input.market ?? null,
    lines: plan.lines.map((line) => {
      const discount = applied.get(line.lineId) ?? 0;
      return {
        lineId: line.lineId,
        title: titles.get(line.lineId) ?? line.productId,
        quantity: line.quantity,
        subtotal: line.subtotal,
        discount,
        total: line.subtotal - discount,
      };
    }),
    explain: explainPlan(plan, input.locale).map((item) => ({
      tone: item.tone,
      text: item.text,
      ...(item.lineIds && item.lineIds.length > 0 ? { lineIds: [...item.lineIds] } : {}),
    })),
    totals: {
      subtotal: plan.totals.subtotal,
      productDiscount,
      orderDiscount,
      total: plan.totals.subtotal - productDiscount - orderDiscount,
    },
    ...(warnings.length > 0 ? { warnings } : {}),
  };
}
