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
//                  being propagated) — rule refs and margin refs (MVP 2); only
//                  the dev harness, which has no Shopify, recomputes them with
//                  productRuleIndex;
//   margin (MVP 2) each line's purchase cost as the variant metafield the
//                  mirror wrote holds it (`unitCost`/`unitCostCurrency`, from
//                  VariantCost), the shop currency as the config's `cur`, and
//                  `shopToCartRate` (1 in the shop currency; otherwise an
//                  estimate from market prices — checkout uses Shopify's
//                  presentmentCurrencyRate, so the view says it is an estimate);
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
import { costMinorUnits } from "@won/core/discounts/margin";
import { explainPlan } from "@won/core/discounts/explain";
import { checkoutPreview, roundingTiePossible, type CheckoutPreview } from "@won/core/discounts/function-output";
import { buildNodeVars, buildShopFunctionConfig, campaignInputFromVars } from "@won/core/discounts/function-payload";
import { planCart, type CartPlan, type PlanConfig } from "@won/core/discounts/plan";
import type { CartLineInput, CartPlanInput } from "@won/core/discounts/cart";
import { productRuleIndex, ruleRef, variantKey } from "@won/core/discounts/targeting";

import { refTargetsCollections } from "../sync/products";
import type { CartPlanView, UiText } from "../../components/model/types";

export interface PricedLine {
  variantId: string;
  productId: string;
  /** "Mikina Won" or "Mikina Won — M / černá". */
  title: string;
  quantity: number;
  /** Minor units of the cart currency (from Shopify, never the browser). */
  unitPrice: number;
  /**
   * Collections the product is in: the harness's recomputed targeting, or —
   * with `liveCollections` — its LIVE Shopify membership (membership warning).
   */
  collectionIds: readonly string[];
  /** Purchase cost of one item, MAJOR units (the variant metafield's `cost`); absent = unknown. */
  unitCost?: number;
  /** Its currency (the metafield's `cur`). */
  unitCostCurrency?: string;
  /** An outlet line (A1.1) / a Won gift line (A1.2): outside every discount, margin included (harness, MVP 5). */
  outlet?: boolean;
  giftTierId?: string;
}

/** A product's refs as its `$app:won_discounts/product` metafield holds them. */
export interface ProductRefs {
  ruleIds: readonly string[];
  variantRuleIds: Readonly<Record<string, readonly string[]>>;
  /** Numeric ids of its collections with a margin setting (MVP 2; absent = none). */
  marginRefs?: readonly string[];
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
  /** Shopify shop.currencyCode: the margin's `cur` (without it every cost is unknown, like checkout). */
  shopCurrency?: string | null;
  /** Shop currency → cart currency (1 in the shop currency); absent/null = unknown. */
  shopToCartRate?: number | null;
  /** `shopToCartRate` was estimated from market prices (the cart is not in the shop currency). */
  rateEstimated?: boolean;
  /**
   * The refs checkout reads, per product id (a product without a metafield =
   * no refs). Absent → recomputed from `lines[].collectionIds` (dev harness only).
   */
  productRefs?: ReadonlyMap<string, ProductRefs>;
  /** Sentences about the sync state the caller knows (last sync failed, not applied yet, plan pending). */
  warnings?: readonly UiText[];
  /**
   * Collection membership changed in Shopify and the refs are being refreshed
   * (a stale mark, or a product pass running). Said only when THIS cart
   * involves a collection rule: some line carries a ref from a collection
   * target (same scoping as the rules' "Propisuje se", F2 re-review M-3) — a
   * cart of product-list products gets no such warning.
   */
  targetingStale?: boolean;
  /**
   * `lines[].collectionIds` are the products' live Shopify collections (read
   * while stale): a product live in a targeted collection without that rule's
   * ref (a fresh joiner), or carrying a collection ref for a collection it
   * has left, is named in its own warning.
   */
  liveCollections?: boolean;
}

const lineId = (index: number) => `L${index + 1}`;

/** Collection targets that write refs: each rule's own, and every not-killed campaign re-target (`rule@campaign`). */
function collectionTargets(config: WonDiscountsConfig): { ref: string; ids: ReadonlySet<string> }[] {
  const out: { ref: string; ids: ReadonlySet<string> }[] = [];
  const ruleIds = new Set(config.modules.codes.rules.map((r) => r.id));
  for (const rule of config.modules.codes.rules) {
    if (rule.target.kind === "collections") out.push({ ref: ruleRef(rule.id), ids: new Set(rule.target.ids) });
  }
  for (const campaign of config.campaigns) {
    if (campaign.killed) continue;
    for (const override of campaign.overrides) {
      const target = (override.patch as { target?: { kind?: unknown; ids?: unknown } }).target;
      if (!ruleIds.has(override.ruleId) || target?.kind !== "collections" || !Array.isArray(target.ids)) continue;
      out.push({ ref: ruleRef(override.ruleId, { campaignId: campaign.id }), ids: new Set(target.ids as string[]) });
    }
  }
  return out;
}

/**
 * Lines whose LIVE collection membership and checkout refs disagree: live in a
 * targeted collection but without that target's ref (a fresh joiner), or with
 * the ref but in none of the target's collections any more (a leaver).
 */
export function membershipMismatches(config: WonDiscountsConfig, priced: readonly PricedLine[], lines: readonly CartLineInput[]): string[] {
  const targets = collectionTargets(config);
  if (targets.length === 0) return [];
  const out: string[] = [];
  lines.forEach((line, i) => {
    const live = new Set(priced[i]?.collectionIds ?? []);
    const refs = new Set([...line.ruleIds, ...(line.variantRuleIds?.[variantKey(line.variantId)] ?? [])]);
    const differs = targets.some(({ ref, ids }) => [...ids].some((id) => live.has(id)) !== refs.has(ref));
    if (differs) out.push(line.id);
  });
  return out;
}

/** Does some line carry a ref from a collection target (the rule's own, or a campaign re-target)? */
export function cartInvolvesCollectionRules(config: WonDiscountsConfig, lines: readonly CartLineInput[]): boolean {
  return lines.some((line) => {
    const refs = [...line.ruleIds, ...(line.variantRuleIds?.[variantKey(line.variantId)] ?? [])];
    return refs.some((ref) => refTargetsCollections(config, ref));
  });
}

/** A product metafield value → its refs (junk → no refs, like the function). */
export function parseProductRefs(value: string | null | undefined): ProductRefs {
  if (!value) return { ruleIds: [], variantRuleIds: {} };
  try {
    const parsed = JSON.parse(value) as { ruleIds?: unknown; variantRuleIds?: unknown; marginRefs?: unknown };
    const strings = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
    const variantRuleIds: Record<string, string[]> = {};
    if (parsed.variantRuleIds && typeof parsed.variantRuleIds === "object" && !Array.isArray(parsed.variantRuleIds)) {
      for (const [variant, refs] of Object.entries(parsed.variantRuleIds as Record<string, unknown>)) {
        const list = strings(refs);
        if (list.length > 0) variantRuleIds[variant] = list;
      }
    }
    const marginRefs = strings(parsed.marginRefs);
    return { ruleIds: strings(parsed.ruleIds), variantRuleIds, ...(marginRefs.length > 0 ? { marginRefs } : {}) };
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
  return new Map(
    [...index].map(([productId, entry]) => [
      productId,
      { ruleIds: entry.ruleIds, variantRuleIds: entry.variantRuleIds, ...(entry.marginRefs ? { marginRefs: entry.marginRefs } : {}) },
    ]),
  );
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
  const encoded = buildShopFunctionConfig(config, {
    now,
    shopTimezone: input.shopTimezone,
    ...(input.shopCurrency ? { shopCurrency: input.shopCurrency } : {}),
  });
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
      ...(entry?.marginRefs && entry.marginRefs.length > 0 ? { marginRefs: entry.marginRefs } : {}),
      ...(line.unitCost !== undefined ? { unitCost: line.unitCost } : {}),
      ...(line.unitCostCurrency !== undefined ? { unitCostCurrency: line.unitCostCurrency } : {}),
      ...(line.outlet ? { outlet: true } : {}),
      ...(line.giftTierId ? { giftTierId: line.giftTierId } : {}),
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
    ...(typeof input.shopToCartRate === "number" ? { shopToCartRate: input.shopToCartRate } : {}),
  };
  const plan = planCart(cart, shared);
  const preview = checkoutPreview(plan, { lineCount: plan.lines.length });
  const applied = new Map(preview.lines.map((l) => [l.lineId, l.applied]));
  const titles = new Map(input.lines.map((line, i) => [lineId(i), line.title]));
  const productDiscount = plan.lines.reduce((sum, line) => sum + (applied.get(line.lineId) ?? 0), 0);
  const orderDiscount = preview.order.applied;
  const mismatched = input.targetingStale && input.liveCollections ? membershipMismatches(config, input.lines, lines) : [];
  const membership: UiText[] =
    mismatched.length > 0 ? [{ key: "tryCart.warning.membership", params: { lines: [...new Set(mismatched.map((id) => titles.get(id) ?? id))].join(", ") } }] : [];
  const warnings = [
    ...previewWarnings(plan, preview, input.locale, titles),
    ...(input.warnings ?? []),
    ...membership,
    ...(membership.length === 0 && input.targetingStale && cartInvolvesCollectionRules(config, lines) ? [{ key: "tryCart.warning.targeting" as const }] : []),
  ];
  // Margin protection (MVP 2): a line is capped when its product discount was lowered or the
  // order discount left it out at its floor; the explanation (admin audience) says why.
  const marginOn = config.modules.margin.enabled === true;
  const orderExcluded = new Set(plan.order?.marginExcludedLineIds ?? []);
  const capped = (line: (typeof plan.lines)[number]) => line.marginCapped !== undefined || orderExcluded.has(line.lineId);
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
        ...(marginOn && capped(line) ? { marginCapped: true } : {}),
      };
    }),
    ...(marginOn
      ? {
          margin: {
            rateEstimated: input.rateEstimated === true,
            // Lines margin protection applies to (not outlet, not gift) whose cost is unknown in the cart
            // currency (none in the mirror, or not convertible): the "no purchase cost" percent ceiling is
            // their floor (types.ts CartPlanView.margin).
            linesWithoutCost: plan.lines.filter((planLine) => {
              if (planLine.excluded !== null) return false;
              const line = lines.find((l) => l.id === planLine.lineId);
              return !line || costMinorUnits(line.unitCost, line.unitCostCurrency, input.shopToCartRate ?? undefined, input.currency, input.shopCurrency ?? undefined) === null;
            }).length,
          },
        }
      : {}),
    explain: explainPlan(plan, input.locale, { audience: "admin" }).map((item) => ({
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
