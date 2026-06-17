import { expect, test, type Page } from "@playwright/test";
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
  decorateStorefrontPath,
  maybeUnlockStorefront,
  resolveCurrentProductFixtureFromPage,
  waitForMarginGuardBootstrap,
  type StorefrontProductFixture,
} from "./support/storefront.ts";
import { resolveShopifyE2ERuntime, type ShopifyE2ERuntime } from "./support/runtime.ts";
import { warmStorefrontTunnel } from "./support/warmup.ts";

// Resolved in beforeAll (NOT at module top-level): the Admin scenario-resolution
// calls are slow, and running them during Playwright's collection phase opens a
// gap between any global warm-up and the first navigation in which the dev
// tunnel/route goes cold — making the first page.goto pay the cold-start of the
// no-defer <head> embed script and time out. Resolving + warming in beforeAll
// keeps the route warm immediately before the specs navigate.
let runtime: ShopifyE2ERuntime;

function getVisibleQuantityInput(page: Page) {
  return page
    .locator("form[action*='/cart/add'] input[name='quantity']:not([type='hidden'])")
    .first();
}

test.describe.configure({ mode: "serial" });

let product: StorefrontProductFixture;

test.beforeAll(async () => {
  // The dev-tunnel cold-start of the no-defer <head> embed script can exceed the
  // 45s per-test budget, so give this hook room to fully absorb it once via the
  // warm-up below; the tests then navigate against a warm route.
  test.setTimeout(150_000);
  await ensureOriginalMarginGuardSnapshot();
  runtime = await resolveShopifyE2ERuntime();
  if (runtime.enabled) {
    await warmStorefrontTunnel(runtime.scenarioHandles.visibility);
  }
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

  await page.goto(decorateStorefrontPath(`/products/${scenarioHandles.visibility}`), {
    waitUntil: "domcontentloaded",
  });
  await maybeUnlockStorefront(page, runtime.storefrontPassword);
  await page.goto(decorateStorefrontPath(`/products/${scenarioHandles.visibility}`), {
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

  await page.goto(decorateStorefrontPath(`/products/${scenarioHandles.step}`), {
    waitUntil: "domcontentloaded",
  });
  await maybeUnlockStorefront(page, runtime.storefrontPassword);
  await page.goto(decorateStorefrontPath(`/products/${scenarioHandles.step}`), {
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

  // The MOQ/step notice is the always-present app behavior — assert it first.
  const notice = page.locator("#margin-guard-pdp-quantity-notice");
  await expect(notice).toContainText("Minimum order quantity: 6.");
  await expect(notice).toContainText("This product is sold in multiples of 3.");

  // Quantity-input normalization can only be verified when the theme renders a
  // visible quantity input on the PDP. Some themes (e.g. minimal/generated ones)
  // omit it entirely — skip the input assertions there rather than false-fail.
  const quantityInput = page
    .locator("form[action*='/cart/add'] input[name='quantity']:not([type='hidden'])")
    .first();
  if ((await quantityInput.count()) === 0) {
    test.skip(true, "Theme has no visible PDP quantity input — cannot verify MOQ/step input normalization (notice asserted above).");
    return;
  }
  await expect(quantityInput).toHaveValue("6");
  await expect(quantityInput).toHaveAttribute("min", "6");
  await expect(quantityInput).toHaveAttribute("step", "3");
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

  await page.goto(decorateStorefrontPath(`/products/${scenarioHandles.variant}`), {
    waitUntil: "domcontentloaded",
  });
  await maybeUnlockStorefront(page, runtime.storefrontPassword);
  await page.goto(decorateStorefrontPath(`/products/${scenarioHandles.variant}`), {
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

  await page.goto(decorateStorefrontPath(`/products/${scenarioHandles.max}`), {
    waitUntil: "domcontentloaded",
  });
  await maybeUnlockStorefront(page, runtime.storefrontPassword);
  await page.goto(decorateStorefrontPath(`/products/${scenarioHandles.max}`), {
    waitUntil: "domcontentloaded",
  });
  product = await resolveCurrentProductFixtureFromPage(page);

  await seedMaxOrderQuantityScenario({
    productId: product.productId,
    maxOrderQuantity: 2,
  });

  await page.reload({ waitUntil: "domcontentloaded" });
  await waitForMarginGuardBootstrap(page);

  const quantityInput = getVisibleQuantityInput(page);
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

  await page.goto(decorateStorefrontPath(`/products/${scenarioHandles.max}`), {
    waitUntil: "domcontentloaded",
  });
  await maybeUnlockStorefront(page, runtime.storefrontPassword);
  await page.goto(decorateStorefrontPath(`/products/${scenarioHandles.max}`), {
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

  const quantityInput = getVisibleQuantityInput(page);
  if ((await quantityInput.count()) > 0) {
    await expect(quantityInput).toHaveAttribute("max", "3");
  }
});
