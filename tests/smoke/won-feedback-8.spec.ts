import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Feedback round 8 (Ondřej, 30. 8. 2026) — one spec per reported defect, all
// written as GENERIC invariants so the next section/block that repeats the
// mistake fails here too, not in a screenshot six weeks later.
//
//  1. Rail controls (bar + arrows) must read as ONE control row, not two
//     stacked rows with the bar orphaned bottom-left.
//  2. Quick-add must be VISIBLE in the UI: /cart/add.js succeeded all along,
//     but nothing announced it to the host theme, so the header count stayed 0
//     and a shopper concluded "quick add is broken". Plus: the stepper (+/−)
//     must actually reach the page.
//  3. A row of won-feature items must start its body text on the same line,
//     whatever the heading wraps to.
//  4. The PDP packshot must not be CROPPED. Horizon silently ignores
//     `media_fit` unless `aspect_ratio: adapt`, so a fixed ratio forces
//     `media-fit-cover` and eats the top of a tall bottle.
//  5/6. PDP column order is data, guarded statically against the demo template.

const DEMO_PRODUCT_TEMPLATE = join(
  process.cwd(),
  'themes/demo/horizon/templates/product.json'
);

async function settle(page: Page) {
  await page.evaluate(async () => {
    window.scrollTo(0, document.body.scrollHeight);
    await new Promise((r) => setTimeout(r, 1800));
    window.scrollTo(0, 0);
    await new Promise((r) => setTimeout(r, 500));
  });
}

async function firstWonProductUrl(page: Page): Promise<string> {
  await page.goto('/', { waitUntil: 'load' });
  const href = await page
    .locator('.won-pcard a.won-pcard__media-link')
    .first()
    .getAttribute('href');
  expect(href, 'demo homepage must render at least one won product card').toBeTruthy();
  return href!;
}

/* ------------------------------------------------------------------ *
 * 1. Rail controls sit on ONE row                                    *
 * ------------------------------------------------------------------ */

test('rail progress bar and arrows share one control row', async ({ page }) => {
  await page.goto('/', { waitUntil: 'load' });
  await settle(page);

  const rows = await page.evaluate(() => {
    const shown = (el: Element | null) => {
      if (!el) return false;
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && cs.display !== 'none' && cs.visibility !== 'hidden';
    };
    return Array.from(document.querySelectorAll('won-carousel'))
      .map((rail) => {
        const bar = rail.querySelector('[data-won-progress]');
        const arrows = rail.querySelector('[data-won-arrows]');
        if (!shown(bar) || !shown(arrows)) return null;
        const b = bar!.getBoundingClientRect();
        const a = arrows!.getBoundingClientRect();
        return {
          section: (rail.closest('[id]') as HTMLElement | null)?.id ?? '?',
          barMid: b.top + b.height / 2,
          arrowsMid: a.top + a.height / 2,
        };
      })
      .filter(Boolean) as { section: string; barMid: number; arrowsMid: number }[];
  });

  test.skip(rows.length === 0, 'no rail shows both a bar and arrows at this width');

  for (const r of rows) {
    // Same row = same vertical centre. Stacked rows differ by a full control
    // height (44px + margins), so a 6px tolerance cannot pass by accident.
    expect(
      Math.abs(r.barMid - r.arrowsMid),
      `${r.section}: progress bar and arrows are on separate rows`
    ).toBeLessThanOrEqual(6);
  }
});

/* ------------------------------------------------------------------ *
 * 2. Quick add is visible in the host theme's UI                      *
 * ------------------------------------------------------------------ */

test('quick add updates the header cart count', async ({ page }) => {
  await page.goto('/', { waitUntil: 'load' });
  await page.evaluate(() => fetch('/cart/clear.js', { method: 'POST' }));
  await page.reload({ waitUntil: 'load' });
  await settle(page);

  const countInHeader = () =>
    page.evaluate(() => {
      const icon = document.querySelector('cart-icon');
      const m = (icon?.textContent ?? '').match(/(\d+)\s*$/);
      return m ? Number(m[1]) : NaN;
    });

  expect(await countInHeader(), 'cart must start empty').toBe(0);

  const card = page.locator('.won-pcard:has([data-won-add])').first();
  await card.scrollIntoViewIfNeeded();
  await card.hover();
  await page.waitForTimeout(600);
  await card.locator('[data-won-add]').click();

  await expect
    .poll(countInHeader, {
      message: 'header cart count must react to a card quick-add (no reload)',
      timeout: 8000,
    })
    .toBe(1);
});

test('card quick-add renders a stepper once the line exists', async ({ page }) => {
  await page.goto('/', { waitUntil: 'load' });
  await page.evaluate(() => fetch('/cart/clear.js', { method: 'POST' }));
  await page.reload({ waitUntil: 'load' });
  await settle(page);

  const card = page.locator('.won-pcard:has([data-won-stepper])').first();
  await expect(
    card,
    'the theme ships the stepper as its card quick-add — a card must declare one'
  ).toBeAttached();

  const add = card.locator('[data-won-add]');
  const qty = card.locator('span[data-won-qty]');
  const minus = card.locator('[data-won-step="-1"]');

  await card.scrollIntoViewIfNeeded();
  // A real click, never `force`: the reported defect was "it does not work",
  // so the control has to be genuinely hittable, not merely present.
  await card.hover();
  await page.waitForTimeout(600);
  await add.click();
  await expect(qty).toHaveText('1');
  await expect(minus).toBeVisible();

  // A second tap must reach 2 — the "+" must not stay locked behind the
  // "Added" confirmation timer.
  await add.click();
  await expect(qty).toHaveText('2');

  await minus.click();
  await expect(qty).toHaveText('1');

  await minus.click();
  await expect(qty).toBeHidden();
  await expect(minus).toBeHidden();

  const left = await page.evaluate(async () => (await (await fetch('/cart.js')).json()).item_count);
  expect(left, 'stepping down to zero must empty the line in the real cart').toBe(0);
});

/* ------------------------------------------------------------------ *
 * 3. A feature row starts its body text on one line                   *
 * ------------------------------------------------------------------ */

// Widths matter here: at 1440 every demo heading happens to fit on one line and
// the row looks aligned by luck. The defect only shows where a heading wraps,
// so the invariant is checked across the band where that happens.
const FEATURE_WIDTHS = [780, 1000, 1200, 1440];

test('won-feature rows align their body text across the row', async ({ page }) => {
  for (const width of FEATURE_WIDTHS) {
    await page.setViewportSize({ width, height: 1000 });
    await checkFeatureRows(page, width);
  }
});

async function checkFeatureRows(page: Page, width: number) {
  await page.goto('/', { waitUntil: 'load' });
  await settle(page);

  const groups = await page.evaluate(() => {
    const out: { grid: number; row: number; tops: number[]; titles: string[] }[] = [];
    document.querySelectorAll('.won-grid--blocks').forEach((grid, gi) => {
      const items = Array.from(grid.querySelectorAll('.won-feature')).filter((f) =>
        f.querySelector('.won-feature__text')
      );
      if (items.length < 2) return;
      // Group by grid row: items whose own top matches are in the same row.
      const byRow = new Map<number, { top: number; title: string }[]>();
      items.forEach((f) => {
        const rowKey = Math.round(f.getBoundingClientRect().top);
        const text = f.querySelector('.won-feature__text') as HTMLElement;
        const title = (f.querySelector('.won-feature__title') as HTMLElement)?.textContent?.trim() ?? '';
        const bucket = [...byRow.keys()].find((k) => Math.abs(k - rowKey) < 4) ?? rowKey;
        if (!byRow.has(bucket)) byRow.set(bucket, []);
        byRow.get(bucket)!.push({ top: text.getBoundingClientRect().top, title });
      });
      [...byRow.values()].forEach((row, ri) => {
        if (row.length < 2) return;
        out.push({ grid: gi, row: ri, tops: row.map((r) => r.top), titles: row.map((r) => r.title) });
      });
    });
    return out;
  });

  for (const g of groups) {
    const spread = Math.max(...g.tops) - Math.min(...g.tops);
    expect(
      spread,
      `@${width}px, grid ${g.grid} row ${g.row}: body text starts on different lines (${g.titles.join(' | ')})`
    ).toBeLessThanOrEqual(2);
  }
}

/* ------------------------------------------------------------------ *
 * 4. The PDP packshot is contained, not cropped                       *
 * ------------------------------------------------------------------ */

test('PDP main media shows the whole packshot with breathing room', async ({ page }) => {
  const url = await firstWonProductUrl(page);
  await page.goto(url, { waitUntil: 'load' });

  const media = await page.evaluate(() => {
    const img = document.querySelector('.product-media-container img') as HTMLImageElement | null;
    if (!img) return null;
    const cs = getComputedStyle(img);
    return {
      fit: cs.objectFit,
      padTop: parseFloat(cs.paddingTop),
      natural: [img.naturalWidth, img.naturalHeight] as [number, number],
      box: [img.clientWidth, img.clientHeight] as [number, number],
    };
  });

  expect(media, 'PDP must render a main product image').not.toBeNull();
  expect(
    media!.fit,
    'a catalogue packshot in a fixed box must be CONTAINed — `cover` eats the cap of a tall tub'
  ).toBe('contain');
  expect(
    media!.padTop,
    'the packshot needs space inside its box, not a lid flush against the edge'
  ).toBeGreaterThan(0);
});

/* ------------------------------------------------------------------ *
 * 5 + 6. PDP column composition (template data)                       *
 * ------------------------------------------------------------------ */

test('PDP puts the product description under the price, and ships no highlights block', () => {
  const tpl = JSON.parse(readFileSync(DEMO_PRODUCT_TEMPLATE, 'utf8'));
  const details = tpl.sections.main.blocks['product-details'];
  const order: string[] = details.block_order;
  const blocks = details.blocks as Record<string, { type: string; settings?: Record<string, unknown> }>;

  const descId = order.find(
    (id) =>
      blocks[id].type === 'text' &&
      String(blocks[id].settings?.text ?? '').includes('product.description')
  );
  expect(descId, 'the PDP column must bind a block to the product description').toBeTruthy();

  const groupId = order.find((id) => blocks[id].type === 'group');
  expect(groupId, 'the title/price group must exist').toBeTruthy();

  expect(
    order.indexOf(descId!),
    'the description belongs directly under the price group, not at the bottom of the column'
  ).toBe(order.indexOf(groupId!) + 1);

  expect(
    order.filter((id) => blocks[id].type === 'won-highlights'),
    'the highlights block duplicates the trust strip right below it — it must not ship in the demo PDP'
  ).toEqual([]);
});
