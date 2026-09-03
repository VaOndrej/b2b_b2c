import { test, expect } from '@playwright/test';

// Won toasts — the native cart message.
//
// What this guards, in the order the bugs actually appeared:
//
//  1. The type of a message is derived from the DIFFERENCE between two carts,
//     never from which button was pressed. A batched burst of five taps arrives
//     as one cart, so it must read as five — not as a bare "added".
//  2. One message per variant. Five taps on one card are one fact; five cards
//     are five, capped by the merchant's limit.
//  3. Off means absent. A merchant who switches toasts off gets no region, and
//     therefore no listener — not a hidden div.
//  4. Toasts and the drawer must not both claim the screen. While toasts are on,
//     the drawer stops opening by itself.
//  5. A top-anchored toast must clear the header, or it covers the cart badge
//     the shopper just earned.
//
// Setting-agnostic where it can be: the assertions read the region's own data
// attributes rather than assuming today's defaults.

const REGION = '[data-won-toast]';
const ITEM = '[data-won-toast-item]';

/** The "+" of the first stepper on the page, clicked with a real pointer at a
 *  fixed point — a locator click re-finds the button after the card lifts on
 *  hover, which is exactly the miss a shopper cannot reproduce. */
async function tapPlus(page: import('@playwright/test').Page, nth = 0) {
  const stepper = page.locator('[data-won-stepper]').nth(nth);
  await stepper.scrollIntoViewIfNeeded();
  await page.waitForTimeout(200);
  const hover = await stepper.boundingBox();
  await page.mouse.move(hover!.x + hover!.width - 18, hover!.y + hover!.height / 2);
  await page.waitForTimeout(120);
  const box = await stepper.boundingBox();
  await page.mouse.click(box!.x + box!.width - 18, box!.y + box!.height / 2);
  return box!;
}

test.beforeEach(async ({ page }) => {
  await page.goto('/collections/all', { waitUntil: 'load' });
  await page.evaluate(() => fetch('/cart/clear.js', { method: 'POST' }));
  await page.waitForTimeout(400);
});

test('adding to the cart shows one toast naming the product', async ({ page }) => {
  test.skip((await page.locator(REGION).count()) === 0, 'toasts are switched off');
  test.skip((await page.locator('[data-won-stepper]').count()) === 0, 'no stepper on this page');

  await tapPlus(page);
  await expect(page.locator(ITEM)).toHaveCount(1);
  const text = await page.locator(ITEM).first().innerText();
  expect(text.replace('×', '').trim().length, 'toast must name the product').toBeGreaterThan(3);
});

test('repeat taps on one card rewrite one toast rather than stacking', async ({ page }) => {
  test.skip((await page.locator(REGION).count()) === 0, 'toasts are switched off');
  test.skip((await page.locator('[data-won-stepper]').count()) === 0, 'no stepper on this page');

  const box = await tapPlus(page);
  for (let i = 0; i < 4; i++) {
    await page.mouse.click(box.x + box.width - 18, box.y + box.height / 2);
    await page.waitForTimeout(110);
  }
  await page.waitForTimeout(1600);

  await expect(page.locator(ITEM)).toHaveCount(1);
  const count = await page.evaluate(async () => (await (await fetch('/cart.js')).json()).item_count);
  expect(count, 'five taps must land as five').toBe(5);
  // The message states how many are in the cart NOW — not how many the last tap
  // moved — so the number must equal the cart, whatever the batching did.
  await expect(page.locator(ITEM).first().locator('.won-toast__qty')).toHaveText(String(count));
});

test('a burst across different cards is capped at the configured maximum', async ({ page }) => {
  test.skip((await page.locator(REGION).count()) === 0, 'toasts are switched off');
  const steppers = await page.locator('[data-won-stepper]').count();
  test.skip(steppers < 6, 'needs six steppers on the page');

  const max = Number(await page.locator(REGION).getAttribute('data-max')) || 3;
  for (let i = 0; i < 6; i++) {
    await tapPlus(page, i);
    await page.waitForTimeout(140);
  }
  await page.waitForTimeout(1800);

  const shown = await page.locator(ITEM).count();
  expect(shown, `six cards produced ${shown} toasts, cap is ${max}`).toBeLessThanOrEqual(max);
  expect(shown, 'the cap must not silence toasts entirely').toBeGreaterThan(0);
});

test('emptying the cart reports removals, one per variant', async ({ page }) => {
  test.skip((await page.locator(REGION).count()) === 0, 'toasts are switched off');
  test.skip((await page.locator('[data-won-stepper]').count()) === 0, 'no stepper on this page');

  await tapPlus(page);
  await page.waitForTimeout(1000);
  await page.evaluate(() => document.querySelectorAll('[data-won-toast-item]').forEach((e) => e.remove()));
  await page.evaluate(() =>
    fetch('/cart/clear.js', { method: 'POST' })
      .then((r) => r.json())
      .then((cart) => document.dispatchEvent(new CustomEvent('cart:refresh', { detail: { cart } })))
  );
  await page.waitForTimeout(900);

  await expect(page.locator('[data-won-toast-item][data-type="removed"]')).toHaveCount(1);
});

test('the toast is two lines, and a decrease reads differently from an increase', async ({ page }) => {
  test.skip((await page.locator(REGION).count()) === 0, 'toasts are switched off');
  test.skip((await page.locator('[data-won-stepper]').count()) === 0, 'no stepper on this page');

  const box = await tapPlus(page);
  await expect(page.locator(ITEM)).toHaveCount(1);

  // Line one names the product, line two says what happened to it. They are
  // separate elements so the name can be truncated without eating the message.
  const toast = page.locator(ITEM).first();
  await expect(toast.locator('.won-toast__title')).not.toBeEmpty();
  await expect(toast.locator('.won-toast__label')).not.toBeEmpty();
  // The number is the resulting quantity in the cart, not the size of the change.
  await expect(toast.locator('.won-toast__qty')).toHaveText('1');
  await expect(toast).toHaveAttribute('data-type', 'added');

  const added = await toast.locator('.won-toast__qty').evaluate((el) => getComputedStyle(el).color);

  // Now the other direction. Colour must not be the ONLY difference — the number
  // and the wording carry it too — but it must actually differ.
  const minus = page.locator('[data-won-stepper]').first().locator('[data-won-step="-1"]');
  await page.mouse.move(box.x + 18, box.y + box.height / 2);
  await page.waitForTimeout(150);
  await minus.click();
  await expect(page.locator(ITEM).first()).toHaveAttribute('data-type', /decreased|removed/);

  // Taking the last one out is a removal, and a removal shows no number at all —
  // "0 in cart" describes arithmetic, not a cart.
  const down = page.locator(ITEM).first().locator('.won-toast__qty');
  await expect(down).toBeHidden();
  const removedColour = await down.evaluate((el) => getComputedStyle(el).color);
  expect(removedColour, 'a decrease must not look like an increase').not.toBe(added);
});

test('the thumbnail spans the full height of the toast', async ({ page }) => {
  test.skip((await page.locator(REGION).count()) === 0, 'toasts are switched off');
  test.skip(await page.locator(REGION).getAttribute('data-media') !== '1', 'thumbnails are switched off');
  test.skip((await page.locator('[data-won-stepper]').count()) === 0, 'no stepper on this page');

  await tapPlus(page);
  await expect(page.locator(ITEM)).toHaveCount(1);
  const toast = await page.locator(ITEM).first().boundingBox();
  const media = await page.locator(ITEM).first().locator('.won-toast__media').boundingBox();
  // Within a pixel of the card's own height, borders included.
  expect(Math.abs(media!.height - toast!.height), 'the thumbnail must run edge to edge').toBeLessThanOrEqual(3);
});

test('while toasts are on, the cart drawer does not open by itself', async ({ page }) => {
  test.skip((await page.locator(REGION).count()) === 0, 'toasts are switched off');
  await expect(page.locator('cart-drawer-component[auto-open]')).toHaveCount(0);
});

test('a top-anchored toast clears the header', async ({ page }) => {
  test.skip((await page.locator(REGION).count()) === 0, 'toasts are switched off');
  const position = (await page.locator(REGION).getAttribute('class')) || '';
  test.skip(!position.includes('--top'), 'toasts are anchored to the bottom');
  test.skip((await page.locator('[data-won-stepper]').count()) === 0, 'no stepper on this page');

  await tapPlus(page);
  await expect(page.locator(ITEM)).toHaveCount(1);

  const toast = await page.locator(ITEM).first().boundingBox();
  const headerBottom = await page.evaluate(() => {
    let bottom = 0;
    document.querySelectorAll('.shopify-section-group-header-group, .header').forEach((el) => {
      bottom = Math.max(bottom, el.getBoundingClientRect().bottom);
    });
    return bottom;
  });
  expect(toast!.y, 'the toast must not cover the header or the cart badge').toBeGreaterThanOrEqual(headerBottom);
});
