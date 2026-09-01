import { chromium } from '@playwright/test';
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1440, height: 1000 } });
await p.goto('http://127.0.0.1:9292/products/the-multi-location-snowboard', { waitUntil: 'load' });
await p.waitForTimeout(1500);
const read = () => p.locator('.won-ppu').first().innerText().catch(() => '(nic)');
const price = () => p.locator('.price, [class*="price"]').first().innerText().catch(() => '?');
console.log('start:', (await read()).replace(/\n/g,' '), '| cena', (await price()).replace(/\n/g,' '));
// click the second variant option
const opts = p.locator('variant-picker label, .variant-option label, fieldset label');
const n = await opts.count();
console.log('nalezeno labelů variant:', n);
for (let i = 0; i < n; i++) {
  const t = (await opts.nth(i).innerText().catch(()=>'')).trim();
  if (/180/.test(t)) { await opts.nth(i).click(); console.log('kliknuto na:', t); break; }
}
await p.waitForTimeout(2500);
console.log('po přepnutí:', (await read()).replace(/\n/g,' '), '| cena', (await price()).replace(/\n/g,' '));
await p.screenshot({ path: 'tmp/ppu-shots/kapsle-180-desktop-1440.png' });
await b.close();
