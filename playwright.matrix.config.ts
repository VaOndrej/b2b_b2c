import { defineConfig } from "@playwright/test";
import type { ThemeOptions } from "./tests/e2e/support/fixtures.ts";

/**
 * Parallel, read-only Tier-1 matrix: theme × segment. All Margin Guard rules are
 * seeded once in globalSetup (matrix.setup.ts), so every spec is read-only and
 * safe to run fully in parallel. The serial, mutate-per-test shop-level tier
 * (smoke / listing / cart-enforcement + global toggles) stays in
 * playwright.config.ts and runs once, after this matrix — see
 * scripts/run-playwright-e2e.mjs.
 *
 * The SAME `storefront.matrix.spec.ts` runs under four projects:
 *   - tier1-horizon-b2c  (live Horizon theme,         mg_e2e_segment=B2C)
 *   - tier1-dawn-b2c     (Dawn via preview_theme_id,   mg_e2e_segment=B2C)
 *   - tier1-horizon-b2b  (live Horizon theme,         mg_e2e_segment=B2B)
 *   - tier1-dawn-b2b     (Dawn via preview_theme_id,   mg_e2e_segment=B2B)
 *
 * Theme + segment are injected via project `use` and asserted per-segment. The
 * two B2B projects declare `dependencies` on BOTH B2C projects, so Playwright
 * runs ALL B2C first (Horizon + Dawn in parallel) and only then the B2B pair —
 * no manual segment switching. The Dawn projects skip when
 * SHOPIFY_E2E_PREVIEW_THEME_ID is unset.
 *
 * The forced segment is honored ONLY because the app under test runs with the
 * runner-owned MARGIN_GUARD_E2E_OVERRIDE=1 flag (webServer.env below). That flag
 * lives only here / in the runner for the test duration — never in .env or git —
 * and is a hard no-op in production builds.
 */

const MATRIX_SPEC = /storefront\.matrix\.spec\.ts$/;
const B2C_PROJECTS = ["tier1-horizon-b2c", "tier1-dawn-b2c"];

const storefrontBaseUrl =
  process.env.SHOPIFY_E2E_STOREFRONT_BASE_URL ||
  "https://b2b-b2c-store-development.myshopify.com";

export default defineConfig<ThemeOptions>({
  testDir: "./tests/e2e",
  fullyParallel: true,
  workers: process.env.PLAYWRIGHT_WORKERS
    ? Number(process.env.PLAYWRIGHT_WORKERS)
    : undefined,
  timeout: 45_000,
  expect: { timeout: 12_000 },
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  globalSetup: "./tests/e2e/matrix.setup.ts",
  globalTeardown: "./tests/e2e/matrix.teardown.ts",
  // Starts the app under test WITH the gated override flag. The flag is owned by
  // the test harness (here + the runner), never by .env/git. `reuseExistingServer`
  // lets an already-running dev app (the common remote dev-store flow) be reused;
  // when the harness starts the app itself it carries the flag. NODE_ENV is kept
  // non-production so the gated override stays armed for the test run only.
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
  projects: [
    {
      name: "tier1-horizon-b2c",
      testMatch: MATRIX_SPEC,
      use: { theme: "horizon", segment: "B2C" },
    },
    {
      name: "tier1-dawn-b2c",
      testMatch: MATRIX_SPEC,
      use: { theme: "dawn", segment: "B2C" },
    },
    {
      name: "tier1-horizon-b2b",
      testMatch: MATRIX_SPEC,
      use: { theme: "horizon", segment: "B2B" },
      dependencies: B2C_PROJECTS,
    },
    {
      name: "tier1-dawn-b2b",
      testMatch: MATRIX_SPEC,
      use: { theme: "dawn", segment: "B2B" },
      dependencies: B2C_PROJECTS,
    },
  ],
});
