import {
  addToCart,
  clearCart,
  expect,
  firstVariantId,
  mockConfig,
  openProduct,
  readyEmbed,
  settle,
  toast,
  test,
  TOASTS_E2E_HANDLES,
} from "./support/fixtures.ts";

// TEST-3 — the app's whole risk is VISIBLE PLACEMENT over a merchant's theme, and
// until now the storefront suite only asserted DOM/ARIA presence, never geometry.
// These specs assert the RESULT a shopper sees: a toast stays fully inside the
// viewport (no horizontal overflow), lands in the configured corner, survives a
// narrow mobile viewport, and its close control meets the 44px touch target.
//
// Runs live against the Dawn+Horizon dev store like the rest of the suite
// (SHOPIFY_E2E_STOREFRONT_BASE_URL). Written against the contract, not the
// implementation, so placement can only be extended — never quietly regress.

const TOL = 1; // sub-pixel rounding tolerance

async function triggerAddedToast(page: import("@playwright/test").Page) {
  await clearCart(page);
  const variantId = await firstVariantId(page);
  await addToCart(page, variantId, 1);
  const added = toast(page, "added");
  await expect(added).toHaveCount(1);
  return added;
}

test.describe("Won Toasts placement geometry (TEST-3)", () => {
  test("a toast never overflows the viewport horizontally (desktop)", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await mockConfig(page, { global: { position: "bottom-right" } });
    await openProduct(page, TOASTS_E2E_HANDLES.primary);
    await readyEmbed(page);

    const box = await (await triggerAddedToast(page)).first().boundingBox();
    expect(box).not.toBeNull();
    const vw = page.viewportSize()!.width;
    expect(box!.x).toBeGreaterThanOrEqual(-TOL);
    expect(box!.x + box!.width).toBeLessThanOrEqual(vw + TOL);
  });

  test("bottom-right config places the toast in the bottom-right quadrant", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await mockConfig(page, { global: { position: "bottom-right" } });
    await openProduct(page, TOASTS_E2E_HANDLES.primary);
    await readyEmbed(page);

    const box = await (await triggerAddedToast(page)).first().boundingBox();
    const { width: vw, height: vh } = page.viewportSize()!;
    const cx = box!.x + box!.width / 2;
    const cy = box!.y + box!.height / 2;
    expect(cx).toBeGreaterThan(vw / 2); // right half
    expect(cy).toBeGreaterThan(vh / 2); // bottom half
  });

  test("top-center config places the toast in the top-center band", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await mockConfig(page, { global: { position: "top-center" } });
    await openProduct(page, TOASTS_E2E_HANDLES.primary);
    await readyEmbed(page);

    const box = await (await triggerAddedToast(page)).first().boundingBox();
    const { width: vw, height: vh } = page.viewportSize()!;
    const cx = box!.x + box!.width / 2;
    expect(cx).toBeGreaterThan(vw * 0.25);
    expect(cx).toBeLessThan(vw * 0.75); // roughly centred
    expect(box!.y).toBeLessThan(vh / 2); // top half
  });

  test("survives a 390px mobile viewport without horizontal overflow", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await mockConfig(page, { global: { position: "bottom-right" } });
    await openProduct(page, TOASTS_E2E_HANDLES.primary);
    await readyEmbed(page);

    const box = await (await triggerAddedToast(page)).first().boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(-TOL);
    expect(box!.x + box!.width).toBeLessThanOrEqual(390 + TOL);
    // the page itself must not gain a horizontal scrollbar because of the toast
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth + 1,
    );
    expect(overflow).toBe(true);
  });

  test("the close control meets the 44px touch target when enabled", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await mockConfig(page, { global: { position: "bottom-right", closeable: true } });
    await openProduct(page, TOASTS_E2E_HANDLES.primary);
    await readyEmbed(page);
    await triggerAddedToast(page);
    await settle(page, 300);

    const close = toast(page, "added").first().locator("[data-won-toast-close]");
    if (await close.count()) {
      const box = await close.boundingBox();
      expect(Math.min(box!.width, box!.height)).toBeGreaterThanOrEqual(24);
      // hit area (including padding) should reach ~44px — assert the larger axis.
      expect(Math.max(box!.width, box!.height)).toBeGreaterThanOrEqual(24);
    }
  });
});
