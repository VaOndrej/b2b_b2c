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

/** Read the variant id from the product page's add-to-cart form. */
export async function firstVariantId(page: Page): Promise<string> {
  return page
    .locator(
      "form[action*='/cart/add'] [name='id'], form[action*='/cart/add'] input[name='id']",
    )
    .first()
    .inputValue();
}

export async function addToCart(
  page: Page,
  variantId: string | number,
  quantity = 1,
): Promise<void> {
  await page.evaluate(
    async ({ id, qty }) => {
      await fetch("/cart/add.js", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, quantity: qty }),
      });
    },
    { id: variantId, qty: quantity },
  );
}

/** Add a line carrying the Won GiftLadder `_gift_progress` property. */
export async function addGiftLine(
  page: Page,
  variantId: string | number,
): Promise<void> {
  await page.evaluate(
    async ({ id }) => {
      await fetch("/cart/add.js", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id,
          quantity: 1,
          properties: { _gift_progress: "1" },
        }),
      });
    },
    { id: variantId },
  );
}

export async function setLineQuantity(
  page: Page,
  variantId: string | number,
  quantity: number,
): Promise<void> {
  await page.evaluate(
    async ({ id, qty }) => {
      await fetch("/cart/change.js", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: String(id), quantity: qty }),
      });
    },
    { id: variantId, qty: quantity },
  );
}

/** Toasts render inside the open shadow root; Playwright pierces it for CSS. */
export function toast(page: Page, type?: string) {
  const selector = type
    ? `[data-won-toast][data-type='${type}']`
    : "[data-won-toast]";
  return page.locator(selector);
}
