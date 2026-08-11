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

// Wait until a scroller stops moving. The peek loop re-centres itself the moment
// it scrolls into view (one frame after visibility), so geometry assertions must
// wait for that rest position instead of racing the very first frame.
async function settleScroll(track: import('@playwright/test').Locator) {
  await track.evaluate(
    (t: HTMLElement) =>
      new Promise<void>((res) => {
        let last = NaN, stable = 0, ticks = 0;
        const tick = () => {
          const s = Math.round(t.scrollLeft);
          if (s === last) stable++; else { stable = 0; last = s; }
          if (stable >= 3 || ++ticks > 90) return res();
          requestAnimationFrame(tick);
        };
        tick();
      }),
  );
}

// Count partially-visible children on each side of a scroller's centre.
async function peekSidesOf(track: import('@playwright/test').Locator) {
  return track.evaluate((t: HTMLElement) => {
    const box = t.getBoundingClientRect();
    const center = box.left + box.width / 2;
    let left = 0, right = 0;
    for (const k of Array.from(t.children) as HTMLElement[]) {
      const r = k.getBoundingClientRect();
      if (r.width === 0) continue;
      const vis = (Math.min(r.right, box.right) - Math.max(r.left, box.left)) / r.width;
      if (vis > 0.05 && vis < 0.9) (r.left + r.width / 2 < center ? (left++) : (right++));
    }
    return { left, right };
  });
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

// #5: a merchant found a setting could make the FAQ framing vanish (the old
// split_side="media" hid the heading + contact). The FAQ is important content —
// its heading AND its questions must always render, whatever the side settings.
test('won-panels FAQ — heading and questions always render', async ({ page }) => {
  await open(page, '/', '[data-testid="won-panels-section"]');
  const section = page.locator('[data-testid="won-panels-section"]').first();
  await section.scrollIntoViewIfNeeded();
  await expect(section.locator('.won-panels__heading').first(), 'the FAQ heading must stay').toBeVisible();
  const questions = section.locator('.won-panels__summary');
  expect(await questions.count(), 'the FAQ questions must render').toBeGreaterThan(0);
  await expect(questions.first()).toBeVisible();
});

test('hero peek — centred card with side peeks on desktop', async ({ page }, testInfo) => {
  const isDesktop = (testInfo.project.use.viewport?.width ?? 0) >= 990;
  test.skip(!isDesktop, 'peek geometry is a desktop concern (mobile collapses to 1-up)');

  await open(page, '/', '[data-testid="won-hero-carousel-section"]');
  const sec = page.locator('[data-testid="won-hero-carousel-section"]').first();
  await sec.scrollIntoViewIfNeeded();
  const track = sec.locator('[data-won-track]').first();
  await settleScroll(track); // the peek loop centres itself when it enters view
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

// A hotspot can take a SEPARATE position on mobile (a pin placed well on a wide
// image can fall off the crop on a phone). The demo's first pin is configured
// with custom_mobile_pos (desktop x=28% → mobile x_mobile=80%), so this asserts
// the REAL wiring end-to-end: the Liquid emits the `won-shop__pin--m` class + the
// `--x-m` var from the block setting, and the media query moves the pin — nothing
// is forced from JS.
test('shoppable image — a configured hotspot honours its separate mobile position', async ({ page }, testInfo) => {
  const isMobile = (testInfo.project.use.viewport?.width ?? 9999) < 750;

  await open(page, '/', 'main');
  const sec = page.locator('[data-testid="won-shoppable-image-section"]').first();
  await sec.scrollIntoViewIfNeeded();
  const wrap = sec.locator('.won-shop').first();
  const pin = sec.locator('.won-shop__pin').first();
  await pin.waitFor({ state: 'visible' });

  // The Liquid must emit the opt-in class from custom_mobile_pos (both viewports).
  await expect(pin, 'custom_mobile_pos emits the mobile-position class').toHaveClass(/won-shop__pin--m/);

  const centerFrac = async () => {
    const [pb, wb] = [await pin.boundingBox(), await wrap.boundingBox()];
    return (pb!.x + pb!.width / 2 - wb!.x) / wb!.width; // 0..1 across the image
  };
  const frac = await centerFrac();
  if (isMobile) {
    // mobile x_mobile=80% → pin sits in the right portion, NOT at the desktop 28%.
    expect(frac, `mobile pin at ${(frac * 100).toFixed(0)}% should follow x_mobile=80%, not desktop 28%`).toBeGreaterThan(0.6);
  } else {
    // desktop keeps x=28% → left portion.
    expect(frac, `desktop pin at ${(frac * 100).toFixed(0)}% keeps desktop x=28%`).toBeLessThan(0.45);
  }
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
  // Marquee carousels are a continuous belt (duplicated groups, no per-card
  // snap) — the single/peek/multiple contract doesn't apply to them.
  const carousels = page.locator('won-carousel:not(.won-carousel--marquee)');
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

// A CSS marquee loops by translating the duplicated track by -50%; if the two
// groups together are narrower than 2x the viewport, a blank gap scrolls into
// view for the second half of every loop. Short USP strips (a handful of short
// tokens) underfill on desktop — this is the "text appears only after a while"
// bug. Motion must be enabled so both groups lay out (the reduced-motion
// fallback hides the duplicate).
test('marquee — track spans >= 2x the viewport so the loop never shows a blank gap', async ({ page }, testInfo) => {
  const isDesktop = (testInfo.project.use.viewport?.width ?? 0) >= 990;
  test.skip(!isDesktop, 'short strips underfill at desktop width — that is where the gap shows');

  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  const mq = page.locator('[data-testid="won-marquee"]').first();
  await mq.waitFor({ state: 'visible' });
  const dims = await mq.evaluate((el) => {
    const track = el.querySelector('.won-marquee__track') as HTMLElement;
    return { container: Math.round(el.getBoundingClientRect().width), track: Math.round(track.getBoundingClientRect().width) };
  });
  expect(
    dims.track,
    `marquee track ${dims.track}px must be >= 2x its ${dims.container}px container or a blank gap scrolls in`,
  ).toBeGreaterThanOrEqual(dims.container * 2 - 4);
});

// Peek mode centres the active slide with a sibling peeking in on EACH side.
// The old build showed an empty spacer on the outer side of the first slide —
// "prostor vlevo prázdný". The peek loop wraps a clone in, so even resting on
// the first slide (the initial view) a neighbour peeks in on BOTH sides.
test('hero peek — a neighbour peeks in on BOTH sides at the initial rest position', async ({ page }, testInfo) => {
  const isDesktop = (testInfo.project.use.viewport?.width ?? 0) >= 990;
  test.skip(!isDesktop, 'peek geometry is a desktop concern (mobile collapses to 1-up)');

  await open(page, '/', '[data-testid="won-hero-carousel-section"]');
  const sec = page.locator('[data-testid="won-hero-carousel-section"]').first();
  await sec.scrollIntoViewIfNeeded();
  const car = sec.locator('won-carousel').first();
  const track = sec.locator('[data-won-track]').first();
  await settleScroll(track); // loop centres the first slide when it enters view

  // 1) Initial rest = first slide centred: the fix must peek on BOTH sides.
  const start = await peekSidesOf(track);
  expect(start.left, 'a slide must peek in on the LEFT of the first card (no empty spacer)').toBeGreaterThan(0);
  expect(start.right, 'a slide must peek in on the right of the first card').toBeGreaterThan(0);

  // 2) Drive to the last slide with the real Next control; the loop must keep a
  //    peek on BOTH sides there too (previously the right side went empty).
  const reals = await track.evaluate((t: HTMLElement) => Array.from(t.children).filter((c) => !(c as HTMLElement).dataset.wonClone).length);
  for (let i = 0; i < reals - 1; i++) {
    await car.locator('[data-won-next]').click();
    await settleScroll(track);
  }
  const end = await peekSidesOf(track);
  expect(end.left, 'last slide must peek a neighbour on the left').toBeGreaterThan(0);
  expect(end.right, 'last slide must still peek a neighbour on the RIGHT (loop wraps a clone in)').toBeGreaterThan(0);
});

// #4: the hero carousel must scroll endlessly in BOTH directions — a merchant
// asked for "donekonečna doleva i doprava". A bounded rail dead-ends (Next
// disables at the last slide); the loop keeps every control live and wraps.
test('hero carousel — loops endlessly, arrows never dead-end', async ({ page }, testInfo) => {
  const isDesktop = (testInfo.project.use.viewport?.width ?? 0) >= 990;
  test.skip(!isDesktop, 'exercise the desktop loop (mobile collapses to 1-up, still loops)');

  await open(page, '/', '[data-testid="won-hero-carousel-section"]');
  const sec = page.locator('[data-testid="won-hero-carousel-section"]').first();
  await sec.scrollIntoViewIfNeeded();
  const car = sec.locator('won-carousel').first();
  const track = sec.locator('[data-won-track]').first();
  await settleScroll(track);

  const reals = await track.evaluate((t: HTMLElement) => Array.from(t.children).filter((c) => !(c as HTMLElement).dataset.wonClone).length);
  // A full lap plus one: a non-looping rail's Next would already be disabled.
  for (let i = 0; i < reals + 1; i++) {
    await expect(car.locator('[data-won-next]'), 'Next must stay live all the way round').toBeEnabled();
    await car.locator('[data-won-next]').click();
    await settleScroll(track);
  }
  // After wrapping past the end we are back on a real, both-sides-peeking card.
  const wrapped = await peekSidesOf(track);
  expect(wrapped.left, 'after a full lap a neighbour still peeks left').toBeGreaterThan(0);
  expect(wrapped.right, 'after a full lap a neighbour still peeks right').toBeGreaterThan(0);
  // Backwards works too: Prev is live from the very first rest position.
  await expect(car.locator('[data-won-prev]'), 'Prev must be live so you can scroll left past the first slide').toBeEnabled();
});

// #3: on mobile a fractional-column carousel (columns_mobile 1.2) is a "peek"
// rail. Mid-scroll the active card should peek a neighbour on BOTH sides — the
// old start-snap pinned it left, so the left neighbour never showed.
test('won-carousel — mobile peek shows a neighbour on BOTH sides mid-scroll', async ({ page }, testInfo) => {
  const isMobile = (testInfo.project.use.viewport?.width ?? 9999) < 750;
  test.skip(!isMobile, 'mobile peek geometry is a phone concern');

  await open(page, '/', '[data-testid="won-hero-section"]');
  const cars = page.locator('won-carousel[data-mobile-mode*="."]');
  const n = await cars.count();
  if (n === 0) { testInfo.annotations.push({ type: 'skip', description: 'no fractional-column carousel on home' }); return; }

  let checked = 0;
  for (let i = 0; i < n; i++) {
    const car = cars.nth(i);
    await car.scrollIntoViewIfNeeded();
    const track = car.locator('[data-won-track]').first();
    const scrolls = await track.evaluate((t: HTMLElement) => t.scrollWidth > t.clientWidth + 4);
    if (!scrolls) continue;
    // Rest on a middle card, then look for a peek on each side of centre.
    await track.evaluate((t: HTMLElement) => { t.scrollLeft = Math.round((t.scrollWidth - t.clientWidth) / 2); });
    await settleScroll(track);
    const sides = await peekSidesOf(track);
    expect(sides.left, 'mid-scroll a neighbour must peek on the LEFT').toBeGreaterThan(0);
    expect(sides.right, 'mid-scroll a neighbour must peek on the right').toBeGreaterThan(0);
    checked++;
  }
  if (checked === 0) testInfo.annotations.push({ type: 'skip', description: 'no scrollable fractional carousel' });
});

// #2: the won-carousel "marquee" (běžící pás) layout rendered its items ONCE and
// then translated -50%, so the second half of every loop was blank — "nevykresluje
// dobře ten druhý blok". won-carousel.js now duplicates the belt into two groups.
test('won-carousel marquee — the belt is duplicated and spans >= 2x the viewport', async ({ page }, testInfo) => {
  const isDesktop = (testInfo.project.use.viewport?.width ?? 0) >= 990;
  test.skip(!isDesktop, 'measure the belt width at desktop');

  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  const car = page.locator('won-carousel.won-carousel--marquee').first();
  await car.waitFor({ state: 'visible' });
  await car.scrollIntoViewIfNeeded();
  const track = car.locator('[data-won-track]').first();
  const groups = track.locator('.won-carousel__mq-group');
  await groups.first().waitFor({ state: 'attached' });
  expect(await groups.count(), 'belt is built from two identical groups').toBe(2);
  await expect(groups.nth(1)).toHaveAttribute('aria-hidden', 'true');
  // Each group must be at least the viewport wide: the -50% translate advances by
  // exactly one group, so a group >= viewport means the other always fills the
  // frame — no blank half. (scrollWidth is unreliable mid-animation; measure the
  // groups' own layout widths instead.)
  const dims = await track.evaluate((t: HTMLElement) => ({
    container: Math.round(t.clientWidth),
    groups: [...t.querySelectorAll('.won-carousel__mq-group')].map((g) => (g as HTMLElement).offsetWidth),
  }));
  for (const gw of dims.groups) {
    expect(gw, `belt group ${gw}px must be >= its ${dims.container}px viewport (else a blank gap loops in)`)
      .toBeGreaterThanOrEqual(dims.container - 4);
  }
});

// The announcement bar replaces the old single-purpose shipping bar: each line is
// its own block (free-shipping progress + a promo message), individually managed.
test('announcement bar — every message renders and the free-shipping progress is live', async ({ page }) => {
  await open(page, '/', '[data-testid="won-announcement-bar-section"]');
  const bar = page.locator('won-announcement').first();
  await bar.waitFor({ state: 'visible' });
  const items = bar.locator('[data-annbar-item]');
  expect(await items.count(), 'both announcement blocks render').toBe(2);
  // open() forces reduced motion → the rotation never runs, so every message
  // must stay visible (nobody misses an announcement).
  await expect(items.nth(0)).toBeVisible();
  await expect(items.nth(1)).toBeVisible();
  // the free-shipping block carries a live progress bar
  await expect(bar.locator('[data-annbar-ship-fill]')).toHaveCount(1);
});

test('announcement bar — rotate shows exactly one message at a time (motion on)', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  const bar = page.locator('won-announcement').first();
  await bar.waitFor({ state: 'visible' });
  const items = bar.locator('[data-annbar-item]');
  const n = await items.count();
  let visible = 0;
  for (let i = 0; i < n; i++) if (await items.nth(i).isVisible()) visible++;
  expect(visible, 'rotate mode shows one message at a time').toBe(1);
});

// Sticky ATC gained floating styles (Center pill / Corner card) beside the
// original full-width bar. The Corner style is the merchant's "small bar bottom
// -right": it must NOT span the screen, must hug the bottom-inline-end corner,
// and must be rounded (the corner-radius token applies to floating styles). We
// force the variant class + reveal it (the IntersectionObserver only fires on
// scroll) and assert the CSS contract of the shipped style.
test('sticky ATC — corner style floats as a small rounded card at the bottom-inline-end', async ({ page }) => {
  await open(
    page,
    '/products/the-collection-snowboard-hydrogen',
    'form[action^="/cart/add"], [data-testid="won-variant-picker"]',
  );
  const sticky = page.locator('won-sticky-atc').first();
  expect(await sticky.count(), 'the product page renders the sticky ATC element').toBe(1);
  // Schema→class wiring: bar_style maps straight to won-sticky--{{ bar_style }};
  // the demo's default "full" proves the setting renders as its style class.
  await expect(sticky, 'the default bar_style renders its style class').toHaveClass(/won-sticky--full/);

  await sticky.evaluate((el) => {
    el.classList.remove('won-sticky--full');
    el.classList.add('won-sticky--corner', 'is-visible');
  });

  const box = await sticky.boundingBox();
  const vw = page.viewportSize()!.width;
  expect(box, 'the sticky element must lay out').toBeTruthy();
  // Not edge-to-edge — a corner card is much narrower than the screen.
  expect(box!.width, `corner card ${Math.round(box!.width)}px must be well under the ${vw}px viewport`).toBeLessThan(vw - 80);
  // Anchored to the inline-end (right in LTR): its right edge hugs the viewport.
  expect(vw - (box!.x + box!.width), 'corner card hugs the bottom-inline-end corner').toBeLessThan(40);
  // Rounded: the corner-radius token paints on the floating card.
  const radius = await sticky.evaluate((el) => parseFloat(getComputedStyle(el as HTMLElement).borderTopLeftRadius) || 0);
  expect(radius, 'corner card has rounded corners').toBeGreaterThan(0);
});

test('sticky ATC — center style floats as a centered pill, not full width', async ({ page }) => {
  await open(
    page,
    '/products/the-collection-snowboard-hydrogen',
    'form[action^="/cart/add"], [data-testid="won-variant-picker"]',
  );
  const sticky = page.locator('won-sticky-atc').first();
  await sticky.evaluate((el) => {
    el.classList.remove('won-sticky--full');
    el.classList.add('won-sticky--center', 'is-visible');
  });
  const box = await sticky.boundingBox();
  const vw = page.viewportSize()!.width;
  expect(box, 'the sticky element must lay out').toBeTruthy();
  // Floating, not edge-to-edge: a gap on BOTH sides (robust across viewports —
  // the pill caps at 100% - space token, centered by auto margins).
  expect(box!.x, 'center pill has a left gap (not edge-to-edge)').toBeGreaterThan(3);
  expect(vw - (box!.x + box!.width), 'center pill has a right gap (not edge-to-edge)').toBeGreaterThan(3);
  // …and sits horizontally centered.
  const centerX = box!.x + box!.width / 2;
  expect(Math.abs(centerX - vw / 2), 'center pill is horizontally centered').toBeLessThan(40);
});

test('announcement bar — the close button dismisses it for the session', async ({ page }) => {
  await open(page, '/', '[data-testid="won-announcement-bar-section"]');
  const sec = page.locator('[data-testid="won-announcement-bar-section"]').first();
  await expect(sec).toBeVisible();
  await page.locator('[data-annbar-close]').first().click();
  await expect(sec, 'closing the bar hides it').toBeHidden();
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(
    page.locator('[data-testid="won-announcement-bar-section"]').first(),
    'the dismissal persists across a reload (sessionStorage)',
  ).toBeHidden();
});
