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
  // Retry transient theme-dev/proxy flakes (e.g. the Liquid embed occasionally
  // not attaching in time). A real logic bug fails on the retry too, so this
  // never masks correctness — it only absorbs infra hiccups. The matrix runner
  // sets PLAYWRIGHT_RETRIES=1; honour it here (default 1 locally).
  retries: Number(process.env.PLAYWRIGHT_RETRIES ?? 1),
  // One worker: the spec files share a single live dev store + a latency-bound
  // theme-dev proxy, so running files in parallel only causes resource
  // contention and timing flakiness. Serial is deterministic here.
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
