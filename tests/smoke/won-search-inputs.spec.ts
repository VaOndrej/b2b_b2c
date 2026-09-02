import { test, expect } from '@playwright/test';

/**
 * One search box per page, and every search box behaves the same.
 *
 * Two defects, both created or exposed by moving search into the header:
 *
 * 1. `/search` now paints TWO fields — the sticky header one and the
 *    `_search-input` block that `sections/search-header.liquid` renders
 *    statically. Two identical boxes 150px apart is a "which one is real?"
 *    moment on the page where the shopper is already hunting.
 *
 * 2. They do not behave the same. The header form sends
 *    `options[prefix]=last`; `blocks/_search-input.liquid` sends only
 *    `type=product` and `search-page-input.js` handles nothing but Escape, so
 *    Enter is a plain native submit. Storefront `/search` matches whole tokens
 *    unless asked otherwise — so "krea" finds Kreatin from the header and
 *    nothing from the page field. Same query, same shop, two answers.
 *
 * Stated as invariants over whatever forms exist, so a third entry point added
 * later has to clear the same bar: count what the shopper can see, and read the
 * parameters off every form rather than naming the two we know about.
 */

test('the search page paints exactly one search field', async ({ page }) => {
  await page.goto('/search?q=kreatin&type=product&options%5Bprefix%5D=last', { waitUntil: 'load' });
  await page.waitForTimeout(700);

  const fields = await page.evaluate(() =>
    [...document.querySelectorAll('input[name="q"]')]
      .filter((el) => {
        const r = el.getBoundingClientRect();
        const cs = getComputedStyle(el);
        const dialog = el.closest('dialog');
        if (dialog && !dialog.hasAttribute('open')) return false;
        return r.width > 1 && r.height > 1 && cs.visibility !== 'hidden' && Number(cs.opacity) > 0.05;
      })
      .map((el) => {
        const r = el.getBoundingClientRect();
        return { y: Math.round(r.top + window.scrollY), w: Math.round(r.width), ph: el.getAttribute('placeholder') };
      }),
  );

  expect(
    fields.length,
    `the search page shows ${fields.length} search boxes at once: ${JSON.stringify(fields)} — ` +
      `the shopper cannot tell which one is the real one`,
  ).toBe(1);
});

const FORM_PARAMS = () =>
  [...document.querySelectorAll('form[action*="/search"]')]
    .filter((f) => f.querySelector('input[name="q"]'))
    .map((f) => {
      const names = [...f.querySelectorAll('input, select')].map((i) => (i as HTMLInputElement).name);
      const value = (n: string) =>
        (f.querySelector(`[name="${n}"]`) as HTMLInputElement | null)?.value ?? null;
      return {
        action: (f as HTMLFormElement).getAttribute('action'),
        hasType: names.includes('type'),
        type: value('type'),
        prefix: value('options[prefix]'),
      };
    });

for (const pg of [
  { name: 'home', path: '/' },
  { name: 'search page', path: '/search?q=kreatin&type=product&options%5Bprefix%5D=last' },
]) {
  test(`${pg.name} — every search form asks for products and for partial words`, async ({ page }) => {
    await page.goto(pg.path, { waitUntil: 'load' });
    await page.waitForTimeout(700);

    const forms = await page.evaluate(FORM_PARAMS);
    expect(forms.length, 'no search form on the page at all').toBeGreaterThan(0);

    for (const f of forms) {
      // sections/search-results.liquid fills the grid from
      // `where: 'object_type','product'` but counts every resource type, so a
      // form without type=product can report "12 products" over an empty grid.
      expect(f.type, `a search form submits without type=product: ${JSON.stringify(f)}`).toBe('product');
      // Without options[prefix]=last, /search matches whole tokens only: the
      // dropdown finds "krea" -> Kreatin, the results page finds nothing.
      expect(
        f.prefix,
        `a search form submits without options[prefix]=last, so partial words die on the ` +
          `results page: ${JSON.stringify(f)}`,
      ).toBe('last');
    }
  });
}
