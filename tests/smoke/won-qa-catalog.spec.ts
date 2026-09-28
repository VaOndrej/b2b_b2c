import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import {
  assertResponsiveSane,
  assertCarousel,
} from "../support/responsive-invariants";

// Opt-in visual evidence collector. A captured screenshot is NOT a visual approval.
const enabled = process.env.WON_CATALOG_QA === "1";
const root = process.env.WON_QA_OUTPUT || "tmp/theme-audit-runs/2026-09-10-catalog";
const manifestPath = "themes/won-base/examples/qa/manifest.json";
const manifest =
  enabled && fs.existsSync(manifestPath)
    ? JSON.parse(fs.readFileSync(manifestPath, "utf8"))
    : { cases: [] };
const selectedIds = process.env.WON_QA_IDS?.split(",");
if (selectedIds)
  manifest.cases = manifest.cases.filter((c: any) =>
    selectedIds.includes(c.id),
  );
const urls = [...new Set<string>(manifest.cases.map((c: any) => c.url))];
for (const width of (process.env.WON_QA_WIDTHS || "390,768,1440")
  .split(",")
  .map(Number))
  for (const url of urls) {
    test(`QA catalogue ${width} ${url}`, async ({ page }, info) => {
      test.skip(
        info.project.name !== "desktop",
        "Runner owns all three viewports",
      );
      test.setTimeout(240_000);
      await page.setViewportSize({ width, height: width === 390 ? 844 : 1024 });
      const signals: any = {
        console: [],
        pageErrors: [],
        failedRequests: [],
        failedAssets: [],
      };
      page.on("console", (m) => {
        if (m.type() === "error") signals.console.push(m.text());
      });
      page.on("pageerror", (e) => signals.pageErrors.push(e.message));
      page.on("requestfailed", (r) =>
        signals.failedRequests.push({
          url: r.url(),
          error: r.failure()?.errorText,
        }),
      );
      page.on("response", (r) => {
        if (
          r.status() >= 400 &&
          /\.(css|js|svg|png|jpe?g|webp|woff2?)(\?|$)/i.test(r.url())
        )
          signals.failedAssets.push({ url: r.url(), status: r.status() });
      });
      fs.mkdirSync(`${root}/screenshots`, { recursive: true });
      let response = await page.goto(url, { waitUntil: "domcontentloaded" });
      signals.httpAttempts = [response?.status()];
      for (
        let attempt = 0;
        response?.status() === 503 && attempt < 2;
        attempt++
      ) {
        await page.waitForTimeout(1500);
        response = await page.goto(url, { waitUntil: "domcontentloaded" });
        signals.httpAttempts.push(response?.status());
      }
      expect(
        response?.status(),
        "QA preview must render, not an upload-error document",
      ).toBe(200);
      await page.locator("#MainContent").waitFor();
      signals.identity = await page.evaluate(() => ({
        shop: (window as any).Shopify?.shop,
        theme: (window as any).Shopify?.theme,
      }));
      expect(signals.identity.shop).toBe(
        "b2b-b2c-store-development.myshopify.com",
      );
      expect(signals.identity.theme.role).toBe("development");
      await page.evaluate(() => document.fonts.ready);
      const results: any[] = [];
      for (const c of manifest.cases.filter((c: any) => c.url === url)) {
        const row: any = {
          ...c,
          width,
          status: "captured-not-reviewed",
          checks: [],
          screenshots: [],
        };
        let section = page.locator(
          `[id^="shopify-section-"][id$="__${c.sectionId}"]`,
        );
        if (c.type === "won-sticky-atc") {
          await page.evaluate(() =>
            window.scrollTo(0, document.body.scrollHeight),
          );
          await page.waitForTimeout(500);
          section = section.locator("won-sticky-atc");
        }
        try {
          const expectedHidden =
            c.type === "won-sticky-atc" &&
            ((c.variant === "mobile device scope" && width >= 750) ||
              (c.variant === "desktop device scope" && width < 750));
          if (expectedHidden) {
            await expect(section).toBeHidden();
            row.status = "expected-hidden";
            row.checks.push({ name: "device-scope", pass: true });
            results.push(row);
            continue;
          }
          await expect(section).toBeVisible();
          if (c.type !== "won-sticky-atc")
            await section.scrollIntoViewIfNeeded();
          await section.locator("img").evaluateAll(async (imgs) => {
            imgs.forEach((i: any) => (i.loading = "eager"));
            await Promise.race([
              Promise.all(imgs.map((i: any) => i.decode().catch(() => {}))),
              new Promise((r) => setTimeout(r, 5000)),
            ]);
          });
          await page.waitForTimeout(150);
          row.text = (await section.innerText()).slice(0, 1500);
          row.images = await section
            .locator("img")
            .evaluateAll((imgs) =>
              imgs.map((i: any) => ({
                src: i.currentSrc,
                loaded: i.complete && i.naturalWidth > 0,
              })),
            );
          row.box = await section.boundingBox();
          const screenshot = `${root}/screenshots/${c.id}-${width}.png`;
          await section.screenshot({
            path: screenshot,
            animations: "disabled",
            style:
              ".shopify-section-group-header-group { visibility:hidden !important; }",
            timeout: 15000,
          });
          row.screenshots.push(screenshot);
          if (/Liquid error|translation missing/i.test(row.text))
            row.checks.push({ name: "render", error: row.text });
          const summaries = section.locator("summary");
          if (await summaries.count()) {
            const summary = summaries.first();
            const wasOpen = await summary.evaluate((e) =>
              e.parentElement?.hasAttribute("open"),
            );
            await summary.focus();
            await page.keyboard.press("Enter");
            const opened = await summary.evaluate((e) =>
              e.parentElement?.hasAttribute("open"),
            );
            row.checks.push({
              name: "keyboard-disclosure",
              pass: opened !== wasOpen,
            });
            if (!opened) await page.keyboard.press("Enter");
            const expanded = `${root}/screenshots/${c.id}-${width}-expanded.png`;
            await section.screenshot({
              path: expanded,
              animations: "disabled",
              style:
                ".shopify-section-group-header-group { visibility:hidden !important; }",
            });
            row.screenshots.push(expanded);
            if (!wasOpen) await page.keyboard.press("Enter");
          }
          const tabs = section.locator('[role="tab"]');
          if ((await tabs.count()) > 1) {
            await tabs.nth(1).click();
            row.checks.push({
              name: "tab-switch",
              selected: await tabs.nth(1).getAttribute("aria-selected"),
            });
          }
          for (const rail of await section.locator("won-carousel").all()) {
            const track = rail.locator("[data-won-track]").first();
            if (!(await track.isVisible())) continue;
            const overflow = await track.evaluate(
              (e) => e.scrollWidth > e.clientWidth + 1,
            );
            const mode = await rail.getAttribute("data-mobile-mode");
            row.checks.push({ name: "carousel-content", overflow, mode });
            if (
              width === 390 &&
              overflow &&
              (await track.getAttribute("data-marquee")) === null
            ) {
              try {
                await assertCarousel(page, track, track.locator(":scope > *"), {
                  mode:
                    mode === "peek" || (Number(mode) > 1 && Number(mode) < 2)
                      ? "peek"
                      : mode === "single" || Number(mode) === 1
                        ? "single"
                        : "multiple",
                  visibleItems: Number(mode) || 1,
                });
                row.checks.push({ name: "carousel-invariant", pass: true });
              } catch (e: any) {
                row.checks.push({
                  name: "carousel-invariant",
                  error: e.message,
                });
              }
            }
            if (overflow) {
              await track.evaluate((e) =>
                e.scrollTo({ left: 0, behavior: "instant" }),
              );
              await page.waitForTimeout(250);
              const before = await track.evaluate((e) => e.scrollLeft);
              await track.evaluate((e) =>
                e.scrollBy({ left: e.clientWidth, behavior: "instant" }),
              );
              await page.waitForTimeout(200);
              row.checks.push({
                name: "carousel-scroll",
                pass: (await track.evaluate((e) => e.scrollLeft)) > before,
              });
              await track.evaluate((e) =>
                e.scrollTo({ left: 0, behavior: "instant" }),
              );
            }
          }
        } catch (e: any) {
          row.status = "capture-failed";
          row.error = e.message;
        }
        results.push(row);
      }
      if (width === 390)
        try {
          await assertResponsiveSane(page);
          signals.responsive = "pass";
        } catch (e: any) {
          signals.responsive = e.message;
        }
      const name = `${path.basename(url.split("?")[0])}-${new URL("http://localhost" + url).searchParams.get("view")}-${width}`;
      fs.writeFileSync(
        `${root}/${name}.json`,
        JSON.stringify(
          { url, width, httpStatus: response?.status(), signals, results },
          null,
          2,
        ),
      );
    });
  }
