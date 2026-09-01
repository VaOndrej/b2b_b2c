import { test, expect } from '@playwright/test';

// Art-directed slide media (won-slide `image_asset_mobile` / `image_mobile`).
//
// Both assertions here are regressions that shipped and were caught only by
// looking at the rendered page — theme check and the composed build were green
// through both.
//
//  1. FILL — a <picture> is display:inline and has no height, so an <img> inside
//     it resolves `height: 100%` against an auto-height parent and silently
//     falls back to its width/height aspect ratio. On the 390px hero that left
//     a 44px strip of bare section background below the image (576px image in a
//     620px box). The plain <img> path was unaffected, which is why the bug hid.
//
//  2. SWAP — below 750px the packaged mobile asset must actually win. A wide
//     hero crop shows only its middle ~30% on a phone, so if the swap silently
//     stops working the hero loses its subject entirely and still looks
//     "fine" to any check that only asserts the image loaded.
//
// Runs against a local `shopify theme dev -e horizon` (see playwright.config.ts).

const HERO = '[data-testid="won-hero-section"]';

test.describe('won-slide art direction', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/', { waitUntil: 'load' });
    await page.locator(HERO).first().waitFor({ state: 'visible' });
    // decode() rather than a fixed wait: currentSrc is only authoritative once
    // the browser has actually settled on a candidate.
    await page.evaluate(async (sel) => {
      const img = document.querySelector<HTMLImageElement>(`${sel} img`);
      if (img) await img.decode().catch(() => undefined);
    }, HERO);
  });

  test('slide media fills its box (no gap under an art-directed image)', async ({ page }) => {
    const box = await page.evaluate((sel) => {
      const img = document.querySelector<HTMLImageElement>(`${sel} img`);
      const media = img?.closest('.won-slide__media');
      if (!img || !media) return null;
      return {
        img: img.getBoundingClientRect().height,
        media: media.getBoundingClientRect().height,
        inPicture: img.parentElement?.tagName === 'PICTURE',
      };
    }, HERO);

    expect(box, 'hero slide should render an <img> inside .won-slide__media').not.toBeNull();
    expect(box!.media).toBeGreaterThan(0);
    // Sub-pixel rounding is fine; a missing fill rule is tens of pixels.
    expect(
      Math.abs(box!.img - box!.media),
      `image (${box!.img}px) must fill its media box (${box!.media}px); inPicture=${box!.inPicture}`
    ).toBeLessThan(2);
  });

  test('below 750px the packaged mobile asset is the one served', async ({ page }, testInfo) => {
    const width = testInfo.project.use.viewport?.width ?? 0;
    const src = await page.evaluate((sel) => {
      const img = document.querySelector<HTMLImageElement>(`${sel} img`);
      return (img?.currentSrc || img?.src || '').split('/').pop()?.split('?')[0] ?? '';
    }, HERO);

    expect(src, 'hero must render some packaged slide art').not.toBe('');
    if (width < 750) {
      expect(src, 'mobile viewport must receive the -mobile art-directed asset').toContain('-mobile');
    } else {
      expect(src, 'desktop viewport must NOT receive the mobile asset').not.toContain('-mobile');
    }
  });
});
