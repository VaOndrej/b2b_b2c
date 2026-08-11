import {
  addToCart,
  clearCart,
  expect,
  firstVariantId,
  mockConfig,
  openProduct,
  readyEmbed,
  test,
  toast,
  TOASTS_E2E_HANDLES,
} from "./support/fixtures.ts";

// Edge case the merchant hit: turning every toast OFF. The storefront must stay
// completely silent AND error-free — no toast, no thrown script. (Regression
// guard: the admin save white-screened; this proves the resulting all-off config
// is benign on the storefront.)

test.describe("Won Toasts — everything turned off is silent, not broken", () => {
  test("all cart events off → no toast and no page/console errors on add", async ({
    page,
  }) => {
    const errors: string[] = [];
    // A thrown, uncaught script is always a fault — keep every pageerror.
    page.on("pageerror", (err) => errors.push(String(err)));
    // Console errors, however, are dominated by Shopify's own headless-dev-store
    // noise that has nothing to do with Won Toasts: Shop Pay wallet resource 4xx
    // (`shop.app/pay/hop`), the Shop Pay iframe CSP `frame-ancestors` block, and
    // `[shopify-account] Menu ... not found` fallbacks. This spec guards that OUR
    // storefront stays silent, so only Won-Toasts-attributable console errors
    // count; a real Won Toasts throw still surfaces via pageerror above.
    page.on("console", (msg) => {
      if (msg.type() !== "error") return;
      const text = msg.text();
      const from = msg.location()?.url ?? "";
      if (/won-toasts/i.test(text) || /won-toasts/i.test(from)) errors.push(text);
    });

    // Every individually-toggleable cart event is off; no milestones either.
    await mockConfig(page, {
      cartEvents: {
        added: false,
        removed: false,
        increased: false,
        decreased: false,
      },
      milestones: [],
    });
    await openProduct(page, TOASTS_E2E_HANDLES.primary);
    await readyEmbed(page);
    await clearCart(page);

    const variantId = await firstVariantId(page);
    await addToCart(page, variantId, 1);

    // Give the engine a beat to (not) render anything.
    await page.waitForTimeout(600);
    await expect(toast(page)).toHaveCount(0);
    expect(errors, `unexpected storefront errors:\n${errors.join("\n")}`).toEqual([]);
  });

  test("app disabled entirely → embed loads, stays silent, no errors", async ({
    page,
  }) => {
    const errors: string[] = [];
    // A thrown, uncaught script is always a fault — keep every pageerror.
    page.on("pageerror", (err) => errors.push(String(err)));
    // Console errors, however, are dominated by Shopify's own headless-dev-store
    // noise that has nothing to do with Won Toasts: Shop Pay wallet resource 4xx
    // (`shop.app/pay/hop`), the Shop Pay iframe CSP `frame-ancestors` block, and
    // `[shopify-account] Menu ... not found` fallbacks. This spec guards that OUR
    // storefront stays silent, so only Won-Toasts-attributable console errors
    // count; a real Won Toasts throw still surfaces via pageerror above.
    page.on("console", (msg) => {
      if (msg.type() !== "error") return;
      const text = msg.text();
      const from = msg.location()?.url ?? "";
      if (/won-toasts/i.test(text) || /won-toasts/i.test(from)) errors.push(text);
    });

    await mockConfig(page, { enabled: false });
    await openProduct(page, TOASTS_E2E_HANDLES.primary);
    // Embed may short-circuit when disabled; either way it must not throw.
    await clearCart(page);
    const variantId = await firstVariantId(page);
    await addToCart(page, variantId, 1);

    await page.waitForTimeout(600);
    await expect(toast(page)).toHaveCount(0);
    expect(errors, `unexpected storefront errors:\n${errors.join("\n")}`).toEqual([]);
  });
});
