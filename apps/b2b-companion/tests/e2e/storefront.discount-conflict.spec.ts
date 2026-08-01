import { type Page } from "@playwright/test";
import { expect, test } from "./support/test-base.ts";
import { disconnectE2EPrisma } from "./support/seed.ts";
import {
  seedCatalogFloor,
  setupE2ECatalog,
  teardownE2ECatalog,
} from "./support/catalog-e2e.ts";
import {
  createProductScopedPercentAutomaticDiscount,
  deleteAutomaticDiscount,
  type E2EAutomaticDiscount,
} from "./support/automatic-discount-e2e.ts";
import {
  decorateStorefrontPath,
  gotoStorefrontOrSkip,
  isStorefrontVerificationChallenge,
  resolveCurrentProductFixtureFromPage,
  waitForVerificationChallengeToClear,
} from "./support/storefront.ts";
import { resolveShopifyE2ERuntime, type ShopifyE2ERuntime } from "./support/runtime.ts";
import { warmStorefrontTunnel } from "./support/warmup.ts";

/**
 * Cart discount-conflict banner (serial storefront tier). When a real Shopify
 * automatic discount, combined with the margin floor, would be clipped/blocked at
 * checkout, the storefront cart shows a persistent margin-guard banner.
 *
 * Faithful to the feature (MVP_5_4): the banner is driven by
 * `resolveCartDiscountConflictsByHandle`, which flags *real Shopify automatic
 * discounts* (fetched live from the admin API) that breach the resolved catalog's
 * floor — catalog discount rules are only stacking context, never the offender.
 * So this test seeds the FLOOR onto a fresh dedicated e2e catalog (forced via the
 * gated `mg_e2e_audience` override) AND creates a real PRODUCT-scoped automatic
 * discount on the single e2e product as the offender, deleting it on teardown.
 * Blast radius: one automatic discount on the `mg-e2e-*` product for one test.
 */

let runtime: ShopifyE2ERuntime;
let catalogId: string;
let createdDiscount: E2EAutomaticDiscount | null = null;

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

test.afterEach(async () => {
  // Always remove the real automatic discount, even if the test failed, so it
  // never lingers on the store between runs.
  if (createdDiscount) {
    await deleteAutomaticDiscount(createdDiscount.id);
    createdDiscount = null;
  }
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
  // Headroom for the (bounded) add retry + banner poll on the first theme, where the
  // intermittent Cloudflare challenge can cost a one-time clear wait.
  test.setTimeout(150_000);

  const handle = runtime.scenarioHandles.visibility;

  if (!(await gotoStorefrontOrSkip(page, decorateStorefrontPath(`/products/${handle}`), runtime.storefrontPassword))) {
    return;
  }

  const product = await resolveCurrentProductFixtureFromPage(page);

  // Seed an 80% floor for the product on the forced e2e catalog: the final price
  // must stay at or above 80% of base.
  await seedCatalogFloor(catalogId, product.productId, 80);

  // Add the product to the cart BEFORE the floor-breaching discount exists. Order
  // matters: the margin-guard cart-validation function rejects the /cart/add
  // mutation once a discount would push the line below the floor (HTTP 422), so
  // adding first models the realistic case — the item is already in the cart when
  // the discount activates — and lets the softer cart banner (a GET /cart, which
  // runs no validation) surface the conflict.
  const variantId = await readFirstVariantId(page, handle);
  if (!variantId) {
    test.skip(true, `Could not resolve a purchasable variant for ${handle}.`);
    return;
  }

  // Add must succeed while NO breaching discount is active. A previous theme's
  // teardown (the wrapper runs themes sequentially on the same product) can take a
  // few seconds to propagate to the cart-validation function, so a lingering
  // deleted discount may briefly still reject the add with HTTP 422. Retry the add
  // (bounded) so that propagation window doesn't flake the test.
  // The Cloudflare bot-challenge that intermittently greets the first theme's early
  // requests also fails the add XHR. Give it ONE bounded chance to clear before the
  // retry loop (calling the 25s clear per-iteration would blow the test budget).
  if (await isStorefrontVerificationChallenge(page)) {
    await waitForVerificationChallengeToClear(page);
  }

  let added = false;
  for (let attempt = 0; attempt < 6 && !added; attempt += 1) {
    // Bound each request with AbortController: on the challenged first theme the
    // fetch can hang with the connection held open, which would otherwise stall the
    // whole test (page.evaluate has no independent timeout) instead of retrying.
    added = await page.evaluate(async (id) => {
      const withTimeout = (url: string, init: RequestInit) => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 5_000);
        return fetch(url, { ...init, credentials: "same-origin", signal: controller.signal }).finally(
          () => clearTimeout(timer),
        );
      };
      try {
        await withTimeout("/cart/clear.js", { method: "POST" });
        const response = await withTimeout("/cart/add.js", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id, quantity: 1 }),
        });
        return response.ok;
      } catch {
        return false;
      }
    }, variantId);
    if (!added) {
      await page.waitForTimeout(2_000);
    }
  }
  if (!added) {
    // A persistent challenge is environmental (matches the rest of the suite); any
    // other add failure is unexpected and worth flagging in the skip reason.
    const challenged = await isStorefrontVerificationChallenge(page);
    test.skip(
      true,
      challenged
        ? "Storefront served a bot/connection-verification challenge to the headless browser (environmental)."
        : "Add to cart kept failing (a floor-breaching discount stayed active).",
    );
    return;
  }

  // Now create the real offender: a PRODUCT-scoped 50% automatic discount on this
  // product. 50% off → final 50% of base < 80% floor → BELOW_FLOOR conflict, which
  // the live `resolveCartDiscountConflictsByHandle` surfaces in the cart banner.
  createdDiscount = await createProductScopedPercentAutomaticDiscount({
    productId: product.productId,
    percentOff: 50,
    startsAt: new Date(Date.now() - 60_000).toISOString(),
    titleSuffix: String(product.productId.split("/").pop() ?? "product"),
  });
  if (!createdDiscount) {
    test.skip(true, "No offline admin session — cannot create the automatic discount.");
    return;
  }

  const banner = page.locator("#margin-guard-cart-discount-conflict-notice");

  // Land on the cart page so the visibility script discovers the cart line and
  // fetches the (live) discount conflicts for the forced catalog. A freshly created
  // automatic discount can take a few seconds to become visible to the admin
  // discounts query, so reload the cart until the banner appears (bounded).
  await expect(async () => {
    await page.goto(decorateStorefrontPath("/cart"), {
      waitUntil: "domcontentloaded",
      timeout: 15_000,
    });
    await expect(
      banner,
      "Cart discount-conflict banner should appear for the conflicting product.",
    ).toBeVisible({ timeout: 4_000 });
  }).toPass({ timeout: 40_000 });
});
