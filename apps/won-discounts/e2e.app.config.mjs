export default {
  appName: "won-discounts",
  workspace: "won-discounts",
  shopDomain: "b2b-b2c-store-development.myshopify.com",
  appProxyProbe: {
    path: "/apps/won-discounts/health",
    bodyMarker: "won-discounts-health-ok",
  },
  testCommand: ["npm", "run", "test:e2e"],
  themes: {
    horizon: { remoteName: "Horizon", preferredPort: 9885 },
    dawn: { remoteName: "Dawn", preferredPort: 9886 },
  },
  appStartHint: "npm run dev -w won-discounts",
};
