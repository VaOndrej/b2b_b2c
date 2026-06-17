import { expect, test, type Page } from "@playwright/test";
import {
  disconnectE2EPrisma,
  ensureOriginalMarginGuardSnapshot,
  getOfflineAdminClientForE2E,
  resetMarginGuardConfigForStorefrontE2E,
  restoreOriginalMarginGuardSnapshot,
} from "./support/seed.ts";
import { decorateStorefrontPath, maybeUnlockStorefront } from "./support/storefront.ts";
import { resolveShopifyE2ERuntimeConfig } from "./support/runtime.ts";
import { warmStorefrontTunnel } from "./support/warmup.ts";
import { readMatrixFile } from "./support/matrix.ts";
import { updateGlobalMarginGuardConfig } from "../../app/services/margin-guard-config.server.ts";
import { fetchAutomaticDiscounts } from "../../app/services/automatic-discounts.server.ts";

/**
 * MVP_5_0_3 cart conflict banner (Tier 3 storefront). When a product has an
 * active automatic Shopify discount that, combined with the margin floor, would
 * be clipped/blocked at checkout, the storefront cart must show a persistent
 * margin-guard banner.
 *
 * Best-effort + SERIAL: it mutates the shared config and needs (a) the app
 * running so the App Proxy serves the visibility script, and (b) at least one
 * active GLOBAL automatic discount on the store. Missing preconditions SKIP
 * (not fail) — the exhaustive logic lives in the unit/contract/integration suite.
 */

const config = resolveShopifyE2ERuntimeConfig();

function resolveCartProductHandle(): string | null {
  const override = String(process.env.SHOPIFY_E2E_PRODUCT_HANDLE_CART ?? "").trim();
  if (override) {
    return override.toLowerCase();
  }
  const matrix = readMatrixFile();
  return matrix?.products[0]?.handle ?? null;
}

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
  await ensureOriginalMarginGuardSnapshot();
  await warmStorefrontTunnel(resolveCartProductHandle() ?? undefined);
});

test.afterAll(async () => {
  await restoreOriginalMarginGuardSnapshot();
  await disconnectE2EPrisma();
});

test("cart shows a margin-guard banner when an automatic discount conflicts with the floor", async ({
  page,
}) => {
  const handle = resolveCartProductHandle();
  if (!handle) {
    test.skip(true, "No cart product handle resolved (set SHOPIFY_E2E_PRODUCT_HANDLE_CART or seed the matrix).");
    return;
  }

  const admin = await getOfflineAdminClientForE2E();
  if (!admin) {
    test.skip(true, "No offline Shopify session to read automatic discounts.");
    return;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const automaticDiscounts = await fetchAutomaticDiscounts(admin as any);
  const globalDiscount = automaticDiscounts
    .filter((discount) => discount.scope === "GLOBAL" && discount.percentOff > 0)
    .sort((a, b) => b.percentOff - a.percentOff)[0];
  if (!globalDiscount) {
    test.skip(
      true,
      "No active GLOBAL automatic discount on the store to conflict with the floor.",
    );
    return;
  }

  // Pick a floor strict enough that the discount necessarily breaches it:
  // conflict ⇔ (100 − floorPercent) < discountPercent ⇔ floorPercent > 100 − discountPercent.
  const floorPercent = Math.min(95, Math.round(100 - globalDiscount.percentOff + 5));
  await resetMarginGuardConfigForStorefrontE2E();
  await updateGlobalMarginGuardConfig({
    b2bTag: "b2b",
    globalMinPricePercent: floorPercent,
    b2bGlobalMinPricePercent: floorPercent,
    allowZeroFinalPrice: false,
    allowRemoveAtMinimumOrderQuantity: true,
    allowStacking: true,
    maxCombinedPercentOff: null,
  });

  await page.goto(decorateStorefrontPath(`/products/${handle}`), { waitUntil: "domcontentloaded" });
  await maybeUnlockStorefront(page, config.storefrontPassword);
  await page.goto(decorateStorefrontPath(`/products/${handle}`), { waitUntil: "domcontentloaded" });

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
  // fetches the (live) discount conflicts for the current segment.
  await page.goto(decorateStorefrontPath("/cart"), { waitUntil: "domcontentloaded" });

  const banner = page.locator("#margin-guard-cart-discount-conflict-notice");
  await expect(banner, "Cart discount-conflict banner should appear for the conflicting product.").toBeVisible();
});
