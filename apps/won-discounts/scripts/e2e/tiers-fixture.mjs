// The quantity tiers E2E fixture (MVP 3, Task 7), shared by the seed
// (scripts/e2e/seed-mvp1.mjs --profile tiers|tiers-pro), the cost pass
// (scripts/e2e/margin-costs.mjs) and the spec (tests/e2e/storefront.tiers.spec.ts).
//
// Phase A (Free, profile `tiers`):
//   global set "e2e-tiers-global", counted per PRODUCT (Free: line | product):
//     from 3 items −10 %, from 5 items −15 %
//   margin protection ON: minimum margin 30 %, maximum discount 30 % for
//   products without a purchase cost. No rule, no code.
//
// Base currency CZK (dev store since 2026-09-30); catalog prices/costs in Kč:
//   won-e2e-simple-a   10 Kč, cost 6 Kč → floor ⌈600 / 0.70⌉ = 858 haléřů →
//                      the most margin allows is 14.2 % (variant pdp.max 14.2):
//                      3 items −10 % stays 10 %, 5 items −15 % is CUT to 14.2 %
//                      (the clipped tier the PDP must show as checkout gives it).
//   won-e2e-two-variants Small 15 Kč (cost 5 Kč → up to 52.3 %, no cut),
//                      Large 18 Kč (no cost → the 30 % ceiling, no cut):
//                      the variant switch changes the prices, not the percents.
//   won-e2e-simple-b   12 Kč, no cost → the 30 % ceiling, no cut.
// The expectations are never these numbers: the spec computes them with
// planCart / the variant metafields; the numbers above only explain the choice.
//
// Phase B (Pro, profile `tiers-pro`): the same global set + a set on the test
// collection won-e2e-tiers (won-e2e-simple-b + won-e2e-spare), counted across
// the CART: from 2 items −20 %. One simple-b + one spare reach it only when the
// two lines count together (per product each has 1). Free would make that set
// inert (no tier for its products, never the global set).

export const TIERS_GLOBAL_SET_ID = "e2e-tiers-global";
export const TIERS_COLLECTION_SET_ID = "e2e-tiers-col";
export const TIERS_COUNT_ACROSS = "product";
export const TIERS_BREAKS = [
  { minQty: 3, percent: 10 },
  { minQty: 5, percent: 15 },
];
export const TIERS_COLLECTION_BREAKS = [{ minQty: 2, percent: 20 }];

export const TIERS_MIN_MARGIN_PERCENT = 30;
export const TIERS_MAX_DISCOUNT_PERCENT = 30;

export const TIERS_PRODUCT_HANDLE = "won-e2e-simple-a";
export const TIERS_VARIANTS_HANDLE = "won-e2e-two-variants";
export const TIERS_PLAIN_HANDLE = "won-e2e-simple-b";
export const TIERS_SPARE_HANDLE = "won-e2e-spare";
/** Every product a tiers cart or PDP of the spec touches (read as the app). */
export const TIERS_HANDLES = [TIERS_PRODUCT_HANDLE, TIERS_VARIANTS_HANDLE, TIERS_PLAIN_HANDLE, TIERS_SPARE_HANDLE];

// Phase B collection (scripts/e2e/margin-collection.mjs --fixture tiers).
export const TIERS_COLLECTION_HANDLE = "won-e2e-tiers";
export const TIERS_COLLECTION_TITLE = "Won E2E — Tiers (Pro)";
export const TIERS_COLLECTION_MEMBER_HANDLES = [TIERS_PLAIN_HANDLE, TIERS_SPARE_HANDLE];

/** modules.tiers of the seed config; with `collectionId` (Pro) the collection set comes first. */
export function tiersModule(collectionId) {
  const global = { id: TIERS_GLOBAL_SET_ID, scope: "global", countAcross: TIERS_COUNT_ACROSS, breaks: TIERS_BREAKS.map((b) => ({ ...b })) };
  if (!collectionId) return { sets: [global] };
  return {
    sets: [
      { id: TIERS_COLLECTION_SET_ID, scope: { collectionIds: [collectionId] }, countAcross: "cart", breaks: TIERS_COLLECTION_BREAKS.map((b) => ({ ...b })) },
      global,
    ],
  };
}

/** modules.margin of the seed config (stored, admin shape). */
export function tiersMarginModule() {
  return {
    enabled: true,
    global: { minMarginPercent: TIERS_MIN_MARGIN_PERCENT, maxDiscountPercent: TIERS_MAX_DISCOUNT_PERCENT },
    perCollection: [],
  };
}

/** The two-variants option values (Size). */
export const TIERS_SMALL_OPTION = "Small";
export const TIERS_LARGE_OPTION = "Large";

/**
 * Phase A cart (market cesko): simple-a × 5 reaches the 5-item tier, cut by
 * margin; two-variants Small × 1 + Large × 2 reach the 3-item tier only
 * because the set counts per PRODUCT (each line alone has < 3); simple-b × 1
 * reaches nothing (the control line).
 */
export const TIERS_CART = [
  { handle: TIERS_PRODUCT_HANDLE, quantity: 5 },
  { handle: TIERS_VARIANTS_HANDLE, quantity: 1, option: TIERS_SMALL_OPTION },
  { handle: TIERS_VARIANTS_HANDLE, quantity: 2, option: TIERS_LARGE_OPTION },
  { handle: TIERS_PLAIN_HANDLE, quantity: 1 },
];

/**
 * Phase B cart: simple-b × 1 + spare × 1 (the collection set, counted across
 * the cart: 2 items → −20 % on both) and simple-a × 1 (the global set, 1 item:
 * nothing).
 */
export const TIERS_PRO_CART = [
  { handle: TIERS_PLAIN_HANDLE, quantity: 1 },
  { handle: TIERS_SPARE_HANDLE, quantity: 1 },
  { handle: TIERS_PRODUCT_HANDLE, quantity: 1 },
];

/** Stable id of the block in the theme copies' product template (scripts/make-e2e-overlay.mjs TIERS_BLOCK_ID). */
export const TIERS_TEMPLATE_BLOCK_ID = "won_discounts_quantity_tiers";
