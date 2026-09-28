import { test, expect } from "@playwright/test";
import { assertResponsiveSane } from "../support/responsive-invariants";

test.describe("QA verified fixes", () => {
  test.skip(
    process.env.WON_CATALOG_QA !== "1",
    "Requires the source QA catalogue",
  );
  test("identical comparison images stay registered when the divider moves", async ({
    page,
  }, info) => {
    for (const width of [390, 768, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.goto("/pages/contact?view=won-qa-page-12");
      const section = page.locator('[id^="shopify-section-"][id$="__qa158"]');
      await section.scrollIntoViewIfNeeded();
      const before = section.locator(".won-compare__layer--before img");
      const after = section.locator(".won-compare__layer--after img");
      for (const value of ["0", "50", "100"]) {
        const range = section.locator("input[type=range]");
        await range.fill(value);
        await range.dispatchEvent("input");
        const a = await before.boundingBox(),
          b = await after.boundingBox();
        expect(a).not.toBeNull();
        expect(b).not.toBeNull();
        for (const key of ["x", "y", "width", "height"] as const)
          expect(Math.abs(a![key] - b![key])).toBeLessThan(1);
      }
      const range = section.locator("input[type=range]");
      await range.fill("50");
      await range.focus();
      await page.keyboard.press("ArrowRight");
      await expect(range).toHaveValue("51");
      await section.screenshot({
        path: `${process.env.WON_QA_OUTPUT || "tmp/theme-audit-runs/2026-09-10-catalog"}/compare-fixed-${width}.png`,
        style:
          ".shopify-section-group-header-group {visibility:hidden!important}",
        animations: "disabled",
      });
      if (width === 390) await assertResponsiveSane(page);
    }
  });
  test("external URL video renders the provider iframe without a Liquid exception", async ({
    page,
  }) => {
    await page.goto("/pages/contact?view=won-qa-page-10");
    const video = page.locator('[id^="shopify-section-"][id$="__qa128"]');
    await video.scrollIntoViewIfNeeded();
    await expect(video).not.toContainText("Liquid error");
    await expect(video.locator("iframe")).toHaveAttribute(
      "src",
      "https://www.youtube.com/embed/_9VUPq3SxOc",
    );
    await expect(video.locator("iframe")).toHaveAttribute("title", /\S/);
    // iframe creation is the theme contract; external playback is reported separately.
  });
});
