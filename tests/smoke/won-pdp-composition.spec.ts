import { test, expect } from '@playwright/test';

/**
 * PDP composition invariants.
 *
 * Written against BEHAVIOUR, not a list of sections — a new won block dropped
 * into a band or a new PDP section must satisfy these too. Every assertion here
 * corresponds to a defect found in the 2026-08-30 visual audit
 * (won-theme-generic/.agents/audits/pdp-visual-audit-2026-08-30.md).
 */

const PDP = '/products/the-videographer-snowboard';

async function goto(page: import('@playwright/test').Page) {
  await page.goto(PDP, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('load').catch(() => {});
  await page.waitForTimeout(600);
}

test('data blocks inside a band fill their content column', async ({ page }) => {
  await goto(page);

  const offenders = await page.evaluate(() => {
    const bad: { block: string; w: number; colW: number }[] = [];
    for (const content of document.querySelectorAll<HTMLElement>('.won-band__content')) {
      const colW = content.getBoundingClientRect().width;
      if (colW < 1) continue;
      for (const wrap of content.children) {
        // Shopify wraps every theme block in div.shopify-block.
        if (!wrap.classList.contains('shopify-block')) continue;
        // Only blocks that carry tabular/list data owe a full-width row.
        const data = wrap.querySelector('table, ul, ol, [class*="__list"], [class*="__rows"]');
        if (!data) continue;
        const w = (data as HTMLElement).getBoundingClientRect().width;
        if (w < colW * 0.8) {
          bad.push({ block: wrap.className + ' > ' + (data as HTMLElement).className, w: Math.round(w), colW: Math.round(colW) });
        }
      }
    }
    return bad;
  });

  expect(offenders, `data blocks collapsed to content width instead of filling the band column: ${JSON.stringify(offenders)}`).toEqual([]);
});

test('the product title is the largest heading on the PDP', async ({ page }) => {
  await goto(page);

  const { h1, bigger } = await page.evaluate(() => {
    const px = (el: Element) => parseFloat(getComputedStyle(el).fontSize);
    const visible = (el: Element) => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    };
    const h1El = [...document.querySelectorAll('h1')].find(visible);
    const h1 = h1El ? px(h1El) : 0;
    const bigger = [...document.querySelectorAll('h2, h3')]
      .filter(visible)
      .filter((el) => px(el) > h1)
      .map((el) => ({ t: el.textContent!.trim().slice(0, 40), fs: px(el) }));
    return { h1, bigger };
  });

  expect(h1).toBeGreaterThan(0);
  expect(bigger, `headings larger than the product title (${h1}px): ${JSON.stringify(bigger)}`).toEqual([]);
});

test('no schema placeholder copy leaks onto the storefront', async ({ page }) => {
  await goto(page);
  // Read the rendered text directly: `main` can resolve to more than one node and
  // innerText on a hidden candidate is flaky on the mobile project.
  const body = (await page.evaluate(() => document.body.innerText)).toLowerCase();
  for (const placeholder of ['section heading', 'nadpis sekce', 'lorem ipsum']) {
    expect(body, `placeholder "${placeholder}" rendered on the storefront`).not.toContain(placeholder);
  }
});

test('a data block with no rows renders no orphan heading', async ({ page }) => {
  await goto(page);

  const orphans = await page.evaluate(() => {
    const bad: string[] = [];
    // Any won block root whose only visible content is its own heading.
    for (const root of document.querySelectorAll<HTMLElement>('[class^="won-"][class*="__heading"]')) {
      const block = root.closest('.shopify-block') as HTMLElement | null;
      if (!block) continue;
      const text = block.innerText.trim();
      if (text && text === root.innerText.trim()) bad.push(text.slice(0, 40));
    }
    return bad;
  });

  expect(orphans, `blocks rendering a heading with no content: ${JSON.stringify(orphans)}`).toEqual([]);
});

test('product media is never smaller than the buy box column', async ({ page }) => {
  for (const width of [768, 1024, 1280, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await goto(page);
    const m = await page.evaluate(() => {
      const g = document.querySelector('media-gallery, .product-media-container, [class*="product-media"]');
      const d = document.querySelector('.product-details, [class*="product-details"]');
      if (!g || !d) return null;
      return { g: Math.round(g.getBoundingClientRect().width), d: Math.round(d.getBoundingClientRect().width) };
    });
    if (!m) continue;
    // The defect was a postage-stamp gallery (280px next to a 384px buy box at 768).
    // Columns are allowed to differ by the details column's own inline padding, so
    // assert the ratio, not strict equality.
    expect(m.g / m.d, `at ${width}px the media column (${m.g}px) is much narrower than the buy box (${m.d}px)`).toBeGreaterThanOrEqual(0.9);
  }
});

/**
 * REMOVED — 'the unit price tracks the selected variant price'.
 *
 * Its premise was the bug: "the reference amount is a product-level value, so
 * when only the price moves the unit price must move by the SAME factor." On a
 * size or count axis the reference amount moves WITH the variant (weight and
 * servings live on the variant), so a correct implementation must NOT scale the
 * unit price 1:1 with the price — this test would have failed the fix and passed
 * the fiction it was meant to catch. It also went green against a block that
 * divided every price by a hardcoded 1000.
 *
 * The contract it was reaching for (a block that freezes on the first variant is
 * a wrong number) is subsumed, and stated correctly, by
 * tests/smoke/won-unit-price-honesty.spec.ts: the reference amount implied by the
 * printed number must track the quantity on the variant axis. A frozen block
 * implies a constant amount and fails there.
 */

test('the sticky bar repeats the buy box CTA, it does not restyle it', async ({ page }) => {
  await goto(page);
  // The bar only mounts once the buy box scrolls away.
  await page.evaluate(() => window.scrollTo(0, window.innerHeight * 2));
  await page.waitForTimeout(1200);

  const m = await page.evaluate(() => {
    const sticky = document.querySelector('.won-sticky__atc') as HTMLElement | null;
    const buy = document.querySelector(
      '.product-form__buttons button[name="add"], button[name="add"]'
    ) as HTMLElement | null;
    if (!sticky || !buy) return null;
    const pick = (el: HTMLElement) => {
      const cs = getComputedStyle(el);
      return { bg: cs.backgroundColor, radius: cs.borderTopLeftRadius, label: el.innerText.trim().toLowerCase() };
    };
    return { sticky: pick(sticky), buy: pick(buy) };
  });
  if (!m) test.skip(true, 'no sticky bar or no add-to-cart button on this PDP');

  // One action must not present itself as two different offers. The bug: a black
  // 14px "Add to cart" in the buy box and an orange pill "Do košíku" in the bar.
  expect(m!.sticky.bg, 'sticky CTA colour differs from the buy box CTA').toBe(m!.buy.bg);
  expect(m!.sticky.radius, 'sticky CTA corner radius differs from the buy box CTA').toBe(m!.buy.radius);
  expect(m!.sticky.label, 'sticky CTA wording differs from the buy box CTA').toBe(m!.buy.label);
});
