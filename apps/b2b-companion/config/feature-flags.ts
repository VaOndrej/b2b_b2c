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

// MVP_5_0_2: storefront projection behaviour.
// - syncOnSettingsLoad: when true, the app.settings loader refreshes the
//   shop.metafields.margin_guard.storefront_projection on every load. Default
//   false — the projection is kept fresh by the rule-change and catalog-sync
//   action handlers, so refreshing it on every render is redundant GraphQL traffic.
// - debug: verbose console logging in the storefront projection sync and the
//   generated storefront visibility script. Default off in production.
export const storefrontProjection = {
  syncOnSettingsLoad: process.env.MARGIN_GUARD_PROJECTION_SYNC_ON_LOAD === "1",
  debug: process.env.MARGIN_GUARD_STOREFRONT_DEBUG === "1",
} as const;
