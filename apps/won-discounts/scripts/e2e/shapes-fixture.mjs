// The "shapes" checkout E2E fixture (MVP 1 gate), shared by the seed
// (scripts/e2e/seed-mvp1.mjs --profile shapes) and the spec
// (tests/e2e/checkout.shapes.spec.ts). It exercises the function output shapes
// the Rust mapping (extensions/won-discounts-engine/src/output.rs) emits that the
// MVP 1 profile never reaches:
//
//   "E2E fix 1000 Kč/ks"  automatic, fixed 1 000,00 Kč PER ITEM on won-e2e-simple-b.
//                         More than the item costs, so planCart caps it at the unit
//                         price (fixedPerItem = unit price) and the function sends
//                         it as 100 %: the line becomes 0.
//   "E2E Pro 10 %"        automatic, 10 % on won-e2e-simple-a  ┐ Pro per-rule
//   "E2E Pro 5 %"         automatic,  5 % on won-e2e-simple-a  ┘ combinesWith: both stack;
//                         planCart plans one stack (fixedTotal T), the function sends
//                         the summed whole percent (15 %) because Math.round(S·15/100) = T.
//
// The fixed amount is CZK only (the checkout runs in market cesko): in EUR/USD
// the rule is `currency_missing`, which the spec never exercises. No code rule:
// every discount here is automatic, so the theme-dev session split of codes
// (see checkout.mvp1.spec.ts) plays no part.

export const SHAPES_PRODUCT_A_HANDLE = "won-e2e-simple-a";
export const SHAPES_PRODUCT_B_HANDLE = "won-e2e-simple-b";
export const SHAPES_HANDLES = [SHAPES_PRODUCT_A_HANDLE, SHAPES_PRODUCT_B_HANDLE];

export const SHAPES_CAP_RULE_ID = "e2e-shapes-cap-fixed";
export const SHAPES_PRO_B_RULE_ID = "e2e-shapes-pro-10";
export const SHAPES_PRO_C_RULE_ID = "e2e-shapes-pro-5";
export const SHAPES_CAP_RULE_NAME = "E2E fix 1000 Kč/ks";
export const SHAPES_PRO_B_RULE_NAME = "E2E Pro 10 %";
export const SHAPES_PRO_C_RULE_NAME = "E2E Pro 5 %";
/** Minor units (haléře): 1 000,00 Kč per item, far above won-e2e-simple-b's CZK price. */
export const SHAPES_CAP_AMOUNT_CZK = 100_000;
export const SHAPES_PRO_B_PERCENT = 10;
export const SHAPES_PRO_C_PERCENT = 5;
export const SHAPES_RULE_IDS = [SHAPES_CAP_RULE_ID, SHAPES_PRO_B_RULE_ID, SHAPES_PRO_C_RULE_ID];

/** Quantities the spec buys: 2 × B shows the per-item cap on every item of the line. */
export const SHAPES_CART = [
  { handle: SHAPES_PRODUCT_A_HANDLE, quantity: 1 },
  { handle: SHAPES_PRODUCT_B_HANDLE, quantity: 2 },
];

/** The three seeded rules; `productIds` maps each handle to its product GID on the store. */
export function shapesRules(productIds) {
  const a = productIds[SHAPES_PRODUCT_A_HANDLE];
  const b = productIds[SHAPES_PRODUCT_B_HANDLE];
  if (!a || !b) throw new Error(`shapesRules needs the GIDs of ${SHAPES_HANDLES.join(" and ")}`);
  return [
    {
      id: SHAPES_CAP_RULE_ID,
      name: SHAPES_CAP_RULE_NAME,
      method: "automatic",
      enabled: true,
      value: { kind: "fixed", amount: { CZK: SHAPES_CAP_AMOUNT_CZK } },
      target: { kind: "products", productIds: [b], variantIds: [] },
    },
    {
      id: SHAPES_PRO_B_RULE_ID,
      name: SHAPES_PRO_B_RULE_NAME,
      method: "automatic",
      enabled: true,
      value: { kind: "percentage", percent: SHAPES_PRO_B_PERCENT },
      target: { kind: "products", productIds: [a], variantIds: [] },
      combinesWith: { ruleIds: [SHAPES_PRO_C_RULE_ID] },
    },
    {
      id: SHAPES_PRO_C_RULE_ID,
      name: SHAPES_PRO_C_RULE_NAME,
      method: "automatic",
      enabled: true,
      value: { kind: "percentage", percent: SHAPES_PRO_C_PERCENT },
      target: { kind: "products", productIds: [a], variantIds: [] },
      combinesWith: { ruleIds: [SHAPES_PRO_B_RULE_ID] },
    },
  ];
}
