import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(scriptDirectory, "..");
const require = createRequire(import.meta.url);
const configPath = path.join(appRoot, "e2e.app.config.mjs");
const playwrightConfigPath = path.join(appRoot, "playwright.config.ts");
const e2eDirectory = path.join(appRoot, "tests/e2e");

function listSpecs(directory) {
  if (!existsSync(directory)) {
    return [];
  }
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      return listSpecs(entryPath);
    }
    return /\.spec\.[cm]?[jt]sx?$/u.test(entry.name) ? [entryPath] : [];
  });
}

function fail(reasons) {
  throw new Error(
    [
      "E2E contract is incomplete for this standalone app:",
      ...reasons.map((reason) => `  - ${reason}`),
      "Add an app-specific proxy probe and at least one storefront spec before treating E2E as green.",
    ].join("\n"),
  );
}

if (!existsSync(configPath)) {
  fail(["e2e.app.config.mjs is missing"]);
}

const { default: config } = await import(pathToFileURL(configPath).href);
const reasons = [];
const serializedConfig = JSON.stringify(config);
if (/REPLACE_ME/u.test(serializedConfig)) {
  reasons.push("replace every REPLACE_ME value in e2e.app.config.mjs");
}
if (!String(config?.appProxyProbe?.path ?? "").startsWith("/apps/")) {
  reasons.push("configure an absolute /apps/... appProxyProbe.path");
}
if (!String(config?.appProxyProbe?.bodyMarker ?? "").trim()) {
  reasons.push("configure a stable appProxyProbe.bodyMarker");
}
if (!existsSync(playwrightConfigPath)) {
  reasons.push("playwright.config.ts is missing");
}
if (listSpecs(e2eDirectory).length === 0) {
  reasons.push("tests/e2e contains no *.spec.ts or *.spec.tsx file");
}
if (reasons.length > 0) {
  fail(reasons);
}

const localMatrix = process.argv.includes("--local-matrix");
let command;
let args;
if (localMatrix) {
  command = process.execPath;
  args = [
    path.resolve(
      appRoot,
      "../../packages/testing/scripts/run-theme-matrix.mjs",
    ),
    "--config",
    configPath,
  ];
} else {
  const playwrightPackagePath = require.resolve("playwright/package.json");
  command = process.execPath;
  args = [
    path.join(path.dirname(playwrightPackagePath), "cli.js"),
    "test",
    `--config=${playwrightConfigPath}`,
  ];
}

const result = spawnSync(command, args, {
  cwd: appRoot,
  env: process.env,
  stdio: "inherit",
});
if (result.error) {
  throw result.error;
}
process.exit(result.status ?? 1);
