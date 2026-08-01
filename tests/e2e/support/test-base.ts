import { test as playwrightTest, expect } from "@playwright/test";
import { installThemeDevJsMimeShim } from "./theme-dev-mime.ts";

/**
 * The single `test` every storefront spec must import — both the parallel matrix
 * (via `fixtures.ts`, which extends this) and the serial tier.
 *
 * It overrides the built-in `page` fixture for one reason: to install the theme-dev
 * MIME shim BEFORE any navigation happens, so the app-embed script is executable on
 * the local theme-dev origin. Importing `test` straight from `@playwright/test` in a
 * storefront spec silently loses the shim and the spec times out on `waitForResponse`.
 */
export const test = playwrightTest.extend({
  page: async ({ page }, use) => {
    await installThemeDevJsMimeShim(page);
    await use(page);
  },
});

export { expect };
