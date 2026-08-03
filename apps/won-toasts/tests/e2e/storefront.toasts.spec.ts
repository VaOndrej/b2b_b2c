import {
  addGiftLine,
  addToCart,
  cartItems,
  clearCart,
  expect,
  firstVariantId,
  hasShadowRegion,
  openProduct,
  readyEmbed,
  setLineQuantity,
  test,
  toast,
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

// SPEC-DRIVEN (MVP1). Cart toasts with delta + user-initiated Undo.
test.describe("Won Toasts cart events (MVP1)", () => {
  test("adding a product shows an 'added' toast with the delta", async ({
    page,
  }) => {
    await openProduct(page, TOASTS_E2E_HANDLES.primary);
    await readyEmbed(page);
    await clearCart(page);

    const variantId = await firstVariantId(page);
    await addToCart(page, variantId, 2);

    const added = toast(page, "added");
    await expect(added).toHaveCount(1);
    await expect(added.locator("[data-won-toast-delta]")).toHaveText("+2");
  });

  test("removing a line shows a 'removed' toast whose Undo restores it", async ({
    page,
  }) => {
    await openProduct(page, TOASTS_E2E_HANDLES.primary);
    await readyEmbed(page);
    await clearCart(page);

    const variantId = await firstVariantId(page);
    await addToCart(page, variantId, 1);
    await expect(toast(page, "added")).toHaveCount(1);

    // remove the line
    await setLineQuantity(page, variantId, 0);
    const removed = toast(page, "removed");
    await expect(removed).toHaveCount(1);
    expect((await cartItems(page)).length).toBe(0);

    // Undo is the only cart write the surface performs — it restores the line.
    await removed.locator("[data-won-toast-undo]").click();
    await expect
      .poll(async () => (await cartItems(page)).length)
      .toBeGreaterThan(0);
  });
});

// SPEC-DRIVEN (MVP2). Toast look is driven by the admin theme tokens; the close
// button dismisses. (Deeper appearance assertions belong to the admin preview
// parity test; here we assert the storefront honours the theme + closeable.)
test.describe("Won Toasts appearance (MVP2)", () => {
  test("added toast carries a coloured accent and can be closed", async ({
    page,
  }) => {
    await openProduct(page, TOASTS_E2E_HANDLES.primary);
    await readyEmbed(page);
    await clearCart(page);

    const variantId = await firstVariantId(page);
    await addToCart(page, variantId, 1);
    const added = toast(page, "added");
    await expect(added).toHaveCount(1);

    const borderColor = await added.evaluate(
      (el) => getComputedStyle(el as HTMLElement).borderLeftColor,
    );
    // a real accent, not the default transparent/none
    expect(borderColor).not.toBe("rgba(0, 0, 0, 0)");
    expect(borderColor).not.toBe("");

    await added.locator("[data-won-toast-close]").click();
    await expect(added).toHaveCount(0);
  });
});

// SPEC-DRIVEN (MVP3). A rapid burst of the same product becomes ONE toast, not
// three — via net-diff + grouping.
test.describe("Won Toasts grouping (MVP3)", () => {
  test("three rapid adds of one product yield a single +3 toast", async ({
    page,
  }) => {
    await openProduct(page, TOASTS_E2E_HANDLES.primary);
    await readyEmbed(page);
    await clearCart(page);

    const variantId = await firstVariantId(page);
    await Promise.all([
      addToCart(page, variantId, 1),
      addToCart(page, variantId, 1),
      addToCart(page, variantId, 1),
    ]);

    const toasts = toast(page);
    await expect(toasts).toHaveCount(1);
    await expect(toasts.first().locator("[data-won-toast-delta]")).toHaveText(
      "+3",
    );
  });
});

// SPEC-DRIVEN (MVP4). GiftLadder integration: a gift line is a milestone, not a
// cart event — it must never produce an "added" cart toast.
test.describe("Won Toasts GiftLadder integration (MVP4)", () => {
  test("a _gift_progress line does not create a cart toast", async ({
    page,
  }) => {
    await openProduct(page, TOASTS_E2E_HANDLES.primary);
    await readyEmbed(page);
    await clearCart(page);

    const variantId = await firstVariantId(page);
    await addGiftLine(page, variantId);

    // The gift line is excluded from the cart diff → no "added" toast.
    await expect(toast(page, "added")).toHaveCount(0);
  });
});

// SPEC-DRIVEN (MVP5). Free plan shows a subtle "Won" mark; Pro removes it.
// (Default plan is Free, so the shared theme exercises the Free branding path.)
test.describe("Won Toasts plan gating (MVP5)", () => {
  test("free plan renders a subtle branding mark on toasts", async ({
    page,
  }) => {
    await openProduct(page, TOASTS_E2E_HANDLES.primary);
    await readyEmbed(page);
    await clearCart(page);

    const variantId = await firstVariantId(page);
    await addToCart(page, variantId, 1);

    const added = toast(page, "added");
    await expect(added).toHaveCount(1);
    await expect(added.locator("[data-won-branding]")).toHaveCount(1);
  });
});
