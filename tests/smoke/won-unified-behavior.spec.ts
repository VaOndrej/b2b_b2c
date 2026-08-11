import { test, expect } from '@playwright/test';

// Won unified-schema BEHAVIOURAL checks (needs a running `shopify theme dev`).
//
// The static won-unified-schema.spec proves the editor ORDER; this proves the
// two behaviours the unification promises actually fire in the browser:
//   1. the Visibility toggles genuinely hide the section at the right breakpoint
//      (schema hide_mobile/hide_desktop → won-style-vars --won-d-m/--won-d-d:none
//      → won-tokens.css display:none), and
//   2. the Mode select drives a real render class on the section.
//
// Viewport comes from the playwright project (desktop 1440 / mobile 390), which
// straddles Horizon's 750px cut — so the same test asserts the opposite
// polarity on each side, proving the breakpoint wiring, not just display:none.

test('Visibility toggles hide the section at the correct breakpoint', async ({ page }) => {
  await page.goto('/');
  await page.waitForSelector('.won-section', { state: 'attached' });
  const isMobile = (page.viewportSize()?.width ?? 0) <= 749;

  const result = await page.evaluate(() => {
    const el = document.querySelector<HTMLElement>('.won-section');
    if (!el) return null;
    const read = (vars: Record<string, string>) => {
      for (const [k, v] of Object.entries(vars)) el.style.setProperty(k, v);
      const d = getComputedStyle(el).display;
      for (const k of Object.keys(vars)) el.style.removeProperty(k);
      return d;
    };
    return {
      base: getComputedStyle(el).display,
      hideMobile: read({ '--won-d-m': 'none' }),   // simulates hide_mobile checked
      hideDesktop: read({ '--won-d-d': 'none' }),   // simulates hide_desktop checked
    };
  });

  expect(result, 'no .won-section on the homepage').not.toBeNull();
  expect(result!.base, 'section should be visible by default').not.toBe('none');

  if (isMobile) {
    expect(result!.hideMobile, 'hide_mobile must hide the section on mobile').toBe('none');
    expect(result!.hideDesktop, 'hide_desktop must NOT hide the section on mobile').not.toBe('none');
  } else {
    expect(result!.hideDesktop, 'hide_desktop must hide the section on desktop').toBe('none');
    expect(result!.hideMobile, 'hide_mobile must NOT hide the section on desktop').not.toBe('none');
  }
});

test('Mode select drives a render class on the carousel', async ({ page }) => {
  await page.goto('/');
  const carousel = page.locator('won-carousel').first();
  if ((await carousel.count()) === 0) test.skip(true, 'no won-carousel on the homepage');
  const cls = await carousel.getAttribute('class');
  expect(cls, 'carousel must carry a won-carousel--<mode> class reflecting the Mode select')
    .toMatch(/won-carousel--(slider|grid|marquee)/);
});

test('Infinite-scroll setting clones bookends only where its scope applies', async ({ page }) => {
  await page.goto('/');
  const looped = page.locator('won-carousel[data-won-loop]').first();
  if ((await looped.count()) === 0) test.skip(true, 'no looping carousel configured on the homepage');

  const scope = await looped.getAttribute('data-won-loop'); // always | desktop | mobile
  const isMobile = (page.viewportSize()?.width ?? 0) <= 749;
  const applies = scope === 'always' || (scope === 'desktop' && !isMobile) || (scope === 'mobile' && isMobile);

  // won-carousel.js clones the end slides (data-won-clone) so the rail never
  // hits an empty end — but only for the breakpoints the merchant scoped it to.
  await page.waitForTimeout(500);
  const clones = await looped.locator('[data-won-clone]').count();

  if (applies) {
    expect(clones, `loop scope "${scope}" must clone bookend slides on this viewport`).toBeGreaterThan(0);
  } else {
    expect(clones, `loop scope "${scope}" must NOT clone on this viewport`).toBe(0);
  }
});
