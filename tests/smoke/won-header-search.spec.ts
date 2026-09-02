import { test, expect } from '@playwright/test';

/**
 * Search in the header — HP-004 + SRH-004, both "vysoká".
 *
 * Horizon renders search as a magnifier button only: `snippets/search.liquid`
 * emits a `<search-button>` whose click opens `#search-modal`. The one
 * `input[name="q"]` on the page lives inside that closed `<dialog>`, so a
 * shopper cannot type until they have discovered and clicked an icon.
 *
 * HP-004: "Vyhledávací pole musí být plně viditelné bez klikání na ikonu."
 * SRH-004: "Search pole má být plně viditelné/sticky, ne jen ikona lupy."
 * Searchers convert far better than browsers, so the field is a revenue control,
 * not decoration.
 *
 * Asserted behaviourally, never by class name:
 *   - a search input is painted inside the header with NO interaction,
 *   - it accepts typing (so it is a real control, not a decorative box),
 *   - it carries a placeholder that names what to search for,
 *   - it survives scrolling (sticky), and
 *   - it is a large enough tap/click target to be used.
 * A future header rewrite that goes back to an icon fails this on its own.
 */

const PAGES = [
  { name: 'home', path: '/' },
  { name: 'collection', path: '/collections/automated-collection' },
  { name: 'PDP', path: '/products/the-collection-snowboard-liquid' },
];

// Reads the search field the shopper can actually use: inside the header, painted,
// not inside a closed dialog, not zero-sized.
const probeFn = () => {
  const header = document.querySelector('#header-component, .header-section, header');
  if (!header) return { header: false, fields: [] as any[], buttons: 0 };
  const fields = [...header.querySelectorAll('input[name="q"]')].map((el) => {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    const dialog = el.closest('dialog');
    return {
      w: Math.round(r.width),
      h: Math.round(r.height),
      placeholder: el.getAttribute('placeholder') || '',
      inClosedDialog: !!dialog && !dialog.hasAttribute('open'),
      painted:
        r.width > 1 &&
        r.height > 1 &&
        cs.visibility !== 'hidden' &&
        cs.display !== 'none' &&
        Number(cs.opacity) > 0.05,
    };
  });
  const buttons = header.querySelectorAll('search-button, [class*="search-modal__button"]').length;
  return { header: true, fields, buttons };
};

for (const pg of PAGES) {
  test(`${pg.name} — the header shows a usable search field, not just an icon`, async ({ page }, testInfo) => {
    await page.goto(pg.path, { waitUntil: 'load' });
    await page.waitForTimeout(600);

    const probe = await page.evaluate(probeFn);
    expect(probe.header, 'no header element found at all').toBe(true);

    const usable = probe.fields.filter((f: any) => f.painted && !f.inClosedDialog);
    expect(
      usable.length,
      `header has ${probe.fields.length} search input(s) and ${probe.buttons} search button(s), ` +
        `but none is usable without a click: ${JSON.stringify(probe.fields)} (HP-004 / SRH-004)`,
    ).toBeGreaterThanOrEqual(1);

    const field = usable[0];
    expect(field.placeholder.length, 'the field must tell the shopper what to search for').toBeGreaterThan(2);

    // Minimum tap target — the field is the primary way into the catalogue.
    const minH = testInfo.project.name === 'mobile' ? 36 : 32;
    expect(field.h, `search field is ${field.h}px tall, unusable as a target`).toBeGreaterThanOrEqual(minH);
    // Wide enough to show a query, proportional so it holds at both breakpoints.
    const vw = page.viewportSize()!.width;
    expect(
      field.w,
      `search field is ${field.w}px wide on a ${vw}px viewport — too narrow to type a product name into`,
    ).toBeGreaterThanOrEqual(Math.round(vw * 0.2));
  });

  test(`${pg.name} — the search field accepts typing and stays reachable when scrolled`, async ({ page }) => {
    await page.goto(pg.path, { waitUntil: 'load' });
    await page.waitForTimeout(600);

    const input = page
      .locator('#header-component input[name="q"], .header-section input[name="q"], header input[name="q"]')
      .filter({ visible: true })
      .first();
    await expect(input, 'no visible search input in the header (HP-004)').toBeVisible();

    // A real control, not a decorative box: no click needed to focus and type.
    await input.fill('snowboard');
    await expect(input).toHaveValue('snowboard');

    // SRH-004 — sticky: still on screen after the shopper has scrolled away.
    await page.evaluate(() => window.scrollTo(0, 1600));
    await page.waitForTimeout(500);
    const after = await input.evaluate((el) => {
      const r = el.getBoundingClientRect();
      return { top: Math.round(r.top), bottom: Math.round(r.bottom), h: Math.round(r.height) };
    });
    const vh = page.viewportSize()!.height;
    expect(
      after.bottom > 0 && after.top < vh && after.h > 1,
      `after scrolling 1600px the search field sits at top=${after.top} bottom=${after.bottom} ` +
        `outside the ${vh}px viewport — it scrolled away (SRH-004)`,
    ).toBe(true);
  });
}

test('submitting the header field lands on the search results page for products', async ({ page }) => {
  await page.goto('/', { waitUntil: 'load' });
  await page.waitForTimeout(600);

  const input = page.locator('.won-header-search input[name="q"]').filter({ visible: true }).first();
  await input.fill('krea');
  await Promise.all([page.waitForURL(/\/search/, { timeout: 20_000 }), input.press('Enter')]);

  const url = new URL(page.url());
  expect(url.searchParams.get('q'), 'the query must reach the results page').toBe('krea');
  // sections/search-results.liquid renders `where: 'object_type', 'product'` but counts
  // every resource type — without type=product the toolbar count and the grid disagree.
  expect(url.searchParams.get('type'), 'the header form must scope the results to products').toBe('product');
  // Storefront /search matches whole tokens unless asked otherwise: "krea" would
  // find nothing even though the dropdown showed a match.
  expect(url.searchParams.get('options[prefix]'), 'partial words must still match on the results page').toBe('last');

  const results = await page.evaluate(() => document.querySelectorAll('[data-product-grid-content], .product-grid a[href*="/products/"]').length);
  expect(results, 'the results page came back with nothing for a term the dropdown matched').toBeGreaterThan(0);
});
