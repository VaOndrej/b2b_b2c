import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  prepareThemeWorkspace,
  resolveThemeWorkspace,
} from "../src/theme-workspace.js";

test("theme workspace copies canonical checkout and applies only app overlay", async () => {
  const temporaryRoot = await mkdtemp(
    path.join(os.tmpdir(), "won-theme-workspace-"),
  );
  const repoRoot = path.join(temporaryRoot, "repo");
  const appRoot = path.join(repoRoot, "apps", "example");
  const sourceDirectory = path.join(temporaryRoot, "themes", "Horizon");
  const overlayRelativePath = "tests/themes/horizon.settings_data.json";
  const overlayPath = path.join(appRoot, overlayRelativePath);

  try {
    await mkdir(path.join(sourceDirectory, "layout"), { recursive: true });
    await mkdir(path.join(sourceDirectory, "config"), { recursive: true });
    await mkdir(path.dirname(overlayPath), { recursive: true });
    await writeFile(path.join(sourceDirectory, "layout/theme.liquid"), "theme");
    await writeFile(
      path.join(sourceDirectory, "config/settings_data.json"),
      '{"current":{"blocks":{"b2b":{"type":"shopify://apps/b2b"}}}}',
    );
    await writeFile(
      overlayPath,
      '/* Shopify generated file. */\n{"current":{"blocks":{"quantity":{"type":"shopify://apps/won-quantity"}}}}',
    );

    const workspaceDirectory = resolveThemeWorkspace({
      repoRoot,
      workspace: "won-quantity",
      themeKey: "horizon",
    });
    assert.equal(
      workspaceDirectory,
      path.join(repoRoot, "tmp/e2e-themes/won-quantity/horizon"),
    );

    const prepared = await prepareThemeWorkspace({
      repoRoot,
      appRoot,
      workspace: "won-quantity",
      themeKey: "horizon",
      sourceDirectory,
      settingsDataOverlay: overlayRelativePath,
    });

    assert.equal(prepared, workspaceDirectory);
    assert.equal(
      await readFile(path.join(prepared, "layout/theme.liquid"), "utf8"),
      "theme",
    );
    assert.match(
      await readFile(path.join(prepared, "config/settings_data.json"), "utf8"),
      /shopify:\/\/apps\/won-quantity/u,
    );
    assert.match(
      await readFile(
        path.join(sourceDirectory, "config/settings_data.json"),
        "utf8",
      ),
      /shopify:\/\/apps\/b2b/u,
    );
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test("theme workspace rejects unsafe destinations and invalid overlays", async () => {
  const temporaryRoot = await mkdtemp(
    path.join(os.tmpdir(), "won-theme-workspace-safety-"),
  );
  const repoRoot = path.join(temporaryRoot, "repo");
  const appRoot = path.join(repoRoot, "apps", "example");
  const sourceDirectory = path.join(temporaryRoot, "themes", "Dawn");
  const overlayRelativePath = "tests/themes/dawn.settings_data.json";
  const overlayPath = path.join(appRoot, overlayRelativePath);

  try {
    await mkdir(path.join(sourceDirectory, "layout"), { recursive: true });
    await mkdir(path.join(sourceDirectory, "config"), { recursive: true });
    await mkdir(path.dirname(overlayPath), { recursive: true });
    await writeFile(path.join(sourceDirectory, "layout/theme.liquid"), "theme");
    await writeFile(
      path.join(sourceDirectory, "config/settings_data.json"),
      '{"current":{}}',
    );

    assert.throws(
      () =>
        resolveThemeWorkspace({
          repoRoot,
          workspace: "../shared",
          themeKey: "dawn",
        }),
      /safe workspace segment/u,
    );

    await assert.rejects(
      () =>
        prepareThemeWorkspace({
          repoRoot,
          appRoot,
          workspace: "won-quantity",
          themeKey: "dawn",
          sourceDirectory,
          settingsDataOverlay: "../outside.json",
        }),
      /escapes the app workspace/u,
    );

    await writeFile(overlayPath, '{"presets":{}}');
    await assert.rejects(
      () =>
        prepareThemeWorkspace({
          repoRoot,
          appRoot,
          workspace: "won-quantity",
          themeKey: "dawn",
          sourceDirectory,
          settingsDataOverlay: overlayRelativePath,
        }),
      /object-valued current key/u,
    );
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});
