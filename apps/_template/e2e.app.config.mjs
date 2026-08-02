export default {
  // Replace every REPLACE_ME value while naming/scaffolding the new app. The
  // template E2E guard refuses to run until the app owns a real proxy contract.
  appName: "REPLACE_ME",
  workspace: "replace-me",
  shopDomain: "REPLACE_ME.myshopify.com",
  appProxyProbe: {
    path: "/apps/REPLACE_ME/health",
    bodyMarker: "REPLACE_ME",
  },
  testCommand: ["npm", "run", "test:e2e"],
  themes: {
    horizon: { remoteName: "Horizon", preferredPort: 9981 },
    dawn: { remoteName: "Dawn", preferredPort: 9982 },
  },
};
