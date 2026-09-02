import { test, expect } from '@playwright/test';

/**
 * Every surface that lists products must carry the same card.
 *
 * The collection page renders `won-product-card` (won-collection.liquid:82).
 * Search results rendered Horizon's own tile — `sections/search-results.liquid`
 * calls `content_for 'block', type: '_product-card'` — so the shopper with the
 * highest purchase intent, the one who typed a product name, got the poorest
 * card on the storefront: no rating, no price per unit, no add without a page load.
 *
 * Stated as an invariant, not a feature list: ONE product, compared to ITSELF on
 * two surfaces. Comparing whole grids would only measure which products happen to
 * carry a rating; comparing a product with itself measures the card. Add a fourth
 * listing surface later and it has to clear the same bar with no edit here.
 *
 * Affordances are probed by behaviour — a control that adds from the grid, a
 * rating a screen reader can announce, a price, a unit price — never by won-*
 * class names: the point is what the shopper can do, not whose markup did it.
 */

type Tile = { href: string; price: boolean; addControl: boolean; rating: boolean; unitPrice: boolean };

const readTiles = () => {
  const MONEY = /[\d]([.,]\d+)?\s*(Kč|CZK)|[$€£]\s*[\d]/;
  // Only the page's own listing counts. The header drawer's featured-content list
  // and the predictive-search dropdown also link to products with a price, and
  // they are not listing surfaces — reading them made this guard compare a
  // won card against a nav thumbnail.
  const root = document.querySelector('#MainContent, main, [role="main"]') || document.body;
  const links = [...root.querySelectorAll('a[href*="/products/"]')];
  const tiles = new Map<Element, string>();
  for (const a of links) {
    let el: Element | null = a;
    for (let i = 0; i < 6 && el; i++) {
      if (MONEY.test(el.textContent || '') && el.querySelector('a[href*="/products/"]')) {
        const href = (el.querySelector('a[href*="/products/"]') as HTMLAnchorElement).pathname;
        if (!tiles.has(el)) tiles.set(el, href);
        break;
      }
      el = el.parentElement;
    }
  }
  return [...tiles.entries()].map(([tile, href]) => {
    const txt = tile.textContent || '';
    return {
      href,
      price: MONEY.test(txt),
      addControl: !!tile.querySelector('button'),
      rating: !!tile.querySelector(
        '[class*="rating" i], [aria-label*="rating" i], [aria-label*="star" i], [aria-label*="hodnocen" i]',
      ),
      // "4,50 Kč / 100 g" — a per-unit figure next to the price.
      unitPrice: /\/\s*\d*\s*(g|kg|ml|l|ks|serving|dávk)/i.test(txt),
    };
  });
};

const searchUrl = (q: string) =>
  `/search?q=${encodeURIComponent(q)}&type=product&options%5Bprefix%5D=last`;

test('a product looks the same in search results as it does in a collection', async ({ page }) => {
  await page.goto('/collections/automated-collection', { waitUntil: 'load' });
  await page.waitForTimeout(900);
  const collectionTiles: Tile[] = await page.evaluate(readTiles);
  expect(collectionTiles.length, 'the collection listed no product tiles — the probe or the page is broken').toBeGreaterThan(0);

  // Compare the richest card the collection can produce: a weaker one would let a
  // regression through simply because that product has nothing to show.
  const score = (t: Tile) => Number(t.price) + Number(t.addControl) + Number(t.rating) + Number(t.unitPrice);
  const reference = [...collectionTiles].sort((a, b) => score(b) - score(a))[0];

  // Search for a word out of the product's own handle: deterministic, and it does
  // not depend on how the card happens to lay its title out.
  const term = (reference.href.split('/').pop() ?? '').split('-').find((w) => w.length > 4) ?? '';
  expect(term.length, `could not derive a search term from "${reference.href}"`).toBeGreaterThan(3);

  await page.goto(searchUrl(term), { waitUntil: 'load' });
  await page.waitForTimeout(900);
  const searchTiles: Tile[] = await page.evaluate(readTiles);
  const match = searchTiles.find((t) => t.href === reference.href);
  expect(
    match,
    `searching "${term}" did not return ${reference.href}, so the two surfaces cannot be compared — ` +
      `got ${JSON.stringify(searchTiles.map((t) => t.href))}`,
  ).toBeTruthy();

  for (const feature of ['price', 'addControl', 'rating', 'unitPrice'] as const) {
    expect(
      !reference[feature] || match![feature],
      `${reference.href} shows "${feature}" in the collection but not in search results — ` +
        `the shopper who searched, the one with the clearest intent, gets the weaker card. ` +
        `collection=${JSON.stringify(reference)} search=${JSON.stringify(match)}`,
    ).toBe(true);
  }
});
