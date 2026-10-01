// The margin-protection checkout E2E fixture (MVP 2, Task 5b), shared by the
// seed (scripts/e2e/seed-mvp1.mjs --profile margin|margin-pro), the cleanup
// recognition (scripts/e2e/margin-cleanup.mjs), the cost mirror wrapper
// (scripts/e2e/margin-costs.mjs), the test collection
// (scripts/e2e/margin-collection.mjs) and the spec (tests/e2e/checkout.margin.spec.ts).
//
//   margin protection  ON: minimum margin 25 %, maximum discount 30 % for
//                      products without a purchase cost (Free: global only)
//   "E2E marže auto 50 %"  automatic, 50 % on won-e2e-simple-a, won-e2e-simple-b
//                          and won-e2e-spare
//   "E2E marže kód 20 %"   code WONE2EM20, 20 % on the order
//   "E2E marže kód 60 %"   code WONE2EM60, 60 % on the order (the lowered order
//                          discount scenario, fix round 1 / audit OQ1)
//
// Prices and costs are in the shop currency, CZK since 2026-09-30 (USD before):
// in market cesko the rate is 1; market slovensko has no fixed prices, so every
// EUR price (and cost) is the CZK one converted (simple-a ≈ 0,42 €).
// Main cart (market cesko, CZK; also bought in market slovensko, EUR), one of each:
//   won-e2e-simple-a          price 10 Kč, cost 6 Kč → the 50 % is cut
//                             to its floor ceilTol(cost × rate × 100 / 0.75)
//   won-e2e-simple-b          price 12 Kč, no cost → the 50 % is cut to the
//                             30 % ceiling (floor = price × 70 %); phase B: its
//                             collection's 10 %
//   won-e2e-spare             no cost, NOT in the test collection: the control
//                             line — 30 % on Free and on Pro alike (a Free fold
//                             of the collection's 10 % into the global value
//                             would make it 10 %). In cesko its price is the
//                             price list's fixed 199 CZK (SK: converted 9 Kč).
//   won-e2e-two-variants Small price 15 Kč, cost 5 Kč, no product rule
//                             → carries the whole order discount; the lines at
//                             their floor are left out of it (excludedCartLineIds)
// Order-cap cart (WONE2EM60): two-variants Small + won-e2e-multiaxis S / Red
// (20 Kč, cost 8 Kč), no product rule on either: 60 % of the order is
// more than their floors allow, so margin protection LOWERS the order discount
// to an exact amount spread over BOTH lines (none is at its floor).
//
// Costs are catalog data (packages/testing/src/e2e-products.js, Task 5a): the
// seed never writes them. The function reads them from the variant metafield
// `$app:won_discounts`/`variant` the cost mirror writes (app/lib/sync/costs.ts).
// Every rule value is a percentage (no per-currency amount), so the same seed
// holds in CZK and EUR.

export const MARGIN_PRODUCT_A_HANDLE = "won-e2e-simple-a";
export const MARGIN_PRODUCT_B_HANDLE = "won-e2e-simple-b";
export const MARGIN_SPARE_HANDLE = "won-e2e-spare";
export const MARGIN_SMALL_HANDLE = "won-e2e-two-variants";
/** The two-variants option value the carts buy (it has a cost; "Large" has none). */
export const MARGIN_SMALL_OPTION = "Small";
export const MARGIN_MULTIAXIS_HANDLE = "won-e2e-multiaxis";
/** The multiaxis variant the order-cap cart buys (its title; cost 8 Kč). */
export const MARGIN_MULTIAXIS_OPTION = "S / Red";
/** Products the automatic rule targets (the seed looks up their GIDs). */
export const MARGIN_HANDLES = [MARGIN_PRODUCT_A_HANDLE, MARGIN_PRODUCT_B_HANDLE, MARGIN_SPARE_HANDLE];
/** Every product any margin cart holds (the spec reads their metafields as the app). */
export const MARGIN_CART_HANDLES = [
  MARGIN_PRODUCT_A_HANDLE,
  MARGIN_PRODUCT_B_HANDLE,
  MARGIN_SPARE_HANDLE,
  MARGIN_SMALL_HANDLE,
  MARGIN_MULTIAXIS_HANDLE,
];

export const MARGIN_CODE = "WONE2EM20";
export const MARGIN_AUTO_RULE_ID = "e2e-margin-auto-50";
export const MARGIN_CODE_RULE_ID = "e2e-margin-code-20";
export const MARGIN_AUTO_RULE_NAME = "E2E marže auto 50 %";
export const MARGIN_CODE_RULE_NAME = "E2E marže kód 20 %";
export const MARGIN_AUTO_PERCENT = 50;
export const MARGIN_CODE_PERCENT = 20;

export const MARGIN_ORDER_CAP_CODE = "WONE2EM60";
export const MARGIN_ORDER_CAP_RULE_ID = "e2e-margin-code-60";
export const MARGIN_ORDER_CAP_RULE_NAME = "E2E marže kód 60 %";
export const MARGIN_ORDER_CAP_PERCENT = 60;

export const MARGIN_RULE_IDS = [MARGIN_AUTO_RULE_ID, MARGIN_CODE_RULE_ID, MARGIN_ORDER_CAP_RULE_ID];

export const MARGIN_MIN_MARGIN_PERCENT = 25;
export const MARGIN_MAX_DISCOUNT_PERCENT = 30;

// Phase B (Pro, profile `margin-pro`): a manual test collection holding
// won-e2e-simple-b only, with its own maximum discount, stricter than the
// global one. Created and deleted by scripts/e2e/margin-collection.mjs.
// On Pro the sync ships it as `col` in the shop config and writes the
// collection's numeric id into simple-b's product metafield (`marginRefs`), so
// the function caps simple-b at 10 % while the payload's global max stays 30 %
// (and won-e2e-spare, outside the collection, keeps 30 %).
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

/** The main cart: one item each; `option` picks the variant by an option value or its title (else the first variant). */
export const MARGIN_CART = [
  { handle: MARGIN_PRODUCT_A_HANDLE, quantity: 1 },
  { handle: MARGIN_PRODUCT_B_HANDLE, quantity: 1 },
  { handle: MARGIN_SMALL_HANDLE, quantity: 1, option: MARGIN_SMALL_OPTION },
  { handle: MARGIN_SPARE_HANDLE, quantity: 1 },
];

/** The order-cap cart (with WONE2EM60): two costed lines, no product rule. */
export const MARGIN_ORDER_CAP_CART = [
  { handle: MARGIN_SMALL_HANDLE, quantity: 1, option: MARGIN_SMALL_OPTION },
  { handle: MARGIN_MULTIAXIS_HANDLE, quantity: 1, option: MARGIN_MULTIAXIS_OPTION },
];

/** The seeded rules; `productIds` maps each handle of MARGIN_HANDLES to its product GID on the store. */
export function marginRules(productIds) {
  const targets = MARGIN_HANDLES.map((handle) => productIds[handle]);
  if (targets.some((id) => !id)) throw new Error(`marginRules needs the GIDs of ${MARGIN_HANDLES.join(", ")}`);
  return [
    {
      id: MARGIN_AUTO_RULE_ID,
      name: MARGIN_AUTO_RULE_NAME,
      method: "automatic",
      enabled: true,
      value: { kind: "percentage", percent: MARGIN_AUTO_PERCENT },
      target: { kind: "products", productIds: targets, variantIds: [] },
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
    {
      id: MARGIN_ORDER_CAP_RULE_ID,
      name: MARGIN_ORDER_CAP_RULE_NAME,
      method: "code",
      enabled: true,
      codes: [MARGIN_ORDER_CAP_CODE],
      value: { kind: "percentage", percent: MARGIN_ORDER_CAP_PERCENT },
      target: { kind: "order" },
    },
  ];
}
