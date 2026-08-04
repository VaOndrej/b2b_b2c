import {
  addToCart,
  clearCart,
  expect,
  firstVariantId,
  mockConfig,
  mockInventory,
  openProduct,
  readyEmbed,
  test,
  toast,
  TOASTS_E2E_HANDLES,
} from "./support/fixtures.ts";

// SPEC-DRIVEN (MVP14, acceptance 1). Accessibility: the live region is polite,
// ambient toasts use role=status, and genuinely urgent ones use role=alert.
test.describe("Won Toasts accessibility (MVP14)", () => {
  test("the live region is a polite aria-live status region", async ({
    page,
  }) => {
    await openProduct(page, TOASTS_E2E_HANDLES.primary);
    await readyEmbed(page);

    const region = page.locator("[data-won-toasts-region]");
    await expect(region).toHaveAttribute("aria-live", "polite");
    await expect(region).toHaveAttribute("role", "status");
  });

  test("an ambient cart toast exposes role=status", async ({ page }) => {
    await openProduct(page, TOASTS_E2E_HANDLES.primary);
    await readyEmbed(page);
    await clearCart(page);

    const variantId = await firstVariantId(page);
    await addToCart(page, variantId, 1);

    const added = toast(page, "added");
    await expect(added).toHaveCount(1);
    await expect(added).toHaveAttribute("role", "status");
  });

  test("an urgent low-stock toast escalates to role=alert", async ({ page }) => {
    await mockConfig(page, {
      plan: "pro",
      notifications: [
        {
          id: "few",
          type: "stock.low",
          enabled: true,
          surface: "toast",
          pages: ["product"],
          message: "Only {count} left",
          threshold: 5,
        },
      ],
    });
    await mockInventory(page, TOASTS_E2E_HANDLES.primary, 2);
    await openProduct(page, TOASTS_E2E_HANDLES.primary);
    await readyEmbed(page);

    const stock = toast(page, "stock");
    await expect(stock).toHaveCount(1);
    await expect(stock).toHaveAttribute("role", "alert");
  });
});
