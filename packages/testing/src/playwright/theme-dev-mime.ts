import type { Page } from "@playwright/test";

import type { ThemeEnvironment } from "./theme.ts";

export function isThemeDevMode(env: ThemeEnvironment = process.env): boolean {
  return String(env.SHOPIFY_E2E_THEME_DEV ?? "").trim() === "1";
}

export async function installThemeDevJsMimeShim(
  page: Page,
  javaScriptProxyPaths: readonly string[],
  env: ThemeEnvironment = process.env,
): Promise<void> {
  if (!isThemeDevMode(env) || javaScriptProxyPaths.length === 0) {
    return;
  }

  await page.route(
    (url) =>
      javaScriptProxyPaths.some((scriptPath) =>
        url.pathname.endsWith(scriptPath),
      ),
    async (route) => {
      const response = await route.fetch();
      await route.fulfill({
        response,
        headers: {
          ...response.headers(),
          "content-type": "text/javascript; charset=utf-8",
        },
      });
    },
  );
}
