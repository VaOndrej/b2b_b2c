import { test, expect } from '@playwright/test';

// Product-card quick add — the theme-wide control (won_card_add_mode /
// _align / _reveal).
//
// Two things this guards, both of which broke while it was being built:
//
//  1. The stepper must track the CART, not a counter in the page. The first
//     version set the quantity to a hardcoded 1 on every add, so a second tap
//     still read "1", and it sent /cart/change.js a variant id instead of the
//     line key — which cannot address a line and silently changed nothing.
//  2. Placement and reveal are settings, so the card must declare them. A
//     hard-pinned bottom-right button fights a centred card layout, and "reveal
//     on hover" is unusable on touch.
//
// Mode-agnostic: the demo ships `button`, so the stepper assertions run only
// where a stepper is actually rendered. That keeps the guard alive for whoever
// switches the setting instead of asserting today's demo data.

test('card declares its quick-add placement and reveal', async ({ page }) => {
  await page.goto('/', { waitUntil: 'load' });
  const card = page.locator('.won-pcard').first();
  await expect(card).toBeAttached();
  const cls = (await card.getAttribute('class')) || '';
  expect(cls, 'card must carry the resolved quick-add position').toMatch(/won-pcard--add-(start|center|end)/);
  expect(cls, 'card must carry the resolved reveal mode').toMatch(/won-pcard--reveal-(hover|always)/);
});

test('quick-add control is reachable and correctly sized for touch', async ({ page }) => {
  await page.goto('/', { waitUntil: 'load' });
  await page.evaluate(async () => {
    window.scrollTo(0, document.body.scrollHeight);
    await new Promise((r) => setTimeout(r, 1500));
    window.scrollTo(0, 0);
    await new Promise((r) => setTimeout(r, 400));
  });
  const add = page.locator('.won-pcard [data-won-add]').first();
  test.skip((await add.count()) === 0, 'no quick-add on this page');
  const box = await add.boundingBox();
  expect(box, 'quick-add must be laid out').not.toBeNull();
  // WCAG 2.5.5 floor, and the same --won-tap token the theme uses elsewhere.
  expect(box!.height, `quick-add is ${Math.round(box!.height)}px tall`).toBeGreaterThanOrEqual(40);
});

test('stepper quantity follows the cart', async ({ page }) => {
  await page.goto('/', { waitUntil: 'load' });
  // The cart is shared state across this suite: a leftover line from another
  // spec makes the "hidden until the line exists" assertion below a lie.
  await page.evaluate(() => fetch('/cart/clear.js', { method: 'POST' }));
  await page.reload({ waitUntil: 'load' });
  await page.evaluate(async () => {
    window.scrollTo(0, document.body.scrollHeight);
    await new Promise((r) => setTimeout(r, 1800));
    window.scrollTo(0, 0);
    await new Promise((r) => setTimeout(r, 600));
  });

  const card = page.locator('.won-pcard:has([data-won-stepper])').first();
  test.skip((await card.count()) === 0, 'theme is in plain button mode — no stepper to exercise');

  const add = card.locator('[data-won-add]');
  const qty = card.locator('span[data-won-qty]');
  const minus = card.locator('[data-won-step="-1"]');

  await card.scrollIntoViewIfNeeded();
  // Quick-add is revealed on hover on pointer devices; lazy images are still
  // settling right after the scroll sweep, so hover and let the row come to rest
  // before clicking. Deliberately a REAL click, never `force` — the point is
  // that a shopper can actually hit the control.
  await card.hover();
  await page.waitForTimeout(600);
  await expect(qty, 'quantity is hidden until the line exists').toBeHidden();
  await expect(minus, 'minus is hidden until the line exists').toBeHidden();

  await add.click();
  await expect(qty).toBeVisible({ timeout: 10_000 });
  await expect(qty).toHaveText('1');

  await add.click();
  // A second add must reach 2 — the bug was a hardcoded 1 that never moved.
  await expect(qty).toHaveText('2', { timeout: 10_000 });

  await minus.click();
  await expect(qty).toHaveText('1', { timeout: 10_000 });

  // The card is deliberately ahead of the network: taps are batched and the
  // number moves on the tap, not on the response. So the cart is polled until it
  // settles rather than read the instant the display stops moving — the
  // assertion is that the two AGREE, not that the server is synchronous.
  await expect
    .poll(
      async () => {
        const cart = await page.evaluate(async () =>
          (await fetch('/cart.js', { headers: { Accept: 'application/json' } })).json()
        );
        return (cart.items || []).reduce((n: number, i: { quantity: number }) => n + i.quantity, 0);
      },
      { message: 'the cart itself must agree with what the card shows', timeout: 10_000 }
    )
    .toBe(1);
});
