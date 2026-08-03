export default {
  appName: "won-toasts",
  workspace: "won-toasts",
  shopDomain: "b2b-b2c-store-development.myshopify.com",
  appProxyProbe: {
    path: "/apps/won-toasts/config",
    bodyMarker: "won-toasts-config-ok",
  },
  testCommand: ["npm", "run", "test:e2e"],
  themes: {
    horizon: {
      remoteName: "Horizon",
      preferredPort: 9883,
    },
    dawn: {
      remoteName: "Dawn",
      preferredPort: 9884,
    },
  },
  appStartHint: "npm run dev -w won-toasts",
};
