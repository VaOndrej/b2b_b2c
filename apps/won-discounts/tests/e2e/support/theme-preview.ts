import type { Page } from "@playwright/test";

import { expect, gotoStorefront, STORE_ORIGIN, THEME_LABEL, unlockRealStorefront } from "./fixtures.ts";
import { executeAsApp } from "./won-plan.ts";

/**
 * The specs of the cart panel and the ladder run on the REAL store domain, previewing the theme `shopify theme dev` syncs (the matrix's
 * remote theme "Horizon" / "Dawn", unpublished: its workspace with the overlays). Why: the cart panel writes through
 * Shopify.actions.updateCart, which posts to the storefront's own /api/<version>/graphql.json — the theme-dev proxy
 * (127.0.0.1) does not serve that path (net::ERR_FAILED, probed 2026-10-01), a live storefront always does.
 */
export async function openThemePreview(page: Page): Promise<void> {
  const data = await executeAsApp<{ themes: { nodes: { id: string; name: string; role: string }[] } }>("query WonE2eThemes { themes(first: 50) { nodes { id name role } } }", {});
  const theme = data.themes.nodes.find((t) => t.name === THEME_LABEL);
  expect(theme, `the matrix's remote theme "${THEME_LABEL}" exists`).toBeDefined();
  expect(theme!.role, "previewed, never published").not.toBe("MAIN");
  // The store domain shows Shopify's preview bar and cookie banner over the bottom of the page: hide the bar (screenshots
  // only), decline the banner once (it then stays away for the session). Neither touches the cart.
  await page.addInitScript(() => {
    document.addEventListener("DOMContentLoaded", () => {
      const style = document.createElement("style");
      style.textContent = "#preview-bar-iframe, #PBarNextFrameWrapper { display: none !important; }";
      document.head.append(style);
    });
  });
  await unlockRealStorefront(page);
  await gotoStorefront(page, `${STORE_ORIGIN}/?preview_theme_id=${theme!.id.split("/").pop()}`);
  const decline = page.locator("#shopify-pc__banner__btn-decline");
  if (await decline.isVisible({ timeout: 5_000 }).catch(() => false)) await decline.click();
  const shown = await page.evaluate(() => (window as unknown as { Shopify?: { theme?: { name?: string } } }).Shopify?.theme?.name ?? null);
  expect(shown, "the store renders the previewed theme").toBe(THEME_LABEL);
}

/** A storefront page of the previewed theme (absolute: the page is on the store domain, not the theme-dev base URL). */
export const go = (page: Page, path: string) => gotoStorefront(page, `${STORE_ORIGIN}${path}`);
