import {
  cartItems,
  expect,
  hasShadowRegion,
  openProduct,
  readyEmbed,
  test,
  TOASTS_E2E_HANDLES,
} from "./support/fixtures.ts";

// SPEC-DRIVEN (won-toasts-mvp-plan.md MVP0). Written against the contract, not
// the implementation, so later MVPs can only extend — never quietly regress —
// this baseline. Runs live once the app embed is enabled in the shared themes.
test.describe("Won Toasts storefront skeleton (MVP0)", () => {
  test("mounts a ready Shadow-DOM host on Dawn and Horizon", async ({
    page,
  }) => {
    await openProduct(page, TOASTS_E2E_HANDLES.primary);
    const embed = await readyEmbed(page);

    await expect(embed).toHaveAttribute("data-won-toasts-status", "ready");
    expect(await hasShadowRegion(page)).toBe(true);
  });

  test("is a pure surface: loading a page never mutates the cart", async ({
    page,
  }) => {
    await openProduct(page, TOASTS_E2E_HANDLES.primary);
    await readyEmbed(page);

    // MVP0 renders nothing and must not add/remove anything by merely loading.
    expect((await cartItems(page)).length).toBe(0);
  });
});
