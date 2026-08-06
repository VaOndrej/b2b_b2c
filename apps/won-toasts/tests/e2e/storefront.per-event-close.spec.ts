import {
  addToCart,
  clearCart,
  expect,
  firstVariantId,
  mockConfig,
  openProduct,
  readyEmbed,
  setLineQuantity,
  test,
  toast,
  TOASTS_E2E_HANDLES,
} from "./support/fixtures.ts";

// Change-scoped regression specs for two shipped storefront features:
//  - per cart-event on/off (a merchant can silence e.g. "removed" toasts)
//  - the close (×) affordance (visible when enabled; dismisses the toast)
// Written against the config contract via mockConfig, so they run on Dawn+Horizon.

test.describe("Won Toasts — per cart-event on/off", () => {
  test("disabling 'removed' suppresses its toast while 'added' still shows", async ({
    page,
  }) => {
    await mockConfig(page, { cartEvents: { removed: false } });
    await openProduct(page, TOASTS_E2E_HANDLES.primary);
    await readyEmbed(page);
    await clearCart(page);

    const variantId = await firstVariantId(page);
    await addToCart(page, variantId, 1);
    // The event that stays on still toasts.
    await expect(toast(page, "added")).toHaveCount(1);

    // Remove the line — normally a "removed" toast; here it's disabled.
    await setLineQuantity(page, variantId, 0);
    // Re-add to prove the storefront processed the removal cycle (deterministic
    // sync point) — the "added" toast reappears...
    await addToCart(page, variantId, 1);
    await expect(toast(page, "added")).toHaveCount(1);
    // ...but the disabled "removed" toast never appeared.
    await expect(toast(page, "removed")).toHaveCount(0);
  });

  test("with no override every cart event still toasts (default = on)", async ({
    page,
  }) => {
    await mockConfig(page, {});
    await openProduct(page, TOASTS_E2E_HANDLES.primary);
    await readyEmbed(page);
    await clearCart(page);

    const variantId = await firstVariantId(page);
    await addToCart(page, variantId, 1);
    await expect(toast(page, "added")).toHaveCount(1);
    await setLineQuantity(page, variantId, 0);
    await expect(toast(page, "removed")).toHaveCount(1);
  });
});

test.describe("Won Toasts — close (×) affordance", () => {
  test("the close button is visible when enabled and dismisses the toast", async ({
    page,
  }) => {
    // autoDismiss off so the toast stays until the shopper acts (deterministic).
    await mockConfig(page, { global: { closeable: true, autoDismiss: false } });
    await openProduct(page, TOASTS_E2E_HANDLES.primary);
    await readyEmbed(page);
    await clearCart(page);

    const variantId = await firstVariantId(page);
    await addToCart(page, variantId, 1);

    const added = toast(page, "added");
    await expect(added).toHaveCount(1);
    const close = added.locator("[data-won-toast-close]");
    await expect(close).toBeVisible();

    await close.click();
    await expect(added).toHaveCount(0);
  });

  test("no close button when it is turned off", async ({ page }) => {
    await mockConfig(page, { global: { closeable: false, autoDismiss: false } });
    await openProduct(page, TOASTS_E2E_HANDLES.primary);
    await readyEmbed(page);
    await clearCart(page);

    const variantId = await firstVariantId(page);
    await addToCart(page, variantId, 1);

    const added = toast(page, "added");
    await expect(added).toHaveCount(1);
    await expect(added.locator("[data-won-toast-close]")).toHaveCount(0);
  });
});
