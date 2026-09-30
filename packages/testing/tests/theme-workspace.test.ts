import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  inspectThemeWorkspace,
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
      '/* Shopify generated file. */\n{"current":{"blocks":{"quantity":{"type":"shopify://apps/won-toasts"}}}}',
    );

    const workspaceDirectory = resolveThemeWorkspace({
      repoRoot,
      workspace: "won-toasts",
      themeKey: "horizon",
    });
    assert.equal(
      workspaceDirectory,
      path.join(repoRoot, "tmp/e2e-themes/won-toasts/horizon"),
    );

    const prepared = await prepareThemeWorkspace({
      repoRoot,
      appRoot,
      workspace: "won-toasts",
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
      /shopify:\/\/apps\/won-toasts/u,
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

test("theme workspace applies templateOverlays into the copied checkout, idempotently, and reports a plan without writing", async () => {
  const temporaryRoot = await mkdtemp(
    path.join(os.tmpdir(), "won-theme-workspace-template-overlay-"),
  );
  const repoRoot = path.join(temporaryRoot, "repo");
  const appRoot = path.join(repoRoot, "apps", "example");
  const sourceDirectory = path.join(temporaryRoot, "themes", "Dawn");

  const templateOverlays = [
    {
      template: "templates/product.json",
      block: {
        id: "won_discounts_quantity_tiers",
        type:
          "shopify://apps/won-discounts/blocks/quantity_tiers/11111111-1111-1111-1111-111111111111",
      },
      position: { before: "buy_buttons" },
    },
  ];

  try {
    await mkdir(path.join(sourceDirectory, "layout"), { recursive: true });
    await mkdir(path.join(sourceDirectory, "config"), { recursive: true });
    await mkdir(path.join(sourceDirectory, "templates"), { recursive: true });
    await writeFile(path.join(sourceDirectory, "layout/theme.liquid"), "theme");
    await writeFile(
      path.join(sourceDirectory, "config/settings_data.json"),
      '{"current":{}}',
    );
    await writeFile(
      path.join(sourceDirectory, "templates/product.json"),
      JSON.stringify({
        sections: {
          main: {
            type: "main-product",
            blocks: {
              vendor: { type: "vendor", settings: {} },
              buy_buttons: { type: "buy_buttons", settings: {} },
            },
            block_order: ["vendor", "buy_buttons"],
          },
        },
      }),
    );

    const inspection = await inspectThemeWorkspace({
      repoRoot,
      appRoot,
      workspace: "won-discounts",
      themeKey: "dawn",
      sourceDirectory,
      templateOverlays,
    });
    assert.equal(inspection.templateOverlayPlans.length, 1);
    assert.equal(inspection.templateOverlayPlans[0].action, "insert");
    // inspection must not mutate the canonical checkout.
    assert.doesNotMatch(
      await readFile(
        path.join(sourceDirectory, "templates/product.json"),
        "utf8",
      ),
      /won_discounts_quantity_tiers/u,
    );

    const prepared = await prepareThemeWorkspace({
      repoRoot,
      appRoot,
      workspace: "won-discounts",
      themeKey: "dawn",
      sourceDirectory,
      templateOverlays,
    });

    const productJson = await readFile(
      path.join(prepared, "templates/product.json"),
      "utf8",
    );
    assert.match(productJson, /won_discounts_quantity_tiers/u);
    const parsed = JSON.parse(productJson);
    assert.deepEqual(parsed.sections.main.block_order, [
      "vendor",
      "won_discounts_quantity_tiers",
      "buy_buttons",
    ]);

    // Re-preparing (as a second E2E run would) must stay idempotent.
    await prepareThemeWorkspace({
      repoRoot,
      appRoot,
      workspace: "won-discounts",
      themeKey: "dawn",
      sourceDirectory,
      templateOverlays,
    });
    const reparsed = JSON.parse(
      await readFile(path.join(prepared, "templates/product.json"), "utf8"),
    );
    assert.equal(
      reparsed.sections.main.block_order.filter(
        (id: string) => id === "won_discounts_quantity_tiers",
      ).length,
      1,
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
          workspace: "won-toasts",
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
          workspace: "won-toasts",
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
