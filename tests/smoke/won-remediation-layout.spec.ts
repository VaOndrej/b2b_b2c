import { test, expect, type Page } from "@playwright/test";
import { assertResponsiveSane } from "../support/responsive-invariants";

const output = "tmp/theme-audit-runs/2026-09-11-remediation";
const section = (page: Page, id: string) =>
  page.locator(`[id^="shopify-section-"][id$="__${id}"]`);

async function open(page: Page, url: string) {
  await page.goto(url);
  expect(await page.evaluate(() => (window as any).Shopify?.shop)).toBe(
    "b2b-b2c-store-development.myshopify.com",
  );
}

test.describe("Won remediation layout", () => {
  test.skip(
    process.env.WON_REMEDIATION_QA !== "1",
    "Requires the generated QA catalogue",
  );
  for (const width of [390, 768, 1440]) {
    test(`marquee content retains intrinsic width at ${width}`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 1000 });
      await open(page, "/pages/contact?view=won-qa-page-1");
      const host = section(page, "qa008");
      await host.scrollIntoViewIfNeeded();
      const item = host
        .locator(".won-carousel__mq-group > .shopify-block:has(> .won-slide)")
        .first();
      await expect(item).toBeVisible();
      expect(
        await item.evaluate((el) => getComputedStyle(el).containerType),
      ).toBe("normal");
      expect(
        await item
          .locator(".won-slide__body")
          .evaluate((el) => getComputedStyle(el).containerType),
      ).toBe("normal");
      const box = await item.boundingBox();
      const track = await host.locator("[data-won-track]").boundingBox();
      expect(box!.width).toBeGreaterThan(track!.width / 2);
      expect(box!.width).toBeLessThanOrEqual(track!.width + 1);
      const buttons = host.locator("a.won-btn");
      for (const button of await buttons.all()) {
        const target = await button.boundingBox();
        expect(target!.width).toBeGreaterThanOrEqual(44);
        expect(target!.height).toBeGreaterThanOrEqual(44);
      }
      await host.screenshot({
        path: `${output}/qa008-${width}.png`,
        animations: "disabled",
        style:
          ".shopify-section-group-header-group { visibility: hidden !important; }",
      });
      if (width === 390) await assertResponsiveSane(page);
    });
    test(`mosaic media and its actual grid item at ${width}`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 1000 });
      await open(page, "/pages/contact?view=won-qa-page-2");
      const host = section(page, "qa019");
      await host.scrollIntoViewIfNeeded();
      const tile = host.locator(".won-tile--large").first();
      const media = tile.locator(".won-tile__media");
      await expect(media).toBeVisible();
      const metrics = await tile.evaluate((el) => {
        const grid = el.closest(".won-grid")!;
        let item = el;
        while (item.parentElement !== grid) item = item.parentElement!;
        return {
          span: getComputedStyle(item).gridColumnStart,
          columns: getComputedStyle(grid).gridTemplateColumns.split(" ").length,
          width: el.getBoundingClientRect().width,
          height: el.querySelector(".won-tile__media")!.getBoundingClientRect()
            .height,
        };
      });
      expect(metrics.height).toBeGreaterThan(metrics.width / 2);
      if (width >= 750 && metrics.columns > 1)
        expect(metrics.span).toBe("span 2");
      await host.screenshot({
        path: `${output}/qa019-${width}.png`,
        animations: "disabled",
        style:
          ".shopify-section-group-header-group { visibility: hidden !important; }",
      });
      if (width === 390) await assertResponsiveSane(page);
    });

    test(`bottom badge and long overlay title have separate flow boxes at ${width}`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 1000 });
      await open(page, "/pages/contact?view=won-qa-page-10");
      const host = section(page, "qa120");
      await host.scrollIntoViewIfNeeded();
      const tile = host.locator(".won-tile").first();
      if (width === 768) {
        expect(
          await host
            .locator(".won-grid")
            .evaluate(
              (el) =>
                getComputedStyle(el).gridTemplateColumns.split(" ").length,
            ),
        ).toBe(1);
      }
      const badge = await tile.locator(".won-tile__badge").boundingBox();
      const label = await tile.locator(".won-tile__label").boundingBox();
      const box = await tile.boundingBox();
      expect(badge).not.toBeNull();
      expect(label).not.toBeNull();
      expect(box).not.toBeNull();
      expect(badge!.y + badge!.height).toBeLessThanOrEqual(label!.y);
      expect(label!.y + label!.height).toBeLessThanOrEqual(
        box!.y + box!.height,
      );
      await host.screenshot({
        path: `${output}/qa120-${width}.png`,
        animations: "disabled",
        style:
          ".shopify-section-group-header-group { visibility: hidden !important; }",
      });
      if (width === 390) await assertResponsiveSane(page);
    });

    test(`corner sticky fits its shell and viewport at ${width}`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 1000 });
      await open(
        page,
        "/products/the-videographer-snowboard?view=won-qa-product-19",
      );
      await page.evaluate(() =>
        window.scrollTo(0, document.documentElement.scrollHeight),
      );
      const sticky = section(page, "qa135").locator("won-sticky-atc");
      await expect(sticky).toHaveClass(/is-visible/);
      await expect
        .poll(() => sticky.evaluate((el) => getComputedStyle(el).transform))
        .toBe("matrix(1, 0, 0, 1, 0, 0)");
      const button = sticky.locator("button");
      await expect(button).toBeEnabled();
      const shell = await sticky.boundingBox();
      const action = await button.boundingBox();
      expect(shell!.x).toBeGreaterThanOrEqual(0);
      expect(shell!.x + shell!.width).toBeLessThanOrEqual(width);
      expect(action!.x).toBeGreaterThanOrEqual(shell!.x);
      expect(action!.x + action!.width).toBeLessThanOrEqual(
        shell!.x + shell!.width + 1,
      );
      expect(action!.y).toBeGreaterThanOrEqual(shell!.y);
      expect(action!.y + action!.height).toBeLessThanOrEqual(
        shell!.y + shell!.height + 1,
      );
      expect(action!.width).toBeGreaterThanOrEqual(44);
      expect(action!.height).toBeGreaterThanOrEqual(44);
      await expect
        .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
        .toBeLessThanOrEqual(width);
      await sticky.screenshot({
        path: `${output}/qa135-${width}.png`,
        animations: "disabled",
        style:
          ".shopify-section-group-header-group { visibility: hidden !important; }",
      });
      if (width === 390) await assertResponsiveSane(page);
    });
  }
});
