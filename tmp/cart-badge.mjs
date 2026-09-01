import { chromium } from '@playwright/test';
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1440, height: 1000 } });
await p.goto('http://127.0.0.1:9292/collections/automated-collection', { waitUntil: 'load' });
await p.waitForTimeout(1200);
await p.evaluate(() => fetch('/cart/clear.js', { method: 'POST' }));
await p.reload({ waitUntil: 'load' }); await p.waitForTimeout(1400);

const read = () => p.evaluate(() => {
  const bubble = document.querySelector('.cart-bubble');
  const txt = document.querySelector('#cart-bubble-text, .cart-bubble__text');
  const st = document.querySelector('[data-won-stepper]');
  return {
    bublinaSkryta: bubble ? bubble.classList.contains('visually-hidden') : null,
    pocitadlo: (txt?.textContent || '').trim() || '—',
    stepperQty: st?.getAttribute('data-won-qty-value') ?? '—',
  };
});
console.log('košík 0:', JSON.stringify(await read()));
const add = p.locator('[data-won-add]').first();
await add.scrollIntoViewIfNeeded(); await add.click({ force: true }); await p.waitForTimeout(2500);
console.log('košík 1:', JSON.stringify(await read()));
const plus = p.locator('[data-won-stepper] .won-pcard__plus, [data-won-plus]').first();
if (await plus.count()) { await plus.click({ force: true }); await p.waitForTimeout(2200); }
console.log('košík 2:', JSON.stringify(await read()));
await p.evaluate(() => fetch('/cart/clear.js', { method: 'POST' }));
await b.close();
