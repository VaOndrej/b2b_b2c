import { spawnSync } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

/**
 * Deterministically-green storefront E2E against a LOCAL `shopify theme dev` origin
 * (MVP_5_5). The local origin never serves the Cloudflare bot challenge — the browser
 * talks only to localhost and `/apps/*` is forwarded to the store. theme dev serves
 * exactly ONE theme (the checkout it runs from), and the suite is theme-agnostic
 * (shared selectors, app-proxy / app-injected assertions), so it just runs against
 * whatever theme dev is serving — YOU pick the theme by which checkout you start.
 *
 *   # terminal 1 (app-proxy + gated override armed):
 *   MARGIN_GUARD_E2E_OVERRIDE=1 shopify app dev
 *   # terminal 2 (local storefront — any theme checkout):
 *   shopify theme dev --store b2b-b2c-store-development.myshopify.com
 *   # terminal 3:
 *   npm run test:e2e:local                       (theme dev on the default :9292)
 *   npm run test:e2e:local -- --port 53142       (theme dev on another port)
 *   npm run test:e2e:local -- --url http://127.0.0.1:53142
 *
 * The wrapper is the single boundary that sets the local env contract every
 * downstream layer already reads:
 *   - SHOPIFY_E2E_THEME_DEV=1      → matrix collapses to the context dimension only
 *                                    (base + forced e2e catalog), theme.ts skips the
 *                                    theme guard (no theme dimension to verify).
 *   - SHOPIFY_E2E_STOREFRONT_BASE_URL → the local theme-dev origin (--url/--port win,
 *                                    then a pre-set env, then the :9292 default).
 *   - SHOPIFY_E2E_SHOP_DOMAIN      → real shop for the Admin API handle lookup
 *                                    (the 127.0.0.1 host is not the Admin shop).
 *   - SHOPIFY_E2E_PREVIEW_THEME_ID → cleared (a remote-only mechanism).
 * It owns NOTHING about the override flag (the runner does) and does NOT spawn theme
 * dev (it runs from a separate theme checkout outside this app repo).
 */

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");
const runnerPath = path.join(__dirname, "run-playwright-e2e.mjs");

const DEFAULT_LOCAL_BASE_URL = "http://127.0.0.1:9292";
const DEFAULT_SHOP_DOMAIN = "b2b-b2c-store-development.myshopify.com";

function fail(message) {
  console.error(message);
  console.error(
    "Usage: npm run test:e2e:local [-- --port <n> | --url <origin>]\n" +
      "  Runs the storefront E2E suite against a local `shopify theme dev` origin.\n" +
      "  theme dev's port is not fixed; pass --port/--url when it is not :9292.",
  );
  process.exit(2);
}

// Optional --url <origin> | --port <n> (theme dev's port is not deterministic).
function parseBaseUrl(argv) {
  let url = null;
  let port = null;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--url" || arg === "-u") {
      url = argv[++i];
    } else if (arg.startsWith("--url=")) {
      url = arg.slice("--url=".length);
    } else if (arg === "--port" || arg === "-p") {
      port = argv[++i];
    } else if (arg.startsWith("--port=")) {
      port = arg.slice("--port=".length);
    } else {
      fail(`Unknown argument: ${arg}`);
    }
  }

  if (url && port) {
    fail("Pass either --url or --port, not both.");
  }
  if (url) {
    if (!/^https?:\/\//i.test(url)) {
      fail(`--url must start with http:// or https:// (got: ${url}).`);
    }
    return url;
  }
  if (port != null) {
    const portNum = Number(port);
    if (!Number.isInteger(portNum) || portNum <= 0 || portNum > 65535) {
      fail(`--port must be a valid port number (got: ${port}).`);
    }
    return `http://127.0.0.1:${portNum}`;
  }
  return null;
}

const baseUrlFromArgs = parseBaseUrl(process.argv.slice(2));

const env = { ...process.env };
env.SHOPIFY_E2E_THEME_DEV = "1";
// Precedence: explicit --url/--port > a pre-set env > the :9292 default.
env.SHOPIFY_E2E_STOREFRONT_BASE_URL =
  baseUrlFromArgs || env.SHOPIFY_E2E_STOREFRONT_BASE_URL || DEFAULT_LOCAL_BASE_URL;
env.SHOPIFY_E2E_SHOP_DOMAIN = env.SHOPIFY_E2E_SHOP_DOMAIN || DEFAULT_SHOP_DOMAIN;
// Empty (not deleted): an empty process.env value wins over a non-empty .env entry
// in the runner's merge, and theme.ts/warmup read process.env-only so "" → absent.
env.SHOPIFY_E2E_PREVIEW_THEME_ID = "";

const result = spawnSync(process.execPath, [runnerPath], {
  cwd: projectRoot,
  env,
  stdio: "inherit",
});

if (result.error) {
  throw result.error;
}
process.exit(result.status ?? 0);
