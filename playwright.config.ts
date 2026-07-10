import { defineConfig } from "@playwright/test";

const storefrontBaseUrl =
  process.env.SHOPIFY_E2E_STOREFRONT_BASE_URL ||
  "https://b2b-b2c-store-development.myshopify.com";

export default defineConfig({
  testDir: "./tests/e2e",
  // Serial, mutate-per-test suite only. The parallel read-only matrix suite has
  // its own config (playwright.matrix.config.ts) so the two never race on the
  // shared dedicated e2e catalog. Catalog-native (MVP_5_4): each spec seeds onto a
  // fresh e2e catalog and forces it via the gated mg_e2e_audience override, so
  // this tier ALSO runs with the runner-owned MARGIN_GUARD_E2E_OVERRIDE flag.
  testMatch: /storefront\.(smoke|listing|discount-conflict)\.spec\.ts$/,
  fullyParallel: false,
  workers: 1,
  // Higher than the matrix (45s): the serial tier does multiple time-bounded
  // navigations (goto → unlock → goto, reload, cart) per test.
  timeout: 90_000,
  expect: {
    timeout: 12_000,
  },
  // Opt-in local retries (PLAYWRIGHT_RETRIES=2) help ride out the intermittent
  // Cloudflare bot challenge on the PUBLIC storefront; a theme-dev origin needs none.
  retries: process.env.PLAYWRIGHT_RETRIES
    ? Number(process.env.PLAYWRIGHT_RETRIES)
    : process.env.CI
      ? 1
      : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  // Arms the gated override in the app under test (when the harness starts it).
  // reuseExistingServer lets an already-running dev app be reused; to force the
  // e2e catalog that already-running app must itself carry the flag.
  webServer: {
    command: process.env.SHOPIFY_E2E_APP_COMMAND || "npm run dev:e2e",
    url: process.env.SHOPIFY_E2E_APP_URL || storefrontBaseUrl,
    reuseExistingServer: true,
    timeout: 120_000,
    env: {
      MARGIN_GUARD_E2E_OVERRIDE: "1",
      NODE_ENV: "development",
    },
  },
  use: {
    baseURL: storefrontBaseUrl,
    browserName: "chromium",
    headless: process.env.PLAYWRIGHT_HEADLESS !== "0",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
});
