import { test, expect, type Page } from '@playwright/test';
import { assertResponsiveSane, assertCarousel, assertHeadingBodyAlignment } from '../support/responsive-invariants';

// Broad per-template health for the Won theme demo store, both Horizon
// breakpoints. Runs against a local `shopify theme dev` (SHOP_URL).

const PAGES = [
  { name: 'home', path: '/', ready: '[data-testid="won-hero-section"]' },
  { name: 'product', path: '/products/the-collection-snowboard-hydrogen', ready: 'form[action^="/cart/add"], [data-testid="won-variant-picker"]' },
  { name: 'collection', path: '/collections/automated-collection', ready: 'main' },
  { name: 'cart', path: '/cart', ready: 'main' },
  { name: 'search', path: '/search?q=protein', ready: 'main' },
];

// Third-party / platform noise that is not the theme's fault.
const IGNORE = [
  // Shopify platform runtime / analytics / pixels — never the theme's fault.
  /web-pixels?|web-pixels-manager|\/wpm|monorail|trekkie|shopify_pay|shop_pay|consent|sandbox/i,
  /shopifycloud|origin_trials|\/api\/collect|\/\.well-known\/|perf_kit|storefront\/load_feature/i,
  /google|gstatic|facebook|hotjar|klaviyo|judge\.me|recaptcha|doubleclick/i,
  /favicon\.ico/i,
  /the (server|browser) responded with a status of 4\d\d.*(pixel|monorail|cdn\.shopify)/i,
  /Download the .* DevTools|preloaded using link preload but not used|Content Security Policy/i,
  // Generic browser mirror of a network failure — no URL to filter on; the
  // URL-bearing requestfailed/response listeners already catch real asset 404s.
  /^Failed to load resource: net::/i,
];
const ignored = (s: string) => IGNORE.some((r) => r.test(s));

type Signals = { console: string[]; pageErrors: string[]; failed: string[]; status?: number };

async function open(page: Page, path: string, ready: string): Promise<Signals> {
  const sig: Signals = { console: [], pageErrors: [], failed: [] };
  page.on('console', (m) => {
    if (m.type() === 'error') { const t = m.text(); if (!ignored(t)) sig.console.push(t); }
  });
  page.on('pageerror', (e) => { const t = String(e); if (!ignored(t)) sig.pageErrors.push(t); });
  page.on('requestfailed', (r) => {
    const u = r.url(); if (!ignored(u)) sig.failed.push(`${r.failure()?.errorText || 'failed'} ${u}`);
  });
  page.on('response', (r) => {
    if (r.status() >= 400) { const u = r.url(); if (!ignored(u)) sig.failed.push(`HTTP ${r.status()} ${u}`); }
  });

  await page.emulateMedia({ reducedMotion: 'reduce' });
  const resp = await page.goto(path, { waitUntil: 'domcontentloaded' });
  sig.status = resp?.status();
  await page.locator(ready).first().waitFor({ state: 'visible' }).catch(() => {});
  await page.evaluate(() => (document as any).fonts?.ready).catch(() => {});
  return sig;
}

for (const pg of PAGES) {
  test(`${pg.name} — health + responsive`, async ({ page }, testInfo) => {
    const isMobile = (testInfo.project.use.viewport?.width ?? 9999) < 750;
    const sig = await open(page, pg.path, pg.ready);

    // HTTP: the template must render (allow 3xx redirects for /cart when empty).
    expect(sig.status, `${pg.path} returned HTTP ${sig.status}`).toBeLessThan(400);

    // Hard signals.
    expect(sig.pageErrors, `page exceptions on ${pg.name}: ${sig.pageErrors.join(' | ')}`).toEqual([]);
    expect(sig.failed, `failed requests on ${pg.name}: ${sig.failed.slice(0, 6).join(' | ')}`).toEqual([]);
    expect(sig.console, `console errors on ${pg.name}: ${sig.console.slice(0, 6).join(' | ')}`).toEqual([]);

    // Mobile geometry laws.
    if (isMobile) await assertResponsiveSane(page);
  });
}

test('sections — heading alignment matches body (no centered title over left content)', async ({ page }, testInfo) => {
  const isMobile = (testInfo.project.use.viewport?.width ?? 9999) < 750;
  test.skip(!isMobile, 'the centered-title-over-left-body mismatch is a mobile-layout concern');

  await open(page, '/', '[data-testid="won-hero-section"]');
  // Nudge through the page so every section has laid out before measuring.
  await page.evaluate(async () => {
    for (let y = 0; y < document.body.scrollHeight; y += window.innerHeight) {
      window.scrollTo(0, y);
      await new Promise((r) => requestAnimationFrame(() => r(null)));
    }
    window.scrollTo(0, 0);
  });
  await assertHeadingBodyAlignment(page);
});

test('FAQ split — image column sits beside the accordion (image left, questions right)', async ({ page }, testInfo) => {
  const isDesktop = (testInfo.project.use.viewport?.width ?? 0) >= 990;
  test.skip(!isDesktop, 'the split image+accordion layout is a >=990px concern');

  await open(page, '/', '[data-testid="won-panels-section"]');
  const section = page.locator('[data-testid="won-panels-section"]').first();
  const media = section.locator('.won-panels__media').first();
  await media.waitFor({ state: 'visible' });
  const [mediaBox, rowsBox] = await Promise.all([
    media.boundingBox(),
    section.locator('.won-panels__rows').first().boundingBox(),
  ]);
  expect(mediaBox && rowsBox, 'both the media column and the FAQ rows must render').toBeTruthy();
  // split_position: start → the image column is fully left of the questions.
  expect(
    Math.round(mediaBox!.x + mediaBox!.width),
    'FAQ image column should sit left of the questions',
  ).toBeLessThanOrEqual(Math.round(rowsBox!.x) + 4);
});

test('hero peek — centred card with side peeks on desktop', async ({ page }, testInfo) => {
  const isDesktop = (testInfo.project.use.viewport?.width ?? 0) >= 990;
  test.skip(!isDesktop, 'peek geometry is a desktop concern (mobile collapses to 1-up)');

  await open(page, '/', '[data-testid="won-hero-carousel-section"]');
  const sec = page.locator('[data-testid="won-hero-carousel-section"]').first();
  await sec.scrollIntoViewIfNeeded();
  const track = sec.locator('[data-won-track]').first();
  await assertCarousel(page, track, track.locator('> *'), { mode: 'peek' });
});

test('band center-gutter — media flanks the centred copy on desktop', async ({ page }, testInfo) => {
  const isDesktop = (testInfo.project.use.viewport?.width ?? 0) >= 990;
  test.skip(!isDesktop, 'the gutter layout is a >=750px concern (mobile stacks)');

  await open(page, '/', '[data-testid="won-band-section"]');
  const band = page.locator('.won-band--gutter').first();
  await band.scrollIntoViewIfNeeded();
  const medias = band.locator('.won-band__media');
  expect(await medias.count(), 'gutter band has two media columns').toBe(2);
  const [m0, m1, c] = [
    await medias.nth(0).boundingBox(),
    await medias.nth(1).boundingBox(),
    await band.locator('.won-band__content').first().boundingBox(),
  ];
  const copyCenter = c!.x + c!.width / 2;
  expect(copyCenter, 'copy sits right of the left media').toBeGreaterThan(m0!.x + m0!.width);
  expect(copyCenter, 'copy sits left of the right media').toBeLessThan(m1!.x);
});

test('tile badge — renders in the chosen corner (top-right)', async ({ page }) => {
  await open(page, '/', 'main');
  const badge = page.locator('.won-tile__badge').first();
  await badge.scrollIntoViewIfNeeded();
  await badge.waitFor({ state: 'visible' });
  const tile = page.locator('.won-tile', { has: page.locator('.won-tile__badge') }).first();
  const [bb, tb] = [await badge.boundingBox(), await tile.boundingBox()];
  expect(bb && tb, 'badge and its tile must render').toBeTruthy();
  expect(bb!.y - tb!.y, 'badge hugs the tile top edge').toBeLessThan(40);
  expect((tb!.x + tb!.width) - (bb!.x + bb!.width), 'badge hugs the tile right edge').toBeLessThan(40);
});

test('slide annotation — headline gets a hand-drawn accent doodle', async ({ page }) => {
  await open(page, '/', 'main');
  const h = page.locator('.won-slide--annot-underline .won-slide__heading').first();
  await h.scrollIntoViewIfNeeded();
  await expect(h).toBeVisible();
  const mask = await h.evaluate((el) => {
    const s = getComputedStyle(el as HTMLElement, '::after');
    return (s.maskImage && s.maskImage !== 'none') ? s.maskImage : (s as any).webkitMaskImage;
  });
  expect(mask, 'the annotation ::after paints an SVG doodle mask').toContain('svg');
});

test('comparison — quality dots render (dots:N/M cell syntax)', async ({ page }) => {
  await open(page, '/', 'main');
  const dots = page.locator('.won-cmp__dots').first();
  await dots.scrollIntoViewIfNeeded();
  await expect(dots).toBeVisible();
  const total = await dots.locator('.won-cmp__dot').count();
  const filled = await dots.locator('.won-cmp__dot.is-on').count();
  expect(total, 'dots:4/4 renders 4 dots').toBe(4);
  expect(filled, 'the "us" cell fills 4 of 4').toBe(4);
});

test('tile icon — emoji renders before the label', async ({ page }) => {
  await open(page, '/', 'main');
  const icon = page.locator('.won-tile__icon').first();
  await icon.scrollIntoViewIfNeeded();
  await expect(icon).toBeVisible();
});

test('slide gradient — a photo-free slide paints its CSS gradient background', async ({ page }) => {
  await open(page, '/', 'main');
  const slide = page.locator('.won-slide--gradient').first();
  await slide.scrollIntoViewIfNeeded();
  const bg = await slide.evaluate((el) => getComputedStyle(el as HTMLElement).backgroundImage);
  expect(bg, 'gradient slide paints a gradient background-image').toContain('gradient');
});

test('stats — optional icon renders on each stat', async ({ page }) => {
  await open(page, '/', 'main');
  const stats = page.locator('.won-grid--stats').first();
  await stats.scrollIntoViewIfNeeded();
  const icons = stats.locator('.won-grid__stat-icon');
  expect(await icons.count(), 'stats with a 3rd icon part render an icon').toBeGreaterThanOrEqual(2);
  await expect(icons.first()).toBeVisible();
});

test('shoppable image — hotspot pins reveal a product card on focus', async ({ page }) => {
  await open(page, '/', 'main');
  const sec = page.locator('[data-testid="won-shoppable-image-section"]').first();
  await sec.scrollIntoViewIfNeeded();
  const pins = sec.locator('.won-shop__pin');
  expect(await pins.count(), 'at least two hotspots').toBeGreaterThanOrEqual(2);
  const card = pins.first().locator('.won-shop__card');
  await expect(card).toBeHidden();
  await pins.first().locator('.won-shop__dot').focus();
  await expect(card).toBeVisible();
});

test('tabbed rail — segmented tabs toggle their product panels', async ({ page }) => {
  await open(page, '/', 'main');
  const rail = page.locator('[data-testid="won-tabbed-rail-section"] won-tabset').first();
  await rail.scrollIntoViewIfNeeded();
  const tabs = rail.locator('.won-panels__tab');
  expect(await tabs.count(), 'a tab is built per collection').toBeGreaterThanOrEqual(2);
  const panels = rail.locator('.won-tabrail__panel');
  await expect(panels.nth(0)).toBeVisible();
  await expect(panels.nth(1)).toBeHidden();
  await tabs.nth(1).click();
  await expect(panels.nth(1)).toBeVisible();
  await expect(panels.nth(0)).toBeHidden();
  expect(await panels.nth(1).locator('.won-pcard').count(), 'active tab shows product cards').toBeGreaterThan(0);
});

test('carousel dots — page pager renders, is clickable, and tracks position', async ({ page }) => {
  await open(page, '/', 'main');
  const carousel = page.locator('won-carousel:has(.won-carousel__dots:not([hidden]))').first();
  await carousel.scrollIntoViewIfNeeded();
  const dots = carousel.locator('.won-carousel__dot');
  expect(await dots.count(), 'a scrolling carousel with dots enabled shows >=2 page dots').toBeGreaterThanOrEqual(2);
  const track = carousel.locator('[data-won-track]');
  const before = await track.evaluate((t) => Math.abs((t as HTMLElement).scrollLeft));
  await dots.last().click();
  await page.waitForTimeout(600);
  const after = await track.evaluate((t) => Math.abs((t as HTMLElement).scrollLeft));
  expect(after, 'clicking the last dot scrolls the rail').toBeGreaterThan(before + 20);
  await expect(dots.last()).toHaveAttribute('aria-current', 'true');
});

test('marquee — seamless loop is a duplicated, aria-hidden track', async ({ page }) => {
  await open(page, '/', '[data-testid="won-marquee"]');
  const mq = page.locator('[data-testid="won-marquee"]').first();
  await mq.waitFor({ state: 'visible' });
  const groups = mq.locator('.won-marquee__group');
  expect(await groups.count(), 'marquee needs two identical groups for a seamless loop').toBe(2);
  await expect(groups.nth(1)).toHaveAttribute('aria-hidden', 'true');
  // textContent (not innerText) — the duplicate group scrolls off-screen and
  // innerText would return only its visible portion.
  const a = ((await groups.nth(0).textContent()) || '').replace(/\s+/g, ' ').trim();
  const b = ((await groups.nth(1).textContent()) || '').replace(/\s+/g, ' ').trim();
  expect(a.length, 'first marquee group has content').toBeGreaterThan(0);
  expect(b, 'duplicate group mirrors the first for a seamless loop').toBe(a);
});

test('home — block grids with mobile carousel become a real swipeable rail', async ({ page }, testInfo) => {
  const isMobile = (testInfo.project.use.viewport?.width ?? 9999) < 750;
  test.skip(!isMobile, 'the mobile carousel option only applies on phones');

  await open(page, '/', '[data-testid="won-hero-section"]');
  const rails = page.locator('.won-grid--scroll-sm[data-won-track]');
  const n = await rails.count();
  if (n === 0) { testInfo.annotations.push({ type: 'skip', description: 'no mobile-carousel grid on home' }); return; }

  for (let i = 0; i < n; i++) {
    const rail = rails.nth(i);
    await rail.scrollIntoViewIfNeeded();
    // It must actually be a horizontal scroller (not a stacked grid).
    const scrolls = await rail.evaluate((el) => el.scrollWidth > el.clientWidth + 4);
    expect(scrolls, 'mobile-carousel grid does not scroll horizontally (still stacked?)').toBe(true);
    // Peek geometry: one full card visible, next card partially peeking.
    await assertCarousel(page, rail, rail.locator('> *'), { mode: 'peek' });
  }
});

test('home — carousels honour their mobile mode', async ({ page }, testInfo) => {
  const isMobile = (testInfo.project.use.viewport?.width ?? 9999) < 750;
  test.skip(!isMobile, 'carousel geometry is a mobile concern');

  await open(page, '/', '[data-testid="won-hero-section"]');
  const carousels = page.locator('won-carousel');
  const n = await carousels.count();
  if (n === 0) { testInfo.annotations.push({ type: 'skip', description: 'no won-carousel on home' }); return; }

  for (let i = 0; i < n; i++) {
    const car = carousels.nth(i);
    await car.scrollIntoViewIfNeeded();
    const track = car.locator('[data-won-track]');
    const mode = (await car.getAttribute('data-mobile-mode')) || '1';
    const items = track.locator('> *');
    await assertCarousel(page, track, items,
      mode === '1' || mode === 'single' ? { mode: 'single' }
      : mode.startsWith('1.') || mode.startsWith('peek') ? { mode: 'peek' }
      : { mode: 'multiple', visibleItems: Math.round(Number(mode)) || 2 });
  }
});
