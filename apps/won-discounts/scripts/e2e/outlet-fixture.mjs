// The MVP 5 (Výprodej) E2E fixture, shared by the seed (scripts/e2e/seed-mvp1.mjs --profile outlet), the sale
// script (scripts/e2e/outlet.mjs) and the spec (tests/e2e/storefront.outlet.spec.ts), so all name the same things.
//
//   "E2E výprodej auto 10 %"  automatic, 10 % on won-e2e-two-variants and won-e2e-spare (product target)
//   "E2E výprodej kód"        code WONE2EVYP, 20 % on the order
//   sales (Pro, outlet.mjs --start):
//     won-e2e-two-variants Large  −25 % (18 Kč → 13,50 Kč), quota 3, no price list — Small stays a normal item
//     won-e2e-spare               −50 %, quota 2, the price list of the market "česko" (fixed 199 Kč → 99,50 Kč)
// Percentages only: they hold in every currency (cesko CZK, slovensko EUR) with nothing to convert.

export const OUTLET_HANDLES = ["won-e2e-two-variants", "won-e2e-spare"];
export const OUTLET_AUTO_RULE_ID = "e2e-outlet-auto-10";
export const OUTLET_CODE_RULE_ID = "e2e-outlet-code-20";
export const OUTLET_CODE = "WONE2EVYP";
export const OUTLET_RULE_IDS = [OUTLET_AUTO_RULE_ID, OUTLET_CODE_RULE_ID];
export const OUTLET_AUTO_PERCENT = 10;
export const OUTLET_CODE_PERCENT = 20;

// `before`: the catalog price the sale starts from (minor units, CZK): the base price of Large, the česko fixed
// price of the spare. The spec computes the sale prices from it (the storefront shows no compare-at for a variant
// priced by a market price list's adjustment: live fact F-O3).
export const OUTLET_SALES = [
  { handle: "won-e2e-two-variants", variant: "Large", percent: 25, quota: 3, catalogs: [], before: 1800 },
  { handle: "won-e2e-spare", variant: null, percent: 50, quota: 2, catalogs: ["česko"], before: 19900 },
];

/** The seeded rules; `ids` maps each handle to its product GID on the store. */
export function outletRules(ids) {
  return [
    {
      id: OUTLET_AUTO_RULE_ID,
      name: "E2E výprodej auto 10 %",
      method: "automatic",
      enabled: true,
      value: { kind: "percentage", percent: OUTLET_AUTO_PERCENT },
      target: { kind: "products", productIds: OUTLET_HANDLES.map((h) => ids[h]), variantIds: [] },
    },
    {
      id: OUTLET_CODE_RULE_ID,
      name: "E2E výprodej kód",
      method: "code",
      enabled: true,
      codes: [OUTLET_CODE],
      value: { kind: "percentage", percent: OUTLET_CODE_PERCENT },
      target: { kind: "order" },
    },
  ];
}
