import { test, expect } from '@playwright/test';

// Behavioural invariant (theme-block-ux rule 7): a slider carousel's arrows must
// be visible IFF the rail actually overflows. Arrows that render (even disabled)
// on a rail that fits are dead controls; a rail that overflows with no arrows is
// an unreachable carousel. Runs against the live theme dev server.

test('carousel arrows are visible only when the rail overflows', async ({ page }) => {
  await page.goto('/');
  await page.waitForSelector('won-carousel', { state: 'attached' });

  const report = await page.evaluate(() => {
    const out: { i: number; scrollable: boolean; arrowsShown: boolean; loop: boolean }[] = [];
    document.querySelectorAll('won-carousel').forEach((el, i) => {
      const track = el.querySelector('[data-won-track]') as HTMLElement | null;
      const arrows = el.querySelector('[data-won-arrows]') as HTMLElement | null;
      if (!track) return;
      // Marquee rails have no arrows container — skip.
      if (track.hasAttribute('data-marquee')) return;
      // Arrows are a SLIDER affordance (the section only renders them for
      // layout: slider). A grid carousel with mobile_carousel on also overflows
      // on phones, but pages by swipe — exactly like won-grid's --scroll-sm
      // rail, which has never had arrows either. Holding it to "overflow implies
      // arrows" would demand a control the layout deliberately does not offer.
      if (!el.classList.contains('won-carousel--slider')) return;
      const scrollable = track.scrollWidth - track.clientWidth > 1;
      const loop = !!el.querySelector('[data-won-track][data-won-loop]') || track.dataset.wonLoop === '1';
      const arrowsShown = !!arrows && !arrows.hidden && arrows.offsetParent !== null;
      out.push({ i, scrollable, arrowsShown, loop });
    });
    return out;
  });

  // There must be at least one arrowed slider on the demo homepage to assert on.
  const arrowed = report.filter((r) => r !== null);
  test.skip(arrowed.length === 0, 'no arrowed carousel on the homepage');

  for (const r of report) {
    if (r.loop) continue; // a looping rail always scrolls → arrows always allowed
    // Invariant: arrows shown  ⟺  rail overflows.
    expect(
      r.arrowsShown,
      `carousel #${r.i}: arrowsShown=${r.arrowsShown} but scrollable=${r.scrollable}`,
    ).toBe(r.scrollable);
  }
});
