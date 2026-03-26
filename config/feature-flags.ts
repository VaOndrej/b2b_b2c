export const featureFlags = {
  // Margin guard core remains enabled.
  enableMVP1: true,
  // Advanced discount orchestration is now part of the active rollout.
  enableMVP2: false,
  enableMVP3: false,
  enableMVP4: true,
  enableMVP5: false,
  enableMVP6: false,
} as const;

export const discountFunctionPolicy = {
  allowDiscountFunction: featureFlags.enableMVP4,
} as const;
