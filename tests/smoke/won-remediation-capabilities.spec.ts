import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { assertResponsiveSane } from "../support/responsive-invariants";
import {
  observeCommittedCart,
  openEmptyCart,
  expectCommittedCart,
} from "../support/cart-state";

const catalogue = JSON.parse(
  readFileSync("themes/won-base/examples/qa/manifest.json", "utf8"),
);
type Case = {
  id: string;
  type: string;
  variant: string;
  url: string;
  sectionId: string;
};
const cases: Case[] = catalogue.cases;
const sectionFor = (page: Page, c: Case) =>
  page.locator(`[id^="shopify-section-"][id$="__${c.sectionId}"]`);
const rowCases = () =>
  cases.filter(
    (c) => c.type === "won-product-card" && c.variant.startsWith("row "),
  );
const videoCases = () =>
  cases.filter(
    (c) => c.type === "won-video" && /^(portrait|adaptive) /.test(c.variant),
  );

async function openFixture(page: Page, c: Case) {
  const current = new URL(page.url());
  if (current.pathname + current.search !== c.url) {
    const response = await page.goto(c.url);
    expect(response?.status()).toBe(200);
  }
  expect(await page.evaluate(() => (window as any).Shopify?.shop)).toBe(
    "b2b-b2c-store-development.myshopify.com",
  );
  await expect(sectionFor(page, c)).not.toContainText("Liquid error");
}

test.describe("Won remediation capabilities", () => {
  test.skip(
    process.env.WON_REMEDIATION_QA !== "1",
    "Requires regenerated remediation QA catalogue",
  );
  for (const width of [390, 768, 1440]) {
    test(`product rows have natural CTA placement and real tap targets at ${width}`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 1000 });
      const rows = rowCases();
      expect(
        rows.length,
        "single, multi-variant and unavailable row fixtures",
      ).toBeGreaterThanOrEqual(3);
      for (const c of rows) {
        await openFixture(page, c);
        const section = sectionFor(page, c);
        const card = section.locator(".won-pcard--row");
        await expect(card).toHaveCount(1);
        await section.scrollIntoViewIfNeeded();
        const media = await card.locator(".won-pcard__media").boundingBox();
        const content = await card.locator(".won-pcard__info").boundingBox();
        const action = card.locator(":scope > .won-pcard__add");
        const box = await action.boundingBox();
        expect(media).not.toBeNull();
        expect(content).not.toBeNull();
        expect(box).not.toBeNull();
        expect(media!.width).toBeGreaterThan(43);
        expect(media!.height).toBeGreaterThan(43);
        expect(content!.x).toBeGreaterThanOrEqual(media!.x + media!.width);
        expect(box!.x + box!.width).toBeLessThanOrEqual(width + 1);
        expect(
          await action.evaluate((el) => getComputedStyle(el).position),
        ).toBe("static");
        // Both regular buttons and the stepper's actual child buttons are tested.
        for (const control of await card
          .locator("button:visible, a.won-pcard__add:visible")
          .all()) {
          const target = await control.boundingBox();
          expect(target!.height).toBeGreaterThanOrEqual(44);
          expect(target!.width).toBeGreaterThanOrEqual(44);
        }
        await section.screenshot({
          path: `tmp/theme-remediation/2026-09-11/${c.id}-${width}.png`,
          animations: "disabled",
          style:
            ".shopify-section-group-header-group {visibility:hidden!important}",
        });
        if (width === 390) await assertResponsiveSane(page);
      }
    });

    test(`video portrait and adaptive fallback retain a usable player at ${width}`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 1000 });
      const videos = videoCases();
      expect(
        videos.length,
        "portrait cover/contain and external adaptive fixtures",
      ).toBeGreaterThanOrEqual(3);
      for (const c of videos) {
        await openFixture(page, c);
        const section = sectionFor(page, c);
        await section.scrollIntoViewIfNeeded();
        const frame = section.locator(".won-video__frame");
        const box = await frame.boundingBox();
        const ratio = c.variant.startsWith("portrait") ? 9 / 16 : 16 / 9;
        expect(box).not.toBeNull();
        expect(Math.abs(box!.width / box!.height - ratio)).toBeLessThan(0.01);
        const iframe = frame.locator("iframe");
        if (await iframe.count()) {
          await expect(iframe).toHaveAttribute("title", /\S/);
          await expect(iframe).toHaveAttribute(
            "src",
            /https:\/\/(www\.youtube\.com\/embed|player\.vimeo\.com\/video)\//,
          );
          const player = await iframe.boundingBox();
          expect(Math.abs(player!.width - box!.width)).toBeLessThan(1);
          expect(Math.abs(player!.height - box!.height)).toBeLessThan(1);
        }
        const expectedFit = c.variant.includes("contain") ? "contain" : "cover";
        expect(
          await section
            .locator(".won-video")
            .evaluate((el) =>
              getComputedStyle(el).getPropertyValue("--won-video-fit").trim(),
            ),
        ).toBe(expectedFit);
        await section.screenshot({
          path: `tmp/theme-remediation/2026-09-11/${c.id}-${width}.png`,
          animations: "disabled",
          style:
            ".shopify-section-group-header-group {visibility:hidden!important}",
        });
        if (width === 390) await assertResponsiveSane(page);
      }
      // These checks establish frame geometry/settings, not hosted playback:
      // the development catalogue currently has no hosted video resource.
    });
  }

  test("row multi-variant action opens the existing quick view", async ({
    page,
  }) => {
    const fixture = rowCases().find((c) => /multi/.test(c.variant));
    expect(fixture).toBeDefined();
    await openFixture(page, fixture!);
    const action = sectionFor(page, fixture!).locator(
      ".won-pcard--row > a.won-pcard__add",
    );
    await expect(action).toHaveAttribute("href", /\/products\//);
    await expect(action).toHaveAttribute("data-won-quickview", "");
    await action.click();
    await expect(
      page.locator("#quick-add-dialog > dialog.quick-add-modal"),
    ).toHaveAttribute("open", "");
    await expect(
      page.locator("#quick-add-modal-content [data-product-grid-content]"),
    ).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(
      page.locator("#quick-add-dialog > dialog.quick-add-modal"),
    ).not.toHaveAttribute("open", "");
  });

  test("row quick add uses the shared cart and unavailable rows cannot add", async ({
    page,
  }) => {
    const fixture = rowCases().find((c) => /single/.test(c.variant));
    expect(fixture, "single variant row fixture required").toBeDefined();
    const network: Array<{ url: string; status: number; body?: string }> = [];
    page.on("response", async (response) => {
      if (!/\/cart\/(add|update|change)\.js/.test(response.url())) return;
      const entry = {
        url: response.url(),
        status: response.status(),
        body: undefined as string | undefined,
      };
      network.push(entry);
      if (!response.ok())
        entry.body = await response
          .text()
          .catch(() => "Response body unavailable");
    });
    await observeCommittedCart(page);
    await openEmptyCart(page, fixture!.url);
    const card = sectionFor(page, fixture!).locator(".won-pcard--row");
    const add = card.locator("[data-won-add]");
    await expect(add).toHaveCount(1);
    const variant = Number(await add.getAttribute("data-variant-id"));
    let primaryFailure: unknown;
    try {
      await add.click();
      const cart = await expectCommittedCart(page, 1);
      expect(
        cart.items
          .filter((line) => line.variant_id === variant)
          .reduce((sum, line) => sum + line.quantity, 0),
      ).toBe(1);
      const qty = card.locator("[data-won-qty]");
      if (await qty.count()) await expect(qty).toHaveText("1");
    } catch (error) {
      primaryFailure = error;
      await test
        .info()
        .attach("row-cart-response-evidence", {
          contentType: "application/json",
          body: JSON.stringify(network, null, 2),
        });
    }
    // Preserve the action failure if cleanup also fails (for example an HTTP
    // throttle); a finally assertion must not erase the actual cart evidence.
    try {
      const cleared = await page.request.post("/cart/clear.js");
      expect(
        cleared.ok(),
        `row cleanup HTTP ${cleared.status()}: ${cleared.ok() ? "" : await cleared.text()}`,
      ).toBeTruthy();
      expect((await cleared.json()).item_count).toBe(0);
    } catch (cleanupFailure) {
      if (primaryFailure)
        throw new AggregateError(
          [primaryFailure, cleanupFailure],
          "Row cart action and cleanup both failed",
        );
      throw cleanupFailure;
    }
    if (primaryFailure) throw primaryFailure;
    const unavailable = rowCases().find((c) =>
      /sold|unavailable/.test(c.variant),
    );
    expect(unavailable).toBeDefined();
    await openFixture(page, unavailable!);
    await expect(
      sectionFor(page, unavailable!).locator(".won-pcard__add--soldout"),
    ).toHaveAttribute("aria-disabled", "true");
    await expect(
      sectionFor(page, unavailable!).locator("[data-won-add]"),
    ).toHaveCount(0);
  });
});
