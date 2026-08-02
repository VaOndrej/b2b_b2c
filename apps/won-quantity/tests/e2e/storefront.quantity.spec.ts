import { SHARED_THEME_SELECTORS } from "@won/testing/playwright";

import {
  QUANTITY_E2E_HANDLES,
  assertAppTransport,
  clearCart,
  expect,
  openProduct,
  quantityForm,
  readyQuantityInput,
  responseMatches,
  selectSecondVariant,
  test,
} from "./support/fixtures.ts";

test.describe("Won Quantity storefront vertical slice", () => {
  test("keeps the native product form and loads app-owned assets", async ({
    page,
    appDiagnostics,
  }) => {
    await openProduct(page, QUANTITY_E2E_HANDLES.default);
    const input = await readyQuantityInput(page);
    const form = quantityForm(page, input);

    await expect(form).toHaveCount(1);
    expect(
      await page.locator(SHARED_THEME_SELECTORS.addToCartForm).count(),
    ).toBeGreaterThanOrEqual(1);
    await expect(input).toHaveAttribute("min", "1");
    await expect(input).toHaveAttribute("step", "1");
    await assertAppTransport(page, appDiagnostics);
  });

  test("enforces minimum and step and submits the normalized quantity", async ({
    page,
    appDiagnostics,
  }) => {
    await clearCart(page);
    await openProduct(page, QUANTITY_E2E_HANDLES.step);
    let input = await readyQuantityInput(page);
    const form = quantityForm(page, input);

    await expect(input).toHaveAttribute("min", "2");
    await expect(input).toHaveAttribute("step", "2");
    await expect(input).toHaveValue("2");

    const plus = form.locator("button[name='plus']");
    const minus = form.locator("button[name='minus']");
    await expect(plus).toHaveCount(1);
    await expect(minus).toHaveCount(1);
    await plus.click();
    await expect(input).toHaveValue("4");
    await minus.click();
    await expect(input).toHaveValue("2");

    await input.fill("3");
    await input.blur();
    await expect(input).toHaveValue("4");

    const variantId = await form
      .locator("input[name='id'], select[name='id']")
      .first()
      .inputValue();
    const submit = form.locator("button[type='submit'], input[type='submit']");
    await expect(submit.first()).toBeEnabled();
    await Promise.all([
      page.waitForResponse((response) =>
        responseMatches(response, "/cart/add"),
      ),
      submit.first().click(),
    ]);
    const cart = await page.evaluate(async () =>
      fetch("/cart.js", { headers: { Accept: "application/json" } }).then(
        (response) => response.json(),
      ),
    );
    const line = cart.items.find(
      (item: { id: number }) => String(item.id) === String(variantId),
    );
    expect(line?.quantity).toBe(4);

    input = await readyQuantityInput(page);
    await expect(input).toHaveAttribute("data-won-quantity-status", "ready");
    await assertAppTransport(page, appDiagnostics);
  });

  test("caps excessive values at the app maximum", async ({
    page,
    appDiagnostics,
  }) => {
    await openProduct(page, QUANTITY_E2E_HANDLES.maximum);
    const input = await readyQuantityInput(page);
    const form = quantityForm(page, input);

    await expect(input).toHaveAttribute("min", "2");
    await expect(input).toHaveAttribute("step", "2");
    await expect(input).toHaveAttribute("max", "6");
    await input.fill("99");
    await input.blur();
    await expect(input).toHaveValue("6");
    await form.locator("button[name='plus']").click();
    await expect(input).toHaveValue("6");
    await expect(page.locator("[data-won-quantity-notice]")).toContainText("6");
    await assertAppTransport(page, appDiagnostics);
  });

  test("reapplies the variant override after native theme morphing", async ({
    page,
    appDiagnostics,
  }) => {
    await openProduct(page, QUANTITY_E2E_HANDLES.step);
    let input = await readyQuantityInput(page);
    await expect(input).toHaveAttribute("step", "2");
    const variantInput = page
      .locator(
        "form[action*='/cart/add'] input[name='id'], form[action*='/cart/add'] select[name='id']",
      )
      .first();
    const previousVariantId = await variantInput.inputValue();

    await selectSecondVariant(page);
    await expect(variantInput).not.toHaveValue(previousVariantId);
    input = await readyQuantityInput(page);
    await expect(input).toHaveAttribute("min", "3");
    await expect(input).toHaveAttribute("step", "3");
    await expect(input).toHaveAttribute("max", "9");
    await expect(input).toHaveValue("3");
    await assertAppTransport(page, appDiagnostics);
  });
});
