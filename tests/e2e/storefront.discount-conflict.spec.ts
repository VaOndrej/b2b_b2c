import { expect, test, type Page } from "@playwright/test";
import { disconnectE2EPrisma } from "./support/seed.ts";
import {
  seedCatalogDiscountFloorConflict,
  setupE2ECatalog,
  teardownE2ECatalog,
} from "./support/catalog-e2e.ts";
import {
  decorateStorefrontPath,
  gotoStorefrontOrSkip,
  resolveCurrentProductFixtureFromPage,
} from "./support/storefront.ts";
import { resolveShopifyE2ERuntime, type ShopifyE2ERuntime } from "./support/runtime.ts";
import { warmStorefrontTunnel } from "./support/warmup.ts";

/**
 * Cart discount-conflict banner (serial storefront tier). When the resolved
 * catalog has a discount that, combined with the margin floor, would be
 * clipped/blocked, the storefront cart shows a persistent margin-guard banner.
 *
 * Catalog-native (MVP_5_4): seeds a GLOBAL discount + a breaching product floor
 * onto a fresh dedicated e2e catalog and forces it via the gated `mg_e2e_audience`
 * override — self-contained (no real Shopify automatic discount, no global-config
 * edit) and zero blast radius. The banner is driven by the app-proxy `/visibility`
 * payload (`discountConflictsByHandle`) for the forced catalog.
 */

let runtime: ShopifyE2ERuntime;
let catalogId: string;

async function readFirstVariantId(page: Page, handle: string): Promise<number | null> {
  return page.evaluate(async (currentHandle) => {
    const response = await fetch(`/products/${encodeURIComponent(currentHandle)}.js`, {
      credentials: "same-origin",
    });
    if (!response.ok) {
      return null;
    }
    const json = await response.json();
    const variant =
      (json?.variants ?? []).find((candidate: { available?: boolean }) => candidate?.available) ??
      (json?.variants ?? [])[0];
    return variant?.id ?? null;
  }, handle);
}

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
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

test("cart shows a margin-guard banner when a catalog discount conflicts with the floor", async ({
  page,
}) => {
  if (!runtime.enabled) {
    test.skip(true, runtime.skipReason);
    return;
  }

  const handle = runtime.scenarioHandles.visibility;

  if (!(await gotoStorefrontOrSkip(page, decorateStorefrontPath(`/products/${handle}`), runtime.storefrontPassword))) {
    return;
  }

  const product = await resolveCurrentProductFixtureFromPage(page);

  // A 50% GLOBAL discount necessarily breaches an 80% floor (final 50% < 80%),
  // so the conflict detector flags it for the forced catalog.
  await seedCatalogDiscountFloorConflict(catalogId, product.productId, {
    percentOff: 50,
    floorPercent: 80,
  });

  const variantId = await readFirstVariantId(page, handle);
  if (!variantId) {
    test.skip(true, `Could not resolve a purchasable variant for ${handle}.`);
    return;
  }

  await page.evaluate(() => fetch("/cart/clear.js", { method: "POST", credentials: "same-origin" }));
  const added = await page.evaluate(async (id) => {
    const response = await fetch("/cart/add.js", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ id, quantity: 1 }),
    });
    return response.ok;
  }, variantId);
  if (!added) {
    test.skip(true, "Add to cart failed.");
    return;
  }

  // Land on the cart page so the visibility script discovers the cart line and
  // fetches the (live) discount conflicts for the forced catalog.
  await page.goto(decorateStorefrontPath("/cart"), { waitUntil: "domcontentloaded" });

  const banner = page.locator("#margin-guard-cart-discount-conflict-notice");
  await expect(banner, "Cart discount-conflict banner should appear for the conflicting product.").toBeVisible();
});
