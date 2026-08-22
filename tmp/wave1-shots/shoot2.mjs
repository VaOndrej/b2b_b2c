import { chromium } from '@playwright/test';
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1440, height: 1000 } });
await p.goto('http://127.0.0.1:9292/', { waitUntil: 'load' });
// sipky se skryvaji, kdyz se rail vejde na jednu stranku -> vezmi prvni VIDITELNE
const all = p.locator('.won-carousel__arrows');
const n = await all.count();
for (let i = 0; i < n; i++) {
  const a = all.nth(i);
  if (await a.isVisible().catch(() => false)) {
    await a.scrollIntoViewIfNeeded(); await p.waitForTimeout(300);
    await a.screenshot({ path: 'tmp/wave1-shots/arrows-desktop-1440.png' });
    console.log('sipky zachyceny z carouselu #' + i);
    break;
  }
}
const g = p.locator('won-carousel.won-carousel--scroll-sm').first();
await g.scrollIntoViewIfNeeded(); await p.waitForTimeout(300);
await g.screenshot({ path: 'tmp/wave1-shots/grid-scroll-desktop-1440.png' });
await b.close();
