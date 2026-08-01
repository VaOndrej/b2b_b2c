import assert from "node:assert/strict";
import test from "node:test";

import { resolveThemePaths } from "../src/theme-paths.ts";

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

