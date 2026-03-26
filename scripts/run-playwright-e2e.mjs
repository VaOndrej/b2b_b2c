import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const DEFAULT_STOREFRONT_BASE_URL = "https://b2b-b2c-store-development.myshopify.com";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");
const playwrightCliPath = path.join(projectRoot, "node_modules", "playwright", "cli.js");
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

const mergedEnv = loadProjectEnv();
if (!String(mergedEnv.SHOPIFY_E2E_STOREFRONT_BASE_URL ?? "").trim()) {
  mergedEnv.SHOPIFY_E2E_STOREFRONT_BASE_URL = DEFAULT_STOREFRONT_BASE_URL;
}

const runResult = spawnSync(
  process.execPath,
  [playwrightCliPath, "test", "--config=playwright.config.ts"],
  {
    cwd: projectRoot,
    env: mergedEnv,
    stdio: "inherit",
  },
);

if (typeof runResult.status === "number") {
  process.exit(runResult.status);
}

if (runResult.error) {
  throw runResult.error;
}

process.exit(1);
