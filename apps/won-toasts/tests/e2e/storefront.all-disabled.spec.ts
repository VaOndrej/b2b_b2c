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
    page.on("pageerror", (err) => errors.push(String(err)));
    page.on("console", (msg) => {
      if (msg.type() === "error") errors.push(msg.text());
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
    page.on("pageerror", (err) => errors.push(String(err)));
    page.on("console", (msg) => {
      if (msg.type() === "error") errors.push(msg.text());
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
