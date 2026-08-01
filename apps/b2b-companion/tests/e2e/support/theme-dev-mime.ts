import type { Page } from "@playwright/test";

/**
 * Workaround for a `shopify theme dev` bug, active ONLY in theme-dev mode.
 *
 * theme dev proxies `/apps/*` to the store and forwards Shopify's response BODY
 * unchanged, but rewrites the `Content-Type` of anything that is not
 * `application/json` to `text/html`. Measured 2026-07-10: text/javascript,
 * application/javascript, text/css and text/plain all arrive as text/html.
 *
 * Because the storefront also sends `X-Content-Type-Options: nosniff`, the browser
 * then REFUSES to execute the app-embed script:
 *
 *   Refused to execute script from '/apps/margin-guard/visibility-script'
 *   because its MIME type ('text/html') is not executable
 *
 * With the script dead, no `/visibility` request is ever made and every storefront
 * assertion times out on `waitForResponse`.
 *
 * This is NOT an app defect. Verified in a real browser against the live storefront:
 * the same script is served as `text/javascript; charset=utf-8`, executes, and issues
 * its `/visibility` requests. Only the local theme-dev origin corrupts the header, so
 * this shim is scoped to `SHOPIFY_E2E_THEME_DEV=1` and never runs against remote.
 *
 * It restores the header the app actually sent — it does not fabricate behavior. If
 * the app ever stops serving executable JS, the remote matrix still catches it.
 */
const VISIBILITY_SCRIPT_PATH = "/apps/margin-guard/visibility-script";

export function isThemeDevMode(): boolean {
  return process.env.SHOPIFY_E2E_THEME_DEV === "1";
}

export async function installThemeDevJsMimeShim(page: Page): Promise<void> {
  if (!isThemeDevMode()) {
    return;
  }

  await page.route(
    (url) => url.pathname.endsWith(VISIBILITY_SCRIPT_PATH),
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
