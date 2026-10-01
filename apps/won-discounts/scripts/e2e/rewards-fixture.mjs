// The cart rewards E2E fixture (MVP 4, Task 8), shared by the seed
// (scripts/e2e/seed-mvp1.mjs --profile rewards|rewards-other|rewards-pro) and the
// spec (tests/e2e/storefront.rewards.spec.ts).
//
// Phase A (Free):
//   rewards        free shipping from 40 Kč / 2 €; a gift (won-e2e-spare, 1 item
//                  free) from 50 Kč / 3 €; thresholds counted before discounts.
//   rewards-other  the same with countOtherDiscounts on + code WONE2EDAR (50 % on
//                  the order): a cart of 60 Kč reaches the gift, the code takes
//                  it to 30 Kč → the cart warns and offers keep / remove.
// Phase B (Pro, rewards-pro): a ladder — the spare from 50 Kč / 3 €, then a
// choice of 3 (won-e2e-simple-b, won-e2e-two-variants Small, won-e2e-multiaxis
// first variant) from 80 Kč / 4 €.
// Catalog (CZK base): simple-a 10 Kč (the cart's product), spare 199 Kč in the
// cesko price list; Slovakia converts (no fixed prices). The expectations are
// never these numbers: the spec computes them with planCart on the live config.

export const REWARDS_GIFT_TIER_ID = "e2e-gift";
export const REWARDS_LADDER_TIER_ID = "e2e-gift-choice";
export const REWARDS_CODE_RULE_ID = "e2e-rewards-code";
export const REWARDS_CODE = "WONE2EDAR";
export const REWARDS_CODE_PERCENT = 50;

export const REWARDS_CART_HANDLE = "won-e2e-simple-a";
export const REWARDS_GIFT_HANDLE = "won-e2e-spare";
export const REWARDS_CHOICE_HANDLES = ["won-e2e-simple-b", "won-e2e-two-variants", "won-e2e-multiaxis"];
/** Every product the seed reads a variant of (the gift, the Pro choices) and the spec's cart product. */
export const REWARDS_HANDLES = [REWARDS_CART_HANDLE, REWARDS_GIFT_HANDLE, ...REWARDS_CHOICE_HANDLES];

export const REWARDS_SHIPPING = { CZK: 40_00, EUR: 2_00 };
export const REWARDS_GIFT_THRESHOLD = { CZK: 50_00, EUR: 3_00 };
export const REWARDS_LADDER_THRESHOLD = { CZK: 80_00, EUR: 4_00 };

/** Every E2E gift tier id: a cleanup without a backup resets rewards holding one, and they mean "the seed is in it". */
export const ALL_REWARDS_TIER_IDS = [REWARDS_GIFT_TIER_ID, REWARDS_LADDER_TIER_ID];

/** modules.rewards of the seed config; `variantIds` = the first variant GID per handle. */
export function rewardsModule(variantIds, { other = false, pro = false } = {}) {
  const gifts = [
    {
      id: REWARDS_GIFT_TIER_ID,
      threshold: { ...REWARDS_GIFT_THRESHOLD },
      choices: [variantIds[REWARDS_GIFT_HANDLE]],
    },
  ];
  if (pro) {
    gifts.push({
      id: REWARDS_LADDER_TIER_ID,
      threshold: { ...REWARDS_LADDER_THRESHOLD },
      choices: REWARDS_CHOICE_HANDLES.map((handle) => variantIds[handle]),
      fallbackVariantId: variantIds[REWARDS_GIFT_HANDLE],
    });
  }
  return {
    freeShipping: { threshold: { ...REWARDS_SHIPPING } },
    gifts,
    countOtherDiscounts: other,
    giftDeclinable: true,
  };
}

/** The code rule of rewards-other: 50 % on the order. */
export function rewardsRules() {
  return [
    {
      id: REWARDS_CODE_RULE_ID,
      name: "E2E dárek kód",
      method: "code",
      enabled: true,
      codes: [REWARDS_CODE],
      value: { kind: "percentage", percent: REWARDS_CODE_PERCENT },
      target: { kind: "order" },
    },
  ];
}
