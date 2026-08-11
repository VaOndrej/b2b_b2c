import { defineConfig } from '@playwright/test';

// Storefront smoke/regression harness for the Won theme demo store.
// Base URL comes from a running `shopify theme dev` (never production — the
// storefront is password-protected). Two projects = Horizon's two breakpoints.
//
// REQUIRED STORE: run `shopify theme dev -e horizon` — the `horizon` env in
// shopify.theme.toml points at b2b-b2c-store-development.myshopify.com, the ONLY
// store with the demo catalog storefront.spec.ts expects. Any other store (e.g.
// therabeast) 404s on the demo products/collections → ~13 false failures.
const baseURL = process.env.SHOP_URL || 'http://127.0.0.1:9292';

export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: [['list'], ['json', { outputFile: 'tmp/theme-audit-runs/report.json' }]],
  use: {
    baseURL,
    trace: 'off',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'desktop', use: { viewport: { width: 1440, height: 1000 } } },
    { name: 'mobile', use: { viewport: { width: 390, height: 844 } } },
  ],
});
