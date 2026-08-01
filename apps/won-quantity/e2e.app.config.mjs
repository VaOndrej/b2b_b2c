export default {
  appName: "won-quantity",
  shopDomain: "b2b-b2c-store-development.myshopify.com",
  appProxyProbe: {
    path: "/apps/won-quantity/health",
    bodyMarker: "won-quantity-ok",
  },
  testCommand: ["npm", "run", "test:e2e"],
  themes: {
    horizon: { remoteName: "Horizon" },
    dawn: { remoteName: "Dawn" },
  },
};
