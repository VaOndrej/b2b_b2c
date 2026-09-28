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
  // The matrix runner sets PLAYWRIGHT_RETRIES=1 to absorb theme-dev proxy
  // hiccups; a real bug fails the retry too. The list reporter marks any test
  // that only passed on retry as "flaky", so a retry never hides silently.
  retries: Number(process.env.PLAYWRIGHT_RETRIES ?? 0),
  // One live dev store behind one latency-bound theme-dev proxy: run serially.
  workers: 1,
  fullyParallel: false,
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
