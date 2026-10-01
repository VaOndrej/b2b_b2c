import { tiersTemplateOverlays } from "./scripts/make-e2e-overlay.mjs";

export default {
  appName: "won-discounts",
  workspace: "won-discounts",
  shopDomain: "b2b-b2c-store-development.myshopify.com",
  appProxyProbe: {
    path: "/apps/won-discounts/health",
    bodyMarker: "won-discounts-health-ok",
  },
  testCommand: ["npm", "run", "test:e2e"],
  // The overlays switch the Won Discounts app embed ON in each theme copy, so
  // the E2E never depends on a manual theme-editor step. They are the whole
  // canonical settings_data.json + our embed block, generated (and drift-
  // checked with --check) by `node scripts/make-e2e-overlay.mjs`.
  // templateOverlays (MVP 3) put the quantity tiers app block into each theme
  // copy's product template (Horizon: inside _product-details; Dawn: in
  // main-product), planned by the same script's --check.
  themes: {
    horizon: {
      remoteName: "Horizon",
      preferredPort: 9885,
      settingsDataOverlay: "e2e/settings_data.horizon.json",
      templateOverlays: tiersTemplateOverlays("horizon"),
    },
    dawn: {
      remoteName: "Dawn",
      preferredPort: 9886,
      settingsDataOverlay: "e2e/settings_data.dawn.json",
      templateOverlays: tiersTemplateOverlays("dawn"),
    },
  },
  appStartHint: "npm run dev -w won-discounts",
};
