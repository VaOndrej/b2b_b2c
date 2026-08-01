import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const DEFAULT_STOREFRONT_BASE_URL =
  "https://b2b-b2c-store-development.myshopify.com";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");
const require = createRequire(import.meta.url);
const playwrightPackagePath = require.resolve("playwright/package.json");
const playwrightCliPath = path.join(
  path.dirname(playwrightPackagePath),
  "cli.js",
);
const dotenvPath = path.join(projectRoot, ".env");

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

function loadProjectEnv() {
  if (!existsSync(dotenvPath)) {
    return { ...process.env };
  }
  const parsed = parseDotenv(readFileSync(dotenvPath, "utf8"));
  return {
    ...parsed,
    ...process.env,
  };
}

const E2E_OVERRIDE_FLAG = "MARGIN_GUARD_E2E_OVERRIDE";

// PROD-SAFETY: the gated segment-override flag is owned exclusively by this
// runner and injected ONLY for the matrix run below. It must never be committed
// to .env (where it would leak into normal `npm run dev`). Fail loudly if it is.
if (existsSync(dotenvPath)) {
  const dotenvValues = parseDotenv(readFileSync(dotenvPath, "utf8"));
  if (Object.prototype.hasOwnProperty.call(dotenvValues, E2E_OVERRIDE_FLAG)) {
    throw new Error(
      `${E2E_OVERRIDE_FLAG} must not be set in .env — it is injected by the test ` +
        `runner only for the duration of the matrix run. Remove it from .env.`,
    );
  }
}

const mergedEnv = loadProjectEnv();
if (!String(mergedEnv.SHOPIFY_E2E_STOREFRONT_BASE_URL ?? "").trim()) {
  mergedEnv.SHOPIFY_E2E_STOREFRONT_BASE_URL = DEFAULT_STOREFRONT_BASE_URL;
}
// Never inherit the flag from the ambient shell into the base env; the runner
// re-adds it explicitly, and only for the matrix tier.
delete mergedEnv[E2E_OVERRIDE_FLAG];

// Order = the target "pusť všechny testy" UX:
//   1) parallel read-only theme×context matrix (base vs forced e2e catalog).
//   2) the serial, mutate-per-test tier (DOM banners / notices / cart conflict).
// Catalog-native (MVP_5_4): BOTH tiers force the dedicated e2e catalog via the
// gated `mg_e2e_audience` override, so the runner-owned flag is injected for both.
// Separate configs keep the parallel matrix from racing the serial tier on the
// shared e2e catalog.
const runs = [
  {
    config: "playwright.matrix.config.ts",
    env: { ...mergedEnv, [E2E_OVERRIDE_FLAG]: "1" },
  },
  {
    config: "playwright.config.ts",
    env: { ...mergedEnv, [E2E_OVERRIDE_FLAG]: "1" },
  },
];

let finalStatus = 0;
for (const run of runs) {
  const runResult = spawnSync(
    process.execPath,
    [playwrightCliPath, "test", `--config=${run.config}`],
    {
      cwd: projectRoot,
      env: run.env,
      stdio: "inherit",
    },
  );

  if (runResult.error) {
    throw runResult.error;
  }

  if (typeof runResult.status === "number" && runResult.status !== 0) {
    finalStatus = runResult.status;
  }
}

process.exit(finalStatus);
