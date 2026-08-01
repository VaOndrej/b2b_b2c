import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import net from "node:net";
import path from "node:path";
import process from "node:process";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";

/**
 * ONE command: run the storefront E2E suite against a LOCAL `shopify theme dev`
 * origin for BOTH themes (Horizon + Dawn), sequentially (MVP_5_5).
 *
 *   # terminal 1 (app-proxy + gated override armed):
 *   MARGIN_GUARD_E2E_OVERRIDE=1 shopify app dev
 *   # terminal 2:
 *   npm run test:e2e:local:all
 *
 * WHY SEQUENTIAL, not parallel: both tiers force the ONE dedicated e2e catalog
 * (`mg-e2e-catalog`) on the shared dev store, and the serial tier mutates it
 * per-test. Two concurrent theme runs would race on that catalog and on the
 * globalSetup/globalTeardown lifecycle. Wall-clock is not the constraint here.
 *
 * WHY IT SPAWNS theme dev (unlike test-e2e-local.mjs, which does not): a
 * two-theme run needs two different theme checkouts served in turn, which no
 * human wants to shepherd across terminals. The cost is that this script knows
 * where the theme checkouts live — override with SHOPIFY_E2E_THEME_DIR_{HORIZON,DAWN}.
 *
 * Per theme it: picks a free port -> spawns `shopify theme dev --path <dir>` ->
 * waits for the origin to serve -> preflights the app proxy -> delegates to the
 * SAME runner every other entrypoint uses -> tears the theme dev down.
 *
 * It owns NOTHING about MARGIN_GUARD_E2E_OVERRIDE (the runner owns that flag).
 */

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");
const runnerPath = path.join(__dirname, "run-playwright-e2e.mjs");
const dotenvPath = path.join(projectRoot, ".env");

const DEFAULT_SHOP_DOMAIN = "b2b-b2c-store-development.myshopify.com";
const DEFAULT_THEME_DEV_TIMEOUT_MS = 240_000;
const APP_PROXY_PROBE_PATH = "/apps/margin-guard/visibility-script";

/**
 * Pinned test data. Dedicated products created 2026-07-10 (one per archetype) so the
 * tested product↔archetype mapping is STABLE — a catalog re-sync can no longer shuffle
 * which product is HIDDEN vs MAX. See the REFERENCE block in readme.txt.
 */
const PINNED_PRODUCT_HANDLES = {
  SHOPIFY_E2E_PRODUCT_HANDLE_VISIBILITY: "mg-e2e-hidden",
  SHOPIFY_E2E_PRODUCT_HANDLE_STEP: "mg-e2e-moq-step",
  SHOPIFY_E2E_PRODUCT_HANDLE_MAX: "mg-e2e-max",
  SHOPIFY_E2E_PRODUCT_HANDLE_VARIANT: "mg-e2e-variant-hidden",
  // COLLECTION_MAX: the member product + the collection GID whose max rule it inherits
  // (membership resolved live at storefront time, so the collection id must be pinned).
  SHOPIFY_E2E_PRODUCT_HANDLE_COLLECTION: "mg-e2e-collection-member",
  SHOPIFY_E2E_COLLECTION_ID: "gid://shopify/Collection/466006212849",
};

/**
 * Preferred ports deliberately far from theme dev's :9292 default (and :9293+,
 * which it auto-picks): those belong to the OTHER local theme dev sessions the
 * user runs for client themes. A busy preferred port is not fatal — we fall back
 * to a free ephemeral one and say so.
 */
const PREFERRED_PORTS = { horizon: 9781, dawn: 9782 };

// The theme checkouts live OUTSIDE this app repo (separate repo, one dir per theme).
// Each syncs into its own named remote theme; `theme dev` pushes edits there in real
// time, so both MUST stay unpublished. The CLI refuses a live theme unless given
// --allow-live, which this script never passes — a live target fails fast instead.
const THEMES = [
  {
    key: "horizon",
    label: "Horizon",
    dirEnv: "SHOPIFY_E2E_THEME_DIR_HORIZON",
    defaultDir: path.resolve(projectRoot, "..", "b2b_b2c_themes", "Horizon"),
    nameEnv: "SHOPIFY_E2E_THEME_NAME_HORIZON",
    defaultName: "Horizon",
    portEnv: "SHOPIFY_E2E_THEME_PORT_HORIZON",
  },
  {
    key: "dawn",
    label: "Dawn",
    dirEnv: "SHOPIFY_E2E_THEME_DIR_DAWN",
    defaultDir: path.resolve(projectRoot, "..", "b2b_b2c_themes", "Dawn"),
    nameEnv: "SHOPIFY_E2E_THEME_NAME_DAWN",
    defaultName: "Dawn",
    portEnv: "SHOPIFY_E2E_THEME_PORT_DAWN",
  },
];

const USAGE = [
  "Usage: npm run test:e2e:local:all [-- <options>]",
  "  Runs the storefront E2E suite against a local `shopify theme dev` origin,",
  "  once per theme (Horizon, then Dawn). Requires the app to be running with",
  "  MARGIN_GUARD_E2E_OVERRIDE=1 in another terminal.",
  "",
  "  --only <horizon|dawn>   Run a single theme instead of both.",
  "  --bail                  Stop after the first failing theme (default: run all).",
  "  --skip-app-check        Skip the app-proxy preflight (not recommended).",
  "  --verbose               Stream `shopify theme dev` output.",
  "  --dry-run               Print the plan and exit without spawning anything.",
  "  --timeout <seconds>     theme dev readiness timeout (default: 240).",
  "",
  "Env overrides:",
  "  SHOPIFY_E2E_THEME_DIR_{HORIZON,DAWN}    theme checkout paths",
  "  SHOPIFY_E2E_THEME_NAME_{HORIZON,DAWN}   remote theme to sync into",
  "  SHOPIFY_E2E_THEME_PORT_{HORIZON,DAWN}   preferred local port",
  "  SHOPIFY_E2E_SHOP_DOMAIN                 store (also read from .env)",
  "  SHOPIFY_E2E_STOREFRONT_PASSWORD         storefront password (also read from .env)",
].join("\n");

function fail(message) {
  console.error(`\n${message}\n`);
  console.error(USAGE);
  process.exit(2);
}

function parseArgs(argv) {
  const options = {
    only: null,
    bail: false,
    skipAppCheck: false,
    verbose: false,
    dryRun: false,
    timeoutMs: DEFAULT_THEME_DEV_TIMEOUT_MS,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--only") {
      options.only = String(argv[++i] ?? "").toLowerCase();
    } else if (arg.startsWith("--only=")) {
      options.only = arg.slice("--only=".length).toLowerCase();
    } else if (arg === "--bail") {
      options.bail = true;
    } else if (arg === "--skip-app-check") {
      options.skipAppCheck = true;
    } else if (arg === "--verbose" || arg === "-v") {
      options.verbose = true;
    } else if (arg === "--dry-run") {
      options.dryRun = true;
    } else if (arg === "--timeout" || arg.startsWith("--timeout=")) {
      const raw = arg.startsWith("--timeout=") ? arg.slice("--timeout=".length) : argv[++i];
      const seconds = Number(raw);
      if (!Number.isFinite(seconds) || seconds <= 0) {
        fail(`--timeout must be a positive number of seconds (got: ${raw}).`);
      }
      options.timeoutMs = seconds * 1000;
    } else if (arg === "--help" || arg === "-h") {
      console.log(USAGE);
      process.exit(0);
    } else {
      fail(`Unknown argument: ${arg}`);
    }
  }

  if (options.only && !THEMES.some((theme) => theme.key === options.only)) {
    fail(`--only must be one of: ${THEMES.map((theme) => theme.key).join(", ")} (got: ${options.only}).`);
  }
  return options;
}

// Mirrors the runner's .env handling: process.env wins over .env.
function parseDotenv(content) {
  const values = {};
  for (const rawLine of content.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }
    const separatorIndex = line.indexOf("=");
    if (separatorIndex < 1) {
      continue;
    }
    const key = line.slice(0, separatorIndex).trim();
    let value = line.slice(separatorIndex + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    values[key] = value;
  }
  return values;
}

function readEnvValue(key) {
  const fromProcess = String(process.env[key] ?? "").trim();
  if (fromProcess) {
    return fromProcess;
  }
  if (!existsSync(dotenvPath)) {
    return "";
  }
  return String(parseDotenv(readFileSync(dotenvPath, "utf8"))[key] ?? "").trim();
}

/**
 * A theme checkout, not its parent. Guards the exact footgun of running
 * `shopify theme dev` one directory too high: the CLI asks "not a theme
 * directory, proceed?" and, on yes, syncs an empty tree into the dev theme.
 */
function resolveThemeDir(theme) {
  const configured = String(process.env[theme.dirEnv] ?? "").trim();
  const dir = configured ? path.resolve(configured) : theme.defaultDir;
  if (!existsSync(dir)) {
    fail(`${theme.label}: theme directory not found: ${dir}\n  Set ${theme.dirEnv} to the checkout path.`);
  }
  if (!existsSync(path.join(dir, "layout", "theme.liquid"))) {
    fail(
      `${theme.label}: ${dir} is not a theme checkout (no layout/theme.liquid).\n` +
        `  Point ${theme.dirEnv} at the theme itself, not its parent directory.`,
    );
  }
  return dir;
}

function resolveThemeName(theme) {
  return String(process.env[theme.nameEnv] ?? "").trim() || theme.defaultName;
}

// theme dev's default :9292 is routinely held by another project's theme dev.
function findFreePort(preferred = 0) {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on("error", (error) => {
      if (preferred !== 0 && (error.code === "EADDRINUSE" || error.code === "EACCES")) {
        resolve(null);
        return;
      }
      reject(error);
    });
    server.listen(preferred, "127.0.0.1", () => {
      const { port } = server.address();
      server.close((closeError) => (closeError ? reject(closeError) : resolve(port)));
    });
  });
}

async function resolvePort(theme) {
  const configured = String(process.env[theme.portEnv] ?? "").trim();
  const preferred = configured ? Number(configured) : PREFERRED_PORTS[theme.key];
  if (!Number.isInteger(preferred) || preferred <= 0 || preferred > 65535) {
    fail(`${theme.label}: ${theme.portEnv} must be a valid port number (got: ${configured}).`);
  }

  const port = await findFreePort(preferred);
  if (port !== null) {
    return { port, fellBack: false };
  }
  const fallback = await findFreePort(0);
  return { port: fallback, fellBack: true, preferred };
}

async function probe(url) {
  try {
    const response = await fetch(url, { redirect: "manual" });
    return response.status;
  } catch {
    return null;
  }
}

async function waitForOrigin(baseUrl, timeoutMs, isChildAlive, deadlineSleepMs = 1000) {
  const startedAt = process.hrtime.bigint();
  const elapsedMs = () => Number(process.hrtime.bigint() - startedAt) / 1e6;

  while (elapsedMs() < timeoutMs) {
    if (!isChildAlive()) {
      return { ok: false, reason: "`shopify theme dev` exited before serving the origin." };
    }
    const status = await probe(`${baseUrl}/`);
    // Any non-5xx answer means theme dev is serving; the password page is a 200
    // the harness itself unlocks via SHOPIFY_E2E_STOREFRONT_PASSWORD.
    if (status !== null && status < 500) {
      return { ok: true, status };
    }
    await sleep(deadlineSleepMs);
  }
  return { ok: false, reason: `origin did not serve within ${Math.round(timeoutMs / 1000)}s.` };
}

/**
 * The app-proxy preflight. Without it, a missing terminal 1 is SILENT: Playwright's
 * `webServer.url` points at the theme-dev origin (not the app), `reuseExistingServer`
 * sees it answering, and the suite runs against an app that never armed the gated
 * override — so the `catalog` project fails for a reason that looks like a code bug.
 */
async function preflightAppProxy(baseUrl) {
  let status = null;
  let body = "";
  try {
    const response = await fetch(`${baseUrl}${APP_PROXY_PROBE_PATH}`, { redirect: "manual" });
    status = response.status;
    body = await response.text();
  } catch {
    status = null;
  }

  // Assert on the BODY, not the Content-Type: theme dev rewrites the header of every
  // proxied non-JSON response to text/html (see support/theme-dev-mime.ts), so the
  // header proves nothing here. The body is forwarded untouched.
  if (status === 200 && body.includes("DEFAULT_PROXY_PREFIX")) {
    return { ok: true };
  }
  if (status === 200) {
    return {
      ok: false,
      reason:
        `app proxy ${APP_PROXY_PROBE_PATH} answered 200 but the body is not the embed script.\n` +
        `  Got ${body.length} bytes starting: ${JSON.stringify(body.slice(0, 80))}\n` +
        `  A password page or an error page usually means the store gate rejected the request.`,
    };
  }
  return {
    ok: false,
    reason:
      `app proxy ${APP_PROXY_PROBE_PATH} answered ${status ?? "no response"} (expected 200).\n` +
      `  Is the app running in another terminal, with the override armed?\n` +
      `    MARGIN_GUARD_E2E_OVERRIDE=1 shopify app dev\n` +
      `  Re-run with --skip-app-check to bypass this check.`,
  };
}

function startThemeDev({ theme, dir, port, themeName, shopDomain, storePassword, verbose }) {
  // --theme pins the sync target to a dedicated remote theme (e.g. "Horizon dev"),
  // so a run never syncs into the live theme nor into a shared development theme.
  const args = [
    "theme",
    "dev",
    "--store",
    shopDomain,
    "--path",
    dir,
    "--theme",
    themeName,
    "--port",
    String(port),
  ];
  if (storePassword) {
    args.push("--store-password", storePassword);
  }

  const child = spawn("shopify", args, {
    cwd: dir,
    env: { ...process.env },
    stdio: verbose ? "inherit" : ["ignore", "pipe", "pipe"],
  });

  // Keep a tail of theme dev's own output so a startup failure is diagnosable
  // without --verbose (the CLI reports theme sync errors on stdout, not stderr).
  const tail = [];
  if (!verbose) {
    const capture = (chunk) => {
      const text = String(chunk);
      tail.push(text);
      if (tail.length > 40) {
        tail.shift();
      }
    };
    child.stdout?.on("data", capture);
    child.stderr?.on("data", capture);
  }

  let exited = false;
  child.on("exit", () => {
    exited = true;
  });

  return {
    child,
    tail,
    isAlive: () => !exited,
    label: `${theme.label} theme dev (:${port})`,
  };
}

async function stopThemeDev(handle) {
  if (!handle || !handle.isAlive()) {
    return;
  }
  handle.child.kill("SIGTERM");
  for (let i = 0; i < 50; i++) {
    if (!handle.isAlive()) {
      return;
    }
    await sleep(100);
  }
  handle.child.kill("SIGKILL");
}

function runSuite({ baseUrl, shopDomain, themeLabel }) {
  const env = { ...process.env };
  // The env contract every downstream layer already reads (see test-e2e-local.mjs).
  env.SHOPIFY_E2E_THEME_DEV = "1";
  env.SHOPIFY_E2E_STOREFRONT_BASE_URL = baseUrl;
  env.SHOPIFY_E2E_SHOP_DOMAIN = shopDomain;
  // Empty (not deleted): an empty process.env value wins over a non-empty .env
  // entry in the runner's merge, and theme.ts/warmup read process.env-only.
  env.SHOPIFY_E2E_PREVIEW_THEME_ID = "";
  // Reporting only — the suite itself is theme-agnostic.
  env.SHOPIFY_E2E_THEME_LABEL = themeLabel;
  // Playwright must not try to boot the app: the theme-dev origin would satisfy
  // webServer.url anyway, and terminal 1 already owns the app process.
  env.SHOPIFY_E2E_APP_URL = env.SHOPIFY_E2E_APP_URL || baseUrl;

  // Safety net for the intermittent Cloudflare bot-challenge that volume-triggers on
  // the FIRST theme's requests: the globalSetup warm-up waits out an ACTIVE challenge
  // before the suite, and this rides out one that appears mid-run (managed challenges
  // clear within seconds, so the re-run lands clean). Overridable via the env.
  env.PLAYWRIGHT_RETRIES = env.PLAYWRIGHT_RETRIES || "1";

  // Pinned test data (dedicated mg-e2e-* products created 2026-07-10). Fixes which
  // product plays which archetype in BOTH tiers — the matrix (support/matrix.ts) and
  // the serial runtime (support/runtime.ts) both read these. A pre-set env or .env
  // value wins, so the pins are overridable but stable by default.
  for (const [key, value] of Object.entries(PINNED_PRODUCT_HANDLES)) {
    env[key] = env[key] || value;
  }

  const result = spawnSync(process.execPath, [runnerPath], {
    cwd: projectRoot,
    env,
    stdio: "inherit",
  });
  if (result.error) {
    throw result.error;
  }
  return result.status ?? 0;
}

async function runTheme(theme, options, shopDomain, storePassword) {
  const dir = resolveThemeDir(theme);
  const themeName = resolveThemeName(theme);
  const { port, fellBack, preferred } = await resolvePort(theme);
  const baseUrl = `http://127.0.0.1:${port}`;

  console.log(`\n── ${theme.label} ─────────────────────────────────────────────`);
  console.log(`   checkout:     ${dir}`);
  console.log(`   remote theme: ${themeName}`);
  console.log(`   origin:       ${baseUrl}`);
  if (fellBack) {
    console.log(`   note: preferred port :${preferred} was busy — using :${port} instead.`);
  }

  let handle = null;
  try {
    handle = startThemeDev({
      theme,
      dir,
      port,
      themeName,
      shopDomain,
      storePassword,
      verbose: options.verbose,
    });
    active = handle;

    const ready = await waitForOrigin(baseUrl, options.timeoutMs, handle.isAlive);
    if (!ready.ok) {
      console.error(`\n✗ ${theme.label}: ${ready.reason}`);
      console.error(
        `  Does the remote theme "${themeName}" exist on ${shopDomain}?\n` +
          `    shopify theme list --store ${shopDomain}\n` +
          `  Override the name with ${theme.nameEnv}.`,
      );
      if (!options.verbose && handle.tail.length) {
        console.error(`\n--- last \`shopify theme dev\` output ---\n${handle.tail.join("")}`);
      }
      return 1;
    }
    console.log(`   theme dev is serving (HTTP ${ready.status}).`);

    if (!options.skipAppCheck) {
      const preflight = await preflightAppProxy(baseUrl);
      if (!preflight.ok) {
        console.error(`\n✗ ${theme.label}: ${preflight.reason}`);
        return 1;
      }
      console.log(`   app proxy responds (override-armed app is up).`);
    }

    return runSuite({ baseUrl, shopDomain, themeLabel: theme.label });
  } finally {
    await stopThemeDev(handle);
    active = null;
  }
}

// A Ctrl-C must not orphan a `shopify theme dev` holding a port and a dev theme.
let active = null;

const options = parseArgs(process.argv.slice(2));
const shopDomain = readEnvValue("SHOPIFY_E2E_SHOP_DOMAIN") || DEFAULT_SHOP_DOMAIN;
const storePassword = readEnvValue("SHOPIFY_E2E_STOREFRONT_PASSWORD");
const selected = options.only ? THEMES.filter((theme) => theme.key === options.only) : THEMES;

if (options.dryRun) {
  console.log(`store:  ${shopDomain}`);
  console.log(`themes: ${selected.map((theme) => theme.label).join(", ")} (sequential)`);
  console.log(`store password: ${storePassword ? "set (passed to theme dev)" : "not set"}`);
  console.log(`app-proxy preflight: ${options.skipAppCheck ? "skipped" : `GET ${APP_PROXY_PROBE_PATH}`}`);
  for (const theme of selected) {
    const { port, fellBack, preferred } = await resolvePort(theme);
    const portNote = fellBack ? `:${port} (preferred :${preferred} busy)` : `:${port}`;
    console.log(`  ${theme.label}`);
    console.log(`    checkout:     ${resolveThemeDir(theme)}`);
    console.log(`    remote theme: ${resolveThemeName(theme)}`);
    console.log(`    port:         ${portNote}`);
  }
  process.exit(0);
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    void stopThemeDev(active).finally(() => process.exit(130));
  });
}

const results = [];
for (const theme of selected) {
  const status = await runTheme(theme, options, shopDomain, storePassword);
  results.push({ theme: theme.label, status });
  if (status !== 0 && options.bail) {
    console.error(`\n✗ ${theme.label} failed — stopping (--bail).`);
    break;
  }
}

console.log(`\n── summary ────────────────────────────────────────────────`);
for (const result of results) {
  console.log(`   ${result.status === 0 ? "✓" : "✗"} ${result.theme}`);
}
const skipped = selected.length - results.length;
if (skipped > 0) {
  console.log(`   … ${skipped} theme(s) not run (--bail)`);
}

process.exit(results.some((result) => result.status !== 0) ? 1 : 0);
