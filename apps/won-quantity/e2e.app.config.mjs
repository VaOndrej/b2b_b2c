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
    horizon: {
      remoteName: "Won Quantity — Horizon",
      settingsDataOverlay: "tests/themes/horizon.settings_data.json",
      preferredPort: 9881,
    },
    dawn: {
      remoteName: "Won Quantity — Dawn",
      settingsDataOverlay: "tests/themes/dawn.settings_data.json",
      preferredPort: 9882,
    },
  },
  appStartHint: "npm run dev -w won-quantity",
};
