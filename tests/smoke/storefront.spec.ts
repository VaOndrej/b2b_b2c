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
