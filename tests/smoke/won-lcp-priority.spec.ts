import { test, expect } from '@playwright/test';

/**
 * The hero image is the LCP element, so it must not be lazy.
 *
 * EshopAudit PERF-003 (severity vysoká): never lazy-load the LCP/hero image, and
 * give it fetchpriority=high. Measured on the demo homepage before the fix: the
 * first hero slide shipped `loading="lazy"` with no priority hint, so the browser
 * deprioritised the one image Largest Contentful Paint is measured on.
 *
 * `loading` is decided in the initial HTML, so no client-side promoting fixes it:
 * by the time JS runs the request has already been queued late.
 *
 * The assertion is about THE LCP candidate — the largest image on screen at rest —
 * and not about every image that happens to touch the fold. A slide peeking in at
 * the bottom edge is not what Google measures, and eager-loading everything above
 * the fold makes the page slower, which is the opposite of the point.
 */
test('the LCP image loads eagerly and asks for priority', async ({ page }) => {
  await page.goto('/', { waitUntil: 'load' });
  await page.waitForTimeout(1200);

  const lcp = await page.evaluate(() => {
    const vh = window.innerHeight;
    let best: { src: string; loading: string; priority: string; area: number; top: number } | null = null;
    for (const img of document.querySelectorAll('img')) {
      const r = img.getBoundingClientRect();
      if (r.top >= vh || r.bottom <= 0) continue;
      const area = r.width * r.height;
      if (!best || area > best.area) {
        best = {
          src: (img.currentSrc || img.src || '').split('/').pop()!.split('?')[0],
          loading: img.loading,
          priority: img.getAttribute('fetchpriority') || 'none',
          area: Math.round(area),
          top: Math.round(r.top),
        };
      }
    }
    return best;
  });

  expect(lcp, 'no image on screen at rest — nothing to measure').not.toBeNull();

  const where = `${lcp!.src} (${lcp!.area}px², top ${lcp!.top})`;
  expect(
    lcp!.loading,
    `the LCP candidate ${where} is lazy-loaded — the browser fetches it late (PERF-003)`,
  ).not.toBe('lazy');
  expect(
    lcp!.priority,
    `the LCP candidate ${where} does not ask for priority (PERF-003 wants fetchpriority=high)`,
  ).toBe('high');
});
