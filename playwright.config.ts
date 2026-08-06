import { defineConfig } from '@playwright/test';

// Storefront smoke/regression harness for the Won theme demo store.
// Base URL comes from a running `shopify theme dev` (never production — the
// storefront is password-protected). Two projects = Horizon's two breakpoints.
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
