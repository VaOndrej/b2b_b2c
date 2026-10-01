import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { BrowserContext, Page } from "@playwright/test";
import { createStorefrontTest, expect, isThemeDevMode } from "@won/testing/playwright";

// The ONE Playwright `test` every Won Discounts storefront spec imports (never
// `createStorefrontTest` directly): it guards the theme-dev session, so no spec
// can break another one whatever order the specs run in.
//
// Root cause it guards against (observed 2026-09-28, Shopify CLI 4.8.0
// `shopify theme dev`): the theme-dev proxy copies the `_shopify_essential`
// cookie of EVERY proxied response into its own storefront session
// (@shopify/cli dist/chunk-7T6M7FAC.js: `e.session.sessionCookies[_shopify_essential] = <Set-Cookie value>`).
// Shopify's consent banner (`bannerQuery`, POST /api/unstable/graphql.json) and
// Horizon's Storefront API calls answer 400 through the proxy with a fresh,
// UNAUTHENTICATED `_shopify_essential`. From then on every proxied request of
// that theme-dev process — cart AJAX, /products/*.js, even a curl — redirects to
// /password until theme dev restarts. Page renders keep working (they go through
// the render API), so a spec that only loads pages still passes while it
// poisons the session for every spec after it. Aborting the Storefront API on
// the theme-dev origin (nothing we test uses it) keeps the session
// authenticated. The real storefront (checkout) is untouched: there the browser
// owns its cookies.

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const APP_DIR = path.resolve(HERE, "../../..");
export const REPO_ROOT = path.resolve(APP_DIR, "../..");
export const SHOP_DOMAIN = String(process.env.SHOPIFY_E2E_SHOP_DOMAIN ?? "").trim() || "b2b-b2c-store-development.myshopify.com";
export const STORE_ORIGIN = `https://${SHOP_DOMAIN}`;
export const THEME_LABEL = String(process.env.SHOPIFY_E2E_THEME_LABEL ?? "").trim();
/**
 * Which seed profile is on the store (scripts/e2e/seed-mvp1.mjs --profile): each
 * checkout spec runs only under its own profile, so one matrix run per seed ends
 * green on both themes. Default "mvp1"; the shapes matrix sets WON_E2E_PROFILE=shapes.
 */
export const E2E_PROFILE = String(process.env.WON_E2E_PROFILE ?? "").trim() || "mvp1";

const STOREFRONT_API_PATH = /^\/api\/[^/]+\/graphql\.json$/u;
const LOOPBACK_HOST = /^(?:127\.0\.0\.1|localhost|\[::1\])$/u;

/** True when `baseURL` is a local `shopify theme dev` origin (the runner sets SHOPIFY_E2E_THEME_DEV=1). */
export function isThemeDevOrigin(baseURL: string | undefined): boolean {
  if (!baseURL) return false;
  return isThemeDevMode() || LOOPBACK_HOST.test(new URL(baseURL).hostname);
}

/** Abort the Storefront API on the theme-dev origin (see the root cause above). */
export async function guardThemeDevSession(context: BrowserContext, baseURL: string | undefined): Promise<void> {
  if (!baseURL || !isThemeDevOrigin(baseURL)) return;
  const origin = new URL(baseURL).origin;
  await context.route(
    (url) => url.origin === origin && STOREFRONT_API_PATH.test(url.pathname),
    (route) => route.abort(),
  );
}

// Our extension's scripts (the embed + the MVP 3 tiers block and its pure core), served with a JS MIME type through theme dev.
export const test = createStorefrontTest({ javaScriptProxyPaths: ["won-discounts.js", "won-discounts-tiers.js", "won-discounts-tiers-core.js", "won-discounts-cart.js"] }).extend({
  context: async ({ context, baseURL }, use) => {
    await guardThemeDevSession(context, baseURL);
    await use(context);
  },
});

export { expect };

function readDotenvValue(key: string): string {
  const file = path.join(APP_DIR, ".env");
  if (!existsSync(file)) return "";
  for (const raw of readFileSync(file, "utf8").split(/\r?\n/u)) {
    const line = raw.trim();
    if (!line.startsWith(`${key}=`)) continue;
    return line.slice(key.length + 1).trim().replace(/^(?:"(.*)"|'(.*)')$/u, "$1$2");
  }
  return "";
}

/**
 * Unlock the password page of the REAL storefront in this browser's own session
 * (checkout lives there, not on the theme-dev origin). The password comes from
 * SHOPIFY_E2E_STOREFRONT_PASSWORD (env, or that one key of apps/won-discounts/.env,
 * like the matrix runner) and is never logged.
 *
 * The browser form comes first. When Cloudflare answers the form POST with its
 * interactive "Verify you are human" challenge (observed 2026-09-28 after a day
 * of E2E password submissions from one IP: /password?__cf_chl_rt_tk=… → back to
 * /password with a Turnstile box a headless browser cannot pass), the same POST
 * `shopify theme dev` sends (form_type=storefront_password) goes out through the
 * context's request API instead, which shares the browser's cookie jar, so the
 * unlocked storefront cookie lands in this browser session.
 */
export async function unlockRealStorefront(page: Page): Promise<void> {
  const password = String(process.env.SHOPIFY_E2E_STOREFRONT_PASSWORD ?? "").trim() || readDotenvValue("SHOPIFY_E2E_STOREFRONT_PASSWORD");
  await page.goto(`${STORE_ORIGIN}/password`, { waitUntil: "domcontentloaded" });
  // Cloudflare's "Just a moment" interstitial clears by itself.
  for (let i = 0; i < 20 && (await page.title()).includes("Just a moment"); i += 1) await page.waitForTimeout(2_000);
  const input = page.locator("input[type='password']").first();
  if (page.url().includes("/password") && (await input.count()) > 0) {
    expect(password, "SHOPIFY_E2E_STOREFRONT_PASSWORD (env or apps/won-discounts/.env) is needed for the real storefront").not.toBe("");
    // Never type the password with fill/type: on a timeout Playwright's call log prints the filled value
    // (`fill("…")`) into the test output and the evidence. evaluate() arguments are not logged.
    await input.evaluate((el, value) => {
      const field = el as HTMLInputElement;
      field.value = value;
      field.dispatchEvent(new Event("input", { bubbles: true }));
    }, password);
    let challenged = false;
    page.on("framenavigated", (frame) => {
      if (frame === page.mainFrame() && frame.url().includes("__cf_chl")) challenged = true;
    });
    const unlocked = await Promise.all([
      page.waitForURL((url) => !url.pathname.endsWith("/password"), { timeout: 30_000 }).then(
        () => true,
        () => false,
      ),
      input.press("Enter"),
    ]).then(([ok]) => ok);
    if (!unlocked) {
      console.log(`[unlockRealStorefront] browser form did not unlock${challenged ? " (Cloudflare challenge)" : ""}; unlocking through the context request API`);
      const response = await page.context().request.post(`${STORE_ORIGIN}/password`, {
        form: { form_type: "storefront_password", utf8: "\u2713", password },
        maxRedirects: 0,
        failOnStatusCode: false,
      });
      expect(response.status(), "storefront password POST (request API)").toBeLessThan(400);
      await page.goto(`${STORE_ORIGIN}/`, { waitUntil: "domcontentloaded" });
    }
  }
  expect(page.url(), "real storefront still locked").not.toContain("/password");
}

/**
 * page.goto for a storefront page that must load (status < 400). Shopify's storefront
 * now and then answers a transient 5xx ("There was a problem loading this website. Try
 * refreshing", seen on Dawn in the MVP 3 final E2E): that one is reloaded, at most 3 loads,
 * 3 s apart. A 4xx fails at once — it is never transient.
 */
export async function gotoStorefront(page: Page, url: string): Promise<void> {
  for (let attempt = 1; ; attempt += 1) {
    const response = await page.goto(url, { waitUntil: "load" });
    const status = response?.status() ?? 0;
    if (status >= 500 && attempt < 3) {
      console.log(`[gotoStorefront] ${url}: HTTP ${status} on load ${attempt}, reloading`);
      await page.waitForTimeout(3_000);
      continue;
    }
    expect(status, `GET ${url}`).toBeLessThan(400);
    return;
  }
}
