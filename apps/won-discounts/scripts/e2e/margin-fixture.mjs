// The margin-protection checkout E2E fixture (MVP 2, Task 5b), shared by the
// seed (scripts/e2e/seed-mvp1.mjs --profile margin), the cost mirror wrapper
// (scripts/e2e/margin-costs.mjs) and the spec (tests/e2e/checkout.margin.spec.ts).
//
//   margin protection  ON: minimum margin 25 %, maximum discount 30 % for
//                      products without a purchase cost (Free: global only)
//   "E2E marže auto 50 %"  automatic, 50 % on won-e2e-simple-a + won-e2e-simple-b
//   "E2E marže kód 20 %"   code WONE2EM20, 20 % on the order
//
// The cart the spec buys (market cesko, CZK), one item of each:
//   won-e2e-simple-a          price 10.00 USD, cost 6.00 USD → the 50 % is cut
//                             to its floor ceilTol(cost × rate × 100 / 0.75)
//   won-e2e-simple-b          price 12.00 USD, no cost → the 50 % is cut to the
//                             30 % ceiling (floor = price × 70 %)
//   won-e2e-two-variants Small price 15.00 USD, cost 5.00 USD, no product rule
//                             → carries the whole order discount; the two lines
//                             at their floor are left out of it (excludedCartLineIds)
//
// Costs are catalog data (packages/testing/src/e2e-products.js, Task 5a): the
// seed never writes them. The function reads them from the variant metafield
// `$app:won_discounts`/`variant` the cost mirror writes (app/lib/sync/costs.ts).
// Both rule values are percentages (no per-currency amount), like the MVP 1 fixture.

export const MARGIN_PRODUCT_A_HANDLE = "won-e2e-simple-a";
export const MARGIN_PRODUCT_B_HANDLE = "won-e2e-simple-b";
export const MARGIN_SMALL_HANDLE = "won-e2e-two-variants";
/** The two-variants option value the cart buys (it has a cost; "Large" has none). */
export const MARGIN_SMALL_OPTION = "Small";
/** Products the automatic rule targets (the seed looks up their GIDs). */
export const MARGIN_HANDLES = [MARGIN_PRODUCT_A_HANDLE, MARGIN_PRODUCT_B_HANDLE];
/** Every product in the spec's cart. */
export const MARGIN_CART_HANDLES = [MARGIN_PRODUCT_A_HANDLE, MARGIN_PRODUCT_B_HANDLE, MARGIN_SMALL_HANDLE];

export const MARGIN_CODE = "WONE2EM20";
export const MARGIN_AUTO_RULE_ID = "e2e-margin-auto-50";
export const MARGIN_CODE_RULE_ID = "e2e-margin-code-20";
export const MARGIN_AUTO_RULE_NAME = "E2E marže auto 50 %";
export const MARGIN_CODE_RULE_NAME = "E2E marže kód 20 %";
export const MARGIN_AUTO_PERCENT = 50;
export const MARGIN_CODE_PERCENT = 20;
export const MARGIN_RULE_IDS = [MARGIN_AUTO_RULE_ID, MARGIN_CODE_RULE_ID];

export const MARGIN_MIN_MARGIN_PERCENT = 25;
export const MARGIN_MAX_DISCOUNT_PERCENT = 30;

// Phase B (Pro, profile `margin-pro`): a manual test collection holding
// won-e2e-simple-b only, with its own maximum discount, stricter than the
// global one. Created and deleted by scripts/e2e/margin-collection.mjs.
// On Pro the sync ships it as `col` in the shop config and writes the
// collection's numeric id into simple-b's product metafield (`marginRefs`), so
// the function caps simple-b at 10 % while the payload's global max stays 30 %.
// (On Free the plan gate would fold it into the global value instead.)
export const MARGIN_COLLECTION_HANDLE = "won-e2e-margin";
export const MARGIN_COLLECTION_TITLE = "Won E2E — Margin (Pro)";
/** The collection's only member. */
export const MARGIN_COLLECTION_MEMBER_HANDLE = MARGIN_PRODUCT_B_HANDLE;
export const MARGIN_COLLECTION_MAX_DISCOUNT_PERCENT = 10;

/**
 * modules.margin of the seed config (the stored, admin shape). With
 * `collectionId` (the GID of won-e2e-margin): the Pro override on it,
 * maximum discount 10 %, minimum margin left to the global value.
 */
export function marginModule(collectionId) {
  return {
    enabled: true,
    global: { minMarginPercent: MARGIN_MIN_MARGIN_PERCENT, maxDiscountPercent: MARGIN_MAX_DISCOUNT_PERCENT },
    perCollection: collectionId ? [{ collectionId, maxDiscountPercent: MARGIN_COLLECTION_MAX_DISCOUNT_PERCENT }] : [],
  };
}

/** The spec's cart: one item each; `option` picks the variant by its option value (else the first variant). */
export const MARGIN_CART = [
  { handle: MARGIN_PRODUCT_A_HANDLE, quantity: 1 },
  { handle: MARGIN_PRODUCT_B_HANDLE, quantity: 1 },
  { handle: MARGIN_SMALL_HANDLE, quantity: 1, option: MARGIN_SMALL_OPTION },
];

/** The two seeded rules; `productIds` maps each handle of MARGIN_HANDLES to its product GID on the store. */
export function marginRules(productIds) {
  const a = productIds[MARGIN_PRODUCT_A_HANDLE];
  const b = productIds[MARGIN_PRODUCT_B_HANDLE];
  if (!a || !b) throw new Error(`marginRules needs the GIDs of ${MARGIN_HANDLES.join(" and ")}`);
  return [
    {
      id: MARGIN_AUTO_RULE_ID,
      name: MARGIN_AUTO_RULE_NAME,
      method: "automatic",
      enabled: true,
      value: { kind: "percentage", percent: MARGIN_AUTO_PERCENT },
      target: { kind: "products", productIds: [a, b], variantIds: [] },
    },
    {
      id: MARGIN_CODE_RULE_ID,
      name: MARGIN_CODE_RULE_NAME,
      method: "code",
      enabled: true,
      codes: [MARGIN_CODE],
      value: { kind: "percentage", percent: MARGIN_CODE_PERCENT },
      target: { kind: "order" },
    },
  ];
}
