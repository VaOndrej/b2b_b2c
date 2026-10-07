// Prices by quantity on product cards (MVP 7 BETA, contract M8, decision P6): the ONE line a product card shows
// about the product's quantity discount — its first break ("od 3 ks −10 %", "od 3 ks −5 Kč za kus").
// The theme app extension computes it in Liquid (snippets/won-card-tier.liquid) for every card of a collection or
// search page; this is the same decision in TS — the reference the snippet is written against and the property
// test checks against planCart: a card never says more than checkout gives.
//
// A card shows NOTHING unless the promise is safe without knowing the cart:
//   - the storefront config says cards are on (`cards: 1`) and the product has a set (K1: its `tierRef`, else the
//     global set; an unusable ref = none) with a first break;
//   - no variant of the product is on sale (Výprodej; unless outlet combines with anything, `ow`);
//   - margin protection off, or: no variant has a purchase cost AND the break is a percent within the product's
//     percent ceiling (the same ceiling the product page uses). With protection on, an amount break shows nothing
//     (it would need the price), a costed product shows nothing (it would need the floor);
//   - an amount break has an amount in the page's currency and it is at most the cheapest variant's price (the
//     engine caps an amount at the item price).
// The first break only: the lowest quantity, the smallest promise — never "až −30 %".

import type { StorefrontConfigV1, StorefrontTierBreak } from "./storefront-config.ts";

export interface CardTierInput {
  cfg: Pick<StorefrontConfigV1, "tiers" | "margin"> & { cards?: 1; ow?: 1 };
  /** The page's currency (cart.currency.iso_code). */
  currency: string;
  /** The handle of the storefront's market (Liquid `localization.market.handle`): its own amount is read before its currency's. */
  market?: string | null;
  /** The product metafield value (`$app:won_discounts`/`product`), null when the product has none. */
  product: { tierRef?: unknown; marginRefs?: unknown } | null;
  /** Some variant has a purchase cost mirrored (variant metafield `variant` or `pdp`). */
  costed: boolean;
  /** Some variant is on sale (variant metafield `outlet` = true). */
  onSale: boolean;
  /** The cheapest variant's price in Liquid money units (major × 100): product.price_min. */
  priceMin: number;
}

export type CardTier = { min: number; pct: number } | { min: number; off: number } | null;

/** The percent ceiling of a product without a cost (quantity_tiers.liquid "K5/K6 percent ceiling"). */
function percentCeiling(margin: Extract<StorefrontConfigV1["margin"], { on: true }>, refs: unknown): number {
  const list = Array.isArray(refs) ? refs.filter((r): r is string => typeof r === "string") : [];
  const col = margin.col ?? {};
  let cap = margin.max;
  if (list.length > 4) {
    for (const key of Object.keys(col)) cap = Math.min(cap, col[key]!);
  } else {
    let matched = false;
    for (const ref of list) {
      const own = Object.hasOwn(col, ref) ? col[ref] : undefined;
      if (own === undefined) continue;
      cap = matched ? Math.min(cap, own) : own;
      matched = true;
    }
  }
  return Math.min(100, Math.max(0, cap));
}

export function cardTier(input: CardTierInput): CardTier {
  const { cfg, product } = input;
  if (cfg.cards !== 1) return null;
  const ref = product?.tierRef;
  const setId = ref === undefined || ref === null ? cfg.tiers.global : typeof ref === "string" ? ref : null;
  if (setId === null || !Object.hasOwn(cfg.tiers.sets, setId)) return null;
  const first: StorefrontTierBreak | undefined = cfg.tiers.sets[setId]!.breaks[0];
  if (!first) return null;
  if (input.onSale && cfg.ow !== 1) return null;
  const marginOn = cfg.margin.on === true;
  if (marginOn && input.costed) return null;
  if ("pct" in first) {
    if (!(first.pct > 0)) return null;
    if (marginOn && first.pct > percentCeiling(cfg.margin as Extract<StorefrontConfigV1["margin"], { on: true }>, product?.marginRefs)) return null;
    return { min: first.min, pct: first.pct };
  }
  if (marginOn) return null;
  // Amounts per market (7 Oct 2026): the market's own amount ("EUR@sk") first, then its currency's.
  const own = input.market ? `${input.currency}@${input.market}` : null;
  const off = own !== null && Object.hasOwn(first.off, own) ? first.off[own]! : Object.hasOwn(first.off, input.currency) ? first.off[input.currency]! : null;
  if (off === null || !(off > 0) || off > input.priceMin) return null;
  return { min: first.min, off };
}
