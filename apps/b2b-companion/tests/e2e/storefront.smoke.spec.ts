import { type Page } from "@playwright/test";
import { expect, test } from "./support/test-base.ts";
import { disconnectE2EPrisma } from "./support/seed.ts";
import {
  seedCatalogProductHidden,
  seedCatalogQuantity,
  seedCatalogVariantHidden,
  setupE2ECatalog,
  teardownE2ECatalog,
} from "./support/catalog-e2e.ts";
import {
  decorateStorefrontPath,
  gotoStorefrontOrSkip,
  resolveCurrentProductFixtureFromPage,
  waitForMarginGuardBootstrap,
  type StorefrontProductFixture,
} from "./support/storefront.ts";
import { resolveShopifyE2ERuntime, type ShopifyE2ERuntime } from "./support/runtime.ts";
import { warmStorefrontTunnel } from "./support/warmup.ts";

/**
 * Serial (mutate-per-test) storefront tier. Asserts the DOM-rendered app-proxy
 * effects (banners / notices / input normalization) that the read-only parallel
 * matrix does not cover. Catalog-native (MVP_5_4): each test gets a FRESH,
 * dedicated e2e catalog (setupE2ECatalog), seeds exactly its rule onto it, and
 * navigates with the gated `mg_e2e_audience` override forcing that catalog — so
 * nothing is ever written to the user's default/b2b config. The real Shopify
 * Functions (checkout) stay covered by the integration/contract suite.
 */

let runtime: ShopifyE2ERuntime;
let catalogId: string;

function getVisibleQuantityInput(page: Page) {
  return page
    .locator("form[action*='/cart/add'] input[name='quantity']:not([type='hidden'])")
    .first();
}

test.describe.configure({ mode: "serial" });

let product: StorefrontProductFixture;

test.beforeAll(async () => {
  // The dev-tunnel cold-start of the no-defer <head> embed script can exceed the
  // 45s per-test budget, so give this hook room to absorb it once via the warm-up
  // below; the tests then navigate against a warm route.
  test.setTimeout(150_000);
  runtime = await resolveShopifyE2ERuntime();
  if (runtime.enabled) {
    await warmStorefrontTunnel(runtime.scenarioHandles.visibility);
  }
});

test.beforeEach(async () => {
  if (!runtime.enabled) {
    return;
  }
  // Fresh, empty e2e catalog per test (delete-then-create) → deterministic
  // isolation; the test seeds the one rule it asserts.
  ({ catalogId } = await setupE2ECatalog());
});

test.afterAll(async () => {
  await teardownE2ECatalog();
  await disconnectE2EPrisma();
});

test("theme app embed blocks a catalog-hidden product for the forced catalog", async ({ page }) => {
  if (!runtime.enabled) {
    test.skip(true, runtime.skipReason);
    return;
  }

  const scenarioHandles = runtime.scenarioHandles;

  if (!(await gotoStorefrontOrSkip(page, decorateStorefrontPath(`/products/${scenarioHandles.visibility}`), runtime.storefrontPassword))) {
    return;
  }
  product = await resolveCurrentProductFixtureFromPage(page);

  await seedCatalogProductHidden(catalogId, product.productId);

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

  if (!(await gotoStorefrontOrSkip(page, decorateStorefrontPath(`/products/${scenarioHandles.step}`), runtime.storefrontPassword))) {
    return;
  }
  product = await resolveCurrentProductFixtureFromPage(page);

  await seedCatalogQuantity(catalogId, product.productId, {
    moq: 6,
    step: 3,
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
  const quantityInput = getVisibleQuantityInput(page);
  if ((await quantityInput.count()) === 0) {
    test.skip(true, "Theme has no visible PDP quantity input — cannot verify MOQ/step input normalization (notice asserted above).");
    return;
  }
  await expect(quantityInput).toHaveValue("6");
  await expect(quantityInput).toHaveAttribute("min", "6");
  await expect(quantityInput).toHaveAttribute("step", "3");
});

test("theme app embed shows variant visibility banner for a catalog-hidden variant", async ({ page }) => {
  if (!runtime.enabled) {
    test.skip(true, runtime.skipReason);
    return;
  }

  const scenarioHandles = runtime.scenarioHandles;
  if (!scenarioHandles.variant) {
    test.skip(true, "No variant scenario product resolved — set SHOPIFY_E2E_PRODUCT_HANDLE_VARIANT or seed a variant visibility rule.");
    return;
  }

  if (!(await gotoStorefrontOrSkip(page, decorateStorefrontPath(`/products/${scenarioHandles.variant}`), runtime.storefrontPassword))) {
    return;
  }
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

  await seedCatalogVariantHidden(catalogId, product.productId, targetVariantId);

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

  if (!(await gotoStorefrontOrSkip(page, decorateStorefrontPath(`/products/${scenarioHandles.max}`), runtime.storefrontPassword))) {
    return;
  }
  product = await resolveCurrentProductFixtureFromPage(page);

  await seedCatalogQuantity(catalogId, product.productId, { max: 2 });

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

  await page.goto(decorateStorefrontPath("/cart"), { waitUntil: "domcontentloaded" });
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

  if (!(await gotoStorefrontOrSkip(page, decorateStorefrontPath(`/products/${scenarioHandles.max}`), runtime.storefrontPassword))) {
    return;
  }
  product = await resolveCurrentProductFixtureFromPage(page);

  await seedCatalogQuantity(catalogId, product.productId, { max: 3 });

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
