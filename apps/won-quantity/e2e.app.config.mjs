export default {
  appName: "won-quantity",
  workspace: "won-quantity",
  shopDomain: "b2b-b2c-store-development.myshopify.com",
  appProxyProbe: {
    path: "/apps/won-quantity/config",
    bodyMarker: "won-quantity-config-ok",
  },
  testCommand: ["npm", "run", "test:e2e"],
  themes: {
    // The Won Quantity app embed is enabled directly in the shared canonical
    // Horizon/Dawn checkouts, so no per-app settings_data overlay is needed.
    horizon: {
      remoteName: "Horizon",
      preferredPort: 9881,
    },
    dawn: {
      remoteName: "Dawn",
      preferredPort: 9882,
    },
  },
  appStartHint: "npm run dev -w won-quantity",
};
