import { test, expect } from '@playwright/test';

// Regression specs for "control has no (or only partial) visible effect" bugs
// found by the settings-behaviour audit (2026-08-11) and since fixed. Each proves
// the FIX: the CSS rule now consumes the custom property the setting emits.
// CSS-contract style (inject the var, read computed style) — deterministic and
// RED before the fix. Static wiring alone could not catch these: the id WAS
// referenced, but the consumer read the wrong property (align-items got a
// text-align keyword) or did not exist (no desktop / base rule).
//
// Note: won-variant-picker's `title_size_desktop` fix (mirror @media rule) is not
// covered here — the section is not placed in any demo template, so it never
// renders on the storefront. Its fix is verified statically (a `@media
// (min-width:750px) .won-vp__title { font-size: var(--won-h-size-d) }` rule now
// exists) alongside the settings-coverage gate.

test('won-band: content align actually moves the button row, not just text', async ({ page }, testInfo) => {
  // The original bug: align-items read --won-band-align (a text_alignment keyword,
  // invalid for align-items) so the button row never moved. The mechanism has since
  // changed — .won-band__content is now `align-items: stretch` on purpose, because a
  // shrink-to-fit column collapsed every data block to its content width (params table
  // at 138px inside a 1320px band). Alignment now travels through justify-content on
  // the actions row and margin-inline on the capped-measure copy.
  // So assert the OUTCOME the merchant sees, not the property that happens to carry it.
  test.skip(testInfo.project.name !== 'mobile', 'base __content rule is clean of layout overrides on mobile');
  await page.goto('/');
  await page.waitForSelector('.won-band__content', { state: 'attached' });

  const res = await page.evaluate(() => {
    const content = document.querySelector<HTMLElement>('.won-band__content');
    if (!content) return null;
    const actions = content.querySelector<HTMLElement>('.won-band__actions');
    const btn = actions?.firstElementChild as HTMLElement | undefined;
    if (!actions || !btn) return { skipped: true as const };
    // The row itself spans the column (it is a stretched block); what moves is the
    // button inside it, which is exactly what a merchant sees.
    const measure = (flex: string) => {
      content.style.setProperty('--won-band-flex', flex);
      const c = content.getBoundingClientRect();
      const a = btn.getBoundingClientRect();
      return { leftGap: a.left - c.left, rightGap: c.right - a.right };
    };
    return { skipped: false as const, start: measure('flex-start'), end: measure('flex-end') };
  });

  expect(res, 'no won-band on the home page').not.toBeNull();
  if (res!.skipped) test.skip(true, 'the home band carries no button row');

  // flex-start pins the row left; flex-end pins it right. Whichever edge is pinned
  // has ~0 gap and the other has the leftover width — that is the visible effect.
  expect(res!.start.leftGap, 'content_align:left must pin the button row to the left edge').toBeLessThan(2);
  expect(res!.end.rightGap, 'content_align:right must pin the button row to the right edge').toBeLessThan(2);
  expect(res!.end.leftGap, 'content_align:right must actually move the row, not just restyle it').toBeGreaterThan(2);
});

test('won-slide: min height applies to a plain (non-overlayed) slide body', async ({ page }) => {
  await page.goto('/');
  await page.waitForSelector('.won-slide__body', { state: 'attached' });
  const result = await page.evaluate(() => {
    const bodies = Array.from(document.querySelectorAll<HTMLElement>('.won-slide__body'));
    // The bug lived on plain cards: --won-slide-min was only consumed by the
    // gradient/overlayed body rules. Target a slide that is neither.
    const plain = bodies.find((b) => {
      const s = b.closest('.won-slide');
      return s && !s.classList.contains('won-slide--gradient') && !s.classList.contains('won-slide--overlayed');
    });
    if (!plain) return { found: false, minHeight: null as string | null };
    plain.style.setProperty('--won-slide-min', '500px');
    return { found: true, minHeight: getComputedStyle(plain).minHeight };
  });
  // If the demo has no plain slide on this page the regression can't be exercised
  // here — fail loudly rather than pass silently, so the fixture gap is visible.
  expect(result.found, 'no plain (non-overlayed) slide on / to exercise the base min-height rule').toBe(true);
  expect(result.minHeight, 'a base slide body must consume --won-slide-min').toBe('500px');
});

test('won-tabbed-rail: desktop heading size is consumed at >= 750px', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'desktop-only @media rule');
  await page.goto('/');
  await page.waitForSelector('.won-tabrail__heading', { state: 'attached' });
  const fontSize = await page.evaluate(() => {
    const el = document.querySelector<HTMLElement>('.won-tabrail__heading');
    if (!el) return null;
    el.style.setProperty('--won-h-size-d', '60px');
    return getComputedStyle(el).fontSize;
  });
  expect(fontSize, 'desktop heading must read --won-h-size-d at >=750px').toBe('60px');
});
