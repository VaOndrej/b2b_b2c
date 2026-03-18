export const featureFlags = {
  // Margin guard core remains enabled.
  enableMVP1: true,
  // Discount function stays disabled by current rollout policy.
  enableMVP2: false,
  enableMVP3: false,
  enableMVP4: false,
  enableMVP5: false,
  enableMVP6: false,
} as const;

export const discountFunctionPolicy = {
  allowDiscountFunction: featureFlags.enableMVP2,
} as const;
