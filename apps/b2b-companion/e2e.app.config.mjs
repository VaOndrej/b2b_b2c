export default {
  appName: "b2b-companion",
  shopDomain: "b2b-b2c-store-development.myshopify.com",
  appProxyProbe: {
    path: "/apps/margin-guard/visibility-script",
    bodyMarker: "DEFAULT_PROXY_PREFIX",
  },
  testCommand: ["node", "./scripts/run-playwright-e2e.mjs"],
  themes: {
    horizon: { remoteName: "Horizon" },
    dawn: { remoteName: "Dawn" },
  },
  environment: {
    SHOPIFY_E2E_PRODUCT_HANDLE_VISIBILITY: "mg-e2e-hidden",
    SHOPIFY_E2E_PRODUCT_HANDLE_STEP: "mg-e2e-moq-step",
    SHOPIFY_E2E_PRODUCT_HANDLE_MAX: "mg-e2e-max",
    SHOPIFY_E2E_PRODUCT_HANDLE_VARIANT: "mg-e2e-variant-hidden",
    SHOPIFY_E2E_PRODUCT_HANDLE_COLLECTION: "mg-e2e-collection-member",
    SHOPIFY_E2E_COLLECTION_ID: "gid://shopify/Collection/466006212849",
  },
  appStartHint: "MARGIN_GUARD_E2E_OVERRIDE=1 npm run dev -w b2b-companion",
};
