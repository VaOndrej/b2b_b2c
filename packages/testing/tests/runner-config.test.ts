import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  parseRunnerArgs,
  resolveConfiguredPort,
  validateRunnerConfig,
  validateThemeCheckout,
} from "../src/runner-config.js";

const VALID_CONFIG = {
  appName: "example-app",
  workspace: "example-app",
  shopDomain: "example.myshopify.com",
  appProxyProbe: {
    path: "/apps/example/probe",
    bodyMarker: "EXAMPLE_MARKER",
  },
  testCommand: ["node", "./scripts/run-tests.mjs"],
  themes: {
    horizon: {
      remoteName: "Horizon",
      settingsDataOverlay: "tests/themes/horizon.settings_data.json",
      preferredPort: 9781,
    },
    dawn: {
      remoteName: "Dawn",
      settingsDataOverlay: "tests/themes/dawn.settings_data.json",
      preferredPort: 9782,
    },
  },
};

test("runner config requires an absolute app-proxy probe path", () => {
  assert.doesNotThrow(() => validateRunnerConfig(VALID_CONFIG));

  assert.throws(
    () =>
      validateRunnerConfig({
        ...VALID_CONFIG,
        appProxyProbe: { bodyMarker: "EXAMPLE_MARKER" },
      }),
    /appProxyProbe\.path/,
  );
  assert.throws(
    () =>
      validateRunnerConfig({
        ...VALID_CONFIG,
        appProxyProbe: {
          path: "apps/example/probe",
          bodyMarker: "EXAMPLE_MARKER",
        },
      }),
    /must start with/,
  );
});

test("theme checkout must contain layout/theme.liquid", async () => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "won-theme-"));
  try {
    assert.throws(
      () => validateThemeCheckout("Horizon", temporaryRoot),
      /layout\/theme\.liquid/,
    );

    await mkdir(path.join(temporaryRoot, "layout"));
    await writeFile(path.join(temporaryRoot, "layout", "theme.liquid"), "");
    assert.equal(
      validateThemeCheckout("Horizon", temporaryRoot),
      temporaryRoot,
    );
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test("configured theme port must be an integer in the TCP range", () => {
  assert.equal(
    resolveConfiguredPort(
      "Horizon",
      "SHOPIFY_E2E_THEME_PORT_HORIZON",
      {},
      9781,
    ),
    9781,
  );
  assert.equal(
    resolveConfiguredPort(
      "Horizon",
      "SHOPIFY_E2E_THEME_PORT_HORIZON",
      { SHOPIFY_E2E_THEME_PORT_HORIZON: "12000" },
      9781,
    ),
    12000,
  );
  assert.throws(
    () =>
      resolveConfiguredPort(
        "Horizon",
        "SHOPIFY_E2E_THEME_PORT_HORIZON",
        { SHOPIFY_E2E_THEME_PORT_HORIZON: "70000" },
        9781,
      ),
    /valid port number/,
  );
});

test("runner config validates isolated workspaces, overlays and app-owned ports", () => {
  assert.doesNotThrow(() => validateRunnerConfig(VALID_CONFIG));

  assert.throws(
    () => validateRunnerConfig({ ...VALID_CONFIG, workspace: "../shared" }),
    /workspace/,
  );
  assert.throws(
    () =>
      validateRunnerConfig({
        ...VALID_CONFIG,
        themes: {
          ...VALID_CONFIG.themes,
          dawn: {
            remoteName: "Dawn",
            settingsDataOverlay: "",
            preferredPort: 9782,
          },
        },
      }),
    /settingsDataOverlay/,
  );
  assert.throws(
    () =>
      validateRunnerConfig({
        ...VALID_CONFIG,
        themes: {
          ...VALID_CONFIG.themes,
          horizon: {
            ...VALID_CONFIG.themes.horizon,
            preferredPort: 70_000,
          },
        },
      }),
    /preferredPort/,
  );
});

test("--only accepts configured themes and rejects unknown values", () => {
  assert.equal(parseRunnerArgs(["--only", "dawn"]).only, "dawn");
  assert.equal(parseRunnerArgs(["--only=horizon"]).only, "horizon");
  assert.throws(
    () => parseRunnerArgs(["--only", "unknown"]),
    /--only must be one of: horizon, dawn/,
  );
  assert.throws(
    () => parseRunnerArgs(["--only="]),
    /--only must be one of: horizon, dawn/,
  );
});
