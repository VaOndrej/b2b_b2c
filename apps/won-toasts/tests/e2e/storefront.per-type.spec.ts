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

// Per-type look/behaviour overrides (byType) win over the global default on the
// storefront (default + override). Cart events resolve to the "cart" type.

test.describe("Won Toasts — per-type override on the storefront", () => {
  test("a per-type BEHAVIOUR override beats the global default", async ({
    page,
  }) => {
    // Global says no close button; the cart type overrides it back on.
    await mockConfig(page, {
      global: { closeable: false, autoDismiss: false },
      byType: { cart: { behavior: { closeable: true } } },
    });
    await openProduct(page, TOASTS_E2E_HANDLES.primary);
    await readyEmbed(page);
    await clearCart(page);

    const variantId = await firstVariantId(page);
    await addToCart(page, variantId, 1);

    const added = toast(page, "added");
    await expect(added).toHaveCount(1);
    // Overridden ON for the cart type despite the global default being OFF.
    await expect(added.locator("[data-won-toast-close]")).toBeVisible();
  });

  test("a per-type LOOK override sets the toast's own colour tokens", async ({
    page,
  }) => {
    await mockConfig(page, {
      byType: {
        cart: { theme: { mode: "custom", colorBg: "#ff0000", colorText: "#ffffff" } },
      },
    });
    await openProduct(page, TOASTS_E2E_HANDLES.primary);
    await readyEmbed(page);
    await clearCart(page);

    const variantId = await firstVariantId(page);
    await addToCart(page, variantId, 1);

    const added = toast(page, "added");
    await expect(added).toHaveCount(1);
    // finalizeCard set the resolved type tokens inline on the card.
    const bg = await added.evaluate((el) =>
      (el as HTMLElement).style.getPropertyValue("--won-bg").trim(),
    );
    expect(bg.toLowerCase()).toBe("#ff0000");
  });

  test("per-type width + entry animation apply to the card, tagged with its type", async ({
    page,
  }) => {
    await mockConfig(page, {
      byType: { cart: { theme: { width: 500, animationIn: "fade" } } },
    });
    await openProduct(page, TOASTS_E2E_HANDLES.primary);
    await readyEmbed(page);
    await clearCart(page);

    const variantId = await firstVariantId(page);
    await addToCart(page, variantId, 1);

    const added = toast(page, "added");
    await expect(added).toHaveCount(1);
    // Type hook for CSS power users + per-type width token + per-type animation.
    await expect(added).toHaveAttribute("data-won-type", "cart");
    await expect(added).toHaveAttribute("data-anim", "fade");
    const width = await added.evaluate((el) =>
      (el as HTMLElement).style.getPropertyValue("--won-width").trim(),
    );
    expect(width).toBe("500px");
  });

  test("with no override the toast uses the global default look", async ({
    page,
  }) => {
    await mockConfig(page, {
      theme: { mode: "custom", colorBg: "#0000ff", colorText: "#ffffff" },
    });
    await openProduct(page, TOASTS_E2E_HANDLES.primary);
    await readyEmbed(page);
    await clearCart(page);

    const variantId = await firstVariantId(page);
    await addToCart(page, variantId, 1);

    const added = toast(page, "added");
    await expect(added).toHaveCount(1);
    // No per-card override → the card inherits the region's default tokens; its
    // own inline --won-bg is unset.
    const inlineBg = await added.evaluate((el) =>
      (el as HTMLElement).style.getPropertyValue("--won-bg").trim(),
    );
    expect(inlineBg).toBe("");
  });
});
