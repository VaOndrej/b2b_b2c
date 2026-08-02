import { defineConfig } from "@playwright/test";

const storefrontBaseUrl =
  process.env.SHOPIFY_E2E_STOREFRONT_BASE_URL ||
  "https://b2b-b2c-store-development.myshopify.com";

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: /storefront\.quantity\.spec\.ts$/u,
  globalSetup: "./tests/e2e/global.setup.ts",
  globalTeardown: "./tests/e2e/global.teardown.ts",
  fullyParallel: false,
  workers: 1,
  timeout: 45_000,
  expect: { timeout: 12_000 },
  retries: process.env.PLAYWRIGHT_RETRIES
    ? Number(process.env.PLAYWRIGHT_RETRIES)
    : process.env.CI
      ? 1
      : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: storefrontBaseUrl,
    browserName: "chromium",
    headless: process.env.PLAYWRIGHT_HEADLESS !== "0",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    { name: "desktop", use: { viewport: { width: 1440, height: 1000 } } },
    { name: "mobile", use: { viewport: { width: 390, height: 844 } } },
  ],
});
