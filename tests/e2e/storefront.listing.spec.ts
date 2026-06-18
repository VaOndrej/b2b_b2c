import { expect, test, type Page } from "@playwright/test";
import { disconnectE2EPrisma } from "./support/seed.ts";
import {
  seedCatalogProductHidden,
  setupE2ECatalog,
  teardownE2ECatalog,
} from "./support/catalog-e2e.ts";
import {
  decorateStorefrontPath,
  gotoStorefrontOrSkip,
  resolveCurrentProductFixtureFromPage,
  waitForMarginGuardBootstrap,
} from "./support/storefront.ts";
import { resolveShopifyE2ERuntime, type ShopifyE2ERuntime } from "./support/runtime.ts";
import { warmStorefrontTunnel } from "./support/warmup.ts";

/**
 * Serial listing tier. Asserts that a catalog-hidden product's card is removed
 * from a listing for a visitor in the forced e2e catalog context. Catalog-native
 * (MVP_5_4): seeds onto a fresh dedicated e2e catalog and forces it via the gated
 * `mg_e2e_audience` override — never touching default/b2b.
 *
 * Collection visibility is rendered server-side from the storefront_projection
 * metafield (Liquid), keyed by the b2b/b2c segment snapshot — it cannot be forced
 * into a custom catalog via the override, so it stays covered by the projection
 * unit + embed contract tests (documented residual).
 */

let runtime: ShopifyE2ERuntime;
let catalogId: string;

const PRODUCT_LISTING_PATH = "/collections/all";

function productCardLinks(page: Page, handle: string) {
  return page.locator(`a[href*='/products/${handle}']:visible`);
}

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  // See storefront.smoke.spec.ts — give the hook room to absorb the dev-tunnel
  // cold-start once so the tests navigate against a warm route.
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
  ({ catalogId } = await setupE2ECatalog());
});

test.afterAll(async () => {
  await teardownE2ECatalog();
  await disconnectE2EPrisma();
});

test("theme app embed removes a catalog-hidden product card from the product listing", async ({ page }) => {
  if (!runtime.enabled) {
    test.skip(true, runtime.skipReason);
    return;
  }

  const scenarioHandles = runtime.scenarioHandles;

  // Resolve the product id from its PDP first (the listing page does not expose it reliably).
  if (!(await gotoStorefrontOrSkip(page, decorateStorefrontPath(`/products/${scenarioHandles.visibility}`), runtime.storefrontPassword))) {
    return;
  }
  const product = await resolveCurrentProductFixtureFromPage(page);

  // Baseline: with no visibility rule the product card is visible on the listing.
  if (!(await gotoStorefrontOrSkip(page, decorateStorefrontPath(PRODUCT_LISTING_PATH), runtime.storefrontPassword))) {
    return;
  }
  await waitForMarginGuardBootstrap(page);
  if ((await productCardLinks(page, product.handle).count()) === 0) {
    test.skip(true, `Product ${product.handle} is not present on ${PRODUCT_LISTING_PATH}.`);
    return;
  }

  await seedCatalogProductHidden(catalogId, product.productId);

  if (!(await gotoStorefrontOrSkip(page, decorateStorefrontPath(PRODUCT_LISTING_PATH), runtime.storefrontPassword))) {
    return;
  }
  await waitForMarginGuardBootstrap(page);

  // After the rule is applied the card must be gone (removed from DOM / hidden),
  // never left as a visible empty slot in the carousel/grid.
  await expect(productCardLinks(page, product.handle)).toHaveCount(0);
});
