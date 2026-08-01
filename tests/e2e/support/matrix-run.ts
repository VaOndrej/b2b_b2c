import { type Page } from "@playwright/test";
import { test, expect } from "./fixtures.ts";
import {
  maybeUnlockStorefront,
  waitForMarginGuardBootstrap,
} from "./storefront.ts";
import { resolveShopifyE2ERuntimeConfig } from "./runtime.ts";
import type { ThemeContext } from "./theme.ts";
import {
  describeProductArchetype,
  readMatrixFile,
  type ProductMatrixFixture,
} from "./matrix.ts";
import type { TestContext } from "./catalog-context.ts";

// The active context is forced per Playwright PROJECT via the gated app-proxy
// override (`mg_e2e_audience`): the `catalog` context injects the dedicated e2e
// catalog's audience tag so its seeded rules apply; the `base` context sends no
// override and resolves to the default catalog. The SAME Tier-1 specs render both
// contexts without a real browser login. The TRIGGER (real customer tag → matched
// catalog) stays covered on the integration tier.

const config = resolveShopifyE2ERuntimeConfig();

// App-injected markers — theme-independent, identical on Horizon and Dawn.
const QUANTITY_NOTICE = "#margin-guard-pdp-quantity-notice";
const VISIBILITY_SCRIPT = "script[data-margin-guard-visibility-script]";

async function gotoPdp(
  page: Page,
  theme: ThemeContext,
  handle: string,
): Promise<boolean> {
  await theme.gotoStorefront(page, `/products/${handle}`);
  await maybeUnlockStorefront(page, config.storefrontPassword);
  // Re-navigate THROUGH the theme context so the preview/audience params survive
  // the password unlock (params are re-appended on every navigation).
  await theme.gotoStorefront(page, `/products/${handle}`);
  const hasForm =
    (await page.locator(theme.selectors.addToCartForm).count()) > 0 ||
    (await page.locator(VISIBILITY_SCRIPT).count()) > 0;
  return hasForm;
}

async function readVisibilityPayload(page: Page): Promise<Record<string, unknown>> {
  const response = await waitForMarginGuardBootstrap(page);
  return (await response.json()) as Record<string, unknown>;
}

async function assertProductVisibility(
  page: Page,
  theme: ThemeContext,
  fixture: ProductMatrixFixture,
  context: TestContext,
) {
  if (!(await gotoPdp(page, theme, fixture.handle))) {
    test.skip(true, `PDP for ${fixture.handle} is not a published product page.`);
    return;
  }

  const payload = await readVisibilityPayload(page);
  const hiddenHandles = Array.isArray(payload?.hiddenHandles)
    ? (payload.hiddenHandles as string[])
    : [];
  // The product is hidden ONLY in the catalog context (where the e2e catalog's
  // HIDDEN rule applies); the base/default context keeps it visible.
  const shouldBeHidden = context === "catalog";

  // Assert the AUTHORITATIVE /visibility app-proxy payload. It reflects the seeded
  // catalog rule end-to-end through the real proxy, on the real theme, for the
  // (forced) context — with NO dependency on the Liquid metafield layer. This is
  // deterministic across Horizon/Dawn × base/catalog.
  expect(
    hiddenHandles.includes(fixture.handle),
    `Expected ${context} /visibility payload to ${shouldBeHidden ? "hide" : "keep visible"} ${fixture.handle}.`,
  ).toBe(shouldBeHidden);
}

async function assertVariantVisibility(
  page: Page,
  theme: ThemeContext,
  fixture: ProductMatrixFixture,
  context: TestContext,
) {
  if (!(await gotoPdp(page, theme, fixture.handle))) {
    test.skip(true, `PDP for ${fixture.handle} is not a published product page.`);
    return;
  }

  const payload = await readVisibilityPayload(page);
  const variantRule = (
    payload?.variantVisibilityByProductId as
      | Record<string, { hiddenVariantIds?: unknown }>
      | undefined
  )?.[fixture.productId];
  const hiddenVariantIds = Array.isArray(variantRule?.hiddenVariantIds)
    ? (variantRule!.hiddenVariantIds as string[])
    : [];

  if (context === "catalog") {
    expect(
      hiddenVariantIds.length > 0,
      "Expected the catalog context to hide the e2e-catalog-only variant.",
    ).toBe(true);
  } else {
    expect(
      hiddenVariantIds.length === 0,
      "Expected the base context to keep the variant visible (no hidden variant IDs).",
    ).toBe(true);
  }
}

async function assertQuantityMoqStep(
  page: Page,
  theme: ThemeContext,
  fixture: ProductMatrixFixture,
  context: TestContext,
) {
  if (!(await gotoPdp(page, theme, fixture.handle))) {
    test.skip(true, `PDP for ${fixture.handle} is not a published product page.`);
    return;
  }
  const payload = await readVisibilityPayload(page);
  const constraint = (
    payload?.quantityConstraintsByProductId as
      | Record<string, { minimumOrderQuantity?: unknown; stepQuantity?: unknown }>
      | undefined
  )?.[fixture.productId];

  // The quantity rule lives ONLY on the e2e catalog → the base context has no
  // constraint; assert its absence and stop.
  if (context === "base") {
    expect(
      constraint == null || constraint.minimumOrderQuantity == null,
      `Expected the base context to have no MOQ for ${fixture.handle}.`,
    ).toBe(true);
    return;
  }

  // Catalog context: the seeded MOQ/step applies (payload is authoritative).
  expect(
    constraint != null &&
      constraint.minimumOrderQuantity === fixture.minimumOrderQuantity,
    `Expected catalog payload minimumOrderQuantity=${fixture.minimumOrderQuantity} for ${fixture.handle}.`,
  ).toBe(true);

  const notice = page.locator(QUANTITY_NOTICE);
  if (fixture.minimumOrderQuantity != null) {
    await expect(notice).toContainText(
      `Minimum order quantity: ${fixture.minimumOrderQuantity}.`,
    );
  }
  if (fixture.stepQuantity != null) {
    await expect(notice).toContainText(
      `This product is sold in multiples of ${fixture.stepQuantity}.`,
    );
  }

  const quantityInput = page.locator(theme.selectors.quantityInput).first();
  if ((await quantityInput.count()) === 0) {
    test.skip(
      true,
      `Theme "${theme.name}" has no PDP quantity input — notice asserted, nothing to normalize.`,
    );
    return;
  }
  if (fixture.minimumOrderQuantity != null) {
    await expect(quantityInput).toHaveValue(String(fixture.minimumOrderQuantity));
    await expect(quantityInput).toHaveAttribute(
      "min",
      String(fixture.minimumOrderQuantity),
    );
  }
  if (fixture.stepQuantity != null) {
    await expect(quantityInput).toHaveAttribute("step", String(fixture.stepQuantity));
  }
}

async function assertQuantityMax(
  page: Page,
  theme: ThemeContext,
  fixture: ProductMatrixFixture,
  context: TestContext,
) {
  if (!(await gotoPdp(page, theme, fixture.handle))) {
    test.skip(true, `PDP for ${fixture.handle} is not a published product page.`);
    return;
  }

  const payload = await readVisibilityPayload(page);
  const constraint = (
    payload?.quantityConstraintsByProductId as
      | Record<string, { maxOrderQuantity?: unknown }>
      | undefined
  )?.[fixture.productId];

  // Max quantity lives ONLY on the e2e catalog → absent in the base context.
  if (context === "base") {
    expect(
      constraint == null || constraint.maxOrderQuantity == null,
      `Expected the base context to have no max quantity for ${fixture.handle}.`,
    ).toBe(true);
    return;
  }

  expect(
    constraint != null && constraint.maxOrderQuantity === fixture.maxOrderQuantity,
    `Expected catalog payload maxOrderQuantity=${fixture.maxOrderQuantity} for ${fixture.handle}.`,
  ).toBe(true);

  const quantityInput = page.locator(theme.selectors.quantityInput).first();
  if ((await quantityInput.count()) > 0 && fixture.maxOrderQuantity != null) {
    await expect(quantityInput).toHaveAttribute(
      "max",
      String(fixture.maxOrderQuantity),
    );
  }
}

/**
 * Registers one read-only Tier-1 test per configured matrix fixture. The active
 * theme + context are injected via the `themeContext` fixture (set per Playwright
 * project), so the identical specs run on Horizon and Dawn under both the base and
 * catalog contexts.
 */
export function registerMatrixTests(): void {
  const matrix = readMatrixFile();

  test.describe("storefront matrix (Tier-1)", () => {
    if (!matrix || matrix.products.length === 0) {
      test("matrix is empty", () => {
        test.skip(
          true,
          "No E2E matrix seeded (catalog not synced or setup skipped).",
        );
      });
      return;
    }

    for (const fixture of matrix.products) {
      const title = `${describeProductArchetype(fixture.archetype)} — ${fixture.handle}`;
      test(title, async ({ page, themeContext }) => {
        const context = themeContext.context;
        switch (fixture.archetype) {
          case "HIDDEN":
            await assertProductVisibility(page, themeContext, fixture, context);
            break;
          case "VARIANT_HIDDEN":
            await assertVariantVisibility(page, themeContext, fixture, context);
            break;
          case "QUANTITY_MOQ_STEP":
            await assertQuantityMoqStep(page, themeContext, fixture, context);
            break;
          case "QUANTITY_MAX":
          // COLLECTION_MAX is storefront-indistinguishable from QUANTITY_MAX — same
          // payload field (quantityConstraintsByProductId[productId].maxOrderQuantity)
          // and DOM max attribute; only the seeded rule's target differs.
          case "COLLECTION_MAX":
            await assertQuantityMax(page, themeContext, fixture, context);
            break;
          default:
            test.skip(true, `Unknown archetype ${fixture.archetype}.`);
        }
      });
    }
  });
}
