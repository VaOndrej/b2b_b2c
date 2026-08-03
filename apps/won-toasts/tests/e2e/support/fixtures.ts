import { createStorefrontTest, expect } from "@won/testing/playwright";
import { WON_E2E_PRODUCTS } from "@won/testing/e2e-products";
import type { Page } from "@playwright/test";

// Roles mapped onto the SHARED E2E product catalog. Never create app-specific
// products — every app reuses these.
export const TOASTS_E2E_HANDLES = {
  primary: WON_E2E_PRODUCTS.simpleA.handle,
  secondary: WON_E2E_PRODUCTS.simpleB.handle,
} as const;

const base = createStorefrontTest({ javaScriptProxyPaths: ["won-toasts.js"] });

export const test = base;
export { expect };

export async function openProduct(page: Page, handle: string): Promise<void> {
  await page.goto(`/products/${handle}`, { waitUntil: "domcontentloaded" });
}

/** Wait until the app embed reports it has mounted the Shadow-DOM host. */
export async function readyEmbed(page: Page) {
  const embed = page.locator("[data-won-toasts-embed]");
  await embed.waitFor({ state: "attached" });
  await expect(embed).toHaveAttribute("data-won-toasts-status", "ready");
  return embed;
}

/** True when the host exists and owns a live region inside its shadow root. */
export async function hasShadowRegion(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const host = document.querySelector(
      "won-toast-host[data-won-toasts-host]",
    ) as HTMLElement & { shadowRoot?: ShadowRoot | null };
    return Boolean(
      host?.shadowRoot?.querySelector("[data-won-toasts-region]"),
    );
  });
}

export async function cartItems(
  page: Page,
): Promise<Array<{ id: number; quantity: number }>> {
  return page.evaluate(async () => {
    const cart = await fetch("/cart.js", {
      headers: { Accept: "application/json" },
    }).then((response) => response.json());
    return cart.items ?? [];
  });
}

export async function clearCart(page: Page): Promise<void> {
  await page.evaluate(async () => {
    await fetch("/cart/clear.js", { method: "POST" });
  });
}
