import { test, expect } from '@playwright/test';

// Won Carousel — behavioural proof that the "Ovládání" toggles are not dead.
//
// A merchant enabling "Zobrazit tečky" (show_dots) on a carousel that already
// fits on one screen sees nothing happen — the dots are correctly hidden because
// there's nothing to page through (won-carousel.js buildDots: hidden when
// pages <= 1). That's right behaviour, but it means static wiring isn't enough:
// this spec verifies the *runtime contract* on the live storefront.
//
// Contract:
//   1. A dots bar that is shown always contains dot buttons — never an empty,
//      dead strip.
//   2. A slider carousel whose rail overflows AND has show_dots on actually
//      renders its dots.
//   3. Non-vacuous: at least one carousel on the page paginates, so the checks
//      above run against real overflow rather than passing trivially.

test('carousel pager controls render (and never show a dead/empty bar)', async ({ page }) => {
  await page.goto('/');
  await page.waitForSelector('won-carousel', { state: 'attached' });
  // Give the web component a beat to measure widths and build its dots.
  await page.waitForTimeout(500);

  const report = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('won-carousel')).map((c, i) => {
      const track = c.querySelector('[data-won-track]') as HTMLElement | null;
      const dots = c.querySelector('.won-carousel__dots') as HTMLElement | null;
      const scrollable = track ? track.scrollWidth - track.clientWidth > 2 : false;
      return {
        i,
        isMarquee: !!track?.hasAttribute('data-marquee'),
        scrollable,
        hasDots: !!dots,
        dotsVisible: dots ? !dots.hasAttribute('hidden') : false,
        dotCount: dots ? dots.querySelectorAll('.won-carousel__dot').length : 0,
      };
    });
  });

  expect(report.length, 'no won-carousel on the home page').toBeGreaterThan(0);

  for (const r of report) {
    // (1) a visible dots bar is never empty
    if (r.dotsVisible) {
      expect(r.dotCount, `carousel #${r.i} shows an empty dots bar`).toBeGreaterThan(0);
    }
    // (2) an overflowing slider that opted into dots must actually show them
    if (r.hasDots && r.scrollable && !r.isMarquee) {
      expect(
        r.dotsVisible && r.dotCount > 0,
        `carousel #${r.i} overflows with show_dots on but renders no dots`,
      ).toBeTruthy();
    }
  }

  // (3) non-vacuous: at least one slider actually paginates
  expect(
    report.some((r) => r.scrollable && !r.isMarquee),
    'no slider carousel overflowed — the dots contract was not exercised',
  ).toBeTruthy();
});
