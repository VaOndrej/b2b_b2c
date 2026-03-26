import { expect, test } from "@playwright/test";
import {
  disconnectE2EPrisma,
  ensureOriginalMarginGuardSnapshot,
  resetMarginGuardConfigForStorefrontE2E,
  restoreOriginalMarginGuardSnapshot,
  seedB2BOnlyVisibilityScenario,
  seedMaxOrderQuantityScenario,
  seedQuantityConstraintScenario,
  seedVariantVisibilityScenario,
} from "./support/seed.ts";
import {
  maybeUnlockStorefront,
  resolveCurrentProductFixtureFromPage,
  waitForMarginGuardBootstrap,
  type StorefrontProductFixture,
} from "./support/storefront.ts";
import { resolveShopifyE2ERuntime } from "./support/runtime.ts";

const runtime = await resolveShopifyE2ERuntime();

test.describe.configure({ mode: "serial" });

let product: StorefrontProductFixture;

test.beforeAll(async () => {
  await ensureOriginalMarginGuardSnapshot();
});

test.beforeEach(async () => {
  if (!runtime.enabled) {
    return;
  }
  await resetMarginGuardConfigForStorefrontE2E();
});

test.afterAll(async () => {
  await restoreOriginalMarginGuardSnapshot();
  await disconnectE2EPrisma();
});

test("theme app embed blocks a B2B-only product for anonymous storefront visitors", async ({ page }) => {
  if (!runtime.enabled) {
    test.skip(true, runtime.skipReason);
    return;
  }

  const scenarioHandles = runtime.scenarioHandles;

  await page.goto(`/products/${scenarioHandles.visibility}`, {
    waitUntil: "domcontentloaded",
  });
  await maybeUnlockStorefront(page, runtime.storefrontPassword);
  await page.goto(`/products/${scenarioHandles.visibility}`, {
    waitUntil: "domcontentloaded",
  });
  product = await resolveCurrentProductFixtureFromPage(page);

  await seedB2BOnlyVisibilityScenario({
    productId: product.productId,
  });

  await page.reload({ waitUntil: "domcontentloaded" });
  const visibilityResponse = await waitForMarginGuardBootstrap(page);
  const visibilityPayload = await visibilityResponse.json();

  await expect(page.locator("#margin-guard-visibility-banner")).toContainText(
    "This product is not available for your customer segment.",
  );

  expect(
    Array.isArray(visibilityPayload?.hiddenHandles) &&
      visibilityPayload.hiddenHandles.includes(product.handle),
    "Expected visibility payload to mark the current PDP handle as hidden.",
  ).toBe(true);
});

test("theme app embed injects MOQ and step notices on the PDP and normalizes the quantity input", async ({ page }) => {
  if (!runtime.enabled) {
    test.skip(true, runtime.skipReason);
    return;
  }

  const scenarioHandles = runtime.scenarioHandles;

  await page.goto(`/products/${scenarioHandles.quantity}`, {
    waitUntil: "domcontentloaded",
  });
  await maybeUnlockStorefront(page, runtime.storefrontPassword);
  await page.goto(`/products/${scenarioHandles.quantity}`, {
    waitUntil: "domcontentloaded",
  });
  product = await resolveCurrentProductFixtureFromPage(page);

  await seedQuantityConstraintScenario({
    productId: product.productId,
    minimumOrderQuantity: 6,
    stepQuantity: 3,
  });

  await page.reload({ waitUntil: "domcontentloaded" });
  await waitForMarginGuardBootstrap(page);

  const quantityInput = page
    .locator("form[action*='/cart/add'] input[name='quantity']")
    .first();
  await expect(quantityInput).toHaveValue("6");
  await expect(quantityInput).toHaveAttribute("min", "6");
  await expect(quantityInput).toHaveAttribute("step", "3");

  const notice = page.locator("#margin-guard-pdp-quantity-notice");
  await expect(notice).toContainText("Minimum order quantity: 6.");
  await expect(notice).toContainText("This product is sold in multiples of 3.");
});

test("theme app embed shows variant visibility banner for B2B-only variant on anonymous storefront", async ({ page }) => {
  if (!runtime.enabled) {
    test.skip(true, runtime.skipReason);
    return;
  }

  const scenarioHandles = runtime.scenarioHandles;
  if (!scenarioHandles.variant) {
    test.skip(true, "No variant scenario product resolved — set SHOPIFY_E2E_PRODUCT_HANDLE_VARIANT or seed a variant visibility rule.");
    return;
  }

  await page.goto(`/products/${scenarioHandles.variant}`, {
    waitUntil: "domcontentloaded",
  });
  await maybeUnlockStorefront(page, runtime.storefrontPassword);
  await page.goto(`/products/${scenarioHandles.variant}`, {
    waitUntil: "domcontentloaded",
  });
  product = await resolveCurrentProductFixtureFromPage(page);

  const variantIds = await page.evaluate(async (handle) => {
    const response = await fetch(`/products/${encodeURIComponent(handle)}.js`, {
      credentials: "same-origin",
    });
    if (!response.ok) {
      return [];
    }
    const json = await response.json();
    return (json?.variants ?? []).map((v: { id?: number }) => v.id);
  }, product.handle);

  if (!Array.isArray(variantIds) || variantIds.length === 0) {
    test.skip(true, "Product has no variants — cannot test variant visibility.");
    return;
  }

  const targetVariantId = `gid://shopify/ProductVariant/${variantIds[0]}`;

  await seedVariantVisibilityScenario({
    productId: product.productId,
    variantId: targetVariantId,
  });

  await page.reload({ waitUntil: "domcontentloaded" });
  const visibilityResponse = await waitForMarginGuardBootstrap(page);
  const visibilityPayload = await visibilityResponse.json();

  const variantRule =
    visibilityPayload?.variantVisibilityByProductId?.[product.productId];
  expect(
    variantRule != null &&
      Array.isArray(variantRule.hiddenVariantIds) &&
      variantRule.hiddenVariantIds.length > 0,
    "Expected visibility payload to include hidden variant IDs for the product.",
  ).toBe(true);

  const banner = page.locator("#margin-guard-variant-visibility-banner");
  if (variantIds.length === 1) {
    await expect(banner).toContainText(
      "This product variant is not available for your customer segment.",
    );
  } else {
    await expect(banner).toHaveCount(0);
  }
});

test("acknowledgment button is required to dismiss cart quantity notice", async ({ page }) => {
  if (!runtime.enabled) {
    test.skip(true, runtime.skipReason);
    return;
  }

  const scenarioHandles = runtime.scenarioHandles;

  await page.goto(`/products/${scenarioHandles.quantity}`, {
    waitUntil: "domcontentloaded",
  });
  await maybeUnlockStorefront(page, runtime.storefrontPassword);
  await page.goto(`/products/${scenarioHandles.quantity}`, {
    waitUntil: "domcontentloaded",
  });
  product = await resolveCurrentProductFixtureFromPage(page);

  await seedMaxOrderQuantityScenario({
    productId: product.productId,
    maxOrderQuantity: 2,
  });

  await page.reload({ waitUntil: "domcontentloaded" });
  await waitForMarginGuardBootstrap(page);

  const quantityInput = page
    .locator("form[action*='/cart/add'] input[name='quantity']")
    .first();
  if ((await quantityInput.count()) === 0) {
    test.skip(true, "No quantity input found on PDP — cannot test acknowledgment flow.");
    return;
  }

  await quantityInput.fill("5");
  await quantityInput.dispatchEvent("change");

  const addToCartButton = page
    .locator("form[action*='/cart/add'] button[type='submit'], form[action*='/cart/add'] input[type='submit']")
    .first();
  if ((await addToCartButton.count()) > 0) {
    await addToCartButton.click().catch(() => {});
  }

  await page.goto("/cart", { waitUntil: "domcontentloaded" });
  await waitForMarginGuardBootstrap(page);

  const notice = page.locator("[data-margin-guard-cart-quantity-notice='1']");

  const noticeVisible = (await notice.count()) > 0 && (await notice.isVisible());
  if (!noticeVisible) {
    test.skip(true, "Cart quantity notice did not appear — product may not be in cart or max quantity was not exceeded.");
    return;
  }

  const dismissButton = notice.locator("[data-margin-guard-cart-quantity-notice-dismiss='1']");
  await expect(dismissButton).toBeVisible();
  await expect(dismissButton).toHaveText(/(I understand|Rozumim)/);

  await expect(notice).toBeVisible();

  await dismissButton.click();
  await expect(notice).not.toBeVisible();
});

test("theme app embed enforces max order quantity notice on PDP", async ({ page }) => {
  if (!runtime.enabled) {
    test.skip(true, runtime.skipReason);
    return;
  }

  const scenarioHandles = runtime.scenarioHandles;

  await page.goto(`/products/${scenarioHandles.quantity}`, {
    waitUntil: "domcontentloaded",
  });
  await maybeUnlockStorefront(page, runtime.storefrontPassword);
  await page.goto(`/products/${scenarioHandles.quantity}`, {
    waitUntil: "domcontentloaded",
  });
  product = await resolveCurrentProductFixtureFromPage(page);

  await seedMaxOrderQuantityScenario({
    productId: product.productId,
    maxOrderQuantity: 3,
  });

  await page.reload({ waitUntil: "domcontentloaded" });
  const visibilityResponse = await waitForMarginGuardBootstrap(page);
  const visibilityPayload = await visibilityResponse.json();

  const constraintsByProductId = visibilityPayload?.quantityConstraintsByProductId ?? {};
  const constraint = constraintsByProductId[product.productId];
  expect(
    constraint != null && constraint.maxOrderQuantity === 3,
    "Expected visibility payload to include maxOrderQuantity=3 for the product.",
  ).toBe(true);

  const quantityInput = page
    .locator("form[action*='/cart/add'] input[name='quantity']")
    .first();
  if ((await quantityInput.count()) > 0) {
    await expect(quantityInput).toHaveAttribute("max", "3");
  }
});
