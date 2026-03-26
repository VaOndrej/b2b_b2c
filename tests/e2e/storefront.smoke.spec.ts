import { expect, test } from "@playwright/test";
import {
  disconnectE2EPrisma,
  ensureOriginalMarginGuardSnapshot,
  resetMarginGuardConfigForStorefrontE2E,
  restoreOriginalMarginGuardSnapshot,
  seedB2BOnlyVisibilityScenario,
  seedQuantityConstraintScenario,
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
