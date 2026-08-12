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

test('won-band: content align drives cross-axis alignment, not just text-align', async ({ page }, testInfo) => {
  // align-items lives on .won-band__content. The bug: it read --won-band-align (a
  // text_alignment value left|center|right), invalid for align-items → the block
  // children (button row) never moved. The fix routes align-items through the
  // mapped --won-band-flex. Tested on mobile, where no layout @media rule (>=750px
  // forces center for overlay/gutter) interferes with the base __content rule.
  test.skip(testInfo.project.name !== 'mobile', 'base __content rule is clean of layout overrides on mobile');
  await page.goto('/');
  await page.waitForSelector('.won-band__content', { state: 'attached' });
  const alignItems = await page.evaluate(() => {
    const el = document.querySelector<HTMLElement>('.won-band__content');
    if (!el) return null;
    el.style.setProperty('--won-band-flex', 'flex-end');
    return getComputedStyle(el).alignItems;
  });
  expect(alignItems, 'align-items must consume --won-band-flex (mapped from content_align)').toBe('flex-end');
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
