import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { resolveThemePaths } from "../src/theme-paths.js";

test("theme paths resolve from the monorepo root, not an app workspace", () => {
  assert.deepEqual(
    resolveThemePaths({
      repoRoot: "/repo/b2b_b2c",
      env: {},
    }),
    {
      horizon: "/repo/b2b_b2c_themes/Horizon",
      dawn: "/repo/b2b_b2c_themes/Dawn",
    },
  );
});

test("theme path environment overrides win independently", () => {
  assert.deepEqual(
    resolveThemePaths({
      repoRoot: "/repo/b2b_b2c",
      env: {
        SHOPIFY_E2E_THEME_DIR_HORIZON: "/themes/custom-horizon",
        SHOPIFY_E2E_THEME_DIR_DAWN: " /themes/custom-dawn ",
      },
    }),
    {
      horizon: "/themes/custom-horizon",
      dawn: "/themes/custom-dawn",
    },
  );
});

test("relative overrides resolve against the monorepo root", () => {
  assert.deepEqual(
    resolveThemePaths({
      repoRoot: "/repo/b2b_b2c",
      env: {
        SHOPIFY_E2E_THEME_DIR_HORIZON: "fixtures/Horizon",
      },
    }),
    {
      horizon: "/repo/b2b_b2c/fixtures/Horizon",
      dawn: "/repo/b2b_b2c_themes/Dawn",
    },
  );
});

test("linked worktrees resolve themes beside the primary checkout", async () => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "won-worktree-"));
  const primaryCheckout = path.join(temporaryRoot, "source/b2b_b2c");
  const worktreeRoot = path.join(temporaryRoot, "worktrees/feature");
  const themesRoot = path.join(temporaryRoot, "source/b2b_b2c_themes");
  try {
    await mkdir(worktreeRoot, { recursive: true });
    await mkdir(path.join(themesRoot, "Horizon"), { recursive: true });
    await mkdir(path.join(themesRoot, "Dawn"), { recursive: true });
    await writeFile(
      path.join(worktreeRoot, ".git"),
      `gitdir: ${primaryCheckout}/.git/worktrees/feature\n`,
    );

    assert.deepEqual(resolveThemePaths({ repoRoot: worktreeRoot, env: {} }), {
      horizon: path.join(themesRoot, "Horizon"),
      dawn: path.join(themesRoot, "Dawn"),
    });
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});
