import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * A dot is a promise: "there are this many stops, and this is the one you are on."
 *
 * won-carousel counts dots as PAGES — `round(scrollWidth / clientWidth)` — and a
 * dot click scrolls by `i * clientWidth`. That is only true when the slides tile
 * the track exactly. In the peek layout the theme actually ships (a card is ~64%
 * of the track so its neighbours show at the edges), four slides produce three
 * dots, and clicking a dot lands between two cards, which the scroll-snap then
 * yanks somewhere the shopper did not ask for.
 *
 * The rail snaps per slide, so the stops ARE the slides. Asserted behaviourally
 * on a synthetic rail: the component source is loaded into a bare page with a
 * peek layout, so the guard holds no matter which indicator the demo store
 * happens to be configured with — the demo uses the progress bar, which is
 * exactly why this defect could sit there unseen.
 */

const SRC = readFileSync(join(process.cwd(), 'themes/won-base/assets/won-carousel.js'), 'utf8');

const RAIL = (slides: number) => `
  <style>
    * { box-sizing: border-box; margin: 0; }
    won-carousel { display: block; width: 600px; }
    .track {
      display: flex; gap: 20px; overflow-x: auto;
      scroll-snap-type: x mandatory; scroll-behavior: auto;
    }
    .track > .slide {
      flex: 0 0 64%; height: 200px; scroll-snap-align: center; background: #ddd;
    }
  </style>
  <won-carousel>
    <div class="track" data-won-track>
      ${Array.from({ length: slides }, (_, i) => `<div class="slide" data-i="${i}">${i}</div>`).join('')}
    </div>
    <div data-won-dots></div>
  </won-carousel>
`;

// Which slide is actually at rest: the one whose centre is nearest the track's.
const centred = () => {
  const track = document.querySelector('[data-won-track]') as HTMLElement;
  const mid = track.getBoundingClientRect().left + track.clientWidth / 2;
  let best = -1;
  let bestD = Infinity;
  [...track.children].forEach((c, i) => {
    const r = c.getBoundingClientRect();
    const d = Math.abs(r.left + r.width / 2 - mid);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  });
  return best;
};

for (const slides of [3, 4, 6]) {
  test(`a peek rail of ${slides} slides shows ${slides} dots, and each one lands on its slide`, async ({ page }) => {
    await page.setContent(RAIL(slides), { waitUntil: 'load' });
    await page.addScriptTag({ content: SRC });
    await page.waitForTimeout(200);

    const dots = page.locator('[data-won-dots] button');
    await expect(
      dots,
      `${slides} snap stops must give the shopper ${slides} dots — a page-based count ` +
        `under-reports every peek layout`,
    ).toHaveCount(slides);

    for (let i = 0; i < slides; i++) {
      await dots.nth(i).click();
      await page.waitForTimeout(350);
      const landed = await page.evaluate(centred);
      expect(landed, `dot ${i + 1} put slide ${landed + 1} at rest`).toBe(i);

      const current = await dots.nth(i).getAttribute('aria-current');
      expect(current, `dot ${i + 1} does not mark itself as the current stop`).toBe('true');
    }
  });
}
