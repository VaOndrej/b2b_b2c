import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import net from "node:net";
import path from "node:path";
import process from "node:process";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  THEME_KEYS,
  parseRunnerArgs,
  resolveConfiguredPort,
  validateRunnerConfig,
  validateThemeCheckout,
} from "../src/runner-config.js";
import { resolveThemePaths } from "../src/theme-paths.js";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDirectory, "../../..");
const PREFERRED_PORTS = { horizon: 9781, dawn: 9782 };

const USAGE = [
  "Usage: run-theme-matrix --config <app/e2e.app.config.mjs> [options]",
  "  Runs one app's storefront tests sequentially against Horizon and Dawn",
  "  checkouts served by local `shopify theme dev` processes.",
  "",
  "  --only <horizon|dawn>  Run one theme instead of both.",
  "  --bail                 Stop after the first failing theme.",
  "  --skip-app-check       Skip the configured app-proxy preflight.",
  "  --verbose              Stream `shopify theme dev` output.",
  "  --dry-run              Validate and print the plan; spawn no process.",
  "  --timeout <seconds>    Theme-dev readiness timeout (default: 240).",
  "",
  "Environment overrides:",
  "  SHOPIFY_E2E_THEME_DIR_{HORIZON,DAWN}",
  "  SHOPIFY_E2E_THEME_NAME_{HORIZON,DAWN}",
  "  SHOPIFY_E2E_THEME_PORT_{HORIZON,DAWN}",
  "  SHOPIFY_E2E_SHOP_DOMAIN",
  "  SHOPIFY_E2E_STOREFRONT_PASSWORD",
].join("\n");

function fail(message) {
  throw new Error(message);
}

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

function readAppEnvironment(appRoot) {
  const dotenvPath = path.join(appRoot, ".env");
  return existsSync(dotenvPath)
    ? parseDotenv(readFileSync(dotenvPath, "utf8"))
    : {};
}

function readEnvironmentValue(key, dotenv) {
  return (
    String(process.env[key] ?? "").trim() || String(dotenv[key] ?? "").trim()
  );
}

async function loadConfig(configArgument) {
  if (!configArgument) {
    fail("--config is required.");
  }
  const configPath = path.resolve(process.cwd(), configArgument);
  if (!existsSync(configPath)) {
    fail(`E2E config not found: ${configPath}`);
  }
  const configModule = await import(pathToFileURL(configPath).href);
  return {
    config: validateRunnerConfig(configModule.default),
    configPath,
    appRoot: path.dirname(configPath),
  };
}

function createThemeDefinitions(config) {
  const paths = resolveThemePaths({ repoRoot, env: process.env });
  return THEME_KEYS.map((key) => {
    const upperKey = key.toUpperCase();
    const label = key[0].toUpperCase() + key.slice(1);
    return {
      key,
      label,
      directory: paths[key],
      directoryEnvironmentKey: `SHOPIFY_E2E_THEME_DIR_${upperKey}`,
      nameEnvironmentKey: `SHOPIFY_E2E_THEME_NAME_${upperKey}`,
      portEnvironmentKey: `SHOPIFY_E2E_THEME_PORT_${upperKey}`,
      defaultRemoteName: config.themes[key].remoteName,
      preferredPort: PREFERRED_PORTS[key],
    };
  });
}

function resolveThemeName(theme) {
  return (
    String(process.env[theme.nameEnvironmentKey] ?? "").trim() ||
    theme.defaultRemoteName
  );
}

function resolvePreferredPort(theme) {
  return resolveConfiguredPort(
    theme.label,
    theme.portEnvironmentKey,
    process.env,
    theme.preferredPort,
  );
}

function findFreePort(preferred = 0) {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on("error", (error) => {
      if (
        preferred !== 0 &&
        (error.code === "EADDRINUSE" || error.code === "EACCES")
      ) {
        resolve(null);
        return;
      }
      reject(error);
    });
    server.listen(preferred, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : null;
      server.close((error) => {
        if (error) {
          reject(error);
        } else {
          resolve(port);
        }
      });
    });
  });
}

async function reserveRunPort(theme) {
  const preferred = resolvePreferredPort(theme);
  const preferredResult = await findFreePort(preferred);
  if (preferredResult !== null) {
    return { port: preferredResult, fellBack: false };
  }
  const fallback = await findFreePort(0);
  if (fallback === null) {
    fail(`${theme.label}: could not allocate a local port.`);
  }
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

async function waitForOrigin(baseUrl, timeoutMs, isChildAlive) {
  const startedAt = process.hrtime.bigint();
  const elapsedMs = () => Number(process.hrtime.bigint() - startedAt) / 1e6;
  while (elapsedMs() < timeoutMs) {
    if (!isChildAlive()) {
      return {
        ok: false,
        reason: "`shopify theme dev` exited before serving the origin.",
      };
    }
    const status = await probe(`${baseUrl}/`);
    if (status !== null && status < 500) {
      return { ok: true, status };
    }
    await sleep(1000);
  }
  return {
    ok: false,
    reason: `origin did not serve within ${Math.round(timeoutMs / 1000)}s.`,
  };
}

async function preflightAppProxy(baseUrl, config) {
  let status = null;
  let body = "";
  try {
    const response = await fetch(`${baseUrl}${config.appProxyProbe.path}`, {
      redirect: "manual",
    });
    status = response.status;
    body = await response.text();
  } catch {
    status = null;
  }

  if (status === 200 && body.includes(config.appProxyProbe.bodyMarker)) {
    return { ok: true };
  }
  if (status === 200) {
    return {
      ok: false,
      reason:
        `app proxy ${config.appProxyProbe.path} answered 200 but its body does not contain ` +
        `${JSON.stringify(config.appProxyProbe.bodyMarker)}. Got ${body.length} bytes starting: ` +
        `${JSON.stringify(body.slice(0, 80))}`,
    };
  }
  return {
    ok: false,
    reason:
      `app proxy ${config.appProxyProbe.path} answered ${status ?? "no response"} (expected 200).\n` +
      `  Start ${config.appName} in another terminal${
        config.appStartHint ? `:\n    ${config.appStartHint}` : "."
      }\n  Re-run with --skip-app-check only when this check is intentionally unavailable.`,
  };
}

function startThemeDev({
  theme,
  directory,
  port,
  remoteName,
  shopDomain,
  storePassword,
  verbose,
}) {
  const args = [
    "theme",
    "dev",
    "--store",
    shopDomain,
    "--path",
    directory,
    "--theme",
    remoteName,
    "--port",
    String(port),
  ];
  if (storePassword) {
    args.push("--store-password", storePassword);
  }

  const child = spawn("shopify", args, {
    cwd: directory,
    env: { ...process.env },
    stdio: verbose ? "inherit" : ["ignore", "pipe", "pipe"],
  });
  const tail = [];
  if (!verbose) {
    const capture = (chunk) => {
      tail.push(String(chunk));
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
  child.on("error", (error) => {
    exited = true;
    tail.push(`Failed to start shopify theme dev: ${error.message}\n`);
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
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (!handle.isAlive()) {
      return;
    }
    await sleep(100);
  }
  handle.child.kill("SIGKILL");
}

function runSuite({ appRoot, baseUrl, config, shopDomain, themeLabel }) {
  const [command, ...args] = config.testCommand;
  const environment = {
    ...process.env,
    ...Object.fromEntries(
      Object.entries(config.environment ?? {}).map(([key, value]) => [
        key,
        process.env[key] || value,
      ]),
    ),
    SHOPIFY_E2E_THEME_DEV: "1",
    SHOPIFY_E2E_STOREFRONT_BASE_URL: baseUrl,
    SHOPIFY_E2E_SHOP_DOMAIN: shopDomain,
    SHOPIFY_E2E_PREVIEW_THEME_ID: "",
    SHOPIFY_E2E_THEME_LABEL: themeLabel,
    SHOPIFY_E2E_APP_URL: process.env.SHOPIFY_E2E_APP_URL || baseUrl,
    PLAYWRIGHT_RETRIES: process.env.PLAYWRIGHT_RETRIES || "1",
  };
  const result = spawnSync(command, args, {
    cwd: appRoot,
    env: environment,
    stdio: "inherit",
  });
  if (result.error) {
    throw result.error;
  }
  return result.status ?? 1;
}

let activeThemeDev = null;

async function runTheme({
  appRoot,
  config,
  options,
  shopDomain,
  storePassword,
  theme,
}) {
  const directory = validateThemeCheckout(theme.label, theme.directory);
  const remoteName = resolveThemeName(theme);
  const { port, fellBack, preferred } = await reserveRunPort(theme);
  const baseUrl = `http://127.0.0.1:${port}`;

  console.log(
    `\n── ${theme.label} ─────────────────────────────────────────────`,
  );
  console.log(`   checkout:     ${directory}`);
  console.log(`   remote theme: ${remoteName}`);
  console.log(`   origin:       ${baseUrl}`);
  if (fellBack) {
    console.log(
      `   note: preferred port :${preferred} was busy; using :${port}.`,
    );
  }

  let handle = null;
  try {
    handle = startThemeDev({
      theme,
      directory,
      port,
      remoteName,
      shopDomain,
      storePassword,
      verbose: options.verbose,
    });
    activeThemeDev = handle;
    const ready = await waitForOrigin(
      baseUrl,
      options.timeoutMs,
      handle.isAlive,
    );
    if (!ready.ok) {
      console.error(`\n✗ ${theme.label}: ${ready.reason}`);
      console.error(
        `  Does unpublished remote theme ${JSON.stringify(remoteName)} exist on ${shopDomain}?\n` +
          `  Override it with ${theme.nameEnvironmentKey}.`,
      );
      if (!options.verbose && handle.tail.length > 0) {
        console.error(
          `\n--- last \`shopify theme dev\` output ---\n${handle.tail.join("")}`,
        );
      }
      return 1;
    }
    console.log(`   theme dev is serving (HTTP ${ready.status}).`);

    if (!options.skipAppCheck) {
      const preflight = await preflightAppProxy(baseUrl, config);
      if (!preflight.ok) {
        console.error(`\n✗ ${theme.label}: ${preflight.reason}`);
        return 1;
      }
      console.log("   configured app proxy responds.");
    }
    return runSuite({
      appRoot,
      baseUrl,
      config,
      shopDomain,
      themeLabel: theme.label,
    });
  } finally {
    await stopThemeDev(handle);
    activeThemeDev = null;
  }
}

async function main() {
  const options = parseRunnerArgs(process.argv.slice(2));
  if (options.help) {
    console.log(USAGE);
    return 0;
  }
  const { appRoot, config } = await loadConfig(options.configPath);
  const dotenv = readAppEnvironment(appRoot);
  const shopDomain =
    readEnvironmentValue("SHOPIFY_E2E_SHOP_DOMAIN", dotenv) ||
    config.shopDomain;
  const storePassword = readEnvironmentValue(
    "SHOPIFY_E2E_STOREFRONT_PASSWORD",
    dotenv,
  );
  const definitions = createThemeDefinitions(config);
  const selected = options.only
    ? definitions.filter((theme) => theme.key === options.only)
    : definitions;

  if (options.dryRun) {
    console.log(`app:    ${config.appName}`);
    console.log(`store:  ${shopDomain}`);
    console.log(
      `themes: ${selected.map((theme) => theme.label).join(", ")} (sequential)`,
    );
    console.log(
      `store password: ${storePassword ? "set (passed to theme dev)" : "not set"}`,
    );
    console.log(
      `app-proxy preflight: ${
        options.skipAppCheck
          ? "skipped"
          : `GET ${config.appProxyProbe.path} containing ${JSON.stringify(config.appProxyProbe.bodyMarker)}`
      }`,
    );
    for (const theme of selected) {
      const directory = validateThemeCheckout(theme.label, theme.directory);
      const preferredPort = resolvePreferredPort(theme);
      console.log(`  ${theme.label}`);
      console.log(`    checkout:     ${directory}`);
      console.log(`    remote theme: ${resolveThemeName(theme)}`);
      console.log(`    port:         :${preferredPort} (preferred)`);
    }
    console.log("dry run: no child process spawned");
    return 0;
  }

  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.on(signal, () => {
      void stopThemeDev(activeThemeDev).finally(() => process.exit(130));
    });
  }

  const results = [];
  for (const theme of selected) {
    const status = await runTheme({
      appRoot,
      config,
      options,
      shopDomain,
      storePassword,
      theme,
    });
    results.push({ theme: theme.label, status });
    if (status !== 0 && options.bail) {
      console.error(`\n✗ ${theme.label} failed; stopping (--bail).`);
      break;
    }
  }

  console.log("\n── summary ────────────────────────────────────────────────");
  for (const result of results) {
    console.log(`   ${result.status === 0 ? "✓" : "✗"} ${result.theme}`);
  }
  const skipped = selected.length - results.length;
  if (skipped > 0) {
    console.log(`   … ${skipped} theme(s) not run (--bail)`);
  }
  return results.some((result) => result.status !== 0) ? 1 : 0;
}

try {
  process.exitCode = await main();
} catch (error) {
  console.error(
    `\n${error instanceof Error ? error.message : String(error)}\n`,
  );
  console.error(USAGE);
  process.exitCode = 2;
}
