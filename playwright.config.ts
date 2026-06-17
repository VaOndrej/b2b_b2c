import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  // Serial, mutate-per-test suite only. The parallel read-only matrix suite has
  // its own config (playwright.matrix.config.ts) so the two never race on the
  // shared MarginGuardConfig row / storefront_projection metafield.
  testMatch: /storefront\.(smoke|listing|cart-enforcement)\.spec\.ts$/,
  fullyParallel: false,
  workers: 1,
  timeout: 45_000,
  expect: {
    timeout: 12_000,
  },
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: process.env.SHOPIFY_E2E_STOREFRONT_BASE_URL,
    browserName: "chromium",
    headless: process.env.PLAYWRIGHT_HEADLESS !== "0",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
});
