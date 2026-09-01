import { test, expect } from '@playwright/test';

// Wave 1 — behavioural proof that the parity controls added against the two
// hidden native sections (product-list, featured-blog-posts) actually do
// something. Static schema references are not enough: the 2026-08-11 audit
// found four settings that were referenced but whose consumer was broken.
//
// Fixtures live in themes/demo/horizon/templates/index.json:
//   daily_grid  — layout grid, mobile_carousel true  (positive)
//   range_grid  — layout grid, mobile_carousel false (negative)
// Both use columns_mobile "2" so won-carousel--peek-mobile (flex 0 0 76%)
// never confounds the rail geometry.

test('grid carousel with mobile_carousel scrolls horizontally on mobile', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile', 'mobile-only contract');

  await page.goto('/');
  const rail = page.locator('won-carousel.won-carousel--scroll-sm .won-carousel__track').first();
  await expect(rail).toBeAttached();

  const geometry = await rail.evaluate((el) => ({
    overflowX: getComputedStyle(el).overflowX,
    display: getComputedStyle(el).display,
    scrollable: el.scrollWidth - el.clientWidth > 2,
  }));

  expect(geometry.display).toBe('flex');
  expect(geometry.overflowX).toBe('auto');
  expect(geometry.scrollable).toBe(true);
});

test('grid carousel without mobile_carousel stays a stacked grid on mobile', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile', 'mobile-only contract');

  await page.goto('/');
  const plain = page.locator('won-carousel.won-carousel--grid:not(.won-carousel--scroll-sm) .won-carousel__track').first();
  await expect(plain).toBeAttached();
  await expect(plain).toHaveCSS('display', 'grid');
});

// The shape modifier moved from `won-carousel__arrow--*` to the shared
// `won-rail__arrow--*` when arrows became one control across every rail (hero,
// carousel and grid-turned-rail all render the same button now). The contract
// this guards is unchanged: an arrow always declares its shape.
test('carousel arrows carry their style modifier class', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'desktop-only contract');

  await page.goto('/');
  const arrow = page.locator('.won-rail__arrow').first();
  await expect(arrow).toBeAttached();

  const className = await arrow.getAttribute('class');
  expect(className).toMatch(/won-rail__arrow--(pill|soft|square|minimal)/);
});

test('article cards render author and reading time when enabled', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'desktop-only contract');

  await page.goto('/');

  // DECLARED PRECONDITION, not a convenience skip. The demo store's only blog
  // (`news`) currently has zero articles, so won-grid renders its empty state
  // and there is nothing to assert against. Seeding the blog needs a write to
  // the Shopify admin, which needs the owner's explicit go-ahead.
  //
  // Until then `featured-blog-posts` deliberately stays visible in the picker
  // (see tests/smoke/won-hidden-natives.spec.ts and HIDE_NATIVE_SECTIONS) —
  // the replacement is wired but unproven, so it does not get to replace anything.
  const articleCount = await page.locator('.won-grid__article').count();
  test.skip(
    articleCount === 0,
    'demo blog `news` has no articles — seed it, then this becomes the proof that unblocks hiding featured-blog-posts',
  );

  const card = page.locator('.won-grid__article').first();
  await expect(card).toBeAttached();

  await expect(card.locator('.won-grid__article-author')).toHaveCount(1);

  const readtime = card.locator('.won-grid__article-readtime');
  await expect(readtime).toHaveCount(1);

  // Non-vacuous: reading time must be a real computed number, never "0".
  // `at_least: 1` in the Liquid is what stops a short article rendering "0 min".
  const text = (await readtime.innerText()).trim();
  expect(text).not.toBe('');
  expect(text).toMatch(/[1-9]/);

  // Stronger: prove it is DERIVED FROM CONTENT, not a constant. The seeded demo
  // articles are deliberately different lengths (~83, ~179 and ~608 words), so
  // at least two distinct values must appear across the grid. A hardcoded string
  // or a broken word count would collapse them all to one value and pass the
  // assertions above.
  const all = await page.locator('.won-grid__article-readtime').allInnerTexts();
  expect(all.length).toBeGreaterThan(1);
  expect(new Set(all.map((t) => t.trim())).size).toBeGreaterThan(1);
});

// REGRESSION GUARD. arrow_style was first shipped with a `chevron` default that
// resolved to --won-radius-sm (8px), while the base .won-carousel__arrow rule
// has always used --won-radius-pill (999px). Because the modifier class wins on
// source order, adding the control silently reshaped the arrows on every
// carousel already in the wild — a change no merchant asked for. The unit tests
// were green throughout; only a screenshot caught it.
//
// The default MUST be visually identical to having no arrow_style at all.
test('default arrow style is visually identical to the pre-arrow_style look', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'desktop-only contract');

  await page.goto('/');
  const arrow = page.locator('.won-rail__arrow--pill').first();
  await expect(arrow).toBeAttached();

  const radius = await arrow.evaluate((el) => getComputedStyle(el).borderTopLeftRadius);
  expect(radius).toBe('999px');
});
