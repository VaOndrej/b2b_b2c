import { expect, test as playwrightTest } from "@playwright/test";

import { installThemeDevJsMimeShim } from "./theme-dev-mime.ts";

export interface StorefrontTestOptions {
  javaScriptProxyPaths?: readonly string[];
}

export function createStorefrontTest({
  javaScriptProxyPaths = [],
}: StorefrontTestOptions = {}) {
  return playwrightTest.extend({
    page: async ({ page }, use) => {
      await installThemeDevJsMimeShim(page, javaScriptProxyPaths);
      await use(page);
    },
  });
}

export const test = createStorefrontTest();
export { expect };
