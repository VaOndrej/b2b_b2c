// Vyzkoušet košík, the engine part (spec §5, DATA-4 one brain): the simulated
// cart is planned by the SAME engine on the SAME payload the discount function
// reads at checkout —
//   shared config  buildShopFunctionConfig(config, { now, shopTimezone }), as
//                  the JSON the sync writes (over the budget → the function gets
//                  null → planCart(…, null), exactly like checkout);
//   node vars      buildNodeVars(automatic) → campaignInputFromVars at `now`;
//   targeting      productRuleIndex(config, the cart's products) → each line's
//                  ruleIds / variantRuleIds (the product metafield's value);
//   day            `today` = the chosen shop-local date.
// then explainPlan → the TryCartScreen view model. Pure (prices, collections
// and the country are read from Shopify by try-cart.server.ts), so the dev
// harness renders a real plan from fixture prices.

import type { WonDiscountsConfig } from "@won/core/discounts/config";
import { explainPlan } from "@won/core/discounts/explain";
import { buildNodeVars, buildShopFunctionConfig, campaignInputFromVars } from "@won/core/discounts/function-payload";
import { planCart, type PlanConfig } from "@won/core/discounts/plan";
import type { CartLineInput, CartPlanInput } from "@won/core/discounts/cart";
import { productRuleIndex } from "@won/core/discounts/targeting";

import type { CartPlanView } from "../../components/model/types";

export interface PricedLine {
  variantId: string;
  productId: string;
  /** "Mikina Won" or "Mikina Won — M / černá". */
  title: string;
  quantity: number;
  /** Minor units of the cart currency (from Shopify, never the browser). */
  unitPrice: number;
  /** Collections the product is in (collection targeting). */
  collectionIds: readonly string[];
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
}

const lineId = (index: number) => `L${index + 1}`;

export function planTryCart(config: WonDiscountsConfig, input: TryCartPlanInput): CartPlanView {
  const now = `${input.date}T${input.time}`;
  const encoded = buildShopFunctionConfig(config, { now, shopTimezone: input.shopTimezone });
  // Exactly what the function reads: the JSON as written, or null over the budget (C7).
  const shared = encoded.fits ? (JSON.parse(encoded.json) as PlanConfig) : null;

  const byProduct = new Map<string, { variantIds: Set<string>; collectionIds: Set<string> }>();
  for (const line of input.lines) {
    const entry = byProduct.get(line.productId) ?? { variantIds: new Set<string>(), collectionIds: new Set<string>() };
    entry.variantIds.add(line.variantId);
    for (const id of line.collectionIds) entry.collectionIds.add(id);
    byProduct.set(line.productId, entry);
  }
  const index = productRuleIndex(
    config,
    [...byProduct].map(([productId, e]) => ({ productId, variantIds: [...e.variantIds], collectionIds: [...e.collectionIds] })),
  );

  const lines: CartLineInput[] = input.lines.map((line, i) => {
    const entry = index.get(line.productId);
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
  const titles = new Map(input.lines.map((line, i) => [lineId(i), line.title]));
  return {
    currency: input.currency,
    date: input.date,
    market: input.market ?? null,
    lines: plan.lines.map((line) => {
      const discount = line.product?.amount ?? 0;
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
    totals: { ...plan.totals },
  };
}
