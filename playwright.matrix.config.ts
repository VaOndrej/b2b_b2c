import { defineConfig } from "@playwright/test";
import type { ThemeOptions } from "./tests/e2e/support/fixtures.ts";
import { E2E_CATALOG_AUDIENCE_TAG } from "./tests/e2e/support/catalog-context.ts";

/**
 * Parallel, read-only Tier-1 matrix: theme × CONTEXT. All rules are seeded once in
 * globalSetup (matrix.setup.ts) onto the dedicated e2e catalog, so every spec is
 * read-only and safe to run fully in parallel. The serial, mutate-per-test tier
 * (smoke / listing / discount-conflict) stays in playwright.config.ts and runs
 * once, after this matrix — see scripts/run-playwright-e2e.mjs.
 *
 * The SAME `storefront.matrix.spec.ts` runs under four projects:
 *   - tier1-horizon-base     (live Horizon theme,        no override → default)
 *   - tier1-dawn-base        (Dawn via preview_theme_id,  no override → default)
 *   - tier1-horizon-catalog  (live Horizon theme,        mg_e2e_audience=<e2e tag>)
 *   - tier1-dawn-catalog     (Dawn via preview_theme_id,  mg_e2e_audience=<e2e tag>)
 *
 * Theme + context are injected via project `use` and asserted per-context (`base`
 * = unrestricted, `catalog` = the seeded restrictive rule applies). The Dawn
 * projects skip when SHOPIFY_E2E_PREVIEW_THEME_ID is unset. All four are
 * read-only against the same seeded catalog, so no inter-project dependency is
 * needed.
 *
 * The forced audience is honored ONLY because the app under test runs with the
 * runner-owned MARGIN_GUARD_E2E_OVERRIDE=1 flag (webServer.env below). That flag
 * lives only here / in the runner for the test duration — never in .env or git —
 * and is a hard no-op in production builds.
 */

const MATRIX_SPEC = /storefront\.matrix\.spec\.ts$/;

const storefrontBaseUrl =
  process.env.SHOPIFY_E2E_STOREFRONT_BASE_URL ||
  "https://b2b-b2c-store-development.myshopify.com";

type MatrixProject = { name: string; testMatch: RegExp; use: ThemeOptions };

// Remote run: the full theme × context matrix (Horizon live + Dawn via preview_theme_id).
const REMOTE_PROJECTS = [
  {
    name: "tier1-horizon-base",
    testMatch: MATRIX_SPEC,
    use: { theme: "horizon", testContext: "base", audience: null },
  },
  {
    name: "tier1-dawn-base",
    testMatch: MATRIX_SPEC,
    use: { theme: "dawn", testContext: "base", audience: null },
  },
  {
    name: "tier1-horizon-catalog",
    testMatch: MATRIX_SPEC,
    use: { theme: "horizon", testContext: "catalog", audience: E2E_CATALOG_AUDIENCE_TAG },
  },
  {
    name: "tier1-dawn-catalog",
    testMatch: MATRIX_SPEC,
    use: { theme: "dawn", testContext: "catalog", audience: E2E_CATALOG_AUDIENCE_TAG },
  },
] satisfies MatrixProject[];

// Local `shopify theme dev` run (SHOPIFY_E2E_THEME_DEV, set by test-e2e-local.mjs):
// the origin serves ONE theme and the suite is theme-agnostic, so collapse to the
// context dimension only (base vs forced e2e catalog) against whatever is served.
// `theme` here is just a label — its guard/selectors are theme-neutral in theme-dev mode.
const THEME_DEV_PROJECTS = [
  {
    name: "local-base",
    testMatch: MATRIX_SPEC,
    use: { theme: "horizon", testContext: "base", audience: null },
  },
  {
    name: "local-catalog",
    testMatch: MATRIX_SPEC,
    use: { theme: "horizon", testContext: "catalog", audience: E2E_CATALOG_AUDIENCE_TAG },
  },
] satisfies MatrixProject[];

const projects = process.env.SHOPIFY_E2E_THEME_DEV
  ? THEME_DEV_PROJECTS
  : REMOTE_PROJECTS;

export default defineConfig<ThemeOptions>({
  testDir: "./tests/e2e",
  fullyParallel: true,
  workers: process.env.PLAYWRIGHT_WORKERS
    ? Number(process.env.PLAYWRIGHT_WORKERS)
    : undefined,
  timeout: 45_000,
  expect: { timeout: 12_000 },
  // Opt-in local retries (PLAYWRIGHT_RETRIES=2) help ride out the intermittent
  // Cloudflare bot challenge on the PUBLIC storefront; a theme-dev origin needs none.
  retries: process.env.PLAYWRIGHT_RETRIES
    ? Number(process.env.PLAYWRIGHT_RETRIES)
    : process.env.CI
      ? 1
      : 0,
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
  projects,
});
