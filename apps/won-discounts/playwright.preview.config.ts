import { defineConfig } from "@playwright/test";

// The admin in a real browser WITHOUT Shopify: the dev harness (/dev/preview/<screen>, fixtures, no login, no
// database) of a dev server that is already running — `shopify app dev` or `react-router dev`. This suite never
// starts or stops a server and never talks to a shop; the storefront / checkout suite is playwright.config.ts.
//
//   WON_PREVIEW_BASE_URL=http://localhost:<port> npm run test:e2e:preview
//   (the port of the `react-router dev` process: lsof -iTCP -sTCP:LISTEN -P | grep node)

const previewBaseUrl = process.env.WON_PREVIEW_BASE_URL;

if (!previewBaseUrl) {
  throw new Error("WON_PREVIEW_BASE_URL is required: the address of a running dev server, e.g. http://localhost:3000.");
}

export default defineConfig({
  testDir: "./tests/e2e-preview",
  timeout: 30_000,
  expect: { timeout: 5_000 },
  retries: 0,
  workers: 1,
  fullyParallel: false,
  reporter: "list",
  use: {
    baseURL: previewBaseUrl,
    browserName: "chromium",
    headless: process.env.PLAYWRIGHT_HEADLESS !== "0",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
});
