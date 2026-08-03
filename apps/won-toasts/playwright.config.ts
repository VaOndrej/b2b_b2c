import { defineConfig } from "@playwright/test";

const storefrontBaseUrl = process.env.SHOPIFY_E2E_STOREFRONT_BASE_URL;

if (!storefrontBaseUrl) {
  throw new Error(
    "SHOPIFY_E2E_STOREFRONT_BASE_URL is required for this app's E2E suite.",
  );
}

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 45_000,
  expect: { timeout: 12_000 },
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: storefrontBaseUrl,
    browserName: "chromium",
    headless: process.env.PLAYWRIGHT_HEADLESS !== "0",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
});
