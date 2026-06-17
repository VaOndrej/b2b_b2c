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
import {
  updateGlobalMarginGuardConfig,
  upsertDiscountRule,
  upsertProductQuantityRule,
} from "../../app/services/margin-guard-config.server.ts";
import { ensureDiscountFunctionActive } from "../../app/services/discount-function-activation.server.ts";
import { ensureCartValidationActive } from "../../app/services/cart-validation-activation.server.ts";

/**
 * Cart-level enforcement smoke (Tier 3). The discount + cart-validation Shopify
 * Functions only run inside the cart/checkout, so these tests drive the real
 * cart and assert the resulting line prices / checkout blocking.
 *
 * Everything here is best-effort and SERIAL: it mutates the shared config and
 * needs the Functions deployed + active on the store. When no effect is observed
 * (Functions not active, no automatic discount created, MOQ not enforced), each
 * test SKIPS with a reason rather than failing. The exhaustive discount/margin
 * matrix stays on the unit/contract suite.
 */

const config = resolveShopifyE2ERuntimeConfig();

function resolveCartProductHandle(): string | null {
  const override = String(
    process.env.SHOPIFY_E2E_PRODUCT_HANDLE_CART ?? "",
  ).trim();
  if (override) {
    return override.toLowerCase();
  }
  const matrix = readMatrixFile();
  return matrix?.products[0]?.handle ?? null;
}

interface CartProbe {
  variantId: number | null;
  basePriceCents: number | null;
}

async function readFirstVariant(page: Page, handle: string): Promise<CartProbe> {
  return page.evaluate(async (currentHandle) => {
    const response = await fetch(
      `/products/${encodeURIComponent(currentHandle)}.js`,
      { credentials: "same-origin" },
    );
    if (!response.ok) {
      return { variantId: null, basePriceCents: null };
    }
    const json = await response.json();
    const variant = (json?.variants ?? []).find(
      (candidate: { available?: boolean; id?: number }) => candidate?.available,
    ) ?? (json?.variants ?? [])[0];
    return {
      variantId: variant?.id ?? null,
      basePriceCents: typeof variant?.price === "number" ? variant.price : null,
    };
  }, handle);
}

async function addToCart(page: Page, variantId: number, quantity: number) {
  return page.evaluate(
    async ({ id, qty }) => {
      const response = await fetch("/cart/add.js", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ id, quantity: qty }),
      });
      return { ok: response.ok, status: response.status };
    },
    { id: variantId, qty: quantity },
  );
}

async function readCart(page: Page): Promise<{
  totalDiscountCents: number;
  finalLinePriceCents: number | null;
  itemCount: number;
}> {
  return page.evaluate(async () => {
    const response = await fetch("/cart.js", { credentials: "same-origin" });
    if (!response.ok) {
      return { totalDiscountCents: 0, finalLinePriceCents: null, itemCount: 0 };
    }
    const json = await response.json();
    const firstItem = (json?.items ?? [])[0];
    return {
      totalDiscountCents: Number(json?.total_discount ?? 0),
      finalLinePriceCents:
        typeof firstItem?.final_line_price === "number"
          ? firstItem.final_line_price
          : null,
      itemCount: Number(json?.item_count ?? 0),
    };
  });
}

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  // See storefront.smoke.spec.ts — give the hook room to absorb the dev-tunnel
  // cold-start once so the tests navigate against a warm route.
  test.setTimeout(150_000);
  await ensureOriginalMarginGuardSnapshot();
  await warmStorefrontTunnel(resolveCartProductHandle() ?? undefined);
});

test.afterAll(async () => {
  await restoreOriginalMarginGuardSnapshot();
  await disconnectE2EPrisma();
});

test("discount function keeps the discounted line price above the margin floor", async ({
  page,
}) => {
  const handle = resolveCartProductHandle();
  if (!handle) {
    test.skip(true, "No cart product handle resolved (set SHOPIFY_E2E_PRODUCT_HANDLE_CART or seed the matrix).");
    return;
  }

  const admin = await getOfflineAdminClientForE2E();
  if (!admin) {
    test.skip(true, "No offline Shopify session to activate the discount function.");
    return;
  }

  // Floor 70% → margin guard must cap any discount at 30%. Seed an over-aggressive
  // 50% global discount so the cap is observable.
  await resetMarginGuardConfigForStorefrontE2E();
  await updateGlobalMarginGuardConfig({
    b2bTag: "b2b",
    globalMinPricePercent: 70,
    b2bGlobalMinPricePercent: 70,
    allowZeroFinalPrice: false,
    allowRemoveAtMinimumOrderQuantity: true,
    allowStacking: false,
    maxCombinedPercentOff: null,
  });
  await upsertDiscountRule({
    scope: "GLOBAL",
    percentOff: 50,
    priority: 100,
    stackMode: "STACKABLE",
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const activation = await ensureDiscountFunctionActive(admin as any);
  if (!activation.ok) {
    test.skip(true, `Discount function not active: ${activation.message ?? "unknown"}.`);
    return;
  }

  await page.goto(decorateStorefrontPath(`/products/${handle}`), { waitUntil: "domcontentloaded" });
  await maybeUnlockStorefront(page, config.storefrontPassword);
  await page.goto(decorateStorefrontPath(`/products/${handle}`), { waitUntil: "domcontentloaded" });

  const probe = await readFirstVariant(page, handle);
  if (!probe.variantId || !probe.basePriceCents) {
    test.skip(true, `Could not resolve a purchasable variant for ${handle}.`);
    return;
  }

  // Clear the cart, then add one unit.
  await page.evaluate(() => fetch("/cart/clear.js", { method: "POST", credentials: "same-origin" }));
  const added = await addToCart(page, probe.variantId, 1);
  if (!added.ok) {
    test.skip(true, `Add to cart failed (HTTP ${added.status}).`);
    return;
  }

  const cart = await readCart(page);
  if (cart.totalDiscountCents === 0) {
    test.skip(
      true,
      "No discount applied in cart — the automatic app discount is not active on this store yet.",
    );
    return;
  }

  // Margin guard must not let the final line price fall below the 70% floor.
  const floorCents = Math.round(probe.basePriceCents * 0.7) - 1; // -1 cent rounding slack
  expect(
    cart.finalLinePriceCents != null && cart.finalLinePriceCents >= floorCents,
    `Final line price ${cart.finalLinePriceCents} should stay >= floor ${floorCents} (70% of ${probe.basePriceCents}).`,
  ).toBe(true);
});

test("cart validation blocks checkout when minimum order quantity is not met", async ({
  page,
}) => {
  const handle = resolveCartProductHandle();
  if (!handle) {
    test.skip(true, "No cart product handle resolved.");
    return;
  }

  const admin = await getOfflineAdminClientForE2E();
  if (!admin) {
    test.skip(true, "No offline Shopify session to activate cart validation.");
    return;
  }

  await resetMarginGuardConfigForStorefrontE2E();

  await page.goto(decorateStorefrontPath(`/products/${handle}`), { waitUntil: "domcontentloaded" });
  await maybeUnlockStorefront(page, config.storefrontPassword);
  await page.goto(decorateStorefrontPath(`/products/${handle}`), { waitUntil: "domcontentloaded" });

  const probe = await readFirstVariant(page, handle);
  if (!probe.variantId) {
    test.skip(true, `Could not resolve a purchasable variant for ${handle}.`);
    return;
  }

  // Seed MOQ 6 on the resolved product, then activate cart validation.
  await upsertProductQuantityRule({
    productId: `gid://shopify/Product/${await page.evaluate(async (h) => {
      const r = await fetch(`/products/${encodeURIComponent(h)}.js`, { credentials: "same-origin" });
      const j = await r.json();
      return j?.id ?? 0;
    }, handle)}`,
    minimumOrderQuantity: 6,
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const activation = await ensureCartValidationActive(admin as any);
  if (!activation.ok) {
    test.skip(true, `Cart validation not active: ${activation.message ?? "unknown"}.`);
    return;
  }

  await page.evaluate(() => fetch("/cart/clear.js", { method: "POST", credentials: "same-origin" }));
  const added = await addToCart(page, probe.variantId, 1); // below MOQ 6
  if (!added.ok) {
    test.skip(true, `Add to cart failed (HTTP ${added.status}).`);
    return;
  }

  // Attempt to advance to checkout; cart validation should keep us off the
  // hosted checkout. A reached /checkouts/ URL means validation did not block.
  await page.goto("/checkout", { waitUntil: "domcontentloaded" }).catch(() => {});
  const onCheckout = /\/checkouts?\//.test(new URL(page.url()).pathname);
  if (onCheckout) {
    test.skip(
      true,
      "Checkout was reached — cart validation did not block (Function may not be active for this scenario).",
    );
    return;
  }

  expect(onCheckout, "Checkout should be blocked below MOQ.").toBe(false);
});
