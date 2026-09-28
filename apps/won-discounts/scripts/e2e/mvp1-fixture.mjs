// The MVP 1 checkout E2E fixture, shared by the seed (scripts/e2e/seed-mvp1.mjs)
// and the spec (tests/e2e/checkout.mvp1.spec.ts), so both name the same rules.
//
//   "E2E auto 10 %"  automatic, 10 % on won-e2e-simple-a (product target)
//   "E2E kód"        code WONE2E15, 15 % on the order
//
// Both values are percentages: they hold in every currency the markets use
// (cesko CZK, slovensko EUR, base USD) with no per-currency amount to convert.
// Neither rule has a fixed amount or a minimum, the only config fields that are
// per currency (MoneyByCurrency) and that the engine gates on (`currency_missing`).

export const E2E_PRODUCT_HANDLE = "won-e2e-simple-a";
export const E2E_CODE = "WONE2E15";
export const E2E_AUTO_RULE_ID = "e2e-mvp1-auto-10";
export const E2E_CODE_RULE_ID = "e2e-mvp1-code-15";
export const E2E_AUTO_RULE_NAME = "E2E auto 10 %";
export const E2E_CODE_RULE_NAME = "E2E kód";
export const E2E_AUTO_PERCENT = 10;
export const E2E_CODE_PERCENT = 15;
export const E2E_RULE_IDS = [E2E_AUTO_RULE_ID, E2E_CODE_RULE_ID];

/** The two seeded rules; `productId` is the GID of won-e2e-simple-a on the store. */
export function e2eRules(productId) {
  return [
    {
      id: E2E_AUTO_RULE_ID,
      name: E2E_AUTO_RULE_NAME,
      method: "automatic",
      enabled: true,
      value: { kind: "percentage", percent: E2E_AUTO_PERCENT },
      target: { kind: "products", productIds: [productId], variantIds: [] },
    },
    {
      id: E2E_CODE_RULE_ID,
      name: E2E_CODE_RULE_NAME,
      method: "code",
      enabled: true,
      codes: [E2E_CODE],
      value: { kind: "percentage", percent: E2E_CODE_PERCENT },
      target: { kind: "order" },
    },
  ];
}
