import { test, expect } from "@playwright/test";
import {
  assertCartBrowserResponse,
  attachCartDiagnostics,
  getCart,
  observeCommittedCart,
  openEmptyCart,
} from "../support/cart-state";
import { gotoStorefront } from "../support/storefront-environment";
import {
  assertResponsiveSane,
  assertCarousel,
} from "../support/responsive-invariants";

const editorialUrl = `/products/the-videographer-snowboard?view=${process.env.WON_EDITORIAL_VIEW || "won-editorial"}`;

// Opt-in merchant fixture: see themes/won-base/examples/README.md.
// Existing product templates and live assignments are never replaced by this test.
test.describe("editorial PDP", () => {
  test.skip(
    process.env.WON_EDITORIAL_QA !== "1",
    "Requires the optional editorial template fixture",
  );
  test("composes reusable columns, cards and native purchase controls", async ({
    page,
  }, info) => {
    const errors: string[] = [];
    const assetFailures: string[] = [];
    page.on("response", (r) => {
      if (
        r.status() >= 400 &&
        /\.(css|js|svg|png|jpg|webp)(\?|$)/.test(r.url())
      )
        assetFailures.push(`${r.status()} ${r.url()}`);
    });
    page.on("pageerror", (e) => errors.push(e.message));
    await gotoStorefront(page, editorialUrl);
    await expect(page.locator(".won-slide--testimonial")).toHaveCount(2);
    await expect(page.locator(".won-feature--numbered")).toHaveCount(4);
    await expect(page.locator(".won-slide--expert")).toHaveCount(1);
    await expect(page.locator(".won-tile--label-below")).toHaveCount(4);
    await expect(
      page.locator(".won-product-offer variant-picker"),
    ).toBeVisible();
    await expect(page.locator("body")).not.toContainText("Liquid error");
    const review = page.locator(".won-slide--testimonial").first();
    const media = await review.locator(".won-slide__media").boundingBox();
    const body = await review.locator(".won-slide__body").boundingBox();
    expect(media).not.toBeNull();
    expect(body).not.toBeNull();
    if (info.project.name === "desktop") {
      expect(Math.abs(media!.y - body!.y)).toBeLessThan(2);
      expect(body!.x).toBeGreaterThan(media!.x + media!.width - 2);
    } else {
      expect(body!.y).toBeGreaterThanOrEqual(media!.y + media!.height - 2);
      await assertResponsiveSane(page);
      const rail = page
        .locator("won-carousel")
        .filter({ has: page.locator(".won-slide--testimonial") });
      await assertCarousel(
        page,
        rail.locator("[data-won-track]"),
        rail.locator("[data-won-track] > *"),
        { mode: "single" },
      );
    }
    const faq = page.locator(".won-panel--boxed");
    const a = await faq.nth(0).boundingBox(),
      b = await faq.nth(1).boundingBox();
    if (info.project.name === "desktop")
      expect(b!.x).toBeGreaterThan(a!.x + a!.width - 2);
    else expect(b!.y).toBeGreaterThan(a!.y);
    const expertMedia = await page
      .locator(".won-slide--expert .won-slide__media")
      .boundingBox();
    const caption = await page
      .locator(".won-slide__media-caption")
      .boundingBox();
    expect(caption!.y).toBeGreaterThanOrEqual(expertMedia!.y);
    expect(caption!.y + caption!.height).toBeLessThanOrEqual(
      expertMedia!.y + expertMedia!.height,
    );
    expect(errors).toEqual([]);
    expect(assetFailures).toEqual([]);
    await page.screenshot({
      path: `${process.env.WON_EDITORIAL_OUTPUT || "tmp"}/editorial-${info.project.name}.png`,
      fullPage: true,
    });
  });

  test("disclosures work by keyboard and remain independent of purchase state", async ({
    page,
  }) => {
    await gotoStorefront(page, editorialUrl);
    const first = page.locator(".won-panel--editorial").first();
    const summary = first.locator("summary");
    await summary.focus();
    await page.keyboard.press("Enter");
    await expect(first).toHaveAttribute("open", "");
    await expect(first.locator(".won-panels__answer")).toBeVisible();
    await page.keyboard.press("Enter");
    await expect(first).not.toHaveAttribute("open");
    const faq = page.locator(".won-panel--boxed");
    await faq.nth(0).locator("summary").click();
    await expect(faq.nth(0)).toHaveAttribute("open", "");
    await faq.nth(1).locator("summary").click();
    await expect(faq.nth(1)).toHaveAttribute("open", "");
    await expect(faq.nth(0)).not.toHaveAttribute("open");
  });
  test("native variant changes update price and submit the selected item", async ({
    page,
  }) => {
    await observeCommittedCart(page);
    await openEmptyCart(page, editorialUrl, { requireStepper: false });
    const productResponse = await page.request.get(
      "/products/the-videographer-snowboard.js",
      { headers: { Accept: "application/json" } },
    );
    expect(
      productResponse.ok(),
      `product fixture HTTP ${productResponse.status()}`,
    ).toBeTruthy();
    const product = JSON.parse(await productResponse.text());
    const available = product.variants.filter((v: any) => v.available);
    expect(available.length).toBeGreaterThan(1);
    const target = available[1];
    const picker = page.locator(".won-product-offer variant-picker");
    const form = page.locator('form[data-type="add-to-cart-form"]').first();
    const oldPrice = await page.locator("product-price").first().innerText();
    // The fixture's demo product has one package-size option. Click its real label.
    await picker.locator("label").filter({ hasText: target.option1 }).click();
    await expect(form.locator('input[name="id"]')).toHaveValue(
      String(target.id),
    );
    if (available[0].price !== target.price)
      await expect(page.locator("product-price").first()).not.toHaveText(
        oldPrice,
      );
    const mutation = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        /\/cart\/(?:add|update|change)\.js(?:\?|$)/.test(response.url()),
    );
    await form.locator('button[type="submit"]').click();
    await assertCartBrowserResponse(await mutation, "editorial native add");
    const cart = await getCart(page, "editorial independent cart verification");
    expect(
      cart.items.find((i: any) => i.variant_id === target.id)?.quantity || 0,
    ).toBe(1);
    // This test owns a fresh browser context. Let context teardown discard the
    // cart cookie instead of spending another remote mutation on cleanup.
  });
});

test.afterEach(async ({ page }) => attachCartDiagnostics(page));
