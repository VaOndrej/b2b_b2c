import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import type { Page, TestInfo } from "@playwright/test";
import { WON_E2E_PRODUCTS } from "@won/testing/e2e-products";
import { assertResponsiveSane } from "@won/testing/playwright";

import { expect, gotoStorefront, test } from "./support/fixtures.ts";

// SPEC-DRIVEN (MVP 0, Task 6). Live proof that the Won Discounts app embed —
// switched on through the e2e/settings_data.*.json overlay, never by hand —
// renders and boots on BOTH shared themes. Only our own markers are asserted
// (never theme DOM), so the same spec holds on Horizon and Dawn.
//
// `test` is the shared fixture (support/fixtures.ts): it keeps the theme-dev
// session authenticated, so loading the PDP here never breaks the cart AJAX of
// a spec that runs after this one.

const PDP_PATH = `/products/${WON_E2E_PRODUCTS.simpleA.handle}`;
const OUR_ASSET = /\/won-discounts\.(?:js|css)(?:\?|$)/u;
const OUR_SOURCE = /won-discounts\.js|WonDiscounts/u;
const THEME_LABEL = String(process.env.SHOPIFY_E2E_THEME_LABEL ?? "").trim();
const SCREENSHOT_DIR = String(
  process.env.WON_DISCOUNTS_E2E_SCREENSHOT_DIR ?? "",
).trim();

declare global {
  interface Window {
    WonDiscounts?: { ready?: boolean; version?: string };
  }
}

/** Collect every console/page/network error that originates from our asset. */
function watchOurErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    const location = message.location().url ?? "";
    if (OUR_ASSET.test(location) || OUR_SOURCE.test(message.text())) {
      errors.push(`console: ${message.text()} @ ${location}`);
    }
  });
  page.on("pageerror", (error) => {
    if (OUR_SOURCE.test(`${error.message}\n${error.stack ?? ""}`)) {
      errors.push(`pageerror: ${error.message}`);
    }
  });
  page.on("response", (response) => {
    if (OUR_ASSET.test(response.url()) && response.status() >= 400) {
      errors.push(`HTTP ${response.status()}: ${response.url()}`);
    }
  });
  page.on("requestfailed", (request) => {
    if (OUR_ASSET.test(request.url())) {
      errors.push(
        `requestfailed: ${request.url()} (${request.failure()?.errorText})`,
      );
    }
  });
  return errors;
}

/** Open the PDP and wait until the embed is rendered AND its JS has booted. */
async function openReadyPdp(page: Page) {
  await gotoStorefront(page, PDP_PATH);

  const embed = page.locator("[data-won-discounts-embed]");
  await expect(
    embed,
    "app embed marker missing — is the overlay applied and `shopify app dev` running?",
  ).toHaveCount(1);
  await expect(embed).toHaveAttribute("id", "won-discounts-root");
  // Liquid renders "loading"; only assets/won-discounts.js sets "ready" (after
  // window.WonDiscounts exists), so this proves the storefront JS actually ran.
  await expect(embed).toHaveAttribute("data-won-discounts-status", "ready");
  await page.waitForFunction(() => window.WonDiscounts?.ready === true);
  return embed;
}

/**
 * Mobile sanity scoped to what this app owns. The repo-wide
 * `assertResponsiveSane` also enforces 44px tap targets on EVERY control of
 * the page; on the stock Horizon/Dawn PDP that fails on controls we neither
 * render nor can fix (Shopify's cookie banner `button.shopify-pc__banner__*`,
 * Horizon `button.email-signup__button` / `button.policy-list-trigger`, Dawn
 * `button.disclosure__button` / `summary.share-button__button` — observed
 * 2026-09-28). So: the PAGE must not scroll horizontally (theme + our embed
 * together — `assertResponsiveSane`'s page-level check is never scoped away),
 * and the size/tap-target laws apply to our embed subtree only, via `root`.
 */
async function assertEmbedResponsiveSane(page: Page) {
  await assertResponsiveSane(page, { root: "#won-discounts-root" });
}

async function saveScreenshot(page: Page, testInfo: TestInfo, width: number) {
  const body = await page.screenshot();
  await testInfo.attach(`pdp-${width}`, { body, contentType: "image/png" });
  if (!SCREENSHOT_DIR || !THEME_LABEL) return;
  mkdirSync(SCREENSHOT_DIR, { recursive: true });
  writeFileSync(
    path.join(
      SCREENSHOT_DIR,
      `e2e-embed-${THEME_LABEL.toLowerCase()}-${width}.png`,
    ),
    body,
  );
}

test.describe(`Won Discounts app embed (MVP 0)${THEME_LABEL ? ` — ${THEME_LABEL}` : ""}`, () => {
  test("renders the ready marker and boots window.WonDiscounts on the PDP", async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const ourErrors = watchOurErrors(page);

    await openReadyPdp(page);

    // Shopify injected our embed asset (proves the block is the app's, live).
    await expect(page.locator('script[src*="won-discounts.js"]')).not.toHaveCount(0);
    const state = await page.evaluate(() => ({
      ready: window.WonDiscounts?.ready,
      version: window.WonDiscounts?.version,
      themeName:
        (window as unknown as { Shopify?: { theme?: { name?: string } } })
          .Shopify?.theme?.name ?? null,
    }));
    expect(state.ready).toBe(true);
    expect(state.version).toBeTruthy();
    if (THEME_LABEL) {
      // Each matrix leg must really be served by its own theme.
      expect(state.themeName ?? "").toContain(THEME_LABEL);
    }

    await saveScreenshot(page, testInfo, 1440);
    expect(ourErrors, "errors originating from won-discounts assets").toEqual([]);
  });

  test("causes no horizontal overflow at 390px", async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const ourErrors = watchOurErrors(page);

    await openReadyPdp(page);
    await assertEmbedResponsiveSane(page);

    await saveScreenshot(page, testInfo, 390);
    expect(ourErrors, "errors originating from won-discounts assets").toEqual([]);
  });
});
