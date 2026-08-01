import { existsSync } from "node:fs";
import path from "node:path";

export const THEME_KEYS = ["horizon", "dawn"];
const DEFAULT_THEME_DEV_TIMEOUT_MS = 240_000;

function requireNonEmptyString(value, label) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${label} must be a non-empty string.`);
  }
  return value.trim();
}

export function validateRunnerConfig(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("E2E config must export an object.");
  }

  requireNonEmptyString(value.appName, "appName");
  requireNonEmptyString(value.shopDomain, "shopDomain");
  if (
    !value.appProxyProbe ||
    typeof value.appProxyProbe !== "object" ||
    Array.isArray(value.appProxyProbe)
  ) {
    throw new Error("appProxyProbe must be an object.");
  }
  const probePath = requireNonEmptyString(
    value.appProxyProbe.path,
    "appProxyProbe.path",
  );
  if (!probePath.startsWith("/")) {
    throw new Error("appProxyProbe.path must start with '/'.");
  }
  requireNonEmptyString(
    value.appProxyProbe.bodyMarker,
    "appProxyProbe.bodyMarker",
  );

  if (
    !Array.isArray(value.testCommand) ||
    value.testCommand.length === 0 ||
    value.testCommand.some(
      (part) => typeof part !== "string" || part.trim() === "",
    )
  ) {
    throw new Error("testCommand must be a non-empty array of strings.");
  }
  if (!value.themes || typeof value.themes !== "object") {
    throw new Error("themes must define horizon and dawn.");
  }
  for (const key of THEME_KEYS) {
    const entry = value.themes[key];
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new Error(`themes.${key} must be an object.`);
    }
    requireNonEmptyString(entry.remoteName, `themes.${key}.remoteName`);
  }

  if (value.environment !== undefined) {
    if (
      !value.environment ||
      typeof value.environment !== "object" ||
      Array.isArray(value.environment) ||
      Object.entries(value.environment).some(
        ([key, entry]) => !key || typeof entry !== "string",
      )
    ) {
      throw new Error("environment must be a record of string values.");
    }
  }
  if (
    value.appStartHint !== undefined &&
    (typeof value.appStartHint !== "string" || value.appStartHint.trim() === "")
  ) {
    throw new Error("appStartHint must be a non-empty string when provided.");
  }
  return value;
}

function readOptionValue(argv, index, option) {
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${option} requires a value.`);
  }
  return [value, index + 1];
}

export function parseRunnerArgs(argv) {
  const options = {
    configPath: null,
    only: null,
    bail: false,
    skipAppCheck: false,
    verbose: false,
    dryRun: false,
    help: false,
    timeoutMs: DEFAULT_THEME_DEV_TIMEOUT_MS,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--config") {
      const [value, nextIndex] = readOptionValue(argv, index, argument);
      options.configPath = value;
      index = nextIndex;
    } else if (argument.startsWith("--config=")) {
      options.configPath = argument.slice("--config=".length);
    } else if (argument === "--only") {
      const [value, nextIndex] = readOptionValue(argv, index, argument);
      options.only = value.toLowerCase();
      index = nextIndex;
    } else if (argument.startsWith("--only=")) {
      options.only = argument.slice("--only=".length).toLowerCase();
    } else if (argument === "--bail") {
      options.bail = true;
    } else if (argument === "--skip-app-check") {
      options.skipAppCheck = true;
    } else if (argument === "--verbose" || argument === "-v") {
      options.verbose = true;
    } else if (argument === "--dry-run") {
      options.dryRun = true;
    } else if (argument === "--timeout" || argument.startsWith("--timeout=")) {
      let raw;
      if (argument.startsWith("--timeout=")) {
        raw = argument.slice("--timeout=".length);
      } else {
        [raw, index] = readOptionValue(argv, index, argument);
      }
      const seconds = Number(raw);
      if (!Number.isFinite(seconds) || seconds <= 0) {
        throw new Error(
          `--timeout must be a positive number of seconds (got: ${raw}).`,
        );
      }
      options.timeoutMs = seconds * 1000;
    } else if (argument === "--help" || argument === "-h") {
      options.help = true;
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }

  if (options.only !== null && !THEME_KEYS.includes(options.only)) {
    throw new Error(
      `--only must be one of: ${THEME_KEYS.join(", ")} (got: ${options.only}).`,
    );
  }
  return options;
}

export function validateThemeCheckout(label, directory) {
  const resolvedDirectory = path.resolve(directory);
  const themeLayout = path.join(resolvedDirectory, "layout", "theme.liquid");
  if (!existsSync(themeLayout)) {
    throw new Error(
      `${label}: ${resolvedDirectory} is not a theme checkout (no layout/theme.liquid).`,
    );
  }
  return resolvedDirectory;
}

export function resolveConfiguredPort(
  label,
  environmentKey,
  environment,
  fallback,
) {
  const configured = String(environment[environmentKey] ?? "").trim();
  const port = configured ? Number(configured) : fallback;
  if (!Number.isInteger(port) || port <= 0 || port > 65_535) {
    throw new Error(
      `${label}: ${environmentKey} must be a valid port number (got: ${configured || port}).`,
    );
  }
  return port;
}
